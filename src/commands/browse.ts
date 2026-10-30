/**
 * Browse commands (M3): Thumbnails (T) and the filmstrip, thumbnail size, sort order, refresh, open an
 * archive as a folder, select by pattern.
 */
import { def } from './registry';
import type { App } from '../app';
import { toast, promptDialog } from '../ui/dialog';
import { listFolderOf, openDocuments } from '../platform/native';
import { entryFromUri, type SortKey } from '../picture/folder';

const SIZES: Record<string, number> = { small: 96, medium: 160, large: 240, xl: 360 };

/** Glob (* ? and [abc]) to a case-insensitive RegExp. */
export function globToRegExp(pattern: string): RegExp {
  const esc = pattern.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^(?:${esc.split(/\s*[;,]\s*/).join('|')})$`, 'i');
}

def([
  { id: 'browse.thumbnails', icon: 'grid_view', popular: true, kind: 'toggle', noRecord: true, isActive: (app) => app.tab.thumbs.open && app.tab.thumbs.mode === 'grid', isEnabled: (app) => app.folder.length > 0, tip: 'The folder as a grid of thumbnails; Enter or double-click opens a picture', run: (app) => app.tab.thumbs.toggle('grid') },
  {
    id: 'browse.viewMode', icon: 'view_carousel', kind: 'menu', noRecord: true, isEnabled: (app) => app.folder.length > 0,
    menu: (app) => [{ id: 'browse.viewMode', arg: 'thumbnails', label: 'Thumbnail grid', checked: app.tab.thumbs.open && app.tab.thumbs.mode === 'grid' }, { id: 'browse.viewMode', arg: 'filmstrip', label: 'Filmstrip under the picture', checked: app.tab.thumbs.open && app.tab.thumbs.mode === 'strip' }, { id: 'browse.viewMode', arg: 'off', label: 'Picture only' }],
    run: (app, arg?: string) => { const t = app.tab.thumbs; if (arg === 'off') t.hide(); else { t.show(arg === 'filmstrip' ? 'strip' : 'grid'); app.prefs.thumbMode = t.mode; app.savePrefs(); } },
  },
  {
    id: 'browse.thumbSize', icon: 'photo_size_select_large', kind: 'menu', noRecord: true,
    menu: (app) => Object.entries(SIZES).map(([k, v]) => ({ id: 'browse.thumbSize', arg: k, label: `${k[0].toUpperCase() + k.slice(1)} (${v} px)`, checked: app.prefs.thumbSize === v })),
    run: (app, arg?: string) => { const v = SIZES[arg || 'medium'] || +arg! || 160; app.tab.thumbs.setSize(v); },
  },
  {
    id: 'browse.sort', icon: 'sort', kind: 'menu', noRecord: true,
    menu: (app) => [
      ...([['natural', 'Name (natural: 2 before 10)'], ['name', 'Name'], ['date', 'File date'], ['size', 'Size'], ['type', 'Type']] as [SortKey, string][]).map(([k, label]) => ({ id: 'browse.sort', arg: k, label, checked: app.prefs.sort === k })),
      { separator: true }, { id: 'browse.sort', arg: 'desc', label: 'Descending', checked: app.prefs.sortDescending }, { id: 'browse.sort', arg: 'random', label: 'Shuffle' },
    ],
    run: (app, arg?: string) => {
      const f = app.folder;
      if (arg === 'random') { const cur = f.current; for (let i = f.entries.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [f.entries[i], f.entries[j]] = [f.entries[j], f.entries[i]]; } f.index = cur ? f.entries.indexOf(cur) : -1; app.refresh(); app.tab.thumbs.sync(); return; }
      if (arg === 'desc') app.prefs.sortDescending = !app.prefs.sortDescending; else if (arg) app.prefs.sort = arg as SortKey;
      app.savePrefs();
      f.sort(app.prefs.sort, app.prefs.sortDescending);
      app.refresh(); app.tab.thumbs.sync();
    },
  },
  {
    id: 'browse.refresh', icon: 'refresh', noRecord: true, isEnabled: (app) => !!app.folder.uri, tip: 'Reads the folder again (new, renamed and removed files)',
    run: async (app) => {
      const f = app.folder;
      const listed = f.uri ? await listFolderOf(f.uri) : null;
      if (!listed) { toast('This folder cannot be re-read here.'); return; }
      const cur = f.current?.name;
      const kept = new Map(f.entries.map((e) => [e.uri, e]));
      f.entries = listed.entries.map((e) => kept.get(e.uri) || entryFromUri(e));
      f.sort(app.prefs.sort, app.prefs.sortDescending);
      f.select(Math.max(0, cur ? f.indexOfName(cur) : 0));
      app.tab.loader.clear();
      await app.tab.show();
      app.tab.thumbs.sync();
      toast(`${f.length} pictures`);
    },
  },
  {
    id: 'browse.openArchive', icon: 'folder_zip', noRecord: true, tip: 'ZIP, CBZ or EPUB: the pictures inside become the folder',
    run: async (app) => {
      const files = await openDocuments('.zip,.cbz,.epub,application/zip', ['application/zip', 'application/vnd.comicbook+zip', 'application/epub+zip', 'application/octet-stream'], false);
      if (!files.length) return;
      const { archiveFolder } = await import('./file');
      const folder = await archiveFolder(files[0].name, files[0].data);
      if (folder) await app.openFolder(folder, 0);
    },
  },
  {
    id: 'browse.selectPattern', icon: 'pattern', noRecord: true, isEnabled: (app) => app.folder.length > 0, tip: 'Marks the pictures whose names match (wildcards * and ?; several patterns with ;)',
    run: async (app) => {
      const pat = await promptDialog('Select by Pattern', 'Pattern', '*.jpg', { placeholder: 'IMG_*.jpg; *.png' });
      if (!pat) return;
      const re = globToRegExp(pat.trim());
      const t = app.tab;
      let n = 0;
      for (const e of t.folder.entries) if (re.test(e.name)) { t.marked.add(e); n++; }
      if (!t.thumbs.open) t.thumbs.show('grid'); else t.thumbs.sync();
      (t.thumbs as any).render?.(false);
      toast(`${n} picture${n === 1 ? '' : 's'} marked`);
    },
  },
]);
