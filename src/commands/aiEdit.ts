/**
 * AI tab, Edit and Select groups. On-device models (MODNet, Depth Anything, LaMa, Swin2SR) do the
 * work when they can; the picture service does edits by instruction, fills and replacements with
 * a mask built from the selection. Results open as a new labeled picture or replace the current
 * one as an undoable step (AI ▸ Active AI).
 */
import { def } from './registry';
import type { App } from '../app';
import type { Raster } from '../codecs/raster';
import { openDialog, toast } from '../ui/dialog';
import { gaussianBlur } from '../picture/adjust';
import { canvasSize, crop, resample, hexToRgb } from '../picture/ops';
import { maskBounds, type Rect } from '../picture/mask';
import { openDocuments } from '../platform/native';
import { decodePicture } from '../codecs/registry';
import { frameRaster } from '../picture/edit';
import { askText, makePictures, withJob, currentRaster, selectionMask, deviceJob, openResult, blendMasked, device, hasImage, needImage, imageService, type Provenance } from '../ai';
import { extractJson } from '../ai/hosted';
import { textResult, whereField, resultField, has, hasSel, canImage, canText, promptField, entryRaster, AI_NOTE } from './aiShared';
import { drawText } from './editAdd';

const { matte, depth, inpaint, upscale } = device;

// Raster helpers ---------------------------------------------------------------------------------

export function applyAlpha(r: Raster, alpha: Float32Array, bg: [number, number, number] | null = null): Raster {
  const out = { width: r.width, height: r.height, data: r.data.slice() as Uint8ClampedArray<ArrayBuffer> };
  for (let i = 0; i < alpha.length; i++) { const a = alpha[i], o = i * 4; if (bg) { out.data[o] = bg[0] + (r.data[o] - bg[0]) * a; out.data[o + 1] = bg[1] + (r.data[o + 1] - bg[1]) * a; out.data[o + 2] = bg[2] + (r.data[o + 2] - bg[2]) * a; out.data[o + 3] = 255; } else out.data[o + 3] = Math.round(r.data[o + 3] * a); }
  return out;
}
/** Softens a matte: pushes values toward 0/1 (`contrast`) and blurs the edge (`soft` passes). */
export function refineAlpha(a: Float32Array, w: number, h: number, contrast = 1, soft = 0): Float32Array {
  let out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) { const v = Math.min(1, Math.max(0, (a[i] - 0.5) * contrast + 0.5)); out[i] = v; }
  for (let p = 0; p < soft; p++) { const g = new Float32Array(out.length); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0, n = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < w && yy < h) { s += out[yy * w + xx]; n++; } } g[y * w + x] = s / n; } out = g; }
  return out;
}
export const alphaMask = (a: Float32Array, t = 0.5): Uint8Array => { const m = new Uint8Array(a.length); for (let i = 0; i < a.length; i++) m[i] = a[i] >= t ? 255 : 0; return m; };
export function compositeOver(fg: Raster, alpha: Float32Array, bg: Raster): Raster {
  const b = bg.width === fg.width && bg.height === fg.height ? bg : resample(bg, fg.width, fg.height, 'lanczos3');
  const out = { width: fg.width, height: fg.height, data: new Uint8ClampedArray(fg.width * fg.height * 4) as Uint8ClampedArray<ArrayBuffer> };
  for (let i = 0; i < alpha.length; i++) { const a = alpha[i] * (fg.data[i * 4 + 3] / 255), o = i * 4; for (let c = 0; c < 3; c++) out.data[o + c] = b.data[o + c] + (fg.data[o + c] - b.data[o + c]) * a; out.data[o + 3] = 255; }
  return out;
}
/** Blur that grows with distance from the focus plane: three blur levels blended per pixel. */
export function blurByDepth(r: Raster, d: Float32Array, strength: number, focus: number): Raster {
  const levels = [r, gaussianBlur(r, Math.max(1, strength * 0.25)), gaussianBlur(r, Math.max(2, strength * 0.6)), gaussianBlur(r, Math.max(3, strength))];
  const out = { width: r.width, height: r.height, data: new Uint8ClampedArray(r.data.length) as Uint8ClampedArray<ArrayBuffer> };
  for (let i = 0; i < d.length; i++) {
    const a = Math.min(1, Math.max(0, Math.abs(d[i] - focus) / 0.6)) * 3, k = Math.min(2, Math.floor(a)), f = a - k, o = i * 4;
    for (let c = 0; c < 4; c++) out.data[o + c] = levels[k].data[o + c] + (levels[k + 1].data[o + c] - levels[k].data[o + c]) * f;
  }
  return out;
}
/** Approximate relighting: normals from the depth map, a directional light, Lambert shading. */
export function relight(r: Raster, d: Float32Array, azimuthDeg: number, elevationDeg: number, strength: number): Raster {
  const w = r.width, h = r.height, az = azimuthDeg * Math.PI / 180, el = elevationDeg * Math.PI / 180;
  const L = [Math.cos(el) * Math.cos(az), -Math.cos(el) * Math.sin(az), Math.sin(el)];
  const out = { width: w, height: h, data: r.data.slice() as Uint8ClampedArray<ArrayBuffer> }, k = 4 * Math.max(w, h) / 512;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, dx = (d[y * w + Math.min(w - 1, x + 1)] - d[y * w + Math.max(0, x - 1)]) * k, dy = (d[Math.min(h - 1, y + 1) * w + x] - d[Math.max(0, y - 1) * w + x]) * k;
    const nl = Math.sqrt(dx * dx + dy * dy + 1), shade = Math.max(0, (-dx * L[0] - dy * L[1] + L[2]) / nl);
    const f = 1 + strength * (shade - Math.sin(el)) * 1.2, o = i * 4;
    out.data[o] = r.data[o] * f; out.data[o + 1] = r.data[o + 1] * f; out.data[o + 2] = r.data[o + 2] * f;
  }
  return out;
}
export const grayRaster = (v: Float32Array, w: number, h: number, invert = false): Raster => { const out = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) as Uint8ClampedArray<ArrayBuffer> }; for (let i = 0; i < v.length; i++) { const g = Math.round((invert ? 1 - v[i] : v[i]) * 255); out.data[i * 4] = out.data[i * 4 + 1] = out.data[i * 4 + 2] = g; out.data[i * 4 + 3] = 255; } return out; };
export const subjectBounds = (a: Float32Array, w: number, h: number): Rect | null => maskBounds(alphaMask(a), w, h);

// Shared flows -----------------------------------------------------------------------------------

const prov = (command: string, service: string, model: string, prompt?: string, kind: Provenance['kind'] = 'edited'): Provenance => ({ command, service, model, prompt, kind });
const replaceOf = (v: Record<string, any> | null) => (v?.result === 'replace' ? true : v?.result === 'new' ? false : undefined);

/** Edit by instruction through the picture service; with a mask the result is blended inside it. */
async function instructionEdit(app: App, command: string, prompt: string, o: { useSelection?: boolean; replace?: boolean; images?: Raster[]; label?: string } = {}): Promise<void> {
  const orig = currentRaster(app);
  const sel = o.useSelection ? selectionMask(app) : null;
  const r = await withJob(app, command, (status, signal) => makePictures(app, { command, prompt, images: o.images || [orig], mask: sel?.mask, maskW: orig.width, maskH: orig.height }, status, signal));
  if (!r) return;
  let out = r.rasters[0];
  if (sel) out = blendMasked(orig, out, sel.mask, 2);
  else if (!o.images && (out.width !== orig.width || out.height !== orig.height) && Math.abs(out.width / out.height - orig.width / orig.height) < 0.02) out = resample(out, orig.width, orig.height, 'lanczos3');
  await openResult(app, out, prov(command, r.service, r.model, prompt), { replace: o.replace, label: o.label });
}

const svcTip = 'the picture service';
const serviceOrDevice = (app: App, deviceModel: string | null) => whereField(app, deviceModel, 'image');

def([
  // Edit: on-device --------------------------------------------------------------------------
  {
    id: 'ai.removeBackground', icon: 'background_replace', noRecord: true, popular: true, isEnabled: has, tip: 'On-device matting (MODNet); or the picture service with a transparent background',
    run: async (app) => {
      const where = serviceOrDevice(app, 'modnet')!;
      const v = await openDialog({ title: 'Remove Background', ok: 'Remove', fields: [where, resultField(app),
        { key: 'soft', label: 'Edge softness', type: 'range', min: 0, max: 4, value: 1, half: true, visibleIf: (x) => x.where === 'device' },
        { key: 'contrast', label: 'Edge hardness', type: 'range', min: 1, max: 4, step: 0.5, value: 1.5, half: true, visibleIf: (x) => x.where === 'device' },
        { key: 'out', label: 'Output', type: 'select', options: [{ value: 'transparent', label: 'Transparent background' }, { value: 'white', label: 'White background' }, { value: 'selection', label: 'Select the subject only' }], value: 'transparent' },
      ] });
      if (!v) return;
      const r = currentRaster(app);
      if (v.where === 'service') {
        const res = await withJob(app, 'ai.removeBackground', (status, signal) => makePictures(app, { command: 'ai.removeBackground', prompt: 'Remove the background completely, keeping the main subject exactly as it is, with a fully transparent background.', images: [r], transparent: true }, status, signal));
        if (!res) return;
        let out = res.rasters[0]; if (v.out === 'white') out = compositeOver(out, Float32Array.from(out.data.filter((_x, i) => i % 4 === 3), (a) => a / 255), { width: out.width, height: out.height, data: new Uint8ClampedArray(out.width * out.height * 4).fill(255) as Uint8ClampedArray<ArrayBuffer> });
        await openResult(app, out, prov('ai.removeBackground', res.service, res.model), { replace: replaceOf(v) }); return;
      }
      const a = await deviceJob(app, 'modnet', undefined, undefined, (b, bytes) => matte(b, bytes, r));
      if (!a) return;
      const alpha = refineAlpha(a, r.width, r.height, +v.contrast, +v.soft);
      if (v.out === 'selection') { const m = alphaMask(alpha); const bb = maskBounds(m, r.width, r.height); if (!bb) { toast('No subject found.'); return; } app.tab.selectionMask = m; app.tab.setSelection(bb, m); toast('Subject selected.'); return; }
      await openResult(app, applyAlpha(r, alpha, v.out === 'white' ? [255, 255, 255] : null), prov('ai.removeBackground', 'this device', 'MODNet'), { replace: replaceOf(v), label: 'Remove Background' });
    },
  },
  {
    id: 'ai.replaceBackground', icon: 'wallpaper', noRecord: true, isEnabled: has, tip: 'A color, a blur of the original, another picture, or a generated scene behind the subject (matting on the device)',
    run: async (app) => {
      const v = await openDialog({ title: 'Replace Background', ok: 'Replace', fields: [
        { key: 'bg', label: 'New background', type: 'select', options: [{ value: 'color', label: 'A color' }, { value: 'blur', label: 'The original, blurred' }, { value: 'picture', label: 'Another picture (choose a file)' }, ...(hasImage(app) ? [{ value: 'generate', label: `Generated from a prompt (${imageService(app)!.name})` }] : [])], value: 'color' },
        { key: 'color', label: 'Color', type: 'color', value: '#ffffff', half: true, visibleIf: (x) => x.bg === 'color' },
        { key: 'blur', label: 'Blur radius', type: 'range', min: 2, max: 40, value: 12, half: true, visibleIf: (x) => x.bg === 'blur' },
        { key: 'prompt', label: 'Scene', type: 'text', value: '', placeholder: 'a sunlit garden wall', visibleIf: (x) => x.bg === 'generate' },
        { key: 'soft', label: 'Edge softness', type: 'range', min: 0, max: 4, value: 1, half: true }, resultField(app),
      ] });
      if (!v) return;
      const r = currentRaster(app);
      let bg: Raster | null = null; let service = 'this device', model = 'MODNet';
      if (v.bg === 'picture') { const [f] = await openDocuments('image/*', ['image/*'], false); if (!f) return; const pic = await decodePicture(new Uint8Array(f.data), { name: f.name, uri: null, read: async () => f.data }); bg = frameRaster(pic.currentFrame); pic.release(); }
      if (v.bg === 'generate') { const g = await withJob(app, 'ai.replaceBackground', (status, signal) => makePictures(app, { command: 'ai.replaceBackground', prompt: `${v.prompt || 'a plain studio background'}. A background scene with no people; photographic, matching the lighting of a portrait.`, width: r.width, height: r.height }, status, signal)); if (!g) return; bg = g.rasters[0]; service = `this device + ${g.service}`; model = `MODNet + ${g.model}`; }
      const a = await deviceJob(app, 'modnet', undefined, undefined, (b, bytes) => matte(b, bytes, r)); if (!a) return;
      const alpha = refineAlpha(a, r.width, r.height, 1.5, +v.soft);
      if (v.bg === 'color') { const c = hexToRgb(v.color); bg = { width: r.width, height: r.height, data: new Uint8ClampedArray(r.width * r.height * 4) as Uint8ClampedArray<ArrayBuffer> }; for (let i = 0; i < r.width * r.height; i++) { bg.data[i * 4] = c[0]; bg.data[i * 4 + 1] = c[1]; bg.data[i * 4 + 2] = c[2]; bg.data[i * 4 + 3] = 255; } }
      if (v.bg === 'blur') bg = gaussianBlur(r, +v.blur);
      await openResult(app, compositeOver(r, alpha, bg!), prov('ai.replaceBackground', service, model, v.bg === 'generate' ? v.prompt : undefined), { replace: replaceOf(v), label: 'Replace Background' });
    },
  },
  {
    id: 'ai.blurBackground', icon: 'blur_on', noRecord: true, isEnabled: has, tip: 'Depth-based blur (Depth Anything on the device): the farther, the blurrier',
    run: async (app) => {
      const v = await openDialog({ title: 'Blur Background', ok: 'Blur', fields: [{ key: 'strength', label: 'Blur strength', type: 'range', min: 2, max: 30, value: 10, half: true }, { key: 'focus', label: 'In focus', type: 'select', options: [{ value: '1', label: 'The nearest things' }, { value: '0.6', label: 'The middle distance' }, { value: '0', label: 'The farthest things' }], value: '1', half: true }, resultField(app)] });
      if (!v) return;
      const r = currentRaster(app);
      const d = await deviceJob(app, 'depth-anything-v2-small', undefined, undefined, (b, bytes) => depth(b, bytes, r)); if (!d) return;
      await openResult(app, blurByDepth(r, d, +v.strength, +v.focus), prov('ai.blurBackground', 'this device', 'Depth Anything V2 Small'), { replace: replaceOf(v), label: 'Blur Background' });
    },
  },
  {
    id: 'ai.relight', icon: 'light_mode', noRecord: true, isEnabled: has, tip: 'An approximate new light from the depth map: direction and strength',
    run: async (app) => {
      const v = await openDialog({ title: 'Relight', ok: 'Relight', help: 'An approximation: shading from the estimated depth, not a true re-rendering.', fields: [{ key: 'az', label: 'Direction (° from the right, counterclockwise)', type: 'range', min: 0, max: 359, value: 45, half: true }, { key: 'el', label: 'Elevation (°)', type: 'range', min: 5, max: 85, value: 40, half: true }, { key: 'strength', label: 'Strength', type: 'range', min: 0.1, max: 1.5, step: 0.1, value: 0.6, half: true }, resultField(app)] });
      if (!v) return;
      const r = currentRaster(app);
      const d = await deviceJob(app, 'depth-anything-v2-small', undefined, undefined, (b, bytes) => depth(b, bytes, r)); if (!d) return;
      await openResult(app, relight(r, d, +v.az, +v.el, +v.strength), prov('ai.relight', 'this device', 'Depth Anything V2 Small'), { replace: replaceOf(v), label: 'Relight' });
    },
  },
  {
    id: 'ai.upscale', icon: 'zoom_out_map', noRecord: true, popular: true, isEnabled: has, tip: '2× or 4× with Swin2SR on the device',
    run: async (app) => {
      const r = currentRaster(app);
      const v = await openDialog({ title: 'Upscale', ok: 'Upscale', help: `${r.width}×${r.height} now. Large pictures take a while on the device (tiles of 288 px).`, fields: [{ key: 'scale', label: 'Factor', type: 'select', options: [{ value: '2', label: `2× → ${r.width * 2}×${r.height * 2} (Swin2SR classical)` }, { value: '4', label: `4× → ${r.width * 4}×${r.height * 4} (Swin2SR real-world)` }], value: '2' }, resultField(app)] });
      if (!v) return;
      const id = v.scale === '4' ? 'swin2sr-x4-real' : 'swin2sr-x2';
      const out = await withJob(app, 'ai.upscale', (status, signal) => deviceJob(app, id, status, signal, (b, bytes) => upscale(b, bytes, r, +v.scale, (d, t) => status(`tile ${d} of ${t}`)), 'ai.upscale'));
      if (!out) return;
      await openResult(app, out, prov('ai.upscale', 'this device', device.modelById(id).title), { replace: replaceOf(v), label: `Upscale ${v.scale}×` });
    },
  },
  ...(['ai.deblur', 'ai.denoise'] as const).map((id) => ({
    id, icon: id === 'ai.deblur' ? 'deblur' : 'blur_off', noRecord: true, isEnabled: has, tip: `${id === 'ai.deblur' ? 'Sharper detail' : 'Less noise'}: the real-world Swin2SR model on the device restores the picture at its own size; or the picture service by instruction`,
    run: async (app: App) => {
      const where = serviceOrDevice(app, 'swin2sr-x4-real')!;
      const v = await openDialog({ title: id === 'ai.deblur' ? 'Unblur' : 'AI Noise Reduction', ok: 'Run', fields: [where, resultField(app)] });
      if (!v) return;
      if (v.where === 'service') { await instructionEdit(app, id, id === 'ai.deblur' ? 'Make this photograph sharp and clear: remove blur and camera shake while keeping every element, color and composition exactly as it is.' : 'Remove noise and grain from this photograph while keeping every element, color, texture and composition exactly as it is.', { replace: replaceOf(v) }); return; }
      const r = currentRaster(app);
      const out = await withJob(app, id, (status, signal) => deviceJob(app, 'swin2sr-x4-real', status, signal, async (b, bytes) => resample(await upscale(b, bytes, r, 4, (d, t) => status(`tile ${d} of ${t}`)), r.width, r.height, 'lanczos3'), id));
      if (!out) return;
      await openResult(app, out, prov(id, 'this device', 'Swin2SR ×4 real-world'), { replace: replaceOf(v), label: id === 'ai.deblur' ? 'Unblur' : 'AI Noise Reduction' });
    },
  })),
  {
    id: 'ai.erase', icon: 'auto_fix_high', noRecord: true, popular: true, isEnabled: hasSel, tip: 'Fills the selection from its surroundings: LaMa on the device, or the picture service',
    run: async (app) => {
      const where = serviceOrDevice(app, 'lama')!;
      const v = await openDialog({ title: 'Erase Object', ok: 'Erase', help: 'The selection (rectangle, ellipse, lasso or wand) marks what goes.', fields: [where, resultField(app)] });
      if (!v) return;
      if (v.where === 'service') { await instructionEdit(app, 'ai.erase', 'Remove everything inside the editable area and fill it with background that continues the surroundings seamlessly; change nothing outside it.', { useSelection: true, replace: replaceOf(v), label: 'Erase Object' }); return; }
      const r = currentRaster(app), sel = selectionMask(app)!;
      const out = await withJob(app, 'ai.erase', (status, signal) => deviceJob(app, 'lama', status, signal, (b, bytes) => inpaint(b, bytes, r, sel.mask, sel.bounds), 'ai.erase'));
      if (!out) return;
      await openResult(app, out, prov('ai.erase', 'this device', 'LaMa'), { replace: replaceOf(v), label: 'Erase Object' });
    },
  },
  {
    id: 'ai.repairDamage', icon: 'healing', noRecord: true, isEnabled: has, tip: 'Tears, creases, stains and missing corners: select an area for LaMa on the device, or let the picture service repair the whole photograph',
    run: async (app) => {
      const sel = selectionMask(app);
      const where = serviceOrDevice(app, sel ? 'lama' : null);
      if (!where) { toast(sel ? needImage(app)! : 'Select the damaged area (for the on-device model) or set up a picture service (AI ▸ Set Up AI).'); return; }
      const v = await openDialog({ title: 'Repair Damage', ok: 'Repair', help: sel ? 'The selected area is filled from its surroundings.' : 'No selection: the whole photograph goes to the picture service.', fields: [where, resultField(app)] });
      if (!v) return;
      if (v.where === 'service') { await instructionEdit(app, 'ai.repairDamage', sel ? 'Repair the damage inside the editable area (tears, creases, stains, missing paper) so it continues the surrounding photograph seamlessly; change nothing else.' : 'Restore this damaged old photograph: repair tears, creases, scratches, stains, fading and missing corners, keeping the people, objects, composition and period character exactly as they are. Do not colorize.', { useSelection: !!sel, replace: replaceOf(v), label: 'Repair Damage' }); return; }
      const r = currentRaster(app);
      const out = await withJob(app, 'ai.repairDamage', (status, signal) => deviceJob(app, 'lama', status, signal, (b, bytes) => inpaint(b, bytes, r, sel!.mask, sel!.bounds), 'ai.repairDamage'));
      if (!out) return;
      await openResult(app, out, prov('ai.repairDamage', 'this device', 'LaMa'), { replace: replaceOf(v), label: 'Repair Damage' });
    },
  },
  // Edit: service ----------------------------------------------------------------------------
  {
    id: 'ai.editInstruction', icon: 'edit', noRecord: true, popular: true, isEnabled: canImage, tip: '"make it a winter evening"; the whole picture or the selection',
    run: async (app, arg?: { prompt?: string }) => {
      const v = await openDialog({ title: 'Edit by Instruction', ok: 'Edit', fields: [promptField('prompt', 'Instruction', arg?.prompt || '', 'make it a winter evening'), ...(app.tab.selection ? [{ key: 'scope', label: 'Apply to', type: 'select' as const, options: [{ value: 'sel', label: 'The selection only' }, { value: 'all', label: 'The whole picture' }], value: 'sel', half: true }] : []), resultField(app)] });
      if (!v || !String(v.prompt).trim()) return;
      await instructionEdit(app, 'ai.editInstruction', String(v.prompt).trim(), { useSelection: v.scope === 'sel', replace: replaceOf(v), label: 'Edit by Instruction' });
    },
  },
  {
    id: 'ai.fill', icon: 'format_color_fill', noRecord: true, popular: true, isEnabled: (app) => hasSel(app) && hasImage(app), tip: 'Generative fill: the selection plus a prompt',
    run: async (app) => { const v = await openDialog({ title: 'Generative Fill', ok: 'Fill', fields: [promptField('prompt', 'What should appear in the selection', '', 'a wooden bench'), resultField(app)] }); if (!v) return; await instructionEdit(app, 'ai.fill', `Inside the editable area, add: ${String(v.prompt).trim() || 'matching background'}. Blend it naturally with the surroundings; change nothing outside the area.`, { useSelection: true, replace: replaceOf(v), label: 'Generative Fill' }); },
  },
  {
    id: 'ai.replace', icon: 'swap_horiz', noRecord: true, isEnabled: (app) => hasSel(app) && hasImage(app), tip: '"replace the red car with a bicycle" inside the selection',
    run: async (app) => { const v = await openDialog({ title: 'Replace Object', ok: 'Replace', fields: [promptField('prompt', 'Replace the selected object with', '', 'a bicycle'), resultField(app)] }); if (!v || !String(v.prompt).trim()) return; await instructionEdit(app, 'ai.replace', `Replace the object inside the editable area with ${String(v.prompt).trim()}, matching the lighting, perspective and style of the photograph; change nothing outside the area.`, { useSelection: true, replace: replaceOf(v), label: 'Replace Object' }); },
  },
  {
    id: 'ai.recolor', icon: 'palette', noRecord: true, isEnabled: (app) => hasSel(app) && hasImage(app), tip: 'A new color for the selected object, keeping its texture and shading',
    run: async (app) => { const v = await openDialog({ title: 'Recolor Object', ok: 'Recolor', fields: [{ key: 'color', label: 'New color', type: 'color', value: '#2060c0', half: true }, { key: 'desc', label: 'Or describe it', type: 'text', value: '', placeholder: 'deep forest green', half: true }, resultField(app)] }); if (!v) return; await instructionEdit(app, 'ai.recolor', `Change the color of the object inside the editable area to ${String(v.desc).trim() || v.color}, keeping its shape, texture, shading and reflections; change nothing outside the area.`, { useSelection: true, replace: replaceOf(v), label: 'Recolor Object' }); },
  },
  {
    id: 'ai.expand', icon: 'open_in_full', noRecord: true, isEnabled: canImage, tip: 'Extends the canvas and fills the new area with generated content that continues the picture',
    run: async (app) => {
      const r = currentRaster(app);
      const v = await openDialog({ title: 'Expand Picture', ok: 'Expand', fields: [{ key: 'l', label: 'Left (px)', type: 'number', min: 0, max: 4096, value: 0, half: true }, { key: 'r', label: 'Right (px)', type: 'number', min: 0, max: 4096, value: Math.round(r.width / 4), half: true }, { key: 't', label: 'Top (px)', type: 'number', min: 0, max: 4096, value: 0, half: true }, { key: 'b', label: 'Bottom (px)', type: 'number', min: 0, max: 4096, value: 0, half: true }, promptField('prompt', 'What continues there (optional)', '', 'more of the same scene'), resultField(app)] });
      if (!v) return;
      const l = +v.l | 0, rr = +v.r | 0, t = +v.t | 0, b = +v.b | 0; if (!(l + rr + t + b)) { toast('Enter how far to expand.'); return; }
      const W = r.width + l + rr, H = r.height + t + b;
      const big = canvasSize(r, W, H, l, t, [128, 128, 128, 0]);
      const mask = new Uint8Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (x < l || y < t || x >= l + r.width || y >= t + r.height) mask[y * W + x] = 255;
      const res = await withJob(app, 'ai.expand', (status, signal) => makePictures(app, { command: 'ai.expand', prompt: `Extend the photograph into the editable area so the scene continues naturally${String(v.prompt).trim() ? `: ${String(v.prompt).trim()}` : ''}. Match perspective, lighting and style; change nothing in the original area.`, images: [big], mask, maskW: W, maskH: H, width: W, height: H }, status, signal));
      if (!res) return;
      await openResult(app, blendMasked(big, res.rasters[0], mask, 3), prov('ai.expand', res.service, res.model, String(v.prompt)), { replace: replaceOf(v), label: 'Expand Picture' });
    },
  },
  {
    id: 'ai.restyle', icon: 'brush', noRecord: true, isEnabled: canImage, tip: 'Painting, drawing and photographic styles from a prompt',
    run: async (app) => {
      const styles = ['watercolor painting', 'oil painting', 'pencil sketch', 'ink drawing', 'woodcut print', 'pastel drawing', 'vintage photograph (1900s)', 'film photograph (1970s)', 'black-and-white photograph', 'comic book art', 'pixel art', 'stained glass'];
      const v = await openDialog({ title: 'Restyle', ok: 'Restyle', fields: [{ key: 'style', label: 'Style', type: 'combo', options: styles, value: styles[0] }, { key: 'extra', label: 'Details (optional)', type: 'text', value: '' }, resultField(app)] });
      if (!v) return;
      await instructionEdit(app, 'ai.restyle', `Render this picture in the style of a ${v.style}${String(v.extra).trim() ? `, ${String(v.extra).trim()}` : ''}, keeping the composition and subjects.`, { replace: replaceOf(v), label: 'Restyle' });
    },
  },
  { id: 'ai.colorize', icon: 'color_lens', noRecord: true, isEnabled: canImage, tip: 'Colorizes a black-and-white photograph through the picture service; the result is marked as AI-colorized in its metadata', run: async (app) => { const v = await openDialog({ title: 'Colorize', ok: 'Colorize', help: 'Colors are the model\'s guess, not a record. The result carries AI provenance metadata.', fields: [{ key: 'hint', label: 'Known colors (optional)', type: 'text', value: '', placeholder: 'the dress was blue; red brick house' }, resultField(app)] }); if (!v) return; await instructionEdit(app, 'ai.colorize', `Colorize this black-and-white photograph with realistic, period-appropriate colors${String(v.hint).trim() ? ` (known: ${String(v.hint).trim()})` : ''}, keeping every detail, the composition and the grain exactly as they are.`, { replace: replaceOf(v), label: 'Colorize' }); } },
  { id: 'ai.removeReflection', icon: 'flare', noRecord: true, isEnabled: canImage, tip: 'Glare, flash hot spots and window reflections removed by the picture service', run: async (app) => { const v = await openDialog({ title: 'Remove Glare and Reflections', ok: 'Remove', fields: [resultField(app)] }); if (!v) return; await instructionEdit(app, 'ai.removeReflection', 'Remove glare, flash hot spots and reflections from this photograph, restoring what is behind them, and keep everything else exactly as it is.', { replace: replaceOf(v), label: 'Remove Glare and Reflections' }); } },
  {
    id: 'ai.translateText', icon: 'translate', noRecord: true, isEnabled: canText, tip: 'Signs, labels and menus read and translated by the vision service; as text, a caption, or an overlay on a copy',
    run: async (app) => {
      const v = await openDialog({ title: 'Translate Text in Picture', ok: 'Translate', fields: [{ key: 'lang', label: 'Into', type: 'combo', options: ['English', 'Spanish', 'French', 'German', 'Italian', 'Portuguese', 'Dutch', 'Polish', 'Japanese', 'Chinese'], value: 'English' }] });
      if (!v) return;
      const r = await withJob(app, 'ai.translateText', (status, signal) => askText(app, { command: 'ai.translateText', system: 'You read text in pictures and translate it faithfully.', prompt: `Find every piece of text in this picture (signs, labels, menus, captions). Translate each into ${v.lang}. Answer as JSON: {"items": [{"text": "original", "translation": "..."}]}`, images: [currentRaster(app)], json: true, maxTokens: 3000 }, status, signal));
      if (!r) return;
      let items: { text: string; translation: string }[] = [];
      try { const j = extractJson(r.text); items = (j.items || j).map((x: any) => ({ text: String(x.text || ''), translation: String(x.translation || '') })); } catch { items = [{ text: '', translation: r.text }]; }
      const text = items.map((i) => (i.text ? `${i.text} → ${i.translation}` : i.translation)).join('\n');
      await textResult(app, `Translation (${v.lang})`, text, { note: `${r.service}, ${r.ms} ms.`, saveAs: { label: 'Save as caption', patch: (t) => ({ description: t }) }, extra: [{ label: 'Overlay on a copy', onClick: async (t, ctl) => {
        ctl.close();
        const src = currentRaster(app); const lines = t.split('\n').filter(Boolean);
        const size = Math.max(14, Math.round(src.width / 40)), band = Math.round(lines.length * size * 1.25 + size);
        const out = drawText(canvasSize(src, src.width, src.height + band, 0, 0, [0, 0, 0, 255]), src.width, { text: lines.join('\n'), font: 'sans-serif', size, bold: false, italic: false, color: '#ffffff', outline: 0, outlineColor: '#000000', shadow: 0, shadowColor: '#000000', bg: '#000000', bgOpacity: 0, rotation: 0, anchor: 'bl', margin: Math.round(size / 2), opacity: 1, align: 'left' });
        await openResult(app, out, prov('ai.translateText', r.service, r.model), { replace: false });
      } }] });
    },
  },
  {
    id: 'ai.combineGroupShots', icon: 'groups_3', noRecord: true, isEnabled: (app) => hasImage(app) && app.tab.marked.size >= 2, tip: 'The best expression of each person from marked frames of the same group, composed by the picture service',
    run: async (app) => {
      const marked = [...app.tab.marked].slice(0, 6);
      const v = await openDialog({ title: 'Combine Group Shots', ok: 'Combine', help: `${marked.length} marked pictures go to the service as one request. ${AI_NOTE}`, fields: [{ key: 'note', label: 'Notes (optional)', type: 'text', value: '', placeholder: 'everyone looking at the camera, eyes open' }] });
      if (!v) return;
      const images: Raster[] = []; for (const e of marked) images.push(await entryRaster(app, e));
      const res = await withJob(app, 'ai.combineGroupShots', (status, signal) => makePictures(app, { command: 'ai.combineGroupShots', prompt: `These pictures are frames of the same group photograph taken moments apart. Compose one photograph that keeps the first frame's framing and uses, for each person, the frame where they look best (eyes open, natural expression${String(v.note).trim() ? `; ${String(v.note).trim()}` : ''}). Change nothing else.`, images }, status, signal));
      if (!res) return;
      await openResult(app, res.rasters[0], prov('ai.combineGroupShots', res.service, res.model), { replace: false });
    },
  },
  {
    id: 'ai.smartCrop', icon: 'crop_free', noRecord: true, isEnabled: has, tip: 'Subject-aware crop to an aspect ratio (subject found on the device)',
    run: async (app) => {
      const v = await openDialog({ title: 'Smart Crop', ok: 'Crop', fields: [{ key: 'aspect', label: 'Aspect ratio', type: 'select', options: [{ value: '1', label: 'Square 1:1' }, { value: '1.3333', label: '4:3' }, { value: '0.75', label: '3:4' }, { value: '1.5', label: '3:2' }, { value: '0.6667', label: '2:3' }, { value: '1.7778', label: '16:9' }, { value: '0.5625', label: '9:16' }], value: '1' }, { key: 'margin', label: 'Room around the subject (%)', type: 'range', min: 0, max: 60, value: 15, half: true }, resultField(app)] });
      if (!v) return;
      const r = currentRaster(app);
      const a = await deviceJob(app, 'modnet', undefined, undefined, (b, bytes) => matte(b, bytes, r)); if (!a) return;
      const bb = subjectBounds(a, r.width, r.height) || { x: 0, y: 0, w: r.width, h: r.height };
      const ratio = +v.aspect, m = 1 + +v.margin / 100;
      let w = Math.min(r.width, Math.max(bb.w * m, bb.h * m * ratio)), h = w / ratio;
      if (h > r.height) { h = r.height; w = h * ratio; } if (w > r.width) { w = r.width; h = w / ratio; }
      const cx = bb.x + bb.w / 2, cy = bb.y + bb.h / 2;
      const rect = { x: Math.round(Math.min(Math.max(0, cx - w / 2), r.width - w)), y: Math.round(Math.min(Math.max(0, cy - h / 2), r.height - h)), w: Math.round(w), h: Math.round(h) };
      await openResult(app, crop(r, rect), prov('ai.smartCrop', 'this device', 'MODNet'), { replace: replaceOf(v), label: 'Smart Crop' });
    },
  },
  // Select -----------------------------------------------------------------------------------
  {
    id: 'ai.selectSubject', icon: 'center_focus_strong', noRecord: true, popular: true, isEnabled: has, tip: 'Selects the main subject (MODNet on the device)',
    run: async (app) => {
      const r = currentRaster(app);
      const a = await deviceJob(app, 'modnet', undefined, undefined, (b, bytes) => matte(b, bytes, r)); if (!a) return;
      const m = alphaMask(refineAlpha(a, r.width, r.height, 1.5, 0)); const bb = maskBounds(m, r.width, r.height);
      if (!bb) { toast('No subject found.'); return; }
      app.tab.setSelection(bb, m); toast('Subject selected (Edit ▸ Invert Selection for the background).');
    },
  },
  {
    id: 'ai.selectByPrompt', icon: 'highlight_alt', noRecord: true, isEnabled: canText, tip: '"the dog", "the sky": a rectangle around what you describe, from the vision service (approximate)',
    run: async (app) => {
      const v = await openDialog({ title: 'Select by Description', ok: 'Select', fields: [{ key: 'what', label: 'Select', type: 'text', value: '', autofocus: true, placeholder: 'the dog' }] });
      if (!v || !String(v.what).trim()) return;
      const r = await withJob(app, 'ai.selectByPrompt', (status, signal) => askText(app, { command: 'ai.selectByPrompt', system: 'You locate things in pictures.', prompt: `Give the bounding box of "${String(v.what).trim()}" in this picture as fractions of the width and height from the top-left corner. Answer as JSON: {"x0": 0.12, "y0": 0.3, "x1": 0.55, "y1": 0.9, "found": true}`, images: [currentRaster(app)], json: true, temperature: 0 }, status, signal));
      if (!r) return;
      try {
        const j = extractJson(r.text); if (j.found === false) { toast(`Not found: ${v.what}`); return; }
        const p = app.picture!; const f = (x: any) => Math.min(1, Math.max(0, +x || 0));
        let x0 = f(j.x0), y0 = f(j.y0), x1 = f(j.x1), y1 = f(j.y1); if (x1 > 1.5 || y1 > 1.5) { x0 /= 1000; y0 /= 1000; x1 /= 1000; y1 /= 1000; }
        const rect = { x: Math.round(x0 * p.width), y: Math.round(y0 * p.height), w: Math.round((x1 - x0) * p.width), h: Math.round((y1 - y0) * p.height) };
        if (rect.w < 2 || rect.h < 2) { toast('The answer had no usable box.'); return; }
        app.tab.setSelection(rect); toast(`Selected "${v.what}" (approximate box from ${r.service}).`);
      } catch { toast(`The answer was not a box: ${r.text.slice(0, 80)}`); }
    },
  },
  {
    id: 'ai.depth', icon: 'layers', noRecord: true, isEnabled: has, tip: 'The depth map as a picture, or a selection by distance (Depth Anything on the device)',
    run: async (app) => {
      const v = await openDialog({ title: 'Depth Map', ok: 'OK', fields: [{ key: 'out', label: 'Output', type: 'select', options: [{ value: 'picture', label: 'A grayscale picture (white = near)' }, { value: 'selection', label: 'Select by distance' }], value: 'picture' }, { key: 'near', label: 'From (0 = farthest)', type: 'range', min: 0, max: 100, value: 50, half: true, visibleIf: (x) => x.out === 'selection' }, { key: 'far', label: 'To (100 = nearest)', type: 'range', min: 0, max: 100, value: 100, half: true, visibleIf: (x) => x.out === 'selection' }] });
      if (!v) return;
      const r = currentRaster(app);
      const d = await deviceJob(app, 'depth-anything-v2-small', undefined, undefined, (b, bytes) => depth(b, bytes, r)); if (!d) return;
      if (v.out === 'picture') { await openResult(app, grayRaster(d, r.width, r.height), prov('ai.depth', 'this device', 'Depth Anything V2 Small'), { replace: false, name: `${app.picture!.name.replace(/\.[^.]+$/, '')} (depth).png` }); return; }
      const lo = Math.min(+v.near, +v.far) / 100, hi = Math.max(+v.near, +v.far) / 100;
      const m = new Uint8Array(d.length); for (let i = 0; i < d.length; i++) m[i] = d[i] >= lo && d[i] <= hi ? 255 : 0;
      const bb = maskBounds(m, r.width, r.height); if (!bb) { toast('Nothing in that range.'); return; }
      app.tab.setSelection(bb, m); toast('Selected by distance.');
    },
  },
]);
void svcTip; void canText;
