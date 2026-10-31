/**
 * View ▸ Next Folder and Previous Folder (Ctrl+Right, Ctrl+Left), Full Screen on Another Display,
 * and Frameless Window.
 */
import { def } from './registry';
import type { App } from '../app';
import { openDialog, toast } from '../ui/dialog';
import { isDesktop, desktopBridge, canListSubfolders, listSubfolders, parentFolderOf, listFolderFiles, type FolderRef, type DisplayInfo } from '../platform/native';
import { isPictureName } from '../picture/folder';
import { TreeWalker, type FolderTree } from '../picture/folderNav';
import { listingEntries, showFolder } from './file';
import { fullScreen } from './view';

// Folder tree ------------------------------------------------------------------------------------

const tree: FolderTree = {
  children: (uri) => listSubfolders(uri).catch(() => null),
  parent: (uri) => parentFolderOf(uri),
  pictures: async (uri) => { const r = await listFolderFiles(uri).catch(() => null); return r ? (r.entries ? r.entries.length : (r.handles || []).filter((h) => isPictureName(h.name)).length) : 0; },
};
/** One walker per tree, so a folder reached by Next Folder still knows the way back up. */
const walkers = new Map<string, TreeWalker>();
const walkerFor = (top: string | null) => { const k = top ?? '(file system)'; let w = walkers.get(k); if (!w) { w = new TreeWalker(tree); walkers.set(k, w); } w.visited = 0; return w; };
const topOf = (app: App): string | null => (app.folder.treeTop !== undefined ? app.folder.treeTop : isDesktop() ? null : app.folder.uri);

async function open(app: App, f: FolderRef, top: string | null): Promise<boolean> {
  const r = await listFolderFiles(f.uri); const entries = r ? listingEntries(r) : [];
  if (!entries.length) return false;
  await showFolder(app, f.name, f.uri, entries, top);
  toast(`${f.name} · ${entries.length} picture${entries.length === 1 ? '' : 's'}`, { ms: 1500 });
  return true;
}
/** Shows the first folder with pictures inside `root` (for a picked folder that holds only folders). */
export async function firstInside(app: App, root: FolderRef, top: string | null): Promise<boolean> {
  const r = await walkerFor(top).step(root, 1, root.uri);
  return !!r && (await open(app, r.folder, top));
}
async function stepFolder(app: App, dir: 1 | -1): Promise<void> {
  const f = app.folder, top = topOf(app);
  if (!f.uri || !canListSubfolders(f.uri)) { toast('This folder\'s neighbors are not available here; open a folder with Open Folder.'); return; }
  const slow = setTimeout(() => toast(dir > 0 ? 'Looking for the next folder with pictures…' : 'Looking for the previous folder with pictures…', { ms: 1500 }), 400);
  try {
    const r = await walkerFor(top).step({ uri: f.uri, name: f.name }, dir, top);
    clearTimeout(slow);
    if (!r || !(await open(app, r.folder, top))) toast(dir > 0 ? `No folder with pictures after ${f.name}.` : `No folder with pictures before ${f.name}.`);
  } finally { clearTimeout(slow); }
}

// Displays ---------------------------------------------------------------------------------------

interface Screen { label: string; primary: boolean; current: boolean; id?: number; screen?: any }
async function displays(): Promise<Screen[] | null> {
  const d = desktopBridge();
  if (d) return (await d.listDisplays()).map((x: DisplayInfo) => ({ label: `${x.label} (${x.bounds.width} × ${x.bounds.height})`, primary: x.primary, current: x.current, id: x.id }));
  const w = window as any;
  if (typeof w.getScreenDetails !== 'function') return null;
  const det = await w.getScreenDetails();
  return det.screens.map((s: any, i: number) => ({ label: `${s.label || `Display ${i + 1}`} (${s.width} × ${s.height})`, primary: !!s.isPrimary, current: s === det.currentScreen, screen: s }));
}

export let frameless = false;
if (typeof window !== 'undefined') void desktopBridge()?.windowControl?.({ action: 'state' }).then((s) => { frameless = !!s?.frameless; document.body.classList.toggle('qn-frameless', frameless); }).catch(() => undefined);

def([
  { id: 'view.nextFolder', icon: 'keyboard_double_arrow_right', noRecord: true, isEnabled: (app) => canListSubfolders(app.folder.uri), tip: 'The next folder with pictures, in name order (into subfolders first)', run: (app) => stepFolder(app, 1) },
  { id: 'view.previousFolder', icon: 'keyboard_double_arrow_left', noRecord: true, isEnabled: (app) => canListSubfolders(app.folder.uri), tip: 'The previous folder with pictures, in name order', run: (app) => stepFolder(app, -1) },
  {
    id: 'view.fullScreenDisplay', icon: 'connected_tv', noRecord: true, isEnabled: () => isDesktop() || typeof (window as any).getScreenDetails === 'function',
    tip: 'Full screen on a second monitor or projector (Esc returns)',
    run: async (app, arg?: number) => {
      let list: Screen[] | null;
      try { list = await displays(); } catch (e: any) { toast(`The displays could not be listed: ${e?.message || 'permission refused'}`); return; }
      if (!list) { toast('This browser does not list displays; use the desktop app or Chrome.'); return; }
      if (list.length < 2) { toast('Only one display is connected.'); return; }
      let i = typeof arg === 'number' ? arg : -1;
      if (i < 0) {
        const r = await openDialog({ title: 'Full Screen on Another Display', ok: 'Full Screen', fields: [{ key: 'd', label: 'Display', type: 'radio', value: String(Math.max(0, list.findIndex((s) => !s.current))), options: list.map((s, k) => ({ value: String(k), label: `${s.label}${s.primary ? ' · primary' : ''}${s.current ? ' · this window' : ''}` })) }] });
        if (!r) return; i = +r.d;
      }
      const s = list[i]; if (!s) return;
      const d = desktopBridge();
      if (d) { await d.moveToDisplay({ id: s.id!, fullScreen: true }); fullScreen(app, true, { native: false }); }
      else fullScreen(app, true, { screen: s.screen });
    },
  },
  {
    id: 'view.frameless', icon: 'crop_free', kind: 'toggle', noRecord: true, isEnabled: () => isDesktop(), isActive: () => frameless,
    tip: 'The window without its title bar and border; drag the top bar to move it',
    run: async (app) => {
      const d = desktopBridge(); if (!d) return;
      const uri = app.tab.dirty ? null : app.picture?.entry.uri || null;
      if (app.tabs.some((t) => t.dirty)) { toast('Save or discard the changes first: the window is reopened to change its frame.'); return; }
      await d.setFrameless({ on: !frameless, reopen: uri });
    },
  },
]);
