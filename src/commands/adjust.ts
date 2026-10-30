/**
 * Adjust tab (M4 start): automatic corrections, tone, color and detail commands with a live preview
 * dialog. Edits are undoable steps on the pixels; the non-destructive stack, presets and curves come
 * later. Every command respects the rectangle selection.
 */
import { def } from './registry';
import type { App } from '../app';
import { openDialog, toast } from '../ui/dialog';
import type { Field } from '../ui/dialog';
import { editSelection, frameRaster, rasterFrame } from '../picture/edit';
import { crop, resample, hexToRgb } from '../picture/ops';
import * as A from '../picture/adjust';
import type { Raster } from '../codecs/raster';

const has = (app: App) => !!app.picture;

/** A dialog whose preview shows `fn` applied to a small copy of the selection (or picture); OK applies it at full size. */
async function adjustDialog(app: App, title: string, fields: Field[], fn: (r: Raster, v: Record<string, any>) => Raster, opts: { help?: string; ok?: string } = {}): Promise<void> {
  const pic = app.picture!;
  const full = frameRaster(pic.currentFrame);
  const sel = app.tab.selection;
  const region = sel ? crop(full, sel) : full;
  const k = Math.min(1, 420 / Math.max(region.width, region.height));
  const small = k < 1 ? resample(region, Math.round(region.width * k), Math.round(region.height * k), 'bilinear') : region;
  const before = (rasterFrame(small, 0).image as HTMLCanvasElement).toDataURL();
  let seq = 0, busy = false, pending: Record<string, any> | null = null;
  const render = async (v: Record<string, any>, ctl: any) => {
    if (busy) { pending = v; return; }
    busy = true;
    const my = ++seq;
    await new Promise((r) => setTimeout(r, 0));
    try {
      const out = fn(small, v);
      if (my === seq) ctl.setPreview(`<div class="ql-sxs"><figure><img src="${before}"><figcaption>Before</figcaption></figure><figure><img src="${(rasterFrame(out, 0).image as HTMLCanvasElement).toDataURL()}"><figcaption>After</figcaption></figure></div>`);
    } catch (e: any) { ctl.setPreview(`<div class="ql-help">${e?.message || e}</div>`); }
    busy = false;
    if (pending) { const p = pending; pending = null; void render(p, ctl); }
  };
  const r = await openDialog({ title, wide: true, ok: opts.ok || 'Apply', preview: true, help: opts.help, fields, onChange: (v, ctl) => { void render(v, ctl); }, onOpen: (ctl) => { void render(ctl.values(), ctl); } });
  if (!r) return;
  toast('Applying…', { ms: 1200 });
  await new Promise((res) => setTimeout(res, 20));
  editSelection(app, title.replace(/…$/, ''), (x) => fn(x, r));
}

const range = (key: string, label: string, min: number, max: number, value: number, half = true, step?: number): Field => ({ key, label, type: 'range', min, max, value, half, step });

def([
  // Automatic ------------------------------------------------------------------------------
  { id: 'adjust.auto', icon: 'auto_fix_high', popular: true, edits: true, isEnabled: has, tip: 'Auto levels plus a touch of saturation (IrfanView\'s Auto adjust colors)', run: (app) => editSelection(app, 'Auto-Adjust Colors', A.autoAdjust) },
  { id: 'adjust.enhance', icon: 'auto_awesome', popular: true, edits: true, isEnabled: has, tip: 'Tone, color and gentle sharpening in one step', run: (app) => editSelection(app, 'One-Click Enhance', A.enhance) },
  { id: 'adjust.autoLevels', icon: 'tune', edits: true, isEnabled: has, run: (app) => editSelection(app, 'Auto Levels', (r) => A.autoLevels(r)) },
  { id: 'adjust.autoContrast', icon: 'contrast', edits: true, isEnabled: has, run: (app) => editSelection(app, 'Auto Contrast', (r) => A.autoContrast(r)) },
  { id: 'adjust.autoColor', icon: 'palette', edits: true, isEnabled: has, tip: 'Removes a color cast (gray-world)', run: (app) => editSelection(app, 'Auto Color', (r) => A.autoColor(r)) },
  { id: 'adjust.autoWhiteBalance', icon: 'wb_auto', edits: true, isEnabled: has, run: (app) => editSelection(app, 'Auto White Balance', (r) => A.autoColor(r, 0.8)) },

  // Tone -----------------------------------------------------------------------------------
  {
    id: 'adjust.colorCorrections', icon: 'tune', popular: true, edits: true, isEnabled: has, tip: 'Brightness, contrast, gamma, saturation and color balance with a live preview',
    run: (app) => adjustDialog(app, 'Color Corrections…', [range('brightness', 'Brightness', -255, 255, 0), range('contrast', 'Contrast', -127, 127, 0), range('gamma', 'Gamma (×100)', 1, 699, 100), range('saturation', 'Saturation', -255, 255, 0), range('red', 'Red balance', -255, 255, 0), range('green', 'Green balance', -255, 255, 0), range('blue', 'Blue balance', -255, 255, 0)],
      (r, v) => A.colorCorrect(r, { brightness: +v.brightness, contrast: +v.contrast, gamma: +v.gamma / 100, saturation: +v.saturation, red: +v.red, green: +v.green, blue: +v.blue })),
  },
  { id: 'adjust.brightnessContrast', icon: 'brightness_6', edits: true, isEnabled: has, run: (app) => adjustDialog(app, 'Brightness and Contrast…', [range('brightness', 'Brightness', -255, 255, 0), range('contrast', 'Contrast', -127, 127, 0)], (r, v) => A.colorCorrect(r, { brightness: +v.brightness, contrast: +v.contrast })) },
  { id: 'adjust.exposure', icon: 'exposure', edits: true, isEnabled: has, run: (app) => adjustDialog(app, 'Exposure…', [range('ev', 'Exposure (EV × 100)', -300, 300, 0, false)], (r, v) => A.colorCorrect(r, { exposure: +v.ev / 100 })) },
  { id: 'adjust.gamma', icon: 'gradient', edits: true, isEnabled: has, run: (app) => adjustDialog(app, 'Gamma…', [range('gamma', 'Gamma (×100)', 10, 500, 100, false)], (r, v) => A.colorCorrect(r, { gamma: +v.gamma / 100 })) },
  {
    id: 'adjust.levels', icon: 'bar_chart', edits: true, isEnabled: has, tip: 'Input black, gamma and white points; output range; per channel',
    run: (app) => adjustDialog(app, 'Levels…', [
      { key: 'channel', label: 'Channel', type: 'select', options: [{ value: 'all', label: 'RGB' }, { value: 'r', label: 'Red' }, { value: 'g', label: 'Green' }, { value: 'b', label: 'Blue' }], value: 'all', half: true }, range('gamma', 'Gamma (×100)', 10, 500, 100),
      range('inBlack', 'Input black', 0, 254, 0), range('inWhite', 'Input white', 1, 255, 255), range('outBlack', 'Output black', 0, 254, 0), range('outWhite', 'Output white', 1, 255, 255),
    ], (r, v) => A.levels(r, { inBlack: +v.inBlack, inWhite: Math.max(+v.inBlack + 1, +v.inWhite), gamma: +v.gamma / 100, outBlack: +v.outBlack, outWhite: +v.outWhite, channel: v.channel })),
  },
  { id: 'adjust.shadowsHighlights', icon: 'flare', edits: true, isEnabled: has, run: (app) => adjustDialog(app, 'Shadows and Highlights…', [range('shadows', 'Lift shadows', 0, 100, 30), range('highlights', 'Tame highlights', 0, 100, 0), range('radius', 'Radius', 2, 80, 20, false)], (r, v) => A.shadowsHighlights(r, +v.shadows, +v.highlights, +v.radius)) },
  { id: 'adjust.fillLight', icon: 'light_mode', edits: true, isEnabled: has, run: (app) => editSelection(app, 'Fill Light', (r) => A.shadowsHighlights(r, 40, 0, 20)) },
  { id: 'adjust.equalize', icon: 'equalizer', edits: true, isEnabled: has, run: (app) => editSelection(app, 'Equalize Histogram', A.equalize) },
  { id: 'adjust.normalize', icon: 'linear_scale', edits: true, isEnabled: has, tip: 'Stretches the luminance to the full range', run: (app) => editSelection(app, 'Normalize', (r) => A.autoContrast(r, 0)) },
  { id: 'adjust.clarity', icon: 'deblur', edits: true, isEnabled: has, run: (app) => adjustDialog(app, 'Clarity…', [range('amount', 'Amount', -100, 100, 30, false)], (r, v) => A.clarity(r, +v.amount)) },
  { id: 'adjust.dehaze', icon: 'foggy', edits: true, isEnabled: has, run: (app) => adjustDialog(app, 'Dehaze…', [range('amount', 'Amount', 0, 100, 40, false)], (r, v) => A.dehaze(r, +v.amount)) },
  { id: 'adjust.vignette', icon: 'vignette', edits: true, isEnabled: has, run: (app) => adjustDialog(app, 'Vignette…', [range('amount', 'Darkening', 0, 100, 50), range('radius', 'Clear radius (%)', 10, 100, 70), { key: 'color', label: 'Color', type: 'color', value: '#000000', half: true }], (r, v) => A.vignette(r, +v.amount, +v.radius / 100, hexToRgb(v.color))) },

  // Color ----------------------------------------------------------------------------------
  { id: 'adjust.whiteBalance', icon: 'wb_sunny', edits: true, isEnabled: has, tip: 'Temperature and tint, or a neutral reference color', run: (app) => adjustDialog(app, 'White Balance…', [range('temperature', 'Temperature (cool … warm)', -100, 100, 0), range('tint', 'Tint (green … magenta)', -100, 100, 0), { key: 'useNeutral', label: 'Use a neutral reference color', type: 'checkbox', value: false, half: true }, { key: 'neutral', label: 'Color that should be gray', type: 'color', value: '#808080', half: true, visibleIf: (v) => !!v.useNeutral }], (r, v) => A.whiteBalance(r, { temperature: +v.temperature, tint: +v.tint, neutral: v.useNeutral ? hexToRgb(v.neutral) : undefined })) },
  { id: 'adjust.hsl', icon: 'color_lens', edits: true, isEnabled: has, run: (app) => adjustDialog(app, 'Hue, Saturation and Lightness…', [range('hue', 'Hue shift (°)', -180, 180, 0), range('saturation', 'Saturation', -100, 100, 0), range('lightness', 'Lightness', -100, 100, 0)], (r, v) => A.hsl(r, { hue: +v.hue, saturation: +v.saturation, lightness: +v.lightness })) },
  { id: 'adjust.vibrance', icon: 'water_drop', edits: true, isEnabled: has, run: (app) => adjustDialog(app, 'Vibrance…', [range('amount', 'Vibrance', -100, 100, 30, false)], (r, v) => A.vibrance(r, +v.amount / 100)) },
  {
    id: 'adjust.colorBalance', icon: 'balance', edits: true, isEnabled: has, tip: 'Cyan–red, magenta–green, yellow–blue for shadows, midtones and highlights',
    run: (app) => adjustDialog(app, 'Color Balance…', [
      { key: 'h1', type: 'heading', label: 'Midtones' }, range('mr', 'Cyan … Red', -100, 100, 0), range('mg', 'Magenta … Green', -100, 100, 0), range('mb', 'Yellow … Blue', -100, 100, 0),
      { key: 'h2', type: 'heading', label: 'Shadows' }, range('sr', 'Cyan … Red', -100, 100, 0), range('sg', 'Magenta … Green', -100, 100, 0), range('sb', 'Yellow … Blue', -100, 100, 0),
      { key: 'h3', type: 'heading', label: 'Highlights' }, range('hr', 'Cyan … Red', -100, 100, 0), range('hg', 'Magenta … Green', -100, 100, 0), range('hb', 'Yellow … Blue', -100, 100, 0),
    ], (r, v) => A.colorBalance(r, { shadows: [+v.sr, +v.sg, +v.sb], midtones: [+v.mr, +v.mg, +v.mb], highlights: [+v.hr, +v.hg, +v.hb] })),
  },
  {
    id: 'adjust.channelMixer', icon: 'blender', edits: true, isEnabled: has,
    run: (app) => adjustDialog(app, 'Channel Mixer…', [
      { key: 'h1', type: 'heading', label: 'Red output (% of R, G, B)' }, range('rr', 'Red', -200, 200, 100), range('rg', 'Green', -200, 200, 0), range('rb', 'Blue', -200, 200, 0),
      { key: 'h2', type: 'heading', label: 'Green output' }, range('gr', 'Red', -200, 200, 0), range('gg', 'Green', -200, 200, 100), range('gb', 'Blue', -200, 200, 0),
      { key: 'h3', type: 'heading', label: 'Blue output' }, range('br', 'Red', -200, 200, 0), range('bg', 'Green', -200, 200, 0), range('bb', 'Blue', -200, 200, 100),
    ], (r, v) => A.channelMixer(r, [[+v.rr, +v.rg, +v.rb], [+v.gr, +v.gg, +v.gb], [+v.br, +v.bg, +v.bb]])),
  },
  { id: 'adjust.bwMixer', icon: 'filter_b_and_w', edits: true, isEnabled: has, tip: 'Black and white from a weighted mix of the channels (a red filter darkens skies)', run: (app) => adjustDialog(app, 'Black-and-White Mixer…', [range('r', 'Red (%)', -100, 200, 30), range('g', 'Green (%)', -100, 200, 59), range('b', 'Blue (%)', -100, 200, 11)], (r, v) => A.channelMixer(r, [[+v.r, +v.g, +v.b], [0, 0, 0], [0, 0, 0]], true)) },
  { id: 'adjust.tint', icon: 'invert_colors', edits: true, isEnabled: has, run: (app) => adjustDialog(app, 'Tint and Sepia…', [{ key: 'color', label: 'Tone', type: 'color', value: '#704214', half: true }, range('strength', 'Strength', 0, 100, 100)], (r, v) => A.tint(r, hexToRgb(v.color), +v.strength / 100)) },
  { id: 'adjust.warmify', icon: 'wb_incandescent', edits: true, isEnabled: has, run: (app) => editSelection(app, 'Warmify', (r) => A.whiteBalance(r, { temperature: 35 })) },
  { id: 'adjust.posterize', icon: 'texture', edits: true, isEnabled: has, run: (app) => adjustDialog(app, 'Posterize…', [range('levels', 'Levels per channel', 2, 32, 4, false)], (r, v) => A.posterize(r, +v.levels)) },

  // Detail and retouch ---------------------------------------------------------------------
  { id: 'adjust.sharpen', icon: 'details', popular: true, edits: true, isEnabled: has, run: (app) => editSelection(app, 'Sharpen', (r) => A.sharpen(r)) },
  { id: 'adjust.unsharp', icon: 'deblur', edits: true, isEnabled: has, run: (app) => adjustDialog(app, 'Unsharp Mask…', [range('amount', 'Amount (%)', 1, 500, 100), range('radius', 'Radius (px)', 1, 50, 2, true, 1), range('threshold', 'Threshold', 0, 255, 0, false)], (r, v) => A.unsharpMask(r, +v.amount, +v.radius, +v.threshold)) },
  { id: 'adjust.blur', icon: 'blur_on', edits: true, isEnabled: has, run: (app) => adjustDialog(app, 'Blur…', [{ key: 'kind', label: 'Kind', type: 'select', options: [{ value: 'gaussian', label: 'Gaussian' }, { value: 'box', label: 'Box' }, { value: 'surface', label: 'Surface (keeps edges)' }], value: 'gaussian', half: true }, range('radius', 'Radius (px)', 1, 100, 3)], (r, v) => (v.kind === 'box' ? A.boxBlur(r, +v.radius) : v.kind === 'surface' ? A.denoise(r, Math.min(6, +v.radius), 40) : A.gaussianBlur(r, +v.radius))) },
  { id: 'adjust.denoise', icon: 'grain', edits: true, isEnabled: has, run: (app) => adjustDialog(app, 'Noise Reduction…', [range('strength', 'Strength', 1, 100, 30), range('radius', 'Radius (px)', 1, 6, 2)], (r, v) => A.denoise(r, +v.radius, +v.strength)) },
  { id: 'adjust.despeckle', icon: 'cleaning_services', edits: true, isEnabled: has, run: (app) => editSelection(app, 'Despeckle', (r) => A.despeckle(r)) },
  { id: 'adjust.redEye', icon: 'remove_red_eye', edits: true, isEnabled: has, tip: 'Select the eyes first, then apply', run: (app) => { if (!app.tab.selection) { toast('Select the eyes first (Shift+drag), then Red-Eye Reduction.'); return; } editSelection(app, 'Red-Eye Reduction', (r) => A.redEye(r)); } },
  { id: 'adjust.restoreFaded', icon: 'restore', edits: true, isEnabled: has, tip: 'Per-channel stretch plus a cast correction for faded prints and slides', run: (app) => editSelection(app, 'Restore Faded Colors', A.restoreFaded) },

  // Presets and history --------------------------------------------------------------------
  {
    id: 'adjust.beforeAfter', icon: 'compare', kind: 'toggle', noRecord: true, isEnabled: (app) => !!app.picture && (app.tab.canUndo || app.tab.showingOriginal), isActive: (app) => app.tab.showingOriginal, tip: 'Shows the picture as it was before any edit; press again to return',
    run: (app) => { const t = app.tab; if (!t.showOriginal(!t.showingOriginal)) toast('No edits to compare with.'); else toast(t.showingOriginal ? 'Before (original)' : 'After (edited)', { ms: 1200 }); },
  },
]);
