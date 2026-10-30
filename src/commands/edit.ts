/**
 * Edit commands: undo and redo, the rectangle selection (tool, select all/none, custom, aspect), crop
 * (selection, aspect, print size, auto crop borders), clipboard (cut, copy, paste into the picture,
 * paste as new, paste beside, clear, fill), canvas size and borders.
 */
import { def } from './registry';
import type { App } from '../app';
import { openDialog, toast } from '../ui/dialog';
import { encodeCanvas } from '../codecs/registry';
import { Folder, entryFromBytes } from '../picture/folder';
import { editRaster, editSelection, frameRaster, rasterFrame } from '../picture/edit';
import { crop, canvasSize, autoCropRect, hexToRgb, resample, clampRect, type Rect } from '../picture/ops';
import { makeRaster, type Raster } from '../codecs/raster';
import type { Picture } from '../picture/model';

async function clipboardImage(): Promise<Blob | null> {
  try {
    const items = await (navigator.clipboard as any).read?.();
    for (const it of items || []) { const t = it.types.find((x: string) => x.startsWith('image/')); if (t) return await it.getType(t); }
  } catch { /* no image access */ }
  return null;
}

/** The copied pixels: the system clipboard's picture, or the app's own copy. */
async function clipboardRaster(app: App): Promise<Raster | null> {
  const b = await clipboardImage();
  if (b) {
    try { const bmp = await createImageBitmap(b); const r = frameRaster({ image: bmp, width: bmp.width, height: bmp.height, delay: 0 }); bmp.close(); return r; } catch { /* fall through */ }
  }
  return app.clipRaster || (app.clip ? frameRaster(app.clip.currentFrame) : null);
}

export async function pasteAsNew(app: App, blob?: Blob | null): Promise<void> {
  const b = blob || (await clipboardImage());
  if (!b) {
    const r = app.clipRaster || (app.clip ? frameRaster(app.clip.currentFrame) : null);
    if (r) { const c = rasterFrame(r, 0).image as HTMLCanvasElement; const data = await encodeCanvas(c, 'png'); await app.openFolder(new Folder([entryFromBytes('Pasted picture.png', await data.arrayBuffer())], 'Clipboard'), 0, { newWindow: true }); return; }
    toast('The clipboard has no picture (or this platform does not allow reading it; try Ctrl+V on the picture).');
    return;
  }
  const buf = await b.arrayBuffer();
  const ext = (b.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
  await app.openFolder(new Folder([entryFromBytes(`Pasted picture.${ext}`, buf)], 'Clipboard'), 0, { newWindow: true });
}

const has = (app: App) => !!app.picture;
const hasSel = (app: App) => !!app.picture && !!app.tab.selection;
const selOrAll = (app: App): Rect => app.tab.selection || { x: 0, y: 0, w: app.picture!.width, h: app.picture!.height };

async function copySelection(app: App, say = true): Promise<Raster | null> {
  const pic = app.picture;
  if (!pic) return null;
  const r = app.tab.selection ? crop(frameRaster(pic.currentFrame), app.tab.selection) : frameRaster(pic.currentFrame);
  app.clipRaster = r; app.clip = pic;
  try {
    const blob = await encodeCanvas(rasterFrame(r, 0).image as HTMLCanvasElement, 'png');
    await (navigator.clipboard as any).write([new (window as any).ClipboardItem({ 'image/png': blob })]);
    if (say) toast(app.tab.selection ? `Selection copied (${r.width} × ${r.height})` : 'Picture copied');
  } catch (e: any) { if (say) toast(`Copied inside Anne's Lens only (the system clipboard refused: ${e?.message || e})`); }
  return r;
}

/** Fills a rectangle of the raster with a color (alpha 0 = transparent). */
function fillRect(r: Raster, rect: Rect, rgba: [number, number, number, number]): Raster {
  const out = makeRaster(r.width, r.height); out.data.set(r.data);
  for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) { const o = (y * r.width + x) * 4; out.data[o] = rgba[0]; out.data[o + 1] = rgba[1]; out.data[o + 2] = rgba[2]; out.data[o + 3] = rgba[3]; }
  return out;
}

function pasteAt(dst: Raster, src: Raster, x: number, y: number): Raster {
  const out = makeRaster(dst.width, dst.height); out.data.set(dst.data);
  for (let sy = 0; sy < src.height; sy++) {
    const dy = y + sy; if (dy < 0 || dy >= dst.height) continue;
    for (let sx = 0; sx < src.width; sx++) {
      const dx = x + sx; if (dx < 0 || dx >= dst.width) continue;
      const si = (sy * src.width + sx) * 4, di = (dy * dst.width + dx) * 4;
      const a = src.data[si + 3] / 255;
      if (a >= 1) { out.data[di] = src.data[si]; out.data[di + 1] = src.data[si + 1]; out.data[di + 2] = src.data[si + 2]; out.data[di + 3] = 255; }
      else if (a > 0) { const b = out.data[di + 3] / 255, oa = a + b * (1 - a); for (let k = 0; k < 3; k++) out.data[di + k] = Math.round((src.data[si + k] * a + out.data[di + k] * b * (1 - a)) / (oa || 1)); out.data[di + 3] = Math.round(oa * 255); }
    }
  }
  return out;
}

const ASPECTS: { value: string; label: string; r: number }[] = [
  { value: '1', label: 'Square 1:1', r: 1 }, { value: '4:3', label: '4:3', r: 4 / 3 }, { value: '3:2', label: '3:2 (35 mm)', r: 3 / 2 }, { value: '16:9', label: '16:9', r: 16 / 9 }, { value: '16:10', label: '16:10', r: 16 / 10 }, { value: '5:4', label: '5:4', r: 5 / 4 }, { value: '21:9', label: '21:9', r: 21 / 9 }, { value: 'a', label: 'A series (1:√2)', r: Math.SQRT2 },
];
const PRINTS: { value: string; label: string; r: number }[] = [
  { value: '4x6', label: '4 × 6 in', r: 6 / 4 }, { value: '5x7', label: '5 × 7 in', r: 7 / 5 }, { value: '8x10', label: '8 × 10 in', r: 10 / 8 }, { value: '11x14', label: '11 × 14 in', r: 14 / 11 }, { value: 'passport', label: 'Passport / ID 35 × 45 mm', r: 35 / 45 }, { value: 'us-passport', label: 'US passport 2 × 2 in', r: 1 }, { value: 'wallet', label: 'Wallet 2.5 × 3.5 in', r: 3.5 / 2.5 },
];

/** The largest rectangle of the given aspect (w/h) inside the picture, centered (or around the selection). */
function maxAspectRect(pic: Picture, ratio: number, around?: Rect | null): Rect {
  const W = pic.width, H = pic.height;
  let w = W, h = Math.round(W / ratio);
  if (h > H) { h = H; w = Math.round(H * ratio); }
  const cx = around ? around.x + around.w / 2 : W / 2, cy = around ? around.y + around.h / 2 : H / 2;
  return clampRect({ x: Math.max(0, Math.min(W - w, cx - w / 2)), y: Math.max(0, Math.min(H - h, cy - h / 2)), w, h }, W, H)!;
}

def([
  { id: 'edit.undo', icon: 'undo', popular: true, noRecord: true, isEnabled: (app) => !!app.tab?.canUndo, run: (app) => { if (!app.tab.undo()) toast('Nothing to undo.'); } },
  { id: 'edit.redo', icon: 'redo', noRecord: true, isEnabled: (app) => !!app.tab?.canRedo, run: (app) => { if (!app.tab.redo()) toast('Nothing to redo.'); } },

  // Select ---------------------------------------------------------------------------------
  { id: 'edit.selectRect', icon: 'highlight_alt', kind: 'toggle', noRecord: true, isActive: (app) => app.tab.selectTool, tip: 'Drag to select (Shift+drag works without the tool; Ctrl for a square; drag the handles to adjust)', run: (app) => { app.tab.selectTool = !app.tab.selectTool; app.tab.ui.el.classList.toggle('qn-select-tool', app.tab.selectTool); app.refresh(); toast(app.tab.selectTool ? 'Drag on the picture to select; Esc clears' : 'Selection tool off (drag pans again)'); } },
  { id: 'edit.selectAll', icon: 'select_all', noRecord: true, isEnabled: has, run: (app) => app.tab.setSelection({ x: 0, y: 0, w: app.picture!.width, h: app.picture!.height }) },
  { id: 'edit.selectNone', icon: 'deselect', noRecord: true, isEnabled: hasSel, run: (app) => app.tab.setSelection(null) },
  {
    id: 'edit.customSelection', icon: 'crop_free', noRecord: true, isEnabled: has, tip: 'Exact position and size; aspect presets',
    run: async (app) => {
      const pic = app.picture!;
      const s = app.tab.selection || { x: 0, y: 0, w: pic.width, h: pic.height };
      const r = await openDialog({ title: 'Custom Selection', ok: 'Select', fields: [
        { key: 'x', label: 'Left', type: 'number', min: 0, max: pic.width - 1, value: s.x, half: true }, { key: 'y', label: 'Top', type: 'number', min: 0, max: pic.height - 1, value: s.y, half: true },
        { key: 'w', label: 'Width', type: 'number', min: 1, max: pic.width, value: s.w, half: true }, { key: 'h', label: 'Height', type: 'number', min: 1, max: pic.height, value: s.h, half: true },
        { key: 'aspect', label: 'Aspect preset', type: 'select', options: [{ value: '', label: '(free)' }, ...ASPECTS, ...PRINTS], value: '' },
        { key: 'center', label: 'Center in the picture', type: 'checkbox', value: false },
      ], onChange: (v, ctl, key) => {
        if (key === 'aspect' && v.aspect) { const a = [...ASPECTS, ...PRINTS].find((x) => x.value === v.aspect)!; const rect = maxAspectRect(pic, a.r); ctl.set('x', rect.x); ctl.set('y', rect.y); ctl.set('w', rect.w); ctl.set('h', rect.h); }
        if (key === 'center' && v.center) { ctl.set('x', Math.max(0, Math.round((pic.width - +v.w) / 2))); ctl.set('y', Math.max(0, Math.round((pic.height - +v.h) / 2))); }
      } });
      if (!r) return;
      app.tab.setSelection({ x: +r.x || 0, y: +r.y || 0, w: +r.w || 1, h: +r.h || 1 });
    },
  },
  {
    id: 'edit.selectMaxAspect', icon: 'aspect_ratio', kind: 'menu', noRecord: true, isEnabled: has, tip: 'The largest selection of an aspect ratio, around the current selection',
    menu: () => ASPECTS.map((a) => ({ id: 'edit.selectMaxAspect', arg: a.value, label: a.label })),
    run: (app, arg?: string) => { const a = ASPECTS.find((x) => x.value === arg) || ASPECTS[0]; app.tab.setSelection(maxAspectRect(app.picture!, a.r, app.tab.selection)); },
  },
  { id: 'edit.selectionInfo', icon: 'info', noRecord: true, isEnabled: hasSel, run: (app) => { const s = app.tab.selection!; const p = app.picture!; toast(`Selection: ${s.w} × ${s.h} at ${s.x}, ${s.y} (right ${s.x + s.w}, bottom ${s.y + s.h}); ${(100 * s.w * s.h / (p.width * p.height)).toFixed(1)}% of the picture; aspect ${(s.w / s.h).toFixed(3)}`, { ms: 7000 }); } },

  // Crop -----------------------------------------------------------------------------------
  { id: 'edit.crop', icon: 'crop', popular: true, edits: true, isEnabled: hasSel, run: (app) => { const s = app.tab.selection!; editRaster(app, 'Crop', (r) => crop(r, s)); } },
  {
    id: 'edit.cropAspect', icon: 'crop_7_5', edits: true, isEnabled: has, tip: 'Crops to the largest area of an aspect ratio, around the selection',
    run: async (app) => {
      const r = await openDialog({ title: 'Crop to Aspect Ratio', ok: 'Crop', fields: [{ key: 'aspect', label: 'Aspect', type: 'select', options: ASPECTS, value: '3:2' }, { key: 'portrait', label: 'Portrait (taller than wide)', type: 'checkbox', value: app.picture!.height > app.picture!.width }] });
      if (!r) return;
      const a = ASPECTS.find((x) => x.value === r.aspect)!;
      const rect = maxAspectRect(app.picture!, r.portrait ? 1 / a.r : a.r, app.tab.selection);
      editRaster(app, `Crop to ${a.label}`, (x) => crop(x, rect));
    },
  },
  {
    id: 'edit.cropPrint', icon: 'crop_portrait', edits: true, isEnabled: has, tip: '4×6, 5×7, 8×10, passport and ID sizes',
    run: async (app) => {
      const r = await openDialog({ title: 'Crop for Print Size', ok: 'Crop', fields: [{ key: 'size', label: 'Size', type: 'select', options: PRINTS, value: '4x6' }, { key: 'portrait', label: 'Portrait', type: 'checkbox', value: app.picture!.height > app.picture!.width }, { key: 'i', type: 'info', label: 'Passport pictures: the head should fill about 70% of the height; adjust the selection before cropping.' }] });
      if (!r) return;
      const a = PRINTS.find((x) => x.value === r.size)!;
      const ratio = a.value === 'passport' ? (r.portrait ? a.r : 1 / a.r) : r.portrait ? 1 / a.r : a.r;
      const rect = maxAspectRect(app.picture!, ratio, app.tab.selection);
      editRaster(app, `Crop for ${a.label}`, (x) => crop(x, rect));
    },
  },
  {
    id: 'edit.autoCrop', icon: 'crop_square', edits: true, isEnabled: has, tip: 'Trims uniform borders (the top-left pixel\'s color, within a tolerance)',
    run: async (app) => {
      const pic = app.picture!;
      const src = frameRaster(pic.currentFrame);
      const rect = autoCropRect(src, 16);
      if (!rect) { toast('No uniform border to trim.'); return; }
      editRaster(app, 'Auto Crop Borders', (r) => crop(r, autoCropRect(r, 16) || { x: 0, y: 0, w: r.width, h: r.height }));
      toast(`Trimmed to ${rect.w} × ${rect.h}`);
    },
  },

  // Clipboard ------------------------------------------------------------------------------
  { id: 'edit.copy', icon: 'content_copy', popular: true, noRecord: true, isEnabled: has, run: async (app) => { await copySelection(app); } },
  {
    id: 'edit.cut', icon: 'content_cut', edits: true, isEnabled: has, tip: 'Copies the selection and clears it (transparent, or the background color)',
    run: async (app) => { const sel = selOrAll(app); await copySelection(app, false); const hasAlpha = app.picture!.current.hasAlpha; editRaster(app, 'Cut', (r) => fillRect(r, sel, hasAlpha ? [0, 0, 0, 0] : [255, 255, 255, 255]), { keepSelection: true }); toast('Cut'); },
  },
  { id: 'edit.cutOutside', icon: 'crop', edits: true, isEnabled: hasSel, tip: 'Keeps the selection, removes everything around it (a crop that also copies)', run: async (app) => { const s = app.tab.selection!; await copySelection(app, false); editRaster(app, 'Cut Outside Selection', (r) => crop(r, s)); } },
  {
    id: 'edit.paste', icon: 'content_paste', popular: true, edits: true, tip: 'Pastes into the picture at the selection (or the top-left); without a picture, opens the clipboard as a new one',
    run: async (app) => {
      if (!app.picture) return pasteAsNew(app);
      const src = await clipboardRaster(app);
      if (!src) { toast('The clipboard has no picture.'); return; }
      const at = app.tab.selection || { x: 0, y: 0, w: src.width, h: src.height };
      editRaster(app, 'Paste', (r) => pasteAt(r, src, at.x, at.y), { keepSelection: true });
      app.tab.setSelection({ x: at.x, y: at.y, w: src.width, h: src.height });
    },
  },
  { id: 'edit.pasteAsNew', icon: 'add_photo_alternate', noRecord: true, run: (app) => pasteAsNew(app) },
  {
    id: 'edit.pasteInto', icon: 'picture_in_picture', edits: true, isEnabled: hasSel, tip: 'Scales the clipboard picture to fill the selection',
    run: async (app) => {
      const src = await clipboardRaster(app);
      if (!src) { toast('The clipboard has no picture.'); return; }
      const s = app.tab.selection!;
      const scaled = resample(src, s.w, s.h, 'lanczos3');
      editRaster(app, 'Paste into Selection', (r) => pasteAt(r, scaled, s.x, s.y), { keepSelection: true });
    },
  },
  {
    id: 'edit.pasteBeside', icon: 'view_column', kind: 'menu', edits: true, isEnabled: has, tip: 'The canvas grows and the clipboard picture is placed beside',
    menu: () => [{ id: 'edit.pasteBeside', arg: 'right', label: 'Right' }, { id: 'edit.pasteBeside', arg: 'left', label: 'Left' }, { id: 'edit.pasteBeside', arg: 'bottom', label: 'Below' }, { id: 'edit.pasteBeside', arg: 'top', label: 'Above' }],
    run: async (app, arg?: string) => {
      const src = await clipboardRaster(app);
      if (!src) { toast('The clipboard has no picture.'); return; }
      const side = arg || 'right';
      editRaster(app, `Paste ${side}`, (r) => {
        const horiz = side === 'left' || side === 'right';
        const w = horiz ? r.width + src.width : Math.max(r.width, src.width), h = horiz ? Math.max(r.height, src.height) : r.height + src.height;
        const base = canvasSize(r, w, h, side === 'left' ? src.width : 0, side === 'top' ? src.height : 0, [0, 0, 0, 0]);
        return pasteAt(base, src, side === 'right' ? r.width : 0, side === 'bottom' ? r.height : 0);
      }, { patch: { hasAlpha: true } });
    },
  },
  {
    id: 'edit.clear', icon: 'backspace', edits: true, isEnabled: has, tip: 'Fills the selection with transparency (or white when the picture has no alpha)',
    run: (app) => { const sel = selOrAll(app); const hasAlpha = app.picture!.current.hasAlpha; editRaster(app, 'Clear', (r) => fillRect(r, sel, hasAlpha ? [0, 0, 0, 0] : [255, 255, 255, 255]), { keepSelection: true }); },
  },
  {
    id: 'edit.fill', icon: 'format_color_fill', edits: true, isEnabled: has,
    run: async (app) => {
      const r = await openDialog({ title: 'Fill Selection', ok: 'Fill', fields: [{ key: 'color', label: 'Color', type: 'color', value: '#000000', half: true }, { key: 'alpha', label: 'Opacity (%)', type: 'range', min: 0, max: 100, value: 100, half: true }] });
      if (!r) return;
      const sel = selOrAll(app);
      const [cr, cg, cb] = hexToRgb(r.color), a = Math.round(255 * (+r.alpha || 0) / 100);
      editRaster(app, 'Fill', (x) => fillRect(x, sel, [cr, cg, cb, a]), { keepSelection: true });
    },
  },

  // Add ------------------------------------------------------------------------------------
  {
    id: 'edit.canvasSize', icon: 'crop_landscape', edits: true, isEnabled: has, tip: 'New size with an anchor; the extra area gets a color or transparency',
    run: async (app) => {
      const pic = app.picture!;
      const r = await openDialog({ title: 'Change Canvas Size', ok: 'Apply', fields: [
        { key: 'w', label: 'Width', type: 'number', min: 1, max: 32768, value: pic.width, half: true }, { key: 'h', label: 'Height', type: 'number', min: 1, max: 32768, value: pic.height, half: true },
        { key: 'anchor', label: 'Anchor', type: 'select', options: ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right'].map((a) => ({ value: a, label: a })), value: 'center', half: true },
        { key: 'bg', label: 'Background', type: 'color', value: '#ffffff', half: true },
        { key: 'transparent', label: 'Transparent', type: 'checkbox', value: pic.current.hasAlpha },
      ] });
      if (!r) return;
      const w = Math.max(1, +r.w || pic.width), h = Math.max(1, +r.h || pic.height);
      const ax = /left/.test(r.anchor) ? 0 : /right/.test(r.anchor) ? 1 : 0.5, ay = /top/.test(r.anchor) ? 0 : /bottom/.test(r.anchor) ? 1 : 0.5;
      const bg: [number, number, number, number] = r.transparent ? [0, 0, 0, 0] : [...hexToRgb(r.bg), 255] as [number, number, number, number];
      editRaster(app, 'Canvas Size', (x) => canvasSize(x, w, h, Math.round((w - x.width) * ax), Math.round((h - x.height) * ay), bg), { patch: r.transparent ? { hasAlpha: true } : {} });
    },
  },
  {
    id: 'edit.border', icon: 'border_outer', edits: true, isEnabled: has, tip: 'Solid border or frame: width per side, inner line',
    run: async (app) => {
      const r = await openDialog({ title: 'Add Border or Frame', ok: 'Add', fields: [
        { key: 'size', label: 'Width (pixels)', type: 'number', min: 1, max: 2000, value: 20, half: true }, { key: 'color', label: 'Color', type: 'color', value: '#ffffff', half: true },
        { key: 'inner', label: 'Inner line (pixels, 0 = none)', type: 'number', min: 0, max: 200, value: 0, half: true }, { key: 'innerColor', label: 'Inner line color', type: 'color', value: '#000000', half: true },
        { key: 'rounded', label: 'Rounded corners (radius, 0 = square)', type: 'number', min: 0, max: 500, value: 0 },
      ] });
      if (!r) return;
      const s = Math.max(1, +r.size || 1), inner = Math.max(0, +r.inner || 0), rad = Math.max(0, +r.rounded || 0);
      editRaster(app, 'Add Border', (x) => {
        let out = x;
        if (inner) out = canvasSize(out, out.width + 2 * inner, out.height + 2 * inner, inner, inner, [...hexToRgb(r.innerColor), 255] as [number, number, number, number]);
        out = canvasSize(out, out.width + 2 * s, out.height + 2 * s, s, s, [...hexToRgb(r.color), 255] as [number, number, number, number]);
        if (rad) {
          const c = rasterFrame(out, 0).image as HTMLCanvasElement;
          const ctx = c.getContext('2d')!;
          ctx.globalCompositeOperation = 'destination-in';
          ctx.beginPath(); ctx.roundRect(0, 0, c.width, c.height, rad); ctx.fill();
          const id = ctx.getImageData(0, 0, c.width, c.height);
          out = { width: c.width, height: c.height, data: id.data as Uint8ClampedArray<ArrayBuffer> };
        }
        return out;
      }, { patch: rad ? { hasAlpha: true } : {} });
    },
  },
]);
