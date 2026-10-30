/**
 * Image tab (M3): size (resize with every common kernel, half, double, to screen, DPI), rotation by any
 * angle, and color depth (grayscale, negative, thresholds, color reduction with dithering, channel
 * swaps and views, flatten, transparent and replaced colors).
 */
import { def } from './registry';
import type { App } from '../app';
import { openDialog, toast } from '../ui/dialog';
import { editRaster, editSelection, frameRaster } from '../picture/edit';
import { resample, KERNELS, grayscale, negative, otsu, threshold, adaptiveThreshold, reduceColors, swapChannels, showChannel, flatten, replaceColor, hexToRgb, type Kernel, type Dither, type ChannelOrder, type Channel } from '../picture/ops';
import { makeRaster } from '../codecs/raster';
import { mapPage } from '../picture/model';

const has = (app: App) => !!app.picture;

export function resizeTo(app: App, w: number, h: number, kernel: Kernel, linear = false): void {
  const pic = app.picture!;
  if (w === pic.width && h === pic.height) return;
  editRaster(app, `Resize to ${w} × ${h}`, (r) => resample(r, w, h, kernel, linear), { patch: { dpi: pic.current.dpi } });
}

def([
  {
    id: 'image.resize', icon: 'photo_size_select_large', popular: true, edits: true, isEnabled: has,
    tip: 'Pixels, percent or print size; nearest, bilinear, bicubic, Mitchell, Catmull-Rom, Lanczos, B-spline; optional gamma-correct',
    run: async (app) => {
      const pic = app.picture!;
      const dpi = pic.current.dpi?.[0] || 96;
      const ratio = pic.width / pic.height;
      const r = await openDialog({ title: 'Resize / Resample', ok: 'Resize', fields: [
        { key: 'mode', label: 'Set', type: 'radio', options: [{ value: 'px', label: 'Pixels' }, { value: 'pct', label: 'Percent' }, { value: 'print', label: `Print size (inches at ${dpi} dpi)` }], value: 'px' },
        { key: 'w', label: 'Width', type: 'number', min: 1, max: 32768, value: pic.width, half: true, visibleIf: (v) => v.mode === 'px' },
        { key: 'h', label: 'Height', type: 'number', min: 1, max: 32768, value: pic.height, half: true, visibleIf: (v) => v.mode === 'px' },
        { key: 'pct', label: 'Percent', type: 'number', min: 1, max: 3200, step: 1, value: 50, half: true, visibleIf: (v) => v.mode === 'pct' },
        { key: 'pw', label: 'Width (in)', type: 'number', min: 0.1, max: 400, step: 0.1, value: Math.round((pic.width / dpi) * 100) / 100, half: true, visibleIf: (v) => v.mode === 'print' },
        { key: 'pdpi', label: 'At DPI', type: 'number', min: 1, max: 10000, value: dpi, half: true, visibleIf: (v) => v.mode === 'print' },
        { key: 'keep', label: 'Keep the aspect ratio', type: 'checkbox', value: true, half: true },
        { key: 'kernel', label: 'Method', type: 'select', options: Object.entries(KERNELS).map(([value, k]) => ({ value, label: k.label })), value: 'lanczos3', half: true },
        { key: 'linear', label: 'Gamma-correct (blend in linear light)', type: 'checkbox', value: false, half: true },
        { key: 'i', type: 'info', label: `Now ${pic.width} × ${pic.height} pixels. Lanczos 3 for photos; nearest neighbor for pixel art and exact multiples.` },
      ], onChange: (v, ctl, key) => {
        if (!v.keep) return;
        if (key === 'w') ctl.set('h', Math.max(1, Math.round(+v.w / ratio))); else if (key === 'h') ctl.set('w', Math.max(1, Math.round(+v.h * ratio)));
      } });
      if (!r) return;
      let w: number, h: number;
      if (r.mode === 'pct') { w = Math.round(pic.width * (+r.pct || 100) / 100); h = Math.round(pic.height * (+r.pct || 100) / 100); }
      else if (r.mode === 'print') { w = Math.round((+r.pw || 1) * (+r.pdpi || dpi)); h = Math.round(w / ratio); }
      else { w = Math.max(1, Math.round(+r.w || pic.width)); h = r.keep ? Math.max(1, Math.round(w / ratio)) : Math.max(1, Math.round(+r.h || pic.height)); }
      if (w * h > 80_000_000) { toast('That is larger than 80 megapixels; choose a smaller size.'); return; }
      resizeTo(app, Math.max(1, w), Math.max(1, h), r.kernel, !!r.linear);
      if (r.mode === 'print' && +r.pdpi) app.picture!.current.dpi = [+r.pdpi, +r.pdpi];
    },
  },
  { id: 'image.halfSize', icon: 'photo_size_select_small', edits: true, isEnabled: has, run: (app) => { const p = app.picture!; resizeTo(app, Math.max(1, Math.round(p.width / 2)), Math.max(1, Math.round(p.height / 2)), 'lanczos3'); } },
  { id: 'image.doubleSize', icon: 'zoom_out_map', edits: true, isEnabled: has, run: (app) => { const p = app.picture!; if (p.width * p.height * 4 > 80_000_000) { toast('Too large to double.'); return; } resizeTo(app, p.width * 2, p.height * 2, 'lanczos3'); } },
  {
    id: 'image.resizeToScreen', icon: 'fit_screen', edits: true, isEnabled: has, tip: 'Shrinks (or enlarges) to fit the screen size',
    run: (app) => { const p = app.picture!; const sw = screen.width * (devicePixelRatio || 1), sh = screen.height * (devicePixelRatio || 1); const s = Math.min(sw / p.width, sh / p.height); resizeTo(app, Math.max(1, Math.round(p.width * s)), Math.max(1, Math.round(p.height * s)), 'lanczos3'); },
  },
  {
    id: 'image.setDpi', icon: 'straighten', noRecord: true, isEnabled: has, tip: 'Changes the print resolution stored with the picture; the pixels stay',
    run: async (app) => {
      const pic = app.picture!;
      const r = await openDialog({ title: 'Set Print Resolution', ok: 'Set', fields: [
        { key: 'dpi', label: 'Pixels per inch', type: 'number', min: 1, max: 10000, value: pic.current.dpi?.[0] || 96, half: true },
        { key: 'i', type: 'info', label: `${pic.width} × ${pic.height} pixels print at ${(pic.width / (pic.current.dpi?.[0] || 96)).toFixed(2)} × ${(pic.height / (pic.current.dpi?.[1] || 96)).toFixed(2)} in now. Saved with PNG, JPEG (JFIF) and TIFF output.` },
      ] });
      if (!r) return;
      const d = Math.max(1, +r.dpi || 96);
      app.edit('Set DPI', (p) => { p.pages = p.pages.map((pg) => ({ ...pg, dpi: [d, d] })); });
      toast(`${d} dpi`);
    },
  },
  {
    id: 'image.rotateCustom', icon: 'rotate_right', edits: true, isEnabled: has, tip: 'Any angle; expand the canvas or keep the size; background color or transparency',
    run: async (app) => {
      const pic = app.picture!;
      const r = await openDialog({ title: 'Custom Rotation', ok: 'Rotate', fields: [
        { key: 'angle', label: 'Angle (degrees, clockwise)', type: 'number', min: -360, max: 360, step: 0.1, value: 0, half: true },
        { key: 'expand', label: 'Canvas', type: 'select', options: [{ value: 'expand', label: 'Expand to hold the whole picture' }, { value: 'keep', label: 'Keep the size (corners cut)' }], value: 'expand', half: true },
        { key: 'bg', label: 'Background', type: 'color', value: '#ffffff', half: true },
        { key: 'transparent', label: 'Transparent background', type: 'checkbox', value: pic.current.hasAlpha, half: true },
      ] });
      if (!r) return;
      const a = ((+r.angle || 0) * Math.PI) / 180;
      if (!a) return;
      app.edit(`Rotate ${r.angle}°`, (p) => {
        p.pages = p.pages.map((pg, i) => (i !== p.page ? pg : mapPage(pg, (w, h) => (r.expand === 'expand' ? [Math.ceil(Math.abs(w * Math.cos(a)) + Math.abs(h * Math.sin(a))), Math.ceil(Math.abs(w * Math.sin(a)) + Math.abs(h * Math.cos(a)))] : [w, h]), (ctx, f, w, h) => {
          if (!r.transparent) { ctx.fillStyle = r.bg; ctx.fillRect(0, 0, w, h); }
          ctx.save(); ctx.translate(w / 2, h / 2); ctx.rotate(a); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(f.image as CanvasImageSource, -f.width / 2, -f.height / 2); ctx.restore();
        })));
        if (r.transparent) p.pages[p.page].hasAlpha = true;
      });
      app.tab.setSelection(null);
    },
  },
]);

// Color depth and palette --------------------------------------------------------------------------

def([
  { id: 'image.grayscale', icon: 'filter_b_and_w', popular: true, edits: true, isEnabled: has, run: (app) => editSelection(app, 'Grayscale', grayscale) },
  {
    id: 'image.negative', icon: 'invert_colors', edits: true, isEnabled: has, kind: 'menu',
    menu: () => [{ id: 'image.negative', arg: 'all', label: 'All channels' }, { id: 'image.negative', arg: 'r', label: 'Red only' }, { id: 'image.negative', arg: 'g', label: 'Green only' }, { id: 'image.negative', arg: 'b', label: 'Blue only' }],
    run: (app, arg?: string) => editSelection(app, 'Negative', (r) => negative(r, arg === 'r' ? [true, false, false] : arg === 'g' ? [false, true, false] : arg === 'b' ? [false, false, true] : [true, true, true])),
  },
  {
    id: 'image.threshold', icon: 'contrast', edits: true, isEnabled: has, tip: 'Fixed level, Otsu (automatic), or adaptive for uneven scans',
    run: async (app) => {
      const pic = app.picture!;
      const auto = otsu(frameRaster(pic.currentFrame));
      const r = await openDialog({ title: 'Black and White (Threshold)', ok: 'Apply', fields: [
        { key: 'mode', label: 'Method', type: 'radio', options: [{ value: 'otsu', label: `Automatic (Otsu): ${auto}` }, { value: 'fixed', label: 'Fixed level' }, { value: 'adaptive', label: 'Adaptive (local mean; for shaded scans)' }], value: 'otsu' },
        { key: 'level', label: 'Level (0–255): pixels brighter than this become white', type: 'range', min: 0, max: 255, value: auto, visibleIf: (v) => v.mode === 'fixed' },
        { key: 'radius', label: 'Neighborhood radius (pixels)', type: 'number', min: 2, max: 200, value: 15, half: true, visibleIf: (v) => v.mode === 'adaptive' },
        { key: 'offset', label: 'Offset (higher = less black)', type: 'number', min: -64, max: 64, value: 8, half: true, visibleIf: (v) => v.mode === 'adaptive' },
      ] });
      if (!r) return;
      editSelection(app, 'Threshold', (x) => (r.mode === 'adaptive' ? adaptiveThreshold(x, +r.radius || 15, +r.offset || 0) : threshold(x, r.mode === 'otsu' ? otsu(x) : +r.level)));
    },
  },
  {
    id: 'image.decreaseDepth', icon: 'gradient', edits: true, isEnabled: has, tip: '2, 16, 256 or any number of colors; optimal, web or grayscale palette; Floyd–Steinberg, Atkinson, ordered or no dithering',
    run: async (app) => {
      const r = await openDialog({ title: 'Decrease Color Depth', ok: 'Apply', fields: [
        { key: 'colors', label: 'Colors', type: 'select', options: [{ value: '2', label: '2 (black and white)' }, { value: '4', label: '4' }, { value: '16', label: '16' }, { value: '64', label: '64' }, { value: '256', label: '256' }, { value: 'custom', label: 'Custom…' }], value: '256', half: true },
        { key: 'n', label: 'Number of colors', type: 'number', min: 2, max: 256, value: 32, half: true, visibleIf: (v) => v.colors === 'custom' },
        { key: 'palette', label: 'Palette', type: 'select', options: [{ value: 'optimal', label: 'Optimal (median cut from the picture)' }, { value: 'web', label: 'Web-safe (216 colors)' }, { value: 'gray', label: 'Grayscale' }], value: 'optimal', half: true },
        { key: 'dither', label: 'Dithering', type: 'select', options: [{ value: 'floyd', label: 'Floyd–Steinberg' }, { value: 'atkinson', label: 'Atkinson' }, { value: 'ordered', label: 'Ordered (Bayer 4×4)' }, { value: 'none', label: 'None' }], value: 'floyd', half: true },
      ] });
      if (!r) return;
      const n = r.colors === 'custom' ? Math.max(2, Math.min(256, +r.n || 32)) : +r.colors;
      let palette: { colors: [number, number, number][] } | undefined;
      if (r.palette === 'web') { const c: [number, number, number][] = []; for (let x = 0; x < 6; x++) for (let y = 0; y < 6; y++) for (let z = 0; z < 6; z++) c.push([x * 51, y * 51, z * 51]); palette = { colors: c }; }
      else if (r.palette === 'gray') { const c: [number, number, number][] = []; for (let i = 0; i < n; i++) { const v = Math.round((255 * i) / (n - 1)); c.push([v, v, v]); } palette = { colors: c }; }
      editSelection(app, `Reduce to ${palette ? palette.colors.length : n} colors`, (x) => reduceColors(x, n, r.dither as Dither, palette).raster);
      const pg = app.picture!.current; pg.bitDepth = n <= 2 ? 1 : n <= 16 ? 4 : 8; pg.paletteSize = palette ? palette.colors.length : n;
    },
  },
  { id: 'image.increaseDepth', icon: 'hdr_strong', edits: true, isEnabled: has, tip: 'Marks the picture as 24-bit RGB (32-bit with transparency); pixels are already full color in memory', run: (app) => { app.edit('Increase Color Depth', (p) => { const pg = { ...p.current }; pg.bitDepth = pg.hasAlpha ? 32 : 24; pg.paletteSize = undefined; p.pages = p.pages.map((x, i) => (i === p.page ? pg : x)); }); } },
  {
    id: 'image.swapChannels', icon: 'swap_horiz', edits: true, isEnabled: has, kind: 'menu',
    menu: () => (['bgr', 'rbg', 'grb', 'gbr', 'brg'] as ChannelOrder[]).map((o) => ({ id: 'image.swapChannels', arg: o, label: `RGB → ${o.toUpperCase()}` })),
    run: (app, arg?: ChannelOrder) => editSelection(app, `Swap channels (${(arg || 'bgr').toUpperCase()})`, (r) => swapChannels(r, arg || 'bgr')),
  },
  {
    id: 'image.showChannel', icon: 'layers', edits: true, isEnabled: has, kind: 'menu',
    menu: () => (['red', 'green', 'blue', 'alpha', 'luminance'] as Channel[]).map((c) => ({ id: 'image.showChannel', arg: c, label: c[0].toUpperCase() + c.slice(1) })),
    run: (app, arg?: Channel) => editRaster(app, `Show ${arg || 'luminance'} channel`, (r) => showChannel(r, arg || 'luminance'), { keepSelection: true }),
  },
  {
    id: 'image.flatten', icon: 'layers_clear', edits: true, isEnabled: (app) => !!app.picture?.current.hasAlpha, tip: 'Merges transparency onto a background color',
    run: async (app) => {
      const r = await openDialog({ title: 'Flatten Transparency', ok: 'Flatten', fields: [{ key: 'bg', label: 'Background', type: 'color', value: '#ffffff' }] });
      if (!r) return;
      editRaster(app, 'Flatten', (x) => flatten(x, hexToRgb(r.bg)), { keepSelection: true, patch: { hasAlpha: false } });
    },
  },
  {
    id: 'image.transparentColor', icon: 'opacity', edits: true, isEnabled: has, tip: 'Makes one color (within a tolerance) transparent, for GIF, PNG and ICO output',
    run: async (app) => {
      const pic = app.picture!;
      const px = frameRaster(pic.currentFrame).data;
      const first = '#' + [px[0], px[1], px[2]].map((v) => v.toString(16).padStart(2, '0')).join('');
      const r = await openDialog({ title: 'Transparent Color', ok: 'Apply', fields: [
        { key: 'color', label: 'Color', type: 'color', value: first, half: true, help: 'The top-left pixel is suggested; Ctrl+click a pixel in the picture to read its color in the status bar.' },
        { key: 'tol', label: 'Tolerance (0–255)', type: 'range', min: 0, max: 255, value: 0, half: true },
      ] });
      if (!r) return;
      editSelection(app, 'Transparent color', (x) => replaceColor(x, hexToRgb(r.color), +r.tol || 0, null));
      app.picture!.current.hasAlpha = true;
    },
  },
  {
    id: 'image.replaceColor', icon: 'format_color_fill', edits: true, isEnabled: has,
    run: async (app) => {
      const r = await openDialog({ title: 'Replace Color', ok: 'Replace', fields: [
        { key: 'from', label: 'Replace', type: 'color', value: '#ffffff', half: true }, { key: 'to', label: 'With', type: 'color', value: '#000000', half: true },
        { key: 'tol', label: 'Tolerance (0–255)', type: 'range', min: 0, max: 255, value: 16 },
      ] });
      if (!r) return;
      editSelection(app, 'Replace color', (x) => replaceColor(x, hexToRgb(r.from), +r.tol || 0, [...hexToRgb(r.to), 255] as [number, number, number, number]));
    },
  },
]);

export { makeRaster };
