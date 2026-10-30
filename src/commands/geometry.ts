/**
 * Image tab, geometry: Straighten (angle, or detected from the dominant edges), Auto Straighten,
 * Deskew Scanned Page, Perspective Correction (four corners, or detected page edges; Crop Page
 * from Photo uses the same), Lens Correction (distortion, vignetting, chromatic aberration).
 */
import { def } from './registry';
import type { App } from '../app';
import { toast } from '../ui/dialog';
import type { Field } from '../ui/dialog';
import { adjustDialog, range } from './adjust';
import { editRaster, frameRaster } from '../picture/edit';
import { hexToRgb, resample } from '../picture/ops';
import { rotateRaster, straightenAngle, deskewAngle, perspective, lensCorrect, findPageCorners, type Quad } from '../picture/geometry';
import type { Raster } from '../codecs/raster';
import type { RGB } from '../picture/effects';

const has = (app: App) => !!app.picture;
const bgOf = (v: Record<string, any>): RGB | null => (v.transparent ? null : (hexToRgb(v.bg) as RGB));
const rotateFields = (angle: number, extra: Field[] = []): Field[] => [range('angle', 'Angle (°, clockwise)', -45, 45, angle, true, 0.1), ...extra, { key: 'canvas', label: 'Canvas', type: 'select', options: [{ value: 'crop', label: 'Keep the size (edges cut)' }, { value: 'expand', label: 'Expand to hold everything' }], value: 'crop', half: true }, { key: 'bg', label: 'Background', type: 'color', value: '#ffffff', half: true }, { key: 'transparent', label: 'Transparent background', type: 'checkbox', value: false, half: true }];
const rotateFn = (r: Raster, v: Record<string, any>) => rotateRaster(r, +v.angle, v.canvas === 'expand', bgOf(v));

/** The current frame downscaled for the detectors (≤ 800 px). */
function small(app: App, max = 800): Raster { const r = frameRaster(app.picture!.currentFrame); const k = Math.min(1, max / Math.max(r.width, r.height)); return k < 1 ? resample(r, Math.round(r.width * k), Math.round(r.height * k), 'bilinear') : r; }

async function rotateDialog(app: App, title: string, angle: number, help: string, extra: Field[] = []): Promise<void> { await adjustDialogWhole(app, title, rotateFields(angle, extra), rotateFn, help); }
/** adjustDialog previews the selection; rotation applies to the whole picture (and may change the canvas), so run it without the selection. */
async function adjustDialogWhole(app: App, title: string, fields: Field[], fn: (r: Raster, v: Record<string, any>) => Raster, help: string): Promise<Record<string, any> | null> {
  const sel = app.tab.selection; if (sel) app.tab.setSelection(null);
  const r = await adjustDialog(app, title, fields, fn, { help, label: title.replace(/…$/, '') });
  return r;
}

def([
  {
    id: 'image.straighten', icon: 'straighten', edits: true, isEnabled: has, tip: 'Rotate by a small angle to level the horizon; Detect finds the dominant edges',
    run: async (app) => {
      const detected = straightenAngle(small(app));
      await rotateDialog(app, 'Straighten…', detected, `${detected ? `Detected ${detected.toFixed(2)}° from the dominant edges.` : 'No dominant tilt detected; set the angle by hand.'}`);
    },
  },
  {
    id: 'image.autoStraighten', icon: 'auto_fix_high', edits: true, isEnabled: has, tip: 'Levels the picture by the dominant near-horizontal and near-vertical edges, keeping the size',
    run: (app) => { const a = straightenAngle(small(app)); if (!a) { toast('No tilt detected.'); return; } editRaster(app, `Auto Straighten ${a.toFixed(2)}°`, (r) => rotateRaster(r, a, false, [255, 255, 255])); toast(`Rotated ${a.toFixed(2)}°`); },
  },
  {
    id: 'image.deskew', icon: 'format_align_left', edits: true, isEnabled: has, tip: 'Finds the text-line angle of a scanned page and rotates it level (white background)',
    run: async (app) => {
      const a = deskewAngle(small(app, 1200));
      await rotateDialog(app, 'Deskew Scanned Page…', a, a ? `Text lines are tilted by ${(-a).toFixed(1)}°; the rotation levels them.` : 'No skew detected (or too little text); set the angle by hand.');
    },
  },
  {
    id: 'image.perspective', icon: 'transform', edits: true, isEnabled: has, tip: 'Four corners (percent of the picture) mapped to a rectangle; Detect finds a bright page on a dark background',
    run: async (app) => {
      const pic = app.picture!;
      const sm = small(app); const k = pic.width / sm.width;
      const found = findPageCorners(sm);
      const pct = (q: Quad | null): number[] => (q ? q.flatMap(([x, y]) => [Math.round((x * k * 100) / pic.width * 10) / 10, Math.round((y * k * 100) / pic.height * 10) / 10]) : [0, 0, 100, 0, 100, 100, 0, 100]);
      const d = pct(found);
      const fields: Field[] = [
        { key: 'h1', type: 'heading', label: 'Corners (% of width, % of height)' },
        { key: 'x0', label: 'Top left X', type: 'number', min: -50, max: 150, step: 0.1, value: d[0], half: true }, { key: 'y0', label: 'Top left Y', type: 'number', min: -50, max: 150, step: 0.1, value: d[1], half: true },
        { key: 'x1', label: 'Top right X', type: 'number', min: -50, max: 150, step: 0.1, value: d[2], half: true }, { key: 'y1', label: 'Top right Y', type: 'number', min: -50, max: 150, step: 0.1, value: d[3], half: true },
        { key: 'x2', label: 'Bottom right X', type: 'number', min: -50, max: 150, step: 0.1, value: d[4], half: true }, { key: 'y2', label: 'Bottom right Y', type: 'number', min: -50, max: 150, step: 0.1, value: d[5], half: true },
        { key: 'x3', label: 'Bottom left X', type: 'number', min: -50, max: 150, step: 0.1, value: d[6], half: true }, { key: 'y3', label: 'Bottom left Y', type: 'number', min: -50, max: 150, step: 0.1, value: d[7], half: true },
        { key: 'size', label: 'Output size', type: 'select', options: [{ value: 'auto', label: 'From the corner distances' }, { value: 'keep', label: 'Keep the picture size' }], value: 'auto', half: true },
        { key: 'detect', label: 'Detect page corners', type: 'button', half: true, onClick: (_v, ctl) => { const q = findPageCorners(small(app)); if (!q) { toast('No page found: it needs a bright page on a darker background.'); return; } const p = pct(q); ['x0', 'y0', 'x1', 'y1', 'x2', 'y2', 'x3', 'y3'].forEach((key, i) => ctl.set(key, p[i])); } },
      ];
      const fn = (r: Raster, v: Record<string, any>) => { const kx = r.width / 100, ky = r.height / 100; const q: Quad = [[+v.x0 * kx, +v.y0 * ky], [+v.x1 * kx, +v.y1 * ky], [+v.x2 * kx, +v.y2 * ky], [+v.x3 * kx, +v.y3 * ky]]; return perspective(r, q, v.size === 'keep' ? r.width : undefined, v.size === 'keep' ? r.height : undefined); };
      await adjustDialogWhole(app, 'Perspective Correction…', fields, fn, found ? 'A page was detected; adjust the corners if needed.' : 'Enter the four corners of the region that should become a rectangle (clockwise from the top left).');
    },
  },
  {
    id: 'edit.cropPage', icon: 'document_scanner', edits: true, isEnabled: has, tip: 'Finds a document in a photo (bright page on a darker background) and flattens it to a rectangle',
    run: async (app) => {
      const pic = app.picture!; const sm = small(app); const k = pic.width / sm.width;
      const q = findPageCorners(sm);
      if (!q) { toast('No page found. Use Perspective Correction and enter the corners.'); return; }
      const full: Quad = q.map(([x, y]) => [x * k, y * k]) as Quad;
      editRaster(app, 'Crop Page from Photo', (r) => perspective(r, full));
    },
  },
  {
    id: 'image.lensCorrection', icon: 'camera', edits: true, isEnabled: has, tip: 'Barrel or pincushion distortion, vignetting and lateral chromatic aberration, by sliders',
    run: (app) => adjustDialogWhole(app, 'Lens Correction…', [range('k1', 'Distortion (− barrel, + pincushion) ×100', -100, 100, 0), range('k2', 'Distortion, outer zone ×100', -100, 100, 0), range('scale', 'Scale (%) to hide the edges', 80, 120, 100), range('vignette', 'Vignetting (+ brightens the corners) ×100', -100, 100, 0), range('caRed', 'Red fringe (‰)', -20, 20, 0), range('caBlue', 'Blue fringe (‰)', -20, 20, 0)],
      (r, v) => lensCorrect(r, { k1: +v.k1 / 100, k2: +v.k2 / 100, scale: +v.scale / 100, vignette: +v.vignette / 100, caRed: +v.caRed, caBlue: +v.caBlue }), 'Watch straight lines near the edges while moving the distortion sliders; fix color fringes last.').then(() => undefined),
  },
]);
