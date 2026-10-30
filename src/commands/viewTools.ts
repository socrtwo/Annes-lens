/**
 * View tab, Inspect and Display: Grid and Guides, Rulers, Clipping Warnings, Focus Peaking,
 * Histogram Overlay, Information Overlay and its template, Loupe, Copy Color Under Pointer;
 * Display Adjustments, Grayscale Preview, Color-Blindness Simulation. All view-only.
 */
import { def } from './registry';
import type { App } from '../app';
import { openDialog, toast } from '../ui/dialog';
import { viewState, formatColor, type GridMode, type ColorBlind } from '../ui/overlays';
import { writeClipboardText } from '../platform/native';

const has = (app: App) => !!app.picture;
const redraw = (app: App) => { for (const t of app.tabs) t.ui.draw(); app.refresh(); };
const toggle = (id: string, icon: string, key: 'rulers' | 'clipping' | 'peaking' | 'histogram' | 'osd' | 'loupe' | 'grayscale', tip: string, onLabel: string, offLabel: string) => ({
  id, icon, kind: 'toggle' as const, noRecord: true, isEnabled: has, isActive: () => !!viewState[key], tip,
  run: (app: App) => { (viewState as any)[key] = !viewState[key]; redraw(app); toast(viewState[key] ? onLabel : offLabel, { ms: 1200 }); },
});

def([
  {
    id: 'view.grid', icon: 'grid_4x4', kind: 'menu', noRecord: true, isEnabled: has, isActive: () => viewState.grid !== 'off', tip: 'Rule of thirds, golden ratio or a square grid over the picture',
    menu: () => ([['off', 'Off'], ['thirds', 'Rule of thirds'], ['golden', 'Golden ratio'], ['square', `Square grid (${viewState.gridSize} px)`], ['size', 'Square grid size…']] as [string, string][]).map(([value, label]) => ({ id: 'view.grid', arg: value, label, checked: viewState.grid === value })),
    run: async (app, arg?: string) => {
      if (arg === 'size') { const r = await openDialog({ title: 'Grid Size', ok: 'OK', fields: [{ key: 'size', label: 'Cell size (picture pixels)', type: 'number', min: 2, max: 4096, value: viewState.gridSize }] }); if (!r) return; viewState.gridSize = Math.max(2, +r.size || 50); viewState.grid = 'square'; }
      else if (arg) viewState.grid = arg as GridMode; else viewState.grid = viewState.grid === 'off' ? 'thirds' : 'off';
      redraw(app);
    },
  },
  toggle('view.rulers', 'straighten', 'rulers', 'Rulers along the top and left: pixels, or inches when the picture has a DPI', 'Rulers on', 'Rulers off'),
  toggle('view.clipping', 'warning', 'clipping', 'Lost highlights in red, lost shadows in blue', 'Clipping warnings on', 'Clipping warnings off'),
  toggle('view.focusPeaking', 'center_focus_weak', 'peaking', 'Outlines the sharpest edges in red', 'Focus peaking on', 'Focus peaking off'),
  toggle('view.histogramOverlay', 'bar_chart', 'histogram', 'RGB histogram in the corner with the clipped percentages', 'Histogram on', 'Histogram off'),
  toggle('view.osd', 'subtitles', 'osd', 'File and EXIF text on the picture (Overlay Template sets the fields)', 'Information overlay on', 'Information overlay off'),
  {
    id: 'view.osdTemplate', icon: 'edit_note', noRecord: true, tip: 'Fields: {name} {w} {h} {zoom} {n} {total} {exifdate} {camera} {exposure} {size} {page} {pages}; one line per row',
    run: async (app) => { const r = await openDialog({ title: 'Overlay Template', ok: 'Save', fields: [{ key: 't', label: 'Template', type: 'textarea', rows: 4, value: app.prefs.osdTemplate }], help: 'Fields: {name} {w} {h} {zoom} {n} {total} {exifdate} {camera} {exposure} {size} {page} {pages}.' }); if (!r) return; app.prefs.osdTemplate = String(r.t); app.savePrefs(); if (!viewState.osd) viewState.osd = true; redraw(app); },
  },
  {
    id: 'view.loupe', icon: 'search', kind: 'toggle', noRecord: true, isEnabled: has, isActive: () => viewState.loupe, tip: 'A magnifier that follows the pointer (Z); the zoom level is in its menu on the status bar',
    run: (app, arg?: number) => { if (typeof arg === 'number') { viewState.loupeZoom = Math.max(2, Math.min(16, arg)); viewState.loupe = true; } else viewState.loupe = !viewState.loupe; redraw(app); toast(viewState.loupe ? `Loupe ${viewState.loupeZoom}× — move the pointer over the picture` : 'Loupe off', { ms: 1200 }); },
  },
  {
    id: 'view.copyColor', icon: 'colorize', noRecord: true, isEnabled: has, tip: 'Copies the color under the pointer as hex, rgb(), hsl() or a name (Options sets the format)',
    run: async (app, arg?: string) => {
      const v = app.viewer; const pp = v.pointerPos; const pic = app.picture!;
      const q = pp ? v.toPicture(pp.x, pp.y) : { x: pic.width / 2, y: pic.height / 2 };
      const px = v.pixelAt(Math.floor(q.x), Math.floor(q.y));
      if (!px) { toast('Point at the picture first.'); return; }
      const how = (arg as any) || app.prefs.colorFormat;
      const text = formatColor([px[0], px[1], px[2]], how);
      await writeClipboardText(text); toast(`Copied ${text}`);
    },
  },
  {
    id: 'view.displayAdjust', icon: 'brightness_medium', noRecord: true, isEnabled: has, tip: 'Brightness, contrast and gamma for viewing only; nothing is saved',
    run: async (app) => {
      const d = viewState.display;
      const r = await openDialog({ title: 'Display Adjustments', ok: 'Close', cancel: 'Reset', fields: [{ key: 'b', label: 'Brightness', type: 'range', min: -100, max: 100, value: d.brightness }, { key: 'c', label: 'Contrast', type: 'range', min: -100, max: 100, value: d.contrast }, { key: 'g', label: 'Gamma (×100)', type: 'range', min: 20, max: 400, value: Math.round(d.gamma * 100) }], help: 'Applied to the display only, in every window, until reset.', onChange: (v) => { d.brightness = +v.b; d.contrast = +v.c; d.gamma = +v.g / 100; redraw(app); } });
      if (!r) { d.brightness = 0; d.contrast = 0; d.gamma = 1; redraw(app); }
    },
  },
  toggle('view.grayscalePreview', 'filter_b_and_w', 'grayscale', 'Shows the picture in grayscale without changing it', 'Grayscale preview on', 'Grayscale preview off'),
  {
    id: 'view.colorBlindSim', icon: 'visibility', kind: 'menu', noRecord: true, isEnabled: has, isActive: () => viewState.colorBlind !== 'off', tip: 'Simulates protanopia, deuteranopia, tritanopia or achromatopsia (Machado 2009)',
    menu: () => ([['off', 'Off'], ['protanopia', 'Protanopia (no red cones)'], ['deuteranopia', 'Deuteranopia (no green cones)'], ['tritanopia', 'Tritanopia (no blue cones)'], ['achromatopsia', 'Achromatopsia (no color)']] as [ColorBlind, string][]).map(([value, label]) => ({ id: 'view.colorBlindSim', arg: value, label, checked: viewState.colorBlind === value })),
    run: (app, arg?: ColorBlind) => { viewState.colorBlind = arg || (viewState.colorBlind === 'off' ? 'deuteranopia' : 'off'); redraw(app); toast(viewState.colorBlind === 'off' ? 'Simulation off' : `Simulating ${viewState.colorBlind}`, { ms: 1200 }); },
  },
]);
