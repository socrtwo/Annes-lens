/**
 * Image tab additions: Content-Aware Resize (seam carving; the selection protects or removes),
 * Alpha from Mask (the selection mask or a grayscale picture becomes the alpha channel), Import
 * Palette (.gpl, .act, .pal, .aco, hex lists) and Edit Palette (quantize, edit the entries, remap).
 */
import { def } from './registry';
import type { App } from '../app';
import { openDialog, toast } from '../ui/dialog';
import type { Field } from '../ui/dialog';
import { editRaster, frameRaster } from '../picture/edit';
import { reduceColors, resample, grayscale, hexToRgb, type Dither } from '../picture/ops';
import { medianCut, parsePalette, type Palette } from '../codecs/palette';
import { seamCarve } from '../picture/seam';
import { openDocuments } from '../platform/native';
import { decodePicture } from '../codecs/registry';
import { entryFromBytes } from '../picture/folder';
import type { Raster } from '../codecs/raster';

const has = (app: App) => !!app.picture;
const hex = (c: [number, number, number]) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
const ditherField: Field = { key: 'dither', label: 'Dithering', type: 'select', options: [{ value: 'floyd', label: 'Floyd–Steinberg' }, { value: 'atkinson', label: 'Atkinson' }, { value: 'ordered', label: 'Ordered' }, { value: 'none', label: 'None' }], value: 'floyd', half: true };

def([
  {
    id: 'image.seamCarve', icon: 'compress', edits: true, isEnabled: has, tip: 'Shrinks or widens by removing or inserting low-energy seams; the selection protects (or removes) an area',
    run: async (app) => {
      const pic = app.picture!; const t = app.tab;
      const r = await openDialog({ title: 'Content-Aware Resize', ok: 'Resize', preview: true, help: 'Seams go through the plainest parts of the picture, so subjects keep their shape. Big changes take a while.', fields: [
        { key: 'w', label: 'Width (px)', type: 'number', min: 1, max: 20000, value: pic.width, half: true }, { key: 'h', label: 'Height (px)', type: 'number', min: 1, max: 20000, value: pic.height, half: true },
        { key: 'pct', label: 'Or scale width to (%)', type: 'number', min: 10, max: 300, value: 100, half: true }, { key: 'sel', label: 'The selection', type: 'select', options: [{ value: 'protect', label: 'Protects its area' }, { value: 'remove', label: 'Is removed (object removal)' }, { value: 'ignore', label: 'Is ignored' }], value: 'protect', half: true, visibleIf: () => !!t.selection },
      ], onChange: (v, ctl, key) => { if (key === 'pct') { ctl.set('w', Math.max(1, Math.round((pic.width * +v.pct) / 100))); } const w = +ctl.get('w'), h = +ctl.get('h'); ctl.setPreview(`${pic.width} × ${pic.height} → <b>${w} × ${h}</b> (${Math.abs(w - pic.width) + Math.abs(h - pic.height)} seams)`); }, onOpen: (ctl) => ctl.setPreview(`${pic.width} × ${pic.height}`) });
      if (!r) return;
      const w = Math.max(1, +r.w || pic.width), h = Math.max(1, +r.h || pic.height);
      if (w === pic.width && h === pic.height && r.sel !== 'remove') { toast('Nothing to change.'); return; }
      let protect: Uint8Array | null = null, remove: Uint8Array | null = null;
      if (t.selection && r.sel !== 'ignore') { const m = t.selectionMask || (() => { const mm = new Uint8Array(pic.width * pic.height); const s = t.selection!; for (let y = s.y; y < s.y + s.h; y++) mm.fill(255, y * pic.width + s.x, y * pic.width + s.x + s.w); return mm; })(); if (r.sel === 'protect') protect = m; else remove = m; }
      let targetW = w; if (remove && w === pic.width && h === pic.height) { targetW = pic.width - (t.selection!.w); toast(`Removing the selection: width ${pic.width} → ${targetW}`, { ms: 2000 }); }
      toast('Carving…', { ms: 3000 }); await new Promise((res) => setTimeout(res, 30));
      editRaster(app, 'Content-Aware Resize', (x) => seamCarve(x, targetW, h, protect, remove));
      t.setSelection(null);
    },
  },
  {
    id: 'image.alphaFromMask', icon: 'opacity', edits: true, isEnabled: has, tip: 'The selection (mask or rectangle) or a grayscale picture file becomes the alpha channel',
    run: async (app) => {
      const pic = app.picture!; const t = app.tab;
      const r = await openDialog({ title: 'Alpha from Mask', ok: 'Apply', fields: [{ key: 'src', label: 'Mask', type: 'select', options: [...(t.selection ? [{ value: 'selection', label: 'The selection (inside = opaque)' }] : []), { value: 'file', label: 'A grayscale picture file (white = opaque)…' }, { value: 'lum', label: 'This picture\'s own brightness' }], value: t.selection ? 'selection' : 'lum' }, { key: 'invert', label: 'Invert (selected or white = transparent)', type: 'checkbox', value: false }] });
      if (!r) return;
      let alpha: Uint8Array | null = null;
      if (r.src === 'selection' && t.selection) { alpha = t.selectionMask ? t.selectionMask.slice() : (() => { const mm = new Uint8Array(pic.width * pic.height); const s = t.selection!; for (let y = s.y; y < s.y + s.h; y++) mm.fill(255, y * pic.width + s.x, y * pic.width + s.x + s.w); return mm; })(); }
      else if (r.src === 'file') { const files = await openDocuments('image/*', ['image/*'], false); if (!files.length) return; const mp = await decodePicture(new Uint8Array(files[0].data), entryFromBytes(files[0].name, files[0].data)); try { let g = grayscale(frameRaster(mp.currentFrame)); if (g.width !== pic.width || g.height !== pic.height) g = resample(g, pic.width, pic.height, 'bilinear'); alpha = new Uint8Array(pic.width * pic.height); for (let j = 0; j < alpha.length; j++) alpha[j] = g.data[j * 4]; } finally { mp.release(); } }
      else { const g = grayscale(frameRaster(pic.currentFrame)); alpha = new Uint8Array(pic.width * pic.height); for (let j = 0; j < alpha.length; j++) alpha[j] = g.data[j * 4]; }
      const a = alpha!;
      editRaster(app, 'Alpha from Mask', (x) => { const out: Raster = { width: x.width, height: x.height, data: x.data.slice() as Uint8ClampedArray<ArrayBuffer> }; for (let j = 0; j < a.length && j * 4 + 3 < out.data.length; j++) out.data[j * 4 + 3] = r.invert ? 255 - a[j] : a[j]; return out; }, { patch: { hasAlpha: true }, keepSelection: true });
      toast('Alpha set; save as PNG, WebP or TIFF to keep it.');
    },
  },
  {
    id: 'image.paletteImport', icon: 'palette', edits: true, isEnabled: has, tip: 'Maps the picture onto the colors of a .gpl, .act, .pal, .aco or hex-list palette file',
    run: async (app) => {
      const files = await openDocuments('.gpl,.act,.pal,.aco,.txt,.hex,.css', ['*/*'], false); if (!files.length) return;
      const pal = parsePalette(new Uint8Array(files[0].data), files[0].name);
      if (!pal.colors.length) { toast(`No colors found in ${files[0].name}.`); return; }
      const r = await openDialog({ title: `Import Palette — ${pal.colors.length} colors`, ok: 'Apply', preview: `<div style="display:flex;flex-wrap:wrap;gap:3px">${pal.colors.slice(0, 256).map((c) => `<span style="width:18px;height:18px;border-radius:3px;background:${hex(c)};border:1px solid #8884"></span>`).join('')}</div>`, fields: [ditherField] });
      if (!r) return;
      editRaster(app, `Palette ${files[0].name}`, (x) => reduceColors(x, pal.colors.length, r.dither as Dither, pal).raster);
    },
  },
  {
    id: 'image.paletteEdit', icon: 'color_lens', edits: true, isEnabled: has, tip: 'Quantizes to a palette you can edit entry by entry, then remaps the picture',
    run: async (app) => {
      const pic = app.picture!; const raster = frameRaster(pic.currentFrame);
      const n0 = Math.min(64, pic.current.paletteSize || 16);
      const first = await openDialog({ title: 'Edit Palette', ok: 'Next', fields: [{ key: 'n', label: 'Colors (up to 64 editable)', type: 'number', min: 2, max: 64, value: n0, half: true }, ditherField] });
      if (!first) return;
      const n = Math.max(2, Math.min(64, +first.n || 16));
      const pal: Palette = medianCut(raster.data, n); pal.colors.sort((a, b) => (0.299 * a[0] + 0.587 * a[1] + 0.114 * a[2]) - (0.299 * b[0] + 0.587 * b[1] + 0.114 * b[2]));
      const r = await openDialog({ title: `Edit Palette — ${pal.colors.length} colors`, wide: true, ok: 'Apply', help: 'Change any entry; the picture is remapped onto the edited palette.', fields: pal.colors.map((c, i) => ({ key: `c${i}`, label: `${i + 1}`, type: 'color' as const, value: hex(c), half: true })) });
      if (!r) return;
      const edited: Palette = { colors: pal.colors.map((_, i) => hexToRgb(r[`c${i}`]) as [number, number, number]) };
      editRaster(app, 'Edit Palette', (x) => reduceColors(x, edited.colors.length, first.dither as Dither, edited).raster, { patch: { paletteSize: edited.colors.length } });
    },
  },
]);
