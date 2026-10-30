/**
 * Selections beyond the rectangle: Ellipse Selection and Lasso (tools the viewer draws with),
 * Magic Wand (flood fill from the pointer or the selection center), Select by Color Range, and
 * Invert Selection. Edits respect the mask: only selected pixels change.
 */
import { def } from './registry';
import type { App } from '../app';
import { openDialog, toast } from '../ui/dialog';
import { frameRaster } from '../picture/edit';
import { hexToRgb } from '../picture/ops';
import { ellipseMask, wandMask, colorRangeMask, invertMask, maskBounds, maskCount } from '../picture/mask';

const has = (app: App) => !!app.picture;
function setTool(app: App, shape: 'rect' | 'ellipse' | 'lasso'): void {
  const t = app.tab; const same = t.selectTool && t.selectShape === shape;
  t.selectShape = shape; t.selectTool = !same; t.ui.el.classList.toggle('qn-selecting', t.selectTool); app.refresh();
  if (t.selectTool) toast(shape === 'rect' ? 'Drag to select a rectangle' : shape === 'ellipse' ? 'Drag to select an ellipse' : 'Drag around the area to lasso it', { ms: 1500 });
}
function applyMask(app: App, m: Uint8Array, what: string): void {
  const p = app.picture!; const b = maskBounds(m, p.width, p.height);
  if (!b) { toast(`${what}: nothing selected.`); app.tab.setSelection(null); return; }
  app.tab.setSelection(b, m); toast(`${what}: ${maskCount(m).toLocaleString()} pixels`, { ms: 1500 });
}

def([
  { id: 'edit.selectEllipse', icon: 'circle', kind: 'toggle', noRecord: true, isEnabled: has, isActive: (app) => app.tab.selectTool && app.tab.selectShape === 'ellipse', tip: 'Drag an ellipse; with a rectangle already selected, turns it into an ellipse', run: (app) => { const t = app.tab; if (t.selection && !t.selectionMask && !t.selectTool) { const p = app.picture!; t.setSelection(t.selection, ellipseMask(p.width, p.height, t.selection)); toast('Ellipse inside the rectangle', { ms: 1200 }); return; } setTool(app, 'ellipse'); } },
  { id: 'edit.selectLasso', icon: 'gesture', kind: 'toggle', noRecord: true, isEnabled: has, isActive: (app) => app.tab.selectTool && app.tab.selectShape === 'lasso', tip: 'Drag a free shape around the area', run: (app) => setTool(app, 'lasso') },
  {
    id: 'edit.selectWand', icon: 'auto_fix_normal', noRecord: true, isEnabled: has, tip: 'Selects the connected area of similar color under the pointer (or at the center of the selection)',
    run: async (app) => {
      const p = app.picture!, v = app.viewer; const pp = v.pointerPos; const q = pp ? v.toPicture(pp.x, pp.y) : app.tab.selection ? { x: app.tab.selection.x + app.tab.selection.w / 2, y: app.tab.selection.y + app.tab.selection.h / 2 } : { x: p.width / 2, y: p.height / 2 };
      const r = await openDialog({ title: 'Magic Wand', ok: 'Select', help: `Seed at ${Math.floor(q.x)}, ${Math.floor(q.y)} (point at the picture before running the command to seed elsewhere).`, fields: [{ key: 'tolerance', label: 'Tolerance', type: 'range', min: 0, max: 255, value: 32 }, { key: 'contiguous', label: 'Contiguous only', type: 'checkbox', value: true }] });
      if (!r) return;
      applyMask(app, wandMask(frameRaster(p.currentFrame), q.x, q.y, +r.tolerance, !!r.contiguous), 'Magic wand');
    },
  },
  {
    id: 'edit.selectColor', icon: 'colorize', noRecord: true, isEnabled: has, tip: 'Every pixel close to a color, anywhere in the picture',
    run: async (app) => {
      const p = app.picture!; const raster = frameRaster(p.currentFrame); const v = app.viewer; const pp = v.pointerPos; let start = '#ffffff';
      if (pp) { const q = v.toPicture(pp.x, pp.y); const px = v.pixelAt(Math.floor(q.x), Math.floor(q.y)); if (px) start = '#' + [px[0], px[1], px[2]].map((c) => c.toString(16).padStart(2, '0')).join(''); }
      const r = await openDialog({ title: 'Select by Color Range', ok: 'Select', preview: true, fields: [{ key: 'color', label: 'Color', type: 'color', value: start, half: true }, { key: 'tolerance', label: 'Tolerance', type: 'range', min: 0, max: 255, value: 40, half: true }], onChange: (vv, ctl) => { const n = maskCount(colorRangeMask(raster, hexToRgb(vv.color) as [number, number, number], +vv.tolerance)); ctl.setPreview(`${n.toLocaleString()} of ${(raster.width * raster.height).toLocaleString()} pixels (${((100 * n) / (raster.width * raster.height)).toFixed(1)}%)`); }, onOpen: (ctl) => ctl.setPreview('Adjust the color and tolerance.') });
      if (!r) return;
      applyMask(app, colorRangeMask(raster, hexToRgb(r.color) as [number, number, number], +r.tolerance), 'Color range');
    },
  },
  {
    id: 'edit.selectInvert', icon: 'flip_to_back', noRecord: true, isEnabled: (app) => !!app.picture && !!app.tab.selection, tip: 'Selects everything that was not selected',
    run: (app) => { const p = app.picture!, t = app.tab; let m = t.selectionMask; if (!m) { m = new Uint8Array(p.width * p.height); const s = t.selection!; for (let y = s.y; y < s.y + s.h; y++) m.fill(255, y * p.width + s.x, y * p.width + s.x + s.w); } applyMask(app, invertMask(m), 'Inverted'); },
  },
]);
