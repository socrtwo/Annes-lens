/** File commands: open (files, folders, recent, dropped, launched), save, reload, print, share, close, options, settings transfer, portable mode. */
import { def } from './registry';
import type { App, PictureTab } from '../app';
import { Folder, entryFromFile, entryFromBytes, entryFromUri, entryFromHandle, isPictureName, type Entry } from '../picture/folder';
import { openDocuments, openFolderDialog, listFolderOf, saveAs, writeBack, shareFile, readUri, printDocument, isDesktop, isCapacitor, desktopBridge, writeClipboardText, type OpenedFile } from '../platform/native';
import { OPEN_ACCEPT, OPEN_MIMES, FORMATS, encodeCanvas, ENCODERS, encoderFor, type EncodeFormat } from '../codecs/registry';
import { openDialog, toast, confirmDialog, choiceDialog } from '../ui/dialog';
import { sanitizePrefs, parseKeyList, DEFAULT_QAT, type Prefs } from '../prefs';
import { allCommands, getCommand } from './registry';
import { h } from '../ui/dom';
import { fmtSize } from '../ui/shell';

/** Opens a set of files (picker, drop, launch). One file on the desktop pulls in its folder. */
export async function openFiles(app: App, files: OpenedFile[], opts: { newWindow?: boolean } = {}): Promise<void> {
  if (!files.length) return;
  const entries = files.map((f) => entryFromBytes(f.name, f.data, f.uri));
  let folder = new Folder(entries, files.length === 1 ? 'Opened file' : `${files.length} files`);
  let index = 0;
  if (files.length === 1 && files[0].uri && isDesktop()) {
    const listed = await listFolderOf(files[0].uri);
    if (listed && listed.entries.length) {
      const all = listed.entries.map((e) => (e.uri === files[0].uri ? entries[0] : entryFromUri(e)));
      folder = new Folder(all, listed.name);
      folder.uri = listed.uri;
      index = Math.max(0, all.indexOf(entries[0]));
      addRecentFolder(app, listed.name, listed.uri);
    }
  }
  folder.sort(app.prefs.sort, app.prefs.sortDescending);
  if (files.length === 1 && folder.length > 1) index = folder.entries.indexOf(entries[0]);
  await app.openFolder(folder, index, opts);
}

export async function openDroppedFiles(app: App, files: File[]): Promise<void> {
  const list = files.filter((f) => isPictureName(f.name) || f.type.startsWith('image/') || !/\./.test(f.name));
  if (!list.length) { toast('None of the dropped files is a picture Anne\'s Lens can open.'); return; }
  const folder = new Folder(list.map(entryFromFile), list.length === 1 ? list[0].name : `${list.length} dropped files`);
  folder.sort(app.prefs.sort, app.prefs.sortDescending);
  await app.openFolder(folder, 0);
}

function addRecentFolder(app: App, name: string, uri: string | null): void {
  if (!uri) return;
  const list = app.prefs.recentFolders.filter((r) => r.key !== uri);
  list.unshift({ key: uri, name, when: Date.now(), uri });
  app.prefs.recentFolders = list.slice(0, 20);
  app.savePrefs();
}

async function openFolderFromDialog(app: App): Promise<void> {
  const r = await openFolderDialog();
  if (!r) return;
  let entries: Entry[] = [];
  if (r.entries) entries = r.entries.map(entryFromUri);
  else if (r.handles) entries = r.handles.filter((x) => isPictureName(x.name)).map((x) => entryFromHandle(x.name, x.handle));
  else if (r.files) entries = r.files.filter((f) => isPictureName(f.name)).map(entryFromFile);
  if (!entries.length) { toast(`No pictures in ${r.name}.`); return; }
  const folder = new Folder(entries, r.name);
  folder.uri = r.uri;
  folder.sort(app.prefs.sort, app.prefs.sortDescending);
  addRecentFolder(app, r.name, r.uri);
  await app.openFolder(folder, 0);
}

export type SaveFormat = EncodeFormat;
const EXT = Object.fromEntries(Object.entries(ENCODERS).map(([k, v]) => [k, v.ext])) as Record<SaveFormat, string>;
const SAVE_OPTIONS = Object.entries(ENCODERS).map(([value, v]) => ({ value, label: v.label }));

/** Encodes the active picture's current page in the format chosen (asking for options unless given). */
async function produce(app: App, format?: SaveFormat, quality?: number): Promise<{ blob: Blob; name: string } | null> {
  const pic = app.picture!;
  const base = pic.name.replace(/\.[^.]+$/, '') || 'picture';
  let fmt = format, q = quality;
  let opts: { rle?: boolean; threshold?: number } = { rle: app.prefs.tgaRle };
  if (!fmt) {
    const current = encoderFor(pic.format.id) || (ENCODERS[app.prefs.defaultSaveFormat as SaveFormat] ? (app.prefs.defaultSaveFormat as SaveFormat) : 'png');
    const r = await openDialog({ title: 'Save As', fields: [
      { key: 'format', label: 'Format', type: 'select', options: SAVE_OPTIONS, value: current },
      { key: 'quality', label: 'Quality', type: 'range', min: 1, max: 100, value: app.prefs.jpegQuality, visibleIf: (v) => !!ENCODERS[v.format as SaveFormat]?.lossy },
      { key: 'rle', label: 'Compress runs (RLE)', type: 'checkbox', value: app.prefs.tgaRle, visibleIf: (v) => v.format === 'tga' },
      { key: 'threshold', label: 'Black below this brightness', type: 'range', min: 1, max: 254, value: 128, visibleIf: (v) => v.format === 'wbmp' },
      { key: 'i', type: 'info', label: pic.current.hasAlpha ? 'Transparent pixels: kept in PNG, WebP, BMP, TGA, PAM and QOI; flattened onto white in JPEG, PPM, PGM and WBMP. Metadata is not carried over yet (planned for M2).' : 'Metadata is not carried over yet (planned for M2).' },
    ], ok: 'Save' });
    if (!r) return null;
    fmt = r.format; q = r.quality; opts = { rle: !!r.rle, threshold: +r.threshold || 128 };
    app.prefs.jpegQuality = q!; app.prefs.defaultSaveFormat = fmt!; app.prefs.tgaRle = !!r.rle; app.savePrefs();
  }
  const c = pic.frameCanvas();
  const blob = await encodeCanvas(c, fmt!, (q ?? app.prefs.jpegQuality) / 100, opts);
  return { blob, name: `${base}.${EXT[fmt!]}` };
}

/** Save: back into the same file when the format can be written and the file is writable; otherwise Save As. */
export async function saveTab(app: App, tab: PictureTab, opts: { as?: boolean; format?: SaveFormat; copy?: boolean } = {}): Promise<boolean> {
  const pic = tab.picture;
  if (!pic) return false;
  const writable = encoderFor(pic.format.id);
  if (!opts.as && !opts.copy && pic.entry.uri && writable) {
    try {
      const out = await produce(app, writable, app.prefs.jpegQuality);
      if (!out) return false;
      if (await writeBack(pic.entry.uri, out.blob)) { await reloadAfterSave(app, tab, out.blob); toast(`Saved ${pic.name}`); return true; }
    } catch (e) { console.warn(e); }
  }
  const out = await produce(app, opts.format);
  if (!out) return false;
  const r = await saveAs(out.blob, out.name);
  if (!r) return false;
  if (!opts.copy) {
    const data = await out.blob.arrayBuffer();
    const e = entryFromBytes(r.name, data, r.uri);
    // The saved file joins the folder at the current position (or replaces the entry when the name is the same).
    const f = tab.folder;
    const i = f.index;
    if (r.name === pic.name && pic.entry.uri === r.uri) f.entries[i] = e; else f.entries.splice(i + 1, 0, e);
    tab.loader.invalidate(pic.entry);
    f.select(r.name === pic.name && pic.entry.uri === r.uri ? i : i + 1);
    tab.dirty = false; tab.clearHistory();
    await tab.show();
  }
  toast(`Saved ${r.name}`);
  return true;
}

async function reloadAfterSave(app: App, tab: PictureTab, blob: Blob): Promise<void> {
  const pic = tab.picture!;
  const data = await blob.arrayBuffer();
  const e = entryFromBytes(pic.name, data, pic.entry.uri);
  tab.folder.entries[tab.folder.index] = e;
  tab.loader.invalidate(pic.entry);
  tab.dirty = false; tab.clearHistory();
  await tab.show();
}

def([
  {
    id: 'file.open', icon: 'folder_open', popular: true, noRecord: true,
    tip: 'One or several pictures; on the desktop the rest of the folder follows',
    run: async (app) => { const files = await openDocuments(OPEN_ACCEPT, OPEN_MIMES, true); if (!files.length) return; await openFiles(app, files); app.ui.hideBackstage(); },
  },
  { id: 'file.openFolder', icon: 'folder', popular: true, noRecord: true, tip: 'Every picture in a folder, in the current sort order', run: async (app) => { await openFolderFromDialog(app); app.ui.hideBackstage(); } },
  {
    id: 'file.openDropped', label: 'Open Dropped Files', icon: 'file_open', tab: 'File', internal: true, noRecord: true,
    run: (app, files: File[]) => openDroppedFiles(app, files || []),
  },
  {
    id: 'file.openRecent', icon: 'history', kind: 'menu', noRecord: true,
    run: async (app, key?: string) => {
      if (!key) return app.ui.showBackstage('open');
      const rec = app.prefs.recent.find((r) => r.key === key);
      if (!rec || !rec.uri) return;
      const f = await readUri(rec.uri);
      if (!f) { toast('That file is no longer available. Use Open to locate it.'); app.prefs.recent = app.prefs.recent.filter((r) => r !== rec); app.savePrefs(); return; }
      await openFiles(app, [f]);
      app.ui.hideBackstage();
    },
    menu: (app) => app.prefs.recent.length ? app.prefs.recent.slice(0, 15).map((r) => ({ id: 'file.openRecent', arg: r.key, label: (r.pinned ? '📌 ' : '') + r.name })) : [{ label: '(no recent pictures)' }],
  },
  {
    id: 'file.recentFolders', icon: 'folder_special', kind: 'menu', noRecord: true,
    isEnabled: () => isDesktop(),
    run: async (app, key?: string) => {
      const rec = app.prefs.recentFolders.find((r) => r.key === key) || app.prefs.recentFolders[0];
      if (!rec?.uri) { toast('No recent folders yet.'); return; }
      const listed = await listFolderOf(rec.uri);
      if (!listed || !listed.entries.length) { toast(`${rec.name} has no pictures now.`); return; }
      const folder = new Folder(listed.entries.map(entryFromUri), listed.name); folder.uri = listed.uri;
      folder.sort(app.prefs.sort, app.prefs.sortDescending);
      await app.openFolder(folder, 0);
    },
    menu: (app) => app.prefs.recentFolders.length ? app.prefs.recentFolders.map((r) => ({ id: 'file.recentFolders', arg: r.key, label: r.name })) : [{ label: '(no recent folders)' }],
  },
  { id: 'file.clearRecent', icon: 'delete_sweep', noRecord: true, run: (app) => { app.prefs.recent = app.prefs.recent.filter((r) => r.pinned); app.prefs.recentFolders = []; app.savePrefs(); toast('Recent lists cleared'); } },
  {
    id: 'file.newWindow', icon: 'open_in_new', noRecord: true, tip: 'Another window (tab) on the same folder, or a new empty one',
    run: async (app) => {
      const f = app.folder;
      if (!f.length) { app.createTab(); return; }
      const folder = new Folder([...f.entries], f.name); folder.uri = f.uri;
      await app.openFolder(folder, f.index, { newWindow: true });
    },
  },
  {
    id: 'file.revealInFolder', icon: 'folder_open', noRecord: true, isEnabled: (app) => isDesktop() && !!app.picture?.entry.uri,
    run: (app) => desktopBridge()!.revealInFolder({ uri: app.picture!.entry.uri! }),
  },
  {
    id: 'file.openWith', icon: 'open_in_new', noRecord: true, isEnabled: (app) => isDesktop() && !!app.picture?.entry.uri,
    run: async (app) => { const r = await desktopBridge()!.openWith({ uri: app.picture!.entry.uri! }); if (!r.ok) toast(r.error || 'No program is registered for this type.'); },
  },
  { id: 'file.copyName', icon: 'content_copy', noRecord: true, isEnabled: (app) => !!app.picture, run: async (app) => { await writeClipboardText(app.picture!.name); toast('File name copied'); } },
  { id: 'file.copyPath', icon: 'content_copy', noRecord: true, isEnabled: (app) => !!app.picture?.entry.uri, run: async (app) => { await writeClipboardText(app.picture!.entry.uri!.replace(/^file:\/\//, '')); toast('Path copied'); } },
]);

// Save ----------------------------------------------------------------------------------------

def([
  { id: 'file.save', icon: 'save', popular: true, noRecord: true, isEnabled: (app) => !!app.picture, tip: 'Writes back to the same file when its format can be written (PNG, JPEG, WebP, BMP, TGA, PPM, QOI, WBMP); otherwise asks where', run: (app) => saveTab(app, app.tab) },
  { id: 'file.saveAs', icon: 'save_as', popular: true, noRecord: true, isEnabled: (app) => !!app.picture, run: (app, format?: SaveFormat) => saveTab(app, app.tab, { as: true, format: format && EXT[format] ? format : undefined }) },
  { id: 'file.saveCopy', icon: 'file_copy', noRecord: true, isEnabled: (app) => !!app.picture, run: (app) => saveTab(app, app.tab, { as: true, copy: true }) },
  { id: 'file.saveAll', icon: 'library_add_check', noRecord: true, run: async (app) => { for (const t of app.tabs) if (t.dirty && t.picture) { app.activate(t); await saveTab(app, t); } } },
  {
    id: 'file.reload', icon: 'refresh', noRecord: true, isEnabled: (app) => !!app.picture || !!app.folder.current,
    run: async (app) => {
      const t = app.tab;
      if (t.dirty && !(await confirmDialog('Reload', 'Discard the unsaved changes and read the file again?'))) return;
      const e = t.folder.current; if (!e) return;
      t.loader.invalidate(e); t.dirty = false; t.clearHistory();
      await t.show();
    },
  },
]);

// Print, share ----------------------------------------------------------------------------------

async function printPicture(app: App, opts: { fit: 'page' | 'actual'; title?: boolean } = { fit: 'page' }): Promise<void> {
  const pic = app.picture;
  if (!pic) return;
  const blob = await encodeCanvas(pic.frameCanvas(), 'png');
  const url = URL.createObjectURL(blob);
  const root = document.getElementById('ql-print-root') || document.body.appendChild(h('div', { id: 'ql-print-root' }));
  root.innerHTML = '';
  const dpi = pic.current.dpi?.[0] || 96;
  const img = h('img', { src: url, alt: pic.name, style: opts.fit === 'actual' ? `width:${(pic.width / dpi).toFixed(3)}in;height:auto` : 'max-width:100%;max-height:95vh;object-fit:contain' });
  root.appendChild(h('div', { class: 'ql-print-page' }, img, opts.title ? h('div', { style: 'font:11px sans-serif;margin-top:4px' }, pic.name) : null));
  await new Promise((r) => { img.onload = () => r(null); img.onerror = () => r(null); });
  document.body.classList.add('ql-printing');
  try { await printDocument(pic.name); } finally { setTimeout(() => { document.body.classList.remove('ql-printing'); root.innerHTML = ''; URL.revokeObjectURL(url); }, 1000); }
}

def([
  {
    id: 'file.print', icon: 'print', popular: true, noRecord: true, isEnabled: (app) => !!app.picture,
    run: async (app) => {
      const r = await openDialog({ title: 'Print', fields: [
        { key: 'fit', label: 'Size', type: 'radio', options: [{ value: 'page', label: 'Fit to the page' }, { value: 'actual', label: `Actual size at the picture's resolution (${app.picture!.current.dpi?.[0] || 96} dpi)` }], value: 'page' },
        { key: 'title', label: 'Print the file name under the picture', type: 'checkbox', value: false },
        { key: 'i', type: 'info', label: 'Position, scaling, captions and several pictures per page come with M2 (Print Layouts).' },
      ], ok: 'Print' });
      if (!r) return;
      app.ui.hideBackstage();
      await printPicture(app, { fit: r.fit, title: r.title });
    },
  },
  { id: 'file.quickPrint', icon: 'print', noRecord: true, isEnabled: (app) => !!app.picture, run: (app) => printPicture(app) },
  {
    id: 'file.printPreview', icon: 'preview', noRecord: true, isEnabled: (app) => !!app.picture,
    run: async (app) => {
      const pic = app.picture!;
      const blob = await encodeCanvas(pic.frameCanvas(), 'png');
      const url = URL.createObjectURL(blob);
      const page = h('div', { class: 'qn-print-preview' }, h('img', { src: url, alt: pic.name }));
      const r = await openDialog({ title: 'Print Preview', wide: true, content: page, ok: 'Print…', cancel: 'Close' });
      URL.revokeObjectURL(url);
      if (r) app.exec('file.print');
    },
  },
  {
    id: 'file.share', icon: 'share', popular: true, noRecord: true, isEnabled: (app) => !!app.picture,
    run: async (app) => { const pic = app.picture!; await shareFile(new Blob([pic.bytes as BlobPart], { type: pic.format.mime }), pic.name, pic.name); },
  },
  {
    id: 'file.email', icon: 'attach_email', noRecord: true, isEnabled: (app) => !!app.picture, tip: 'Attach to an email through the share sheet (Anne\'s Post when installed)',
    run: async (app) => { const pic = app.picture!; await shareFile(new Blob([pic.bytes as BlobPart], { type: pic.format.mime }), pic.name, pic.name); },
  },
]);

// Close and options ------------------------------------------------------------------------------

def([
  {
    id: 'file.close', icon: 'close', popular: true, noRecord: true,
    run: async (app, arg) => {
      const tab = app.tabs.find((d) => d.id === arg) || app.tab;
      if (tab.dirty && app.prefs.confirmClose && tab.picture) {
        const c = await choiceDialog('Save Changes?', `Save changes to "${tab.displayName}" before closing?`, ['Save', "Don't Save"]);
        if (c < 0) return;
        if (c === 0 && !(await saveTab(app, tab))) return;
      }
      if (app.tabs.length === 1) { tab.folder = new Folder(); tab.loader.setFolder(tab.folder); tab.dirty = false; await tab.show(); }
      else app.closeTab(tab);
      app.ui.hideBackstage();
    },
  },
  { id: 'file.closeAll', icon: 'tab_close', noRecord: true, run: async (app) => { for (const d of [...app.tabs]) { app.activate(d); await app.exec('file.close', d.id); } } },
  {
    id: 'file.exit', icon: 'logout', noRecord: true, tip: 'Esc leaves full screen first; closing the app with Esc is an option (desktop)',
    run: async (app) => {
      if (document.fullscreenElement || document.body.classList.contains('ql-fullscreen')) { app.exec('view.fullScreen'); return; }
      if (!app.prefs.escExits && app.lastCommand?.id === 'file.exit' && !isDesktop()) return;
      if (!isDesktop() && !isCapacitor()) { if (app.lastCommand?.id === 'file.exit') toast('Close the browser tab to leave Anne\'s Lens.'); return; }
      for (const d of [...app.tabs]) if (d.dirty) { app.activate(d); await app.exec('file.close', d.id); if (app.tabs.includes(d) && d.dirty) return; }
      if (isDesktop()) { window.close(); return; }
      try { const { App: CapApp } = await import('@capacitor/app'); await CapApp.exitApp(); } catch { window.close(); }
    },
  },
  {
    id: 'file.options', icon: 'settings', popular: true, noRecord: true,
    run: async (app) => {
      const p = app.prefs;
      const { CLASSIC_LAYOUT_NAMES } = await import('../ui/classicMenus');
      const r = await openDialog({ title: 'Anne\'s Lens Options', wide: true, fields: [
        { key: 'h1', type: 'heading', label: 'Viewing' },
        { key: 'zoomMode', label: 'When a picture opens', type: 'select', options: [{ value: 'fit-large', label: 'Fit only large pictures to the window' }, { value: 'fit', label: 'Fit every picture to the window' }, { value: 'fit-width', label: 'Fit width' }, { value: 'fit-height', label: 'Fit height' }, { value: 'fill', label: 'Fill the window' }, { value: 'actual', label: 'Original size (100%)' }], value: p.zoomMode, half: true },
        { key: 'wheel', label: 'Mouse wheel', type: 'select', options: [{ value: 'navigate', label: 'Next / previous picture (scrolls a large picture)' }, { value: 'zoom', label: 'Zoom' }, { value: 'scroll', label: 'Scroll only' }], value: p.wheel, half: true },
        { key: 'zoomLock', label: 'Lock zoom between pictures', type: 'checkbox', value: p.zoomLock, half: true },
        { key: 'keepPosition', label: 'Keep the panned position too', type: 'checkbox', value: p.keepPosition, half: true },
        { key: 'wrap', label: 'Wrap around at the ends of the folder', type: 'checkbox', value: p.wrap, half: true },
        { key: 'autoRotateExif', label: 'Auto-rotate by EXIF orientation', type: 'checkbox', value: p.autoRotateExif, half: true },
        { key: 'smoothZoom', label: 'Smooth pixels when zoomed in (off: see each pixel)', type: 'checkbox', value: p.smoothZoom, half: true },
        { key: 'pixelInfo', label: 'Pixel position and color in the status bar', type: 'checkbox', value: p.pixelInfo, half: true },
        { key: 'prefetch', label: 'Pictures decoded ahead (each direction)', type: 'number', min: 0, max: 8, value: p.prefetch, half: true },
        { key: 'alphaDisplay', label: 'Transparent pixels show', type: 'select', options: [{ value: 'checkerboard', label: 'Checkerboard' }, { value: 'white', label: 'White' }, { value: 'black', label: 'Black' }, { value: 'custom', label: 'A color…' }], value: p.alphaDisplay, half: true },
        { key: 'alphaColor', label: 'Transparency color', type: 'color', value: p.alphaColor, half: true, visibleIf: (v) => v.alphaDisplay === 'custom' },
        { key: 'background', label: 'Window background (empty: theme)', type: 'text', value: p.background, half: true, placeholder: '#202020' },
        { key: 'fullScreenBackground', label: 'Full-screen background', type: 'color', value: p.fullScreenBackground, half: true },
        { key: 'h2', type: 'heading', label: 'Folder' },
        { key: 'sort', label: 'Sort pictures by', type: 'select', options: [{ value: 'natural', label: 'Name (natural: 2 before 10)' }, { value: 'name', label: 'Name (plain)' }, { value: 'date', label: 'File date' }, { value: 'size', label: 'Size' }, { value: 'type', label: 'Type' }], value: p.sort, half: true },
        { key: 'sortDescending', label: 'Descending', type: 'checkbox', value: p.sortDescending, half: true },
        { key: 'h3', type: 'heading', label: 'Interface' },
        { key: 'theme', label: 'Theme', type: 'select', options: [{ value: 'system', label: 'Follow the system' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'black', label: 'Black (OLED)' }], value: p.theme, half: true },
        { key: 'uiScale', label: 'Toolbar size', type: 'select', options: [{ value: '0.85', label: 'Compact' }, { value: '1', label: 'Normal' }, { value: '1.15', label: 'Large (touch)' }], value: String(p.uiScale), half: true },
        { key: 'menuStyle', label: 'Menus', type: 'select', options: [{ value: 'ribbon', label: 'Ribbon' }, { value: 'classic', label: 'Classic menu bar' }, { value: 'both', label: 'Both' }], value: p.menuStyle, half: true },
        { key: 'menuLayout', label: 'Classic menu layout', type: 'select', options: Object.entries(CLASSIC_LAYOUT_NAMES).map(([value, label]) => ({ value, label })), value: p.menuLayout, half: true },
        { key: 'qatPosition', label: 'Quick Access Bar', type: 'select', options: [{ value: 'top', label: 'Above the ribbon' }, { value: 'below', label: 'Below the ribbon (the classic toolbar place)' }, { value: 'bottom', label: 'At the bottom (near keyboard)' }], value: p.qatPosition, half: true },
        { key: 'qatLabels', label: 'Show labels on Quick Access Bar', type: 'checkbox', value: p.qatLabels, half: true },
        { key: 'statusBar', label: 'Status bar', type: 'checkbox', value: p.statusBar, half: true },
        { key: 'escExits', label: 'Esc closes the app (IrfanView habit; desktop)', type: 'checkbox', value: p.escExits, half: true },
        { key: 'confirmClose', label: 'Ask to save when leaving an edited picture', type: 'checkbox', value: p.confirmClose, half: true },
        { key: 'h4', type: 'heading', label: 'Saving' },
        { key: 'jpegQuality', label: 'JPEG / WebP quality', type: 'range', min: 1, max: 100, value: p.jpegQuality, half: true },
        { key: 'defaultSaveFormat', label: 'Default Save As format', type: 'select', options: SAVE_OPTIONS, value: p.defaultSaveFormat, half: true },
        { key: 'h5', type: 'heading', label: 'Customize' },
        { key: 'bq', type: 'button', label: 'Customize Quick Access Bar…', onClick: () => app.exec('file.customizeQat') },
        { key: 'br', type: 'button', label: 'Customize Tabs (Ribbon)…', onClick: () => app.exec('file.customizeRibbon') },
        { key: 'bk', type: 'button', label: 'Customize Keyboard…', onClick: () => app.exec('file.customizeKeyboard') },
        { key: 'bx', type: 'button', label: 'Export / Import Settings…', onClick: () => app.exec('file.exportSettings') },
        ...(isDesktop() ? [{ key: 'bp', type: 'button' as const, label: 'Portable Mode…', onClick: () => app.exec('file.portableMode') }] : []),
      ] });
      if (!r) return;
      Object.assign(p, {
        zoomMode: r.zoomMode, wheel: r.wheel, zoomLock: r.zoomLock, keepPosition: r.keepPosition, wrap: r.wrap, autoRotateExif: r.autoRotateExif, smoothZoom: r.smoothZoom, pixelInfo: r.pixelInfo, prefetch: Math.max(0, Math.min(8, +r.prefetch || 0)),
        alphaDisplay: r.alphaDisplay, alphaColor: r.alphaColor, background: String(r.background || '').trim(), fullScreenBackground: r.fullScreenBackground,
        sort: r.sort, sortDescending: r.sortDescending,
        theme: r.theme, uiScale: parseFloat(r.uiScale), menuStyle: r.menuStyle, menuLayout: r.menuLayout, qatPosition: r.qatPosition, qatLabels: r.qatLabels, statusBar: r.statusBar, escExits: r.escExits, confirmClose: r.confirmClose,
        jpegQuality: +r.jpegQuality || 90, defaultSaveFormat: r.defaultSaveFormat,
      } satisfies Partial<Prefs>);
      app.savePrefs();
      app.ui.applyPrefs();
      for (const d of app.tabs) { d.ui.layout(); d.ui.draw(); }
      app.folder.sort(p.sort, p.sortDescending);
      app.refresh();
    },
  },
  { id: 'file.customizeQat', icon: 'tune', popular: true, noRecord: true, run: (app) => app.ui.customizeQat() },
  { id: 'file.customizeRibbon', icon: 'view_quilt', noRecord: true, run: (app) => app.ui.customizeRibbon() },
  { id: 'file.customizeKeyboard', icon: 'keyboard', noRecord: true, run: (app) => app.ui.customizeKeyboard() },
  {
    id: 'file.exportSettings', icon: 'import_export', noRecord: true,
    tip: 'One JSON text for every setting, shared with the sister apps; or an IrfanView-style key list',
    run: async (app) => {
      const r = await openDialog({ title: 'Settings Transfer', wide: true, help: 'Copy this text to back up your Quick Access Bar, custom tabs, shortcuts, macros and preferences. Paste settings text here and choose Import to restore. The format is shared with the other Anne\'s Office apps; settings that do not apply to Anne\'s Lens are ignored. An IrfanView-style key list (lines such as "Rotate left=L" or "view.next=Space") can be pasted instead.', fields: [{ key: 'json', label: 'Settings (JSON) or key list', type: 'textarea', rows: 12, value: JSON.stringify({ ...app.prefs, recent: [], recentFolders: [] }, null, 1) }], ok: 'Import', buttons: [{ label: 'Copy', onClick: (x) => { navigator.clipboard?.writeText(x.json); toast('Copied'); } }] });
      if (!r) return;
      const text = String(r.json || '').trim();
      let p: unknown = null;
      try { p = JSON.parse(text); } catch { /* maybe a key list */ }
      if (!p || typeof p !== 'object' || Array.isArray(p)) {
        const ids = new Set(allCommands().map((c) => c.id));
        const { keymap, unknown } = parseKeyList(text, ids);
        const n = Object.keys(keymap).length;
        if (!n) { toast(unknown.length ? `No usable lines; first unknown: ${unknown[0]}` : 'That is neither settings JSON nor a key list.'); return; }
        app.prefs.keymap = { ...app.prefs.keymap, ...keymap };
        app.savePrefs(); app.ui.rebuild();
        toast(`${n} shortcut(s) imported${unknown.length ? `; ${unknown.length} line(s) not understood` : ''}`);
        return;
      }
      const before = JSON.parse(JSON.stringify(app.prefs));
      Object.assign(app.prefs, sanitizePrefs(p), { recent: app.prefs.recent, recentFolders: app.prefs.recentFolders });
      try { app.ui.applyPrefs(); app.ui.rebuild(); } catch (e: any) {
        Object.assign(app.prefs, before); app.ui.applyPrefs(); app.ui.rebuild();
        toast(`These settings could not be applied: ${e?.message || e}`);
        return;
      }
      app.savePrefs();
      toast('Settings imported');
    },
  },
  {
    id: 'file.portableMode', icon: 'usb', kind: 'toggle', noRecord: true,
    tip: 'Keep settings in a folder beside the program instead of the user profile (desktop)',
    isActive: () => !!(window as any).__qlPortable,
    run: async (app) => {
      const d = desktopBridge();
      if (!d) { toast('Portable mode applies to the Windows, macOS and Linux apps: settings then live in a QuillLens-portable folder beside the program.'); return; }
      const st = await d.getPortableMode();
      (window as any).__qlPortable = st.on;
      if (!st.available) { toast(`The folder beside the program is not writable (${st.dir}); portable mode is not available here.`); return; }
      const r = await openDialog({ title: 'Portable Mode', fields: [{ key: 'i', type: 'info', html: `<p>Portable mode keeps every setting (preferences, Quick Access Bar, keys, macros, recent lists) in <code>${st.dir}</code>, so Anne's Lens can run from a USB stick or a folder you carry along.</p><p>It is currently <b>${st.on ? 'on' : 'off'}</b>. Turning it ${st.on ? 'off' : 'on'} copies the current settings and restarts the app.</p>` }], ok: st.on ? 'Turn Off and Restart' : 'Turn On and Restart' });
      if (!r) return;
      const res = await d.setPortableMode({ on: !st.on });
      if (!res.ok) { toast(res.error || 'Could not change portable mode.'); return; }
      await d.relaunch();
      void app;
    },
  },
  { id: 'file.resetCustomizations', icon: 'restart_alt', noRecord: true, run: async (app) => { if (!(await confirmDialog('Reset', 'Reset the Quick Access Bar, custom tabs, menus and keyboard shortcuts to defaults?'))) return; app.prefs.qat = [...DEFAULT_QAT]; app.prefs.customTabs = []; app.prefs.hiddenTabs = []; app.prefs.tabOrder = []; app.prefs.keymap = {}; app.prefs.menuLayout = 'irfanview'; app.prefs.menuStyle = 'both'; app.savePrefs(); app.ui.applyPrefs(); app.ui.rebuild(); } },
]);

export { FORMATS, getCommand, fmtSize };
