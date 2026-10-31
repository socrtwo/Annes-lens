/** View ▸ Before/After Slider, Compare Pictures, Synchronize Windows. */
import { def } from './registry';
import type { App } from '../app';
import type { Entry } from '../picture/folder';
import { decodePicture } from '../codecs/registry';
import { split } from '../ui/viewHooks';
import { openCompare, compareOpen } from '../ui/compareView';
import { sync, setSync, installSync } from '../ui/syncWindows';
import { toast } from '../ui/dialog';

let installed = false;
const ensure = (app: App) => { if (!installed) { installSync(app); installed = true; } };

/** The pictures to compare: the marked ones (2–4), else the current picture and the ones after it. */
export function compareEntries(app: App): Entry[] {
  const t = app.tab, f = t.folder;
  const marked = f.entries.filter((e) => t.marked.has(e));
  if (marked.length >= 2) return marked.slice(0, 4);
  if (!f.length) return [];
  const out: Entry[] = []; for (let k = 0; k < Math.min(2, f.length); k++) out.push(f.entries[(f.index + k) % f.length]);
  return out;
}

async function startSplit(app: App, which?: string): Promise<void> {
  const t = app.tab, p = app.picture!;
  let before: HTMLCanvasElement, label = 'Before';
  const marked = t.folder.entries.filter((e) => t.marked.has(e) && e !== p.entry);
  const mode = which || (t.dirty ? 'original' : marked.length ? 'marked' : 'next');
  if (mode === 'original') { const pic = await decodePicture(p.bytes, p.entry); before = pic.frameCanvas(); label = t.dirty ? 'As opened' : 'Before'; }
  else {
    const other = mode === 'marked' ? marked[0] : t.folder.entries[(t.folder.index + 1) % t.folder.length];
    if (!other || other === p.entry) { toast('There is no other picture to compare with: edit this one, mark another, or open a folder.'); return; }
    const pic = await decodePicture(new Uint8Array(await other.read()), other); before = pic.frameCanvas(); label = other.name;
  }
  Object.assign(split, { on: true, tab: t, before, beforeW: before.width, beforeH: before.height, x: 0.5, labelA: label, labelB: t.dirty ? 'Edited' : p.name });
  app.viewer.draw();
  toast('Drag the divider to compare.');
}

def([
  {
    id: 'view.compareSplit', icon: 'compare', kind: 'menu', noRecord: true, isEnabled: (app) => !!app.picture, isActive: (app) => split.on && split.tab === app.tab,
    tip: 'One divider over two versions: the picture as opened and as edited, or this picture and another (marked or next)',
    menu: (app) => [
      { id: 'auto', arg: '', label: split.on ? 'Turn off' : 'Turn on', checked: split.on },
      { id: 'original', arg: 'original', label: 'Before = the picture as opened' },
      { id: 'marked', arg: 'marked', label: 'Before = the marked picture' },
      { id: 'next', arg: 'next', label: 'Before = the next picture' },
    ].filter((m) => m.id !== 'marked' || app.tab.marked.size > 0),
    run: async (app, arg?: string) => {
      if (split.on && !arg) { split.on = false; split.before = null; split.tab = null; app.viewer.draw(); return; }
      await startSplit(app, arg || undefined);
    },
  },
  {
    id: 'view.compare', icon: 'grid_view', noRecord: true, isEnabled: (app) => app.folder.length >= 2, isActive: () => !!compareOpen(),
    tip: 'Two to four pictures side by side (the marked ones, or this one and the next), with one zoom and pan for all',
    run: async (app) => { if (compareOpen()) { compareOpen()!.close(); return; } const e = compareEntries(app); if (e.length < 2) { toast('Mark two to four pictures, or open a folder.'); return; } await openCompare(app, e); },
  },
  {
    id: 'view.syncWindows', icon: 'view_column', kind: 'toggle', noRecord: true, isEnabled: (app) => app.tabs.length >= 2 || sync.on, isActive: () => sync.on,
    tip: 'The open windows side by side, following the active one\'s zoom, pan and next/previous',
    run: (app) => { ensure(app); setSync(app, !sync.on); toast(sync.on ? `${app.tabs.length} windows side by side, following the active one (blue frame).` : 'Windows no longer synchronized.'); },
  },
]);
