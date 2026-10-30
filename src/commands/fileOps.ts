/**
 * File operations (M2): rename, move, copy, delete (to the Recycle Bin / Trash where there is one),
 * Quick Move / Quick Copy to nine folders, file times, and Undo File Operation through the journal.
 * Every operation goes through src/platform/native.ts, which knows what each backend can do.
 */
import { def } from './registry';
import type { App, PictureTab } from '../app';
import { openDialog, toast, confirmDialog, promptDialog } from '../ui/dialog';
import { entryFromUri, type Entry, type Folder } from '../picture/folder';
import { fileOpCaps, renameFile, deleteFile, pickFolder, copyFileTo, writeIntoFolder, setFileTime, isDesktop, type FileOpCaps } from '../platform/native';
import { fmtSize } from '../ui/shell';

/** The folder address an entry can be restored into: the folder's own, or (desktop) the file's parent. */
export function dirUriOf(entry: Entry | null, folder: Folder): string | null {
  if (folder.uri) return folder.uri;
  const u = entry?.uri;
  if (u && u.startsWith('file:')) return u.replace(/\/[^/]*$/, '') || null;
  return null;
}

function caps(app: App): FileOpCaps {
  const e = app.tab.entry;
  return fileOpCaps(e?.uri || null, dirUriOf(e, app.tab.folder));
}

/** Replaces `from` by `to` in the folder and the tab, keeping the decoded picture. */
export function replaceEntry(tab: PictureTab, from: Entry, to: Entry): void {
  const i = tab.folder.entries.indexOf(from);
  if (i >= 0) tab.folder.entries[i] = to;
  tab.loader.rekey(from, to);
  if (tab.picture && tab.picture.entry === from) tab.picture.entry = to;
  tab.app.addRecent(to);
  tab.ui.pictureChanged();
  tab.app.ui.tabsChanged();
  tab.app.refresh();
}

/** Takes the entry out of the folder and shows the next picture (or the empty state). */
async function dropEntry(tab: PictureTab, e: Entry): Promise<number> {
  const i = tab.folder.entries.indexOf(e);
  const wasCurrent = tab.folder.current === e;
  tab.loader.invalidate(e);
  tab.folder.remove(e);
  if (wasCurrent) { tab.dirty = false; tab.clearHistory(); await tab.show(); }
  return i;
}

function putBack(tab: PictureTab, e: Entry, at: number): void {
  const f = tab.folder;
  f.entries.splice(Math.max(0, Math.min(f.entries.length, at)), 0, e);
  f.select(f.entries.indexOf(e));
  void tab.show();
}

async function bytesOf(app: App, e: Entry): Promise<ArrayBuffer | null> {
  const pic = app.tab.picture;
  if (pic && pic.entry === e) return pic.bytes.buffer.slice(pic.bytes.byteOffset, pic.bytes.byteOffset + pic.bytes.byteLength) as ArrayBuffer;
  try { return await e.read(); } catch { return null; }
}

export async function deleteCurrent(app: App, permanent: boolean): Promise<boolean> {
  const tab = app.tab;
  const e = tab.entry;
  if (!e?.uri) { toast('This picture is not a file on disk.'); return false; }
  const c = caps(app);
  if (!c.delete) { toast('Deleting is not available for files opened this way.'); return false; }
  const toTrash = c.trash && !permanent;
  if (app.prefs.confirmDelete || permanent) {
    const ok = await confirmDialog(permanent ? 'Delete Permanently' : 'Delete', toTrash ? `Move "${e.name}" to the ${isDesktop() && navigator.platform.startsWith('Win') ? 'Recycle Bin' : 'Trash'}?` : `Delete "${e.name}"?${c.restore ? ' Undo File Operation can put it back during this session.' : ' This cannot be undone.'}`, 'Delete');
    if (!ok) return false;
  }
  const dirUri = dirUriOf(e, tab.folder);
  const bytes = c.restore ? await bytesOf(app, e) : null;
  const r = await deleteFile(e.uri, dirUri, permanent);
  const at = await dropEntry(tab, e);
  const name = e.name, uri = e.uri;
  app.journal.push({
    kind: 'delete', label: `${r.trashed ? 'Moved to the trash' : 'Deleted'} ${name}`, when: Date.now(), bytes: bytes || undefined,
    undo: bytes && dirUri ? async () => { const n = await writeIntoFolder(dirUri, name, bytes); putBack(tab, entryFromUri({ uri: n.uri, name: n.name, size: bytes.byteLength, mtime: Date.now() }), at); } : undefined,
    noUndo: bytes ? undefined : r.trashed ? 'restore it from the trash' : 'the file\'s bytes were not kept',
  });
  void uri;
  toast(r.trashed ? `${name} moved to the trash` : `${name} deleted`, c.restore && bytes ? { action: 'Undo', onAction: () => app.exec('file.undoFileOp') } : {});
  return true;
}

async function transfer(app: App, dest: { uri: string; name: string }, move: boolean): Promise<boolean> {
  const tab = app.tab;
  const e = tab.entry;
  if (!e?.uri) { toast('This picture is not a file on disk.'); return false; }
  const c = caps(app);
  if (move ? !c.move : !c.copy) { toast(`${move ? 'Moving' : 'Copying'} is not available for files opened this way.`); return false; }
  if (tab.dirty && move && !(await confirmDialog('Move', `"${e.name}" has unsaved changes. Move the file as it is on disk?`, 'Move'))) return false;
  const srcDir = dirUriOf(e, tab.folder);
  if (srcDir && srcDir === dest.uri) { toast(`${e.name} is already in ${dest.name}.`); return false; }
  const out = await copyFileTo(e.uri, srcDir, dest.uri, e.name, move);
  const name = e.name;
  let at = -1;
  if (move) at = await dropEntry(tab, e);
  app.journal.push({
    kind: move ? 'move' : 'copy', label: `${move ? 'Moved' : 'Copied'} ${name} to ${dest.name}`, when: Date.now(),
    undo: move
      ? (srcDir ? async () => { const back = await copyFileTo(out.uri, dest.uri, srcDir, name, true); putBack(tab, entryFromUri({ uri: back.uri, name: back.name }), at); } : undefined)
      : async () => { await deleteFile(out.uri, dest.uri, true); },
    noUndo: move && !srcDir ? 'the original folder is not known' : undefined,
  });
  toast(`${move ? 'Moved' : 'Copied'} ${name} to ${dest.name}${out.name !== name ? ` as ${out.name}` : ''}`, { action: 'Undo', onAction: () => app.exec('file.undoFileOp') });
  return true;
}

async function quickSlot(app: App, n: number, label: string): Promise<{ uri: string; name: string } | null> {
  const i = Math.max(1, Math.min(9, n)) - 1;
  const slots = app.prefs.quickFolders;
  if (slots[i]?.uri) return slots[i];
  const picked = await pickFolder(`${label}: choose folder ${i + 1}`);
  if (!picked) return null;
  while (slots.length <= i) slots.push({ name: '', uri: '' });
  slots[i] = picked;
  app.savePrefs();
  toast(`Folder ${i + 1} is now ${picked.name}`);
  return picked;
}

export async function quickFoldersDialog(app: App): Promise<void> {
  const slots = app.prefs.quickFolders;
  const row = (i: number) => ({ key: `s${i}`, type: 'button' as const, label: `${i + 1}: ${slots[i]?.uri ? slots[i].name : '(not set)'} — ${slots[i]?.uri ? 'change…' : 'choose…'}`, onClick: async (_v: any, ctl: any) => { const p = await pickFolder(`Quick folder ${i + 1}`); if (!p) return; while (slots.length <= i) slots.push({ name: '', uri: '' }); slots[i] = p; app.savePrefs(); ctl.rebuild(fields()); } });
  const fields = () => [
    { key: 'h', type: 'info' as const, label: 'Quick Move sends the current picture to one of nine folders with Alt+1…Alt+9; Quick Copy copies it with Alt+Shift+1…9. Culling: Keep, Reject, Maybe… Use Undo File Operation (Ctrl+Alt+Z) to take a move back.' },
    ...Array.from({ length: 9 }, (_, i) => row(i)),
    { key: 'clear', type: 'button' as const, label: 'Clear all nine', onClick: (_v: any, ctl: any) => { slots.length = 0; app.savePrefs(); ctl.rebuild(fields()); } },
  ];
  await openDialog({ title: 'Quick Move / Quick Copy Folders', fields: fields(), cancel: false, ok: 'Close' });
}

const slotMenu = (app: App, id: string) => [
  ...Array.from({ length: 9 }, (_, i) => ({ id, arg: i + 1, label: `${i + 1}  ${app.prefs.quickFolders[i]?.uri ? app.prefs.quickFolders[i].name : '(choose a folder)'}` })),
  { separator: true },
  { label: 'Set Up Folders…', icon: 'folder_managed', id: 'file.quickMove', arg: 'setup' },
];

def([
  {
    id: 'file.rename', icon: 'drive_file_rename_outline', noRecord: true, isEnabled: (app) => caps(app).rename,
    run: async (app) => {
      const tab = app.tab;
      const e = tab.entry;
      if (!e?.uri) return;
      const name = await promptDialog('Rename', 'New name', e.name);
      if (name === null) return;
      const n = name.trim();
      if (!n || n === e.name) return;
      if (/[\\/:*?"<>|]/.test(n)) { toast('A file name cannot contain \\ / : * ? " < > |'); return; }
      const oldExt = (e.name.match(/\.[^.]+$/)?.[0] || '').toLowerCase(), newExt = (n.match(/\.[^.]+$/)?.[0] || '').toLowerCase();
      if (oldExt !== newExt && !(await confirmDialog('Rename', `The extension changes from "${oldExt || 'none'}" to "${newExt || 'none'}". Other programs pick a format by the extension; Anne's Lens reads the content. Rename anyway?`, 'Rename'))) return;
      const dirUri = dirUriOf(e, tab.folder);
      const r = await renameFile(e.uri, dirUri, n);
      const to = entryFromUri({ uri: r.uri, name: r.name, size: e.size, mtime: e.mtime });
      replaceEntry(tab, e, to);
      const oldName = e.name;
      app.journal.push({ kind: 'rename', label: `Renamed ${oldName} to ${r.name}`, when: Date.now(), undo: async () => { const b = await renameFile(to.uri!, dirUri, oldName); replaceEntry(tab, to, entryFromUri({ uri: b.uri, name: b.name, size: e.size, mtime: e.mtime })); } });
      toast(`Renamed to ${r.name}`, { action: 'Undo', onAction: () => app.exec('file.undoFileOp') });
    },
  },
  {
    id: 'file.moveTo', icon: 'drive_file_move', noRecord: true, isEnabled: (app) => caps(app).move,
    run: async (app) => { const dest = await pickFolder('Move to folder'); if (dest) await transfer(app, dest, true); },
  },
  {
    id: 'file.copyTo', icon: 'file_copy', noRecord: true, isEnabled: (app) => caps(app).copy,
    run: async (app) => { const dest = await pickFolder('Copy to folder'); if (dest) await transfer(app, dest, false); },
  },
  { id: 'file.delete', icon: 'delete', popular: true, noRecord: true, isEnabled: (app) => caps(app).delete, run: (app) => deleteCurrent(app, false) },
  { id: 'file.deletePermanent', icon: 'delete_forever', noRecord: true, isEnabled: (app) => caps(app).delete, run: (app) => deleteCurrent(app, true) },
  {
    id: 'file.quickMove', icon: 'move_to_inbox', kind: 'menu', noRecord: true, isEnabled: (app) => caps(app).move || !app.picture,
    tip: 'Culling: Alt+1…Alt+9 move the picture to one of nine folders you choose once',
    menu: (app) => slotMenu(app, 'file.quickMove'),
    run: async (app, arg?: number | string) => {
      if (arg === 'setup' || arg === undefined) return quickFoldersDialog(app);
      const dest = await quickSlot(app, +arg, 'Quick Move');
      if (dest) await transfer(app, dest, true);
    },
  },
  {
    id: 'file.quickCopy', icon: 'content_copy', kind: 'menu', noRecord: true, isEnabled: (app) => caps(app).copy || !app.picture,
    tip: 'Alt+Shift+1…9 copy the picture to one of the nine quick folders',
    menu: (app) => slotMenu(app, 'file.quickCopy'),
    run: async (app, arg?: number | string) => {
      if (arg === 'setup' || arg === undefined) return quickFoldersDialog(app);
      const dest = await quickSlot(app, +arg, 'Quick Copy');
      if (dest) await transfer(app, dest, false);
    },
  },
  {
    id: 'file.undoFileOp', icon: 'undo', noRecord: true, isEnabled: (app) => !!app.journal.last,
    tip: 'Takes back the last rename, move, copy or delete of this session',
    run: async (app) => {
      const op = app.journal.last;
      if (!op) { toast('No file operation to undo.'); return; }
      if (!op.undo) {
        const list = app.journal.ops.slice(-12).reverse().map((o) => `${new Date(o.when).toLocaleTimeString()}  ${o.label}${o.undo ? '' : ` (no undo${o.noUndo ? `: ${o.noUndo}` : ''})`}`).join('\n');
        await openDialog({ title: 'File Operations', cancel: false, ok: 'Close', fields: [{ key: 'i', type: 'info', label: `${op.label} cannot be undone${op.noUndo ? `: ${op.noUndo}` : ''}.` }, { key: 'j', type: 'textarea', rows: 8, value: list }] });
        return;
      }
      const done = await app.journal.undoLast();
      if (done) toast(`Undone: ${done.label}`);
    },
  },
  {
    id: 'file.setFileTime', icon: 'schedule', noRecord: true, isEnabled: (app) => caps(app).setTime,
    run: async (app) => {
      const e = app.tab.entry;
      if (!e?.uri) return;
      const cur = new Date(e.mtime || Date.now());
      const pad = (n: number) => String(n).padStart(2, '0');
      const exif = app.picture?.exif?.dateTaken ? parseExifDate(app.picture.exif.dateTaken) : null;
      const r = await openDialog({ title: 'Change File Date/Time', ok: 'Set', fields: [
        { key: 'date', label: 'Date', type: 'date', value: `${cur.getFullYear()}-${pad(cur.getMonth() + 1)}-${pad(cur.getDate())}`, half: true },
        { key: 'time', label: 'Time', type: 'time', value: `${pad(cur.getHours())}:${pad(cur.getMinutes())}`, half: true },
        ...(exif ? [{ key: 'b', type: 'button' as const, label: `Use the EXIF date taken (${exif.toLocaleString()})`, onClick: (_v: any, ctl: any) => { ctl.set('date', `${exif.getFullYear()}-${pad(exif.getMonth() + 1)}-${pad(exif.getDate())}`); ctl.set('time', `${pad(exif.getHours())}:${pad(exif.getMinutes())}`); } }] : []),
      ] });
      if (!r) return;
      const t = new Date(`${r.date}T${r.time || '00:00'}`);
      if (Number.isNaN(t.getTime())) { toast('That is not a valid date.'); return; }
      if (await setFileTime(e.uri, t.getTime())) { e.mtime = t.getTime(); toast(`File time set to ${t.toLocaleString()}`); app.refresh(); }
    },
  },
  {
    id: 'file.fileTimeFromExif', icon: 'update', noRecord: true, isEnabled: (app) => caps(app).setTime && !!app.picture?.exif?.dateTaken,
    run: async (app) => {
      const e = app.tab.entry;
      const d = app.picture?.exif?.dateTaken ? parseExifDate(app.picture.exif.dateTaken) : null;
      if (!e?.uri || !d) { toast('This picture has no EXIF date taken.'); return; }
      if (await setFileTime(e.uri, d.getTime())) { e.mtime = d.getTime(); toast(`File time set to ${d.toLocaleString()} (from EXIF)`); app.refresh(); }
    },
  },
]);

/** "2024:05:17 14:03:22" (EXIF) or an ISO-like string, as a local Date; null when unreadable. */
export function parseExifDate(s: string): Date | null {
  const m = String(s).match(/(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  return Number.isNaN(d.getTime()) ? null : d;
}

export { fmtSize };
