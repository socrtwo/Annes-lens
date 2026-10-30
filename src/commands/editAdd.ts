/**
 * Edit tab additions: Insert Text (fields, outline, shadow, background, rotation), Insert Watermark
 * or Overlay (a picture with opacity, position, scale, tiling), Signature (drawn, typed or from a
 * picture, kept on the device), Redact Region (blur, pixelate or black out the selection), the
 * History Panel and Go to File by Name.
 */
import { def } from './registry';
import type { App } from '../app';
import { openDialog, toast } from '../ui/dialog';
import type { Field } from '../ui/dialog';
import { h } from '../ui/dom';
import { adjustDialog, range } from './adjust';
import { editSelection, rasterFrame, frameRaster } from '../picture/edit';
import { hexToRgb } from '../picture/ops';
import { gaussianBlur } from '../picture/adjust';
import { pixelize } from '../picture/effects';
import { openDocuments } from '../platform/native';
import type { Raster } from '../codecs/raster';

const has = (app: App) => !!app.picture;
const FONTS = ['sans-serif', 'serif', 'monospace', 'cursive', 'Arial', 'Helvetica', 'Georgia', 'Times New Roman', 'Verdana', 'Trebuchet MS', 'Courier New', 'Impact', 'Comic Sans MS', 'Brush Script MT', 'Segoe UI', 'Roboto', 'Noto Sans', 'Liberation Sans', 'DejaVu Sans'];
const ANCHORS: { value: string; label: string }[] = [['tl', 'Top left'], ['tc', 'Top center'], ['tr', 'Top right'], ['ml', 'Middle left'], ['mc', 'Center'], ['mr', 'Middle right'], ['bl', 'Bottom left'], ['bc', 'Bottom center'], ['br', 'Bottom right']].map(([value, label]) => ({ value, label }));

/** Expands {date} {time} {name} {exifdate} {camera} {w} {h} {n} in text. */
export function expandFields(app: App, text: string): string {
  const pic = app.picture; const now = new Date(); const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`, time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  return text.replace(/\{(date|time|name|basename|exifdate|camera|w|h|n)\}/g, (_m, k) => {
    switch (k) {
      case 'date': return date; case 'time': return time; case 'name': return pic?.name || ''; case 'basename': return (pic?.name || '').replace(/\.[^.]+$/, '');
      case 'exifdate': return pic?.exif?.dateTaken?.slice(0, 10).replace(/:/g, '-') || date; case 'camera': return [pic?.exif?.make, pic?.exif?.model].filter(Boolean).join(' ');
      case 'w': return String(pic?.width || ''); case 'h': return String(pic?.height || ''); case 'n': return String((app.tab.folder.index + 1) || 1);
    }
    return '';
  });
}

/** Position of a w×h box in a W×H area by anchor and margin (pixels). */
export function place(anchor: string, W: number, H: number, w: number, hh: number, margin: number): [number, number] {
  const x = anchor.endsWith('l') ? margin : anchor.endsWith('r') ? W - w - margin : (W - w) / 2;
  const y = anchor.startsWith('t') ? margin : anchor.startsWith('b') ? H - hh - margin : (H - hh) / 2;
  return [x, y];
}

/** Draws text on a raster; sizes are given for `targetWidth` and scaled when the raster is a preview copy. */
export function drawText(r: Raster, targetWidth: number, o: { text: string; font: string; size: number; bold: boolean; italic: boolean; color: string; outline: number; outlineColor: string; shadow: number; shadowColor: string; bg: string; bgOpacity: number; rotation: number; anchor: string; margin: number; opacity: number; align: string }): Raster {
  const k = r.width / Math.max(1, targetWidth);
  const c = rasterFrame(r, 0).image as HTMLCanvasElement; const ctx = c.getContext('2d')!;
  const size = Math.max(1, o.size * k), lines = o.text.split('\n');
  ctx.font = `${o.italic ? 'italic ' : ''}${o.bold ? 'bold ' : ''}${size}px ${/\s/.test(o.font) ? `"${o.font}"` : o.font}`;
  ctx.textBaseline = 'top';
  const lineH = size * 1.25, tw = Math.max(...lines.map((l) => ctx.measureText(l).width)), th = lineH * lines.length;
  const pad = o.bgOpacity > 0 ? size * 0.3 : 0;
  const [bx, by] = place(o.anchor, c.width, c.height, tw + 2 * pad, th + 2 * pad, o.margin * k);
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, o.opacity));
  ctx.translate(bx + (tw + 2 * pad) / 2, by + (th + 2 * pad) / 2); ctx.rotate((o.rotation * Math.PI) / 180); ctx.translate(-(tw + 2 * pad) / 2, -(th + 2 * pad) / 2);
  if (o.bgOpacity > 0) { const [rr, gg, bb] = hexToRgb(o.bg); ctx.fillStyle = `rgba(${rr},${gg},${bb},${o.bgOpacity})`; ctx.fillRect(0, 0, tw + 2 * pad, th + 2 * pad); }
  lines.forEach((line, i) => {
    const lw = ctx.measureText(line).width, x = pad + (o.align === 'center' ? (tw - lw) / 2 : o.align === 'right' ? tw - lw : 0), y = pad + i * lineH;
    if (o.shadow > 0) { ctx.save(); ctx.shadowColor = o.shadowColor; ctx.shadowBlur = o.shadow * k; ctx.shadowOffsetX = o.shadow * k * 0.5; ctx.shadowOffsetY = o.shadow * k * 0.5; ctx.fillStyle = o.color; ctx.fillText(line, x, y); ctx.restore(); }
    if (o.outline > 0) { ctx.lineJoin = 'round'; ctx.lineWidth = o.outline * k * 2; ctx.strokeStyle = o.outlineColor; ctx.strokeText(line, x, y); }
    ctx.fillStyle = o.color; ctx.fillText(line, x, y);
  });
  ctx.restore();
  return frameRaster({ image: c, width: c.width, height: c.height, delay: 0 });
}

/** Draws an overlay picture on a raster: scale as a fraction of the target width, opacity, anchor, margin, tiling. */
export function drawOverlay(r: Raster, targetWidth: number, img: CanvasImageSource & { width: number; height: number }, o: { scale: number; opacity: number; anchor: string; margin: number; tile: boolean; rotation: number }): Raster {
  const k = r.width / Math.max(1, targetWidth);
  const c = rasterFrame(r, 0).image as HTMLCanvasElement; const ctx = c.getContext('2d')!;
  const w = Math.max(1, targetWidth * o.scale * k), hh = Math.max(1, (w * img.height) / img.width);
  ctx.save(); ctx.globalAlpha = Math.max(0, Math.min(1, o.opacity)); ctx.imageSmoothingQuality = 'high';
  if (o.tile) {
    const gap = o.margin * k;
    for (let y = -hh; y < c.height + hh; y += hh + gap) for (let x = -w; x < c.width + w; x += w + gap) { ctx.save(); ctx.translate(x + w / 2, y + hh / 2); ctx.rotate((o.rotation * Math.PI) / 180); ctx.drawImage(img, -w / 2, -hh / 2, w, hh); ctx.restore(); }
  } else {
    const [x, y] = place(o.anchor, c.width, c.height, w, hh, o.margin * k);
    ctx.translate(x + w / 2, y + hh / 2); ctx.rotate((o.rotation * Math.PI) / 180); ctx.drawImage(img, -w / 2, -hh / 2, w, hh);
  }
  ctx.restore();
  return frameRaster({ image: c, width: c.width, height: c.height, delay: 0 });
}

const targetWidth = (app: App) => app.tab.selection?.w || app.picture!.width;

async function loadImage(src: Blob | string): Promise<HTMLImageElement> {
  const url = typeof src === 'string' ? src : URL.createObjectURL(src);
  try { const img = new Image(); await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('The picture could not be decoded.')); img.src = url; }); return img; }
  finally { if (typeof src !== 'string') setTimeout(() => URL.revokeObjectURL(url), 10000); }
}

const SIG_KEY = 'quilllens.signatures.v1';
interface Signature { name: string; dataUrl: string }
const loadSignatures = (): Signature[] => { try { return JSON.parse(localStorage.getItem(SIG_KEY) || '[]'); } catch { return []; } };
const saveSignatures = (s: Signature[]) => { try { localStorage.setItem(SIG_KEY, JSON.stringify(s.slice(0, 20))); } catch { toast('The signature could not be stored on this device.'); } };

def([
  {
    id: 'edit.insertText', icon: 'title', popular: true, edits: true, isEnabled: has, tip: 'Text with font, outline, shadow, background and rotation; {date} {time} {name} {exifdate} {camera} {w} {h} {n} are filled in',
    run: async (app) => {
      const tw = targetWidth(app);
      const fields: Field[] = [
        { key: 'text', label: 'Text', type: 'textarea', rows: 2, value: '{name}' },
        { key: 'font', label: 'Font', type: 'combo', options: FONTS, value: 'sans-serif', half: true }, range('size', 'Size (px)', 6, 600, Math.max(12, Math.round(tw / 20)), true, 1),
        { key: 'bold', label: 'Bold', type: 'checkbox', value: false, half: true }, { key: 'italic', label: 'Italic', type: 'checkbox', value: false, half: true },
        { key: 'color', label: 'Color', type: 'color', value: '#ffffff', half: true }, range('opacity', 'Opacity (%)', 1, 100, 100),
        range('outline', 'Outline (px)', 0, 20, 2), { key: 'outlineColor', label: 'Outline color', type: 'color', value: '#000000', half: true },
        range('shadow', 'Shadow (px)', 0, 30, 0), { key: 'shadowColor', label: 'Shadow color', type: 'color', value: '#000000', half: true },
        range('bgOpacity', 'Background opacity (%)', 0, 100, 0), { key: 'bg', label: 'Background', type: 'color', value: '#000000', half: true },
        { key: 'anchor', label: 'Position', type: 'select', options: ANCHORS, value: 'br', half: true }, range('margin', 'Margin (px)', 0, 500, Math.round(tw / 40)),
        range('rotation', 'Rotation (°)', -180, 180, 0), { key: 'align', label: 'Lines', type: 'select', options: [{ value: 'left', label: 'Left' }, { value: 'center', label: 'Centered' }, { value: 'right', label: 'Right' }], value: 'left', half: true },
      ];
      await adjustDialog(app, 'Insert Text…', fields, (r, v) => drawText(r, tw, { text: expandFields(app, String(v.text)), font: String(v.font || 'sans-serif'), size: +v.size, bold: !!v.bold, italic: !!v.italic, color: v.color, outline: +v.outline, outlineColor: v.outlineColor, shadow: +v.shadow, shadowColor: v.shadowColor, bg: v.bg, bgOpacity: +v.bgOpacity / 100, rotation: +v.rotation, anchor: v.anchor, margin: +v.margin, opacity: +v.opacity / 100, align: v.align }), { label: 'Insert Text', help: app.tab.selection ? 'Placed inside the selection.' : undefined });
    },
  },
  {
    id: 'edit.insertOverlay', icon: 'branding_watermark', edits: true, isEnabled: has, tip: 'A picture (logo, watermark) with opacity, size, position or tiling',
    run: async (app) => {
      const files = await openDocuments('image/*', ['image/*'], false);
      if (!files.length) return;
      let img: HTMLImageElement;
      try { img = await loadImage(new Blob([files[0].data])); } catch (e: any) { toast(e.message); return; }
      const tw = targetWidth(app);
      await adjustDialog(app, 'Insert Watermark or Overlay…', [range('scale', 'Width (% of the picture)', 1, 100, 25), range('opacity', 'Opacity (%)', 1, 100, 50), { key: 'anchor', label: 'Position', type: 'select', options: ANCHORS, value: 'br', half: true }, range('margin', 'Margin (px)', 0, 500, Math.round(tw / 40)), range('rotation', 'Rotation (°)', -180, 180, 0), { key: 'tile', label: 'Tile across the picture (margin = gap)', type: 'checkbox', value: false }],
        (r, v) => drawOverlay(r, tw, img, { scale: +v.scale / 100, opacity: +v.opacity / 100, anchor: v.anchor, margin: +v.margin, tile: !!v.tile, rotation: +v.rotation }), { label: `Overlay ${files[0].name}` });
    },
  },
  {
    id: 'edit.signature', icon: 'draw', edits: true, isEnabled: has, tip: 'Draw, type or load a signature once; it stays on this device and goes onto pictures as an overlay',
    run: async (app) => {
      const sigs = loadSignatures();
      const canvas = h('canvas', { width: '600', height: '200', class: 'qn-sigpad' }) as HTMLCanvasElement;
      const ctx = canvas.getContext('2d')!; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#102a6b';
      let drawing = false, drew = false;
      const pos = (e: PointerEvent) => { const r = canvas.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * canvas.width, ((e.clientY - r.top) / r.height) * canvas.height]; };
      canvas.addEventListener('pointerdown', (e) => { drawing = true; drew = true; const [x, y] = pos(e); ctx.beginPath(); ctx.moveTo(x, y); canvas.setPointerCapture(e.pointerId); });
      canvas.addEventListener('pointermove', (e) => { if (!drawing) return; const [x, y] = pos(e); ctx.lineTo(x, y); ctx.stroke(); });
      canvas.addEventListener('pointerup', () => { drawing = false; });
      const typed = async (text: string, color: string) => { ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = color; ctx.font = '96px "Brush Script MT", "Segoe Script", cursive'; ctx.textBaseline = 'middle'; ctx.fillText(text, 20, 100); drew = !!text; };
      const fields = (): Field[] => [
        { key: 'use', label: 'Signature', type: 'select', options: [{ value: '', label: '(new: draw below, type, or load a picture)' }, ...sigs.map((s) => ({ value: s.name, label: s.name }))], value: '' },
        { key: 'typed', label: 'Type it instead', type: 'text', value: '', half: true }, { key: 'ink', label: 'Ink', type: 'color', value: '#102a6b', half: true },
        { key: 'load', label: 'Load a picture of it', type: 'file', accept: 'image/*', half: true }, { key: 'clear', label: 'Clear the pad', type: 'button', half: true, onClick: () => { ctx.clearRect(0, 0, canvas.width, canvas.height); drew = false; } },
        { key: 'name', label: 'Save as (name)', type: 'text', value: '', half: true },
        { key: 'del', label: 'Delete the chosen signature', type: 'button', half: true, onClick: (v, ctl) => { const i = sigs.findIndex((s) => s.name === v.use); if (i >= 0) { sigs.splice(i, 1); saveSignatures(sigs); ctl.rebuild(fields()); } } },
      ];
      const r = await openDialog({ title: 'Signature', wide: true, ok: 'Next: place it', content: h('div', { class: 'qn-sigwrap' }, canvas), fields: fields(), help: 'Draw with the mouse, pen or finger. Signatures are stored only on this device.', onChange: async (v, ctl, key) => {
        if (key === 'typed') { ctx.strokeStyle = v.ink; await typed(String(v.typed), v.ink); }
        if (key === 'ink') ctx.strokeStyle = v.ink;
        if (key === 'load' && v.load) { try { const img = await loadImage(v.load as Blob); ctx.clearRect(0, 0, canvas.width, canvas.height); const k = Math.min(canvas.width / img.width, canvas.height / img.height); ctx.drawImage(img, (canvas.width - img.width * k) / 2, (canvas.height - img.height * k) / 2, img.width * k, img.height * k); drew = true; } catch (e: any) { toast(e.message); } }
        if (key === 'use' && v.use) { const s = sigs.find((x) => x.name === v.use); if (s) { try { const img = await loadImage(s.dataUrl); ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(img, 0, 0); drew = true; ctl.set('name', s.name); } catch { /* ignore */ } } }
      } });
      if (!r) return;
      if (!drew) { toast('Draw, type or load a signature first.'); return; }
      // Trim to the ink and keep a transparent PNG.
      const id = ctx.getImageData(0, 0, canvas.width, canvas.height), d = id.data; let x0 = canvas.width, y0 = canvas.height, x1 = 0, y1 = 0;
      for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) if (d[(y * canvas.width + x) * 4 + 3] > 10) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
      if (x1 < x0) { toast('The pad is empty.'); return; }
      const trimmed = document.createElement('canvas'); trimmed.width = x1 - x0 + 9; trimmed.height = y1 - y0 + 9; trimmed.getContext('2d')!.drawImage(canvas, x0 - 4, y0 - 4, trimmed.width, trimmed.height, 0, 0, trimmed.width, trimmed.height);
      const name = String(r.name || '').trim();
      if (name) { const i = sigs.findIndex((s) => s.name === name); const entry = { name, dataUrl: trimmed.toDataURL('image/png') }; if (i >= 0) sigs[i] = entry; else sigs.push(entry); saveSignatures(sigs); }
      const tw = targetWidth(app);
      await adjustDialog(app, 'Place the Signature…', [range('scale', 'Width (% of the picture)', 2, 100, 20), range('opacity', 'Opacity (%)', 10, 100, 100), { key: 'anchor', label: 'Position', type: 'select', options: ANCHORS, value: 'br', half: true }, range('margin', 'Margin (px)', 0, 500, Math.round(tw / 40)), range('rotation', 'Rotation (°)', -45, 45, 0)],
        (x, v) => drawOverlay(x, tw, trimmed, { scale: +v.scale / 100, opacity: +v.opacity / 100, anchor: v.anchor, margin: +v.margin, tile: false, rotation: +v.rotation }), { label: 'Signature' });
    },
  },
  {
    id: 'edit.redact', icon: 'visibility_off', edits: true, isEnabled: (app) => !!app.picture && !!app.tab.selection, tip: 'Blurs, pixelates or blacks out the selection (the pixels are destroyed, not covered)',
    run: async (app) => {
      if (!app.tab.selection) { toast('Select the region first (Shift+drag).'); return; }
      await adjustDialog(app, 'Redact Region…', [{ key: 'mode', label: 'Method', type: 'select', options: [{ value: 'black', label: 'Black out (safest)' }, { value: 'pixelate', label: 'Pixelate' }, { value: 'blur', label: 'Blur' }], value: 'black', half: true }, range('strength', 'Block size / blur radius (px)', 4, 120, 24)],
        (r, v) => { if (v.mode === 'black') { const o = { width: r.width, height: r.height, data: r.data.slice() as Uint8ClampedArray<ArrayBuffer> }; for (let i = 0; i < o.data.length; i += 4) { o.data[i] = o.data[i + 1] = o.data[i + 2] = 0; o.data[i + 3] = 255; } return o; } const k = Math.max(1, Math.round(+v.strength * (r.width / app.tab.selection!.w))); return v.mode === 'pixelate' ? pixelize(r, k) : gaussianBlur(pixelize(r, Math.max(2, k >> 2)), k); }, { label: 'Redact', help: 'Blur and pixelate can sometimes be partly reversed; black out when it matters. Strip the EXIF thumbnail too (Metadata ▸ Strip Metadata).' });
    },
  },
  {
    id: 'edit.history', icon: 'history', noRecord: true, isEnabled: (app) => !!app.picture && (app.tab.canUndo || app.tab.canRedo), tip: 'Every undoable step with a thumbnail; click one to go back to it',
    run: async (app) => {
      const t = app.tab; const hist = t.history; const redo = t.redoHistory;
      const thumb = (img: CanvasImageSource, w: number, hh: number) => { const c = document.createElement('canvas'); const k = Math.min(1, 96 / Math.max(w, hh)); c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(hh * k)); c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height); return c; };
      const dialog = { close: null as null | (() => void) };
      let target: number | null = null;
      const cur = app.picture!.currentFrame;
      const items = [
        ...hist.map((s, i) => h('button', { class: 'qn-fxcard', type: 'button', onclick: () => { target = hist.length - i; dialog.close?.(); } }, thumb(s.image, s.width, s.height), h('span', null, `${i === 0 ? 'Original' : `After step ${i}`}`), h('span', { class: 'ql-help' }, `before: ${s.label}`))),
        h('button', { class: 'qn-fxcard qn-fxcard-current', type: 'button', onclick: () => dialog.close?.() }, thumb(cur.image as CanvasImageSource, cur.width, cur.height), h('span', null, 'Now'), h('span', { class: 'ql-help' }, hist.length ? `after: ${hist[hist.length - 1].label}` : 'unchanged')),
      ];
      await openDialog({ title: 'History', wide: true, cancel: false, ok: 'Close', help: `${hist.length} undoable step${hist.length === 1 ? '' : 's'}${redo.length ? `; ${redo.length} redo step${redo.length === 1 ? '' : 's'} kept until the next edit` : ''}. Click a state to return to it.`, content: h('div', { class: 'qn-fxgrid' }, ...items), onOpen: (ctl) => { dialog.close = () => ctl.close({}); } });
      if (target) { for (let i = 0; i < target; i++) if (!t.undo()) break; toast(`Back ${target} step${target === 1 ? '' : 's'}; Redo restores them`); }
    },
  },
  {
    id: 'edit.gotoFile', icon: 'manage_search', noRecord: true, isEnabled: (app) => app.folder.length > 1, tip: 'Type part of a name to jump to a file in this folder',
    run: async (app) => {
      const names = app.tab.folder.entries.map((e) => e.name);
      const r = await openDialog({ title: 'Go to File', ok: 'Go', fields: [{ key: 'name', label: 'File name', type: 'combo', options: names, value: '', autofocus: true, placeholder: 'Start typing…' }] });
      if (!r) return;
      const q = String(r.name || '').trim().toLowerCase(); if (!q) return;
      const f = app.tab.folder;
      let i = f.entries.findIndex((e) => e.name.toLowerCase() === q); if (i < 0) i = f.entries.findIndex((e) => e.name.toLowerCase().startsWith(q)); if (i < 0) i = f.entries.findIndex((e) => e.name.toLowerCase().includes(q));
      if (i < 0) { toast(`No file matches "${r.name}".`); return; }
      f.select(i); await app.tab.show();
    },
  },
]);
