/**
 * Browse ▸ Browser (F3: folder tree, thumbnails and a preview in one window), Folder Tree, Favorite
 * Folders, Include Subfolders and Show All Files.
 */
import { def } from './registry';
import type { App, PictureTab } from '../app';
import { openDialog, toast, promptDialog } from '../ui/dialog';
import { FolderTree } from '../ui/folderTree';
import { listing, canListSubfolders, isDesktop, rememberFolder } from '../platform/native';
import { listFavorites, saveFavorites, favoriteOf, sameFavorite, favoriteRef } from '../picture/favorites';
import { openFolderRef } from './viewWindow';

/** Puts the tree pane and the Browser layout on a window as the preferences say. */
let hooked = false;
export function applyBrowseLayout(app: App, tab: PictureTab): void {
  if (!hooked) { hooked = true; app.folderHooks.push((t) => { if (t.tree?.el.isConnected) void t.tree.update(); }); }
  const p = app.prefs, tree = p.browserLayout || p.folderTree;
  if (tree && !tab.tree) tab.tree = new FolderTree(app, tab);
  if (tab.tree) { if (tree && !tab.tree.el.isConnected) tab.el.prepend(tab.tree.el); else if (!tree) tab.tree.el.remove(); }
  tab.el.classList.toggle('qn-has-tree', tree);
  const wasBrowser = tab.el.classList.contains('qn-window-browser');
  tab.el.classList.toggle('qn-window-browser', p.browserLayout);
  if (p.browserLayout && (!tab.thumbs.open || tab.thumbs.mode !== 'grid')) tab.thumbs.show('grid');
  else if (!p.browserLayout && wasBrowser && tab.thumbs.open) tab.thumbs.hide();
  if (tree) void tab.tree!.update();
  requestAnimationFrame(() => tab.ui.layout());
}
const applyAll = (app: App) => { for (const t of app.tabs) applyBrowseLayout(app, t); app.refresh(); };
/** Keeps the tree on the open folder (called after commands run). */
export function syncTrees(app: App): void { for (const t of app.tabs) if (t.tree?.el.isConnected) void t.tree.update(); }

async function reloadFolder(app: App): Promise<void> {
  const f = app.folder;
  if (!f.uri) { toast('This folder has no address to list again (dropped files): open it with Open Folder.'); return; }
  const base = f.name.replace(/ \(with subfolders\)$/, ''), cur = f.current?.name;
  const top = f.treeTop !== undefined ? f.treeTop : isDesktop() ? null : f.uri;
  if (await openFolderRef(app, { uri: f.uri, name: base }, top)) { const i = app.folder.entries.findIndex((e) => e.name === cur); if (i > 0 && app.folder.select(i)) await app.tab.show(); }
}

def([
  {
    id: 'browse.browser', icon: 'view_sidebar', kind: 'toggle', noRecord: true, isActive: (app) => app.prefs.browserLayout, tip: 'Folder tree, thumbnails and a preview of the picture in one window (F3)',
    run: (app) => { app.prefs.browserLayout = !app.prefs.browserLayout; app.savePrefs(); applyAll(app); },
  },
  {
    id: 'browse.folderTree', icon: 'account_tree', kind: 'toggle', noRecord: true, isActive: (app) => app.prefs.folderTree || app.prefs.browserLayout, tip: 'The folders around the open one, beside the picture; click one to open it',
    run: (app) => { if (app.prefs.browserLayout) { app.prefs.browserLayout = false; app.prefs.folderTree = false; } else app.prefs.folderTree = !app.prefs.folderTree; app.savePrefs(); applyAll(app); },
  },
  {
    id: 'browse.favorites', icon: 'folder_special', kind: 'menu', noRecord: true, tip: 'Folders you come back to: open one, add the open folder, or organize the list',
    menu: () => [{ id: 'browse.favorites', arg: 'list', label: 'Favorite Folders…' }, { id: 'browse.favorites', arg: 'add', label: 'Add the Open Folder' }],
    run: async (app, arg?: number | string) => {
      const favs = await listFavorites();
      if (typeof arg === 'number' || (typeof arg === 'string' && /^\d+$/.test(arg))) {
        const fv = favs[+arg]; if (!fv) return; const ref = await favoriteRef(fv);
        if (!ref) { toast(`${fv.name} is not available (moved, or permission refused).`); return; }
        await openFolderRef(app, ref, isDesktop() ? null : ref.uri); return;
      }
      if (arg === 'add') {
        const f = app.folder; const fv = f.uri ? favoriteOf({ uri: f.uri, name: f.name.replace(/ \(with subfolders\)$/, '') }) : null;
        if (!fv) { toast('Open a folder (File ▸ Open Folder) to add it to the favorites.'); return; }
        for (const x of favs) if (await sameFavorite(x, fv)) { toast(`${fv.name} is already a favorite.`); return; }
        favs.push(fv); await saveFavorites(favs); await rememberFolder(fv.uri); syncTrees(app); toast(`Added ${fv.name} to the favorite folders.`); return;
      }
      if (!favs.length) { toast('No favorite folders yet: open a folder, then Favorite Folders ▸ Add the Open Folder.', { ms: 4000 }); return; }
      const r = await openDialog({ title: 'Favorite Folders', ok: 'Go', fields: [
        { key: 'i', label: 'Folder', type: 'list', value: '0', options: favs.map((fv, i) => ({ value: String(i), label: `${fv.name}${fv.uri ? ` — ${decodeURIComponent(fv.uri.replace(/^file:\/\//, ''))}` : ' — picked in this browser'}` })) },
        { key: 'act', label: 'Action', type: 'radio', value: 'open', options: [{ value: 'open', label: 'Open' }, { value: 'up', label: 'Move up' }, { value: 'rename', label: 'Rename…' }, { value: 'remove', label: 'Remove from the favorites' }] },
      ] });
      if (!r) return;
      const i = +r.i, fv = favs[i]; if (!fv) return;
      if (r.act === 'open') return app.exec('browse.favorites', i);
      if (r.act === 'up' && i > 0) [favs[i - 1], favs[i]] = [favs[i], favs[i - 1]];
      if (r.act === 'rename') { const n = await promptDialog('Rename Favorite', 'Name:', fv.name); if (!n) return; fv.name = n; }
      if (r.act === 'remove') favs.splice(i, 1);
      await saveFavorites(favs); syncTrees(app); toast('Favorite folders updated.');
    },
  },
  {
    id: 'browse.recursive', icon: 'folder_copy', kind: 'toggle', noRecord: true, isActive: (app) => app.prefs.includeSubfolders, tip: 'The open folder shows the pictures of its subfolders too',
    run: async (app) => {
      app.prefs.includeSubfolders = !app.prefs.includeSubfolders; app.savePrefs();
      if (app.folder.uri && canListSubfolders(app.folder.uri)) await reloadFolder(app);
      else toast(app.prefs.includeSubfolders ? 'Include Subfolders is on: it applies to folders opened from now on.' : 'Include Subfolders is off.');
      app.refresh();
    },
  },
  {
    id: 'browse.showAllFiles', icon: 'draft', kind: 'toggle', noRecord: true, isActive: (app) => app.prefs.showAllFiles, tip: 'Folders list every file, not only pictures (other files show an icon; open them as text or hex)',
    run: async (app) => {
      app.prefs.showAllFiles = !app.prefs.showAllFiles; listing.allFiles = app.prefs.showAllFiles; app.savePrefs();
      if (app.folder.uri) await reloadFolder(app); else toast(app.prefs.showAllFiles ? 'Show All Files is on: it applies to folders opened from now on.' : 'Show All Files is off.');
      app.refresh();
    },
  },
]);
