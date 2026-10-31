/**
 * View tools, part two: Navigator, Info Pane, Measure (with Set Scale), Filmstrip; and the two
 * "back to the start" commands: Reset All Adjustments and Revert to Original.
 */
import { def } from './registry';
import type { App } from '../app';
import { openDialog, toast, confirmDialog } from '../ui/dialog';
import { viewState } from '../ui/overlays';
import { infoPane, infoPaneOpen } from '../ui/infoPane';
import { readout, pathLength, dist, scaleFrom, scaleFromDpi, type Scale } from '../picture/measure';
import { decodePicture } from '../codecs/registry';
import { findOriginal } from '../picture/keepOriginal';
import { writeClipboardText } from '../platform/native';

const has = (app: App) => !!app.picture;
const redraw = (app: App) => { app.viewer.draw(); app.refresh(); };
const m = () => viewState.measure;

async function setScale(app: App): Promise<void> {
  const pts = m().pts, len = pts.length >= 2 ? (pts.length === 2 ? dist(pts[0], pts[1]) : pathLength(pts, m().closed)) : 0;
  const dpi = app.picture?.current.dpi?.[0] || 0;
  const v = await openDialog({ title: 'Set Scale', ok: 'Set', help: len ? `The measured ${pts.length === 2 ? 'line' : 'path'} is ${len.toFixed(1)} px long.` : 'Measure a known length first (a scale bar or a ruler in the picture), or use the picture\'s DPI.', fields: [
    { key: 'from', label: 'Scale from', type: 'select', options: [...(len ? [{ value: 'line', label: 'The measured length' }] : []), ...(dpi ? [{ value: 'dpi', label: `The picture's resolution (${dpi} dpi)` }] : []), { value: 'none', label: 'No scale (pixels)' }], value: len ? 'line' : dpi ? 'dpi' : 'none' },
    { key: 'known', label: 'It is this long', type: 'number', min: 0, step: 0.001, value: 1, half: true, visibleIf: (x) => x.from === 'line' },
    { key: 'unit', label: 'Unit', type: 'combo', options: ['mm', 'cm', 'm', 'km', 'in', 'ft', 'mi'], value: 'cm', half: true, visibleIf: (x) => x.from === 'line' },
    { key: 'dpiUnit', label: 'Unit', type: 'select', options: [{ value: 'cm', label: 'Centimeters' }, { value: 'mm', label: 'Millimeters' }, { value: 'in', label: 'Inches' }], value: 'cm', half: true, visibleIf: (x) => x.from === 'dpi' },
  ] });
  if (!v) return;
  let s: Scale | null = null;
  if (v.from === 'line') { s = scaleFrom(len, +v.known, String(v.unit)); if (!s) { toast('Enter a length greater than zero.'); return; } }
  else if (v.from === 'dpi') s = scaleFromDpi(dpi, v.dpiUnit);
  m().scale = s; redraw(app);
  toast(s ? `Scale set: 1 px = ${+(s.perPx).toPrecision(4)} ${s.unit}.` : 'Measurements in pixels.');
}

def([
  {
    id: 'view.navigator', icon: 'picture_in_picture', kind: 'toggle', noRecord: true, isEnabled: has, isActive: () => viewState.navigator, tip: 'A mini-map of the whole picture when it does not fit; click or drag in it to move around',
    run: (app) => { viewState.navigator = !viewState.navigator; redraw(app); toast(viewState.navigator ? 'Navigator on (shown while the picture is larger than the window).' : 'Navigator off.'); },
  },
  { id: 'view.infoPane', icon: 'info', kind: 'toggle', noRecord: true, isActive: () => infoPaneOpen(), tip: 'File facts, EXIF summary, location, rating and keywords, and a histogram beside the picture', run: (app) => infoPane(app).toggle() },
  {
    id: 'view.measure', icon: 'straighten', kind: 'menu', noRecord: true, isEnabled: has, isActive: () => m().on, tip: 'Distance and angle between two points, path length, and the area of a closed shape (double-click closes it); a scale from a known length',
    menu: () => [
      { id: 'toggle', arg: 'toggle', label: m().on ? 'Stop measuring' : 'Start measuring', checked: m().on },
      { id: 'scale', arg: 'scale', label: m().scale ? `Set scale… (1 px = ${+(m().scale!.perPx).toPrecision(3)} ${m().scale!.unit})` : 'Set scale…' },
      { id: 'copy', arg: 'copy', label: 'Copy the measurement' },
      { id: 'clear', arg: 'clear', label: 'Clear the points' },
    ],
    run: async (app, arg?: string) => {
      const s = m();
      if (arg === 'scale') return setScale(app);
      if (arg === 'clear') { s.pts = []; s.closed = false; redraw(app); return; }
      if (arg === 'copy') { const lines = readout(s.pts, s.closed, s.scale); if (!lines.length || s.pts.length < 2) { toast('Measure something first.'); return; } await writeClipboardText(lines.join('\n')); toast('Measurement copied.'); return; }
      s.on = !s.on; if (!s.on) { s.pts = []; s.closed = false; }
      redraw(app);
      if (s.on) toast('Click points on the picture; double-click closes a shape for its area. View ▸ Measure ▸ Set scale for real units.', { ms: 5000 });
    },
  },
  {
    id: 'view.filmstrip', icon: 'view_carousel', kind: 'toggle', noRecord: true, isEnabled: (app) => app.folder.length > 0, isActive: (app) => !!app.tab.thumbs?.open && app.tab.thumbs.mode === 'strip', tip: 'Thumbnails in a strip under the picture',
    run: (app) => { const t = app.tab.thumbs; if (!t) return; if (t.open && t.mode === 'strip') t.hide(); else t.show('strip'); app.refresh(); },
  },
  {
    id: 'adjust.resetAll', icon: 'restart_alt', edits: true, isEnabled: (app) => has(app) && app.tab.dirty, tip: 'Back to the picture as it was opened (or last saved), as one step that Undo takes back',
    run: async (app) => {
      const t = app.tab, p = app.picture!;
      if (t.showingOriginal) t.showOriginal(false);
      const fresh = await decodePicture(p.bytes, p.entry);
      app.edit('Reset All Adjustments', (pic) => { pic.pages = fresh.pages; pic.page = Math.min(pic.page, fresh.pages.length - 1); pic.frame = 0; });
      t.setSelection(null);
      toast('All edits reset (Undo brings them back).');
    },
  },
  {
    id: 'adjust.revertOriginal', icon: 'history_toggle_off', edits: true, isEnabled: has, tip: 'Restores the original kept beside the file ("name (original).ext"; Options ▸ Saving ▸ Keep the original) as one undoable step',
    run: async (app) => {
      const t = app.tab, p = app.picture!;
      const orig = await findOriginal(app, t, p.entry);
      if (!orig) {
        const reload = await confirmDialog('No kept original', `There is no "${p.name.replace(/(\.[^.]+)$/, ' (original)$1')}" beside this file. Turn on Options ▸ Saving ▸ Keep the original so the next save keeps one.${t.dirty ? '\nReload instead discards the unsaved changes and reads the file again.' : ''}`, t.dirty ? 'Reload' : 'OK', t.dirty ? 'Cancel' : 'Close');
        if (reload && t.dirty) await app.exec('file.reload');
        return;
      }
      const bytes = new Uint8Array(await orig.read());
      const pic = await decodePicture(bytes, orig);
      if (t.showingOriginal) t.showOriginal(false);
      app.edit('Revert to Original', (q) => { q.pages = pic.pages; q.page = 0; q.frame = 0; });
      t.setSelection(null);
      toast(`Restored from ${orig.name}. Save to write it over ${p.name}.`, { ms: 6000 });
    },
  },
]);
