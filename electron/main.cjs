// Anne's Lens desktop app (Windows, macOS, Linux, Raspberry Pi OS): Electron main process.
//
// The web build (dist/) is served from the privileged app:// scheme so module workers, fetch and
// IndexedDB behave as on the web. The renderer is sandboxed with context isolation and no Node;
// electron/preload.cjs exposes `window.quillDesktop`, the same interface as the Android plugin plus
// what a file system allows: listing the folder of an opened picture (next/previous), opening a
// folder, Show in Folder, Open With, window placement and portable mode.
// File access is limited to files the user opened or saved through a dialog, opened the app with, or
// that sit in a folder the user opened, so picture content cannot use the bridge to read arbitrary files.
'use strict';
const { app, BrowserWindow, protocol, net, ipcMain, dialog, shell, clipboard, powerSaveBlocker, Menu, session, desktopCapturer } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL, fileURLToPath } = require('node:url');

// Portable mode: a QuillLens-portable folder beside the program (or beside the portable .exe) holds the
// user data instead of the profile. docs: File ▸ Portable Mode.
const PORTABLE_NAME = 'QuillLens-portable';
const exeDir = process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath);
const portableDir = path.join(exeDir, PORTABLE_NAME);
const portableOn = fs.existsSync(portableDir) && fs.statSync(portableDir).isDirectory();
if (portableOn) app.setPath('userData', portableDir);
else app.setPath('userData', path.join(app.getPath('appData'), 'QuillLens'));
app.setPath('sessionData', app.getPath('userData'));

const DIST = path.join(__dirname, '..', 'dist');
const SCHEME = 'app';
const ORIGIN = `${SCHEME}://quilllens`;
const OPENABLE = ['jpg', 'jpeg', 'jpe', 'jfif', 'png', 'apng', 'gif', 'webp', 'avif', 'heic', 'heif', 'hif', 'bmp', 'dib', 'rle', 'ico', 'cur', 'tif', 'tiff', 'svg', 'svgz', 'jxl', 'psd', 'psb', 'tga', 'tpic', 'icb', 'vda', 'vst',
  'pnm', 'ppm', 'pgm', 'pbm', 'pam', 'pfm', 'qoi', 'pcx', 'dcx', 'xpm', 'xbm', 'wbmp', 'icns', 'dds', 'hdr', 'pic', 'rgbe',
  'cr2', 'cr3', 'crw', 'nef', 'nrw', 'arw', 'srf', 'sr2', 'raf', 'orf', 'rw2', 'rwl', 'pef', 'dng', '3fr', 'fff', 'iiq', 'x3f', 'srw', 'mrw', 'erf', 'mef', 'mos', 'kdc', 'dcr', 'raw', 'eps', 'epsf', 'ai', 'zip', 'cbz'];
const MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', jpe: 'image/jpeg', jfif: 'image/jpeg', png: 'image/png', apng: 'image/apng', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', heic: 'image/heic', heif: 'image/heif', hif: 'image/heif',
  bmp: 'image/bmp', dib: 'image/bmp', rle: 'image/bmp', ico: 'image/x-icon', cur: 'image/x-icon', tif: 'image/tiff', tiff: 'image/tiff', svg: 'image/svg+xml', svgz: 'image/svg+xml', jxl: 'image/jxl', psd: 'image/vnd.adobe.photoshop', psb: 'image/vnd.adobe.photoshop', tga: 'image/x-tga',
  pnm: 'image/x-portable-anymap', ppm: 'image/x-portable-pixmap', pgm: 'image/x-portable-graymap', pbm: 'image/x-portable-bitmap', pam: 'image/x-portable-anymap', pfm: 'image/x-portable-floatmap', qoi: 'image/qoi', pcx: 'image/x-pcx', dcx: 'image/x-pcx',
  xpm: 'image/x-xpixmap', xbm: 'image/x-xbitmap', wbmp: 'image/vnd.wap.wbmp', icns: 'image/icns', dds: 'image/vnd-ms.dds', hdr: 'image/vnd.radiance', pic: 'image/vnd.radiance', rgbe: 'image/vnd.radiance', dng: 'image/x-adobe-dng', eps: 'application/postscript', epsf: 'application/postscript', ai: 'application/postscript', zip: 'application/zip', cbz: 'application/vnd.comicbook+zip',
};

protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

if (!app.requestSingleInstanceLock()) app.quit();

/** @type {BrowserWindow | null} */
let win = null;
/** Files opened before the page could receive them. Flushed when the page registers its fileOpened listener. */
const pendingFiles = [];
let rendererReady = false;
let wakeId = -1;

// ------------------------------------------------------------------------------------------
// Files and folders the renderer may read

const grantsFile = () => path.join(app.getPath('userData'), 'granted-files.json');
let grants = new Set();
/** Folders opened through a dialog or by opening a picture: every picture in them may be read. */
const grantedDirs = new Set();
function loadGrants() {
  try { grants = new Set(JSON.parse(fs.readFileSync(grantsFile(), 'utf8'))); } catch { grants = new Set(); }
}
function grant(p) {
  grants.add(path.resolve(p));
  const list = [...grants].slice(-400);
  grants = new Set(list);
  try { fs.writeFileSync(grantsFile(), JSON.stringify(list)); } catch { /* read-only profile */ }
}
function grantDir(dir) { grantedDirs.add(path.resolve(dir)); }
function grantedPath(uri, write = false) {
  if (typeof uri !== 'string' || !uri.startsWith('file:')) throw new Error('Not a file address');
  const p = path.resolve(fileURLToPath(uri));
  if (grants.has(p)) return p;
  if (!write && grantedDirs.has(path.dirname(p)) && isPictureName(p)) return p;
  throw new Error('Anne\'s Lens has no permission for this file; open it again.');
}
const isPictureName = (p) => OPENABLE.includes(path.extname(p).slice(1).toLowerCase());

function fileResult(p) {
  const data = fs.readFileSync(p);
  const st = fs.statSync(p);
  const ext = path.extname(p).slice(1).toLowerCase();
  return { uri: pathToFileURL(p).href, name: path.basename(p), mime: MIME[ext] || 'application/octet-stream', data: data.toString('base64'), size: st.size, mtime: st.mtimeMs };
}
/** The picture files in a folder, natural-sorted, as {uri, name, size, mtime}. */
function listDir(dir) {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith('.') || !isPictureName(name)) continue;
    const p = path.join(dir, name);
    try { const st = fs.statSync(p); if (st.isFile()) out.push({ uri: pathToFileURL(p).href, name, size: st.size, mtime: st.mtimeMs }); } catch { /* */ }
  }
  out.sort((a, b) => collator.compare(a.name, b.name));
  return out;
}
function filesFromArgs(argv) {
  const out = [];
  for (const a of argv.slice(1)) {
    if (!a || a.startsWith('-')) continue;
    try { if (fs.statSync(a).isFile() && (isPictureName(a) || !path.extname(a))) out.push(path.resolve(a)); else if (fs.statSync(a).isDirectory()) { for (const e of listDir(a)) out.push(fileURLToPath(e.uri)); } } catch { /* not a file */ }
  }
  return out;
}
function openExternalFiles(paths) {
  if (!paths.length) return;
  for (const p of paths) { grant(p); grantDir(path.dirname(p)); }
  if (win && rendererReady) win.webContents.send('ql:fileOpened', { files: paths.map(fileResult) });
  else pendingFiles.push(...paths);
  if (!win && app.isReady()) createWindow();
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
}
function flushPendingFiles() {
  if (win && rendererReady && pendingFiles.length) { const list = pendingFiles.splice(0); win.webContents.send('ql:fileOpened', { files: list.map(fileResult) }); }
}

// ------------------------------------------------------------------------------------------
// IPC

const safeUrl = (u) => typeof u === 'string' && /^(https?|mailto|tel|ftp|sms|geo):/i.test(u.trim());
function handle(name, fn) {
  ipcMain.handle('ql:' + name, async (e, opts) => {
    if (!win || e.sender !== win.webContents || !e.senderFrame || !e.senderFrame.url.startsWith(ORIGIN)) throw new Error('Refused');
    return fn(opts || {});
  });
}

function registerIpc() {
  handle('openDocument', async ({ multiple }) => {
    const r = await dialog.showOpenDialog(win, {
      properties: multiple ? ['openFile', 'multiSelections'] : ['openFile'],
      filters: [{ name: 'Pictures', extensions: OPENABLE }, { name: 'All files', extensions: ['*'] }],
    });
    if (r.canceled || !r.filePaths[0]) return { canceled: true };
    for (const p of r.filePaths) { grant(p); grantDir(path.dirname(p)); }
    if (r.filePaths.length > 1) return { files: r.filePaths.map(fileResult) };
    return fileResult(r.filePaths[0]);
  });
  handle('openFolder', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return { canceled: true };
    const dir = r.filePaths[0];
    grantDir(dir);
    return { uri: pathToFileURL(dir).href, name: path.basename(dir) || dir, entries: listDir(dir) };
  });
  handle('listFolder', async ({ uri }) => {
    if (typeof uri !== 'string' || !uri.startsWith('file:')) throw new Error('Not a file address');
    let p = path.resolve(fileURLToPath(uri));
    let dir = p;
    try { if (!fs.statSync(p).isDirectory()) dir = path.dirname(p); } catch { dir = path.dirname(p); }
    if (!grantedDirs.has(dir) && !grants.has(p)) throw new Error('Anne\'s Lens has no permission for this folder; open a picture in it first.');
    grantDir(dir);
    return { uri: pathToFileURL(dir).href, name: path.basename(dir) || dir, entries: listDir(dir) };
  });
  handle('saveAs', async ({ name, data }) => {
    const ext = path.extname(String(name || '')).slice(1);
    const r = await dialog.showSaveDialog(win, {
      defaultPath: path.join(app.getPath('pictures'), path.basename(String(name || 'picture'))),
      filters: ext ? [{ name: ext.toUpperCase(), extensions: [ext] }, { name: 'All files', extensions: ['*'] }] : undefined,
    });
    if (r.canceled || !r.filePath) return { canceled: true };
    fs.writeFileSync(r.filePath, Buffer.from(String(data || ''), 'base64'));
    grant(r.filePath); grantDir(path.dirname(r.filePath));
    return { uri: pathToFileURL(r.filePath).href, name: path.basename(r.filePath) };
  });
  handle('writeUri', async ({ uri, data }) => {
    const p = grantedPath(uri, true);
    const tmp = p + '.ql-saving';
    fs.writeFileSync(tmp, Buffer.from(String(data || ''), 'base64'));
    fs.renameSync(tmp, p);
    return { ok: true };
  });
  handle('readUri', async ({ uri }) => fileResult(grantedPath(uri)));
  handle('print', async () => new Promise((res) => win.webContents.print({}, () => res())));
  handle('share', async ({ name, data }) => {
    // Desktops have no share sheet: offer Save As.
    const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('pictures'), path.basename(String(name || 'picture'))) });
    if (!r.canceled && r.filePath) { fs.writeFileSync(r.filePath, Buffer.from(String(data || ''), 'base64')); grant(r.filePath); }
  });
  handle('getLaunchFile', async () => {
    const list = pendingFiles.splice(0);
    if (!list.length) return {};
    const files = list.map(fileResult);
    return { ...files[0], files };
  });
  ipcMain.on('ql:fileListenerReady', (e) => { if (win && e.sender === win.webContents) { rendererReady = true; flushPendingFiles(); } });
  handle('keepAwake', async ({ on }) => {
    if (on && wakeId < 0) wakeId = powerSaveBlocker.start('prevent-display-sleep');
    if (!on && wakeId >= 0) { powerSaveBlocker.stop(wakeId); wakeId = -1; }
  });
  handle('readClipboard', async () => ({ text: clipboard.readText() }));
  handle('writeClipboard', async ({ text }) => { clipboard.writeText(String(text ?? '')); });
  handle('openExternal', async ({ url }) => { if (safeUrl(url)) await shell.openExternal(url); });
  handle('revealInFolder', async ({ uri }) => { shell.showItemInFolder(grantedPath(uri)); });
  handle('openWith', async ({ uri }) => { const err = await shell.openPath(grantedPath(uri)); return err ? { ok: false, error: err } : { ok: true }; });
  handle('setAlwaysOnTop', async ({ on }) => { if (win) win.setAlwaysOnTop(!!on); });
  handle('minimize', async () => { if (win) win.minimize(); });
  handle('fitWindow', async ({ width, height }) => {
    if (!win) return;
    const { screen } = require('electron');
    const area = screen.getDisplayMatching(win.getBounds()).workArea;
    win.setContentSize(Math.max(360, Math.min(area.width, Math.round(width))), Math.max(300, Math.min(area.height, Math.round(height))));
  });
  handle('getArgs', async () => ({ args: process.argv.slice(1) }));

  // File operations (M2). Every source must be a granted file; every destination a granted folder.
  const grantedDir = (uri) => {
    if (typeof uri !== 'string' || !uri.startsWith('file:')) throw new Error('Not a folder address');
    const dir = path.resolve(fileURLToPath(uri));
    if (!grantedDirs.has(dir)) throw new Error('Anne\'s Lens has no permission for this folder; choose it again.');
    return dir;
  };
  const safeName = (name) => { const n = path.basename(String(name || '')).trim(); if (!n || n === '.' || n === '..' || /[\\/:*?"<>|\0]/.test(n)) throw new Error('That is not a valid file name.'); return n; };
  const freeName = (dir, name, allowSame) => {
    if (allowSame || !fs.existsSync(path.join(dir, name))) return name;
    const ext = path.extname(name), base = name.slice(0, name.length - ext.length);
    for (let i = 2; i < 10000; i++) { const n = `${base} (${i})${ext}`; if (!fs.existsSync(path.join(dir, n))) return n; }
    throw new Error('No free file name');
  };
  const done = (p) => { grant(p); grantDir(path.dirname(p)); return { uri: pathToFileURL(p).href, name: path.basename(p) }; };
  handle('renameDocument', async ({ uri, name }) => {
    const p = grantedPath(uri, true);
    const target = path.join(path.dirname(p), safeName(name));
    if (target !== p && fs.existsSync(target) && target.toLowerCase() !== p.toLowerCase()) throw new Error(`A file named "${path.basename(target)}" already exists.`);
    fs.renameSync(p, target);
    return done(target);
  });
  handle('deleteDocument', async ({ uri, permanent }) => {
    const p = grantedPath(uri, true);
    if (permanent) { fs.unlinkSync(p); return { ok: true, trashed: false }; }
    try { await shell.trashItem(p); return { ok: true, trashed: true }; }
    catch (e) { throw new Error(`Could not move the file to the ${process.platform === 'win32' ? 'Recycle Bin' : 'Trash'}: ${e && e.message ? e.message : e}`); }
  });
  handle('pickFolder', async ({ title }) => {
    const r = await dialog.showOpenDialog(win, { title: String(title || 'Choose a folder'), properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return { canceled: true };
    const dir = r.filePaths[0];
    grantDir(dir);
    return { uri: pathToFileURL(dir).href, name: path.basename(dir) || dir };
  });
  const transfer = (move) => async ({ uri, dirUri, name }) => {
    const p = grantedPath(uri, true);
    const dir = grantedDir(dirUri);
    const target = path.join(dir, freeName(dir, safeName(name || path.basename(p)), false));
    if (move) { try { fs.renameSync(p, target); } catch { fs.copyFileSync(p, target, fs.constants.COPYFILE_EXCL); fs.unlinkSync(p); } }
    else fs.copyFileSync(p, target, fs.constants.COPYFILE_EXCL);
    return done(target);
  };
  handle('moveFile', transfer(true));
  handle('copyFile', transfer(false));
  handle('createInFolder', async ({ dirUri, name, data }) => {
    const dir = grantedDir(dirUri);
    const target = path.join(dir, safeName(name));
    fs.writeFileSync(target, Buffer.from(String(data || ''), 'base64'));
    return done(target);
  });
  // Open URL: fetched here so picture hosts need no CORS headers; the renderer gets bytes and a name.
  handle('fetchUrl', async ({ url }) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) throw new Error('Only http(s) addresses can be opened');
    const res = await net.fetch(url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`The server answered ${res.status} ${res.statusText}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 256 * 1024 * 1024) throw new Error('The file is larger than 256 MB');
    let name = '';
    const cd = res.headers.get('content-disposition') || '';
    const m = cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
    if (m) { try { name = decodeURIComponent(m[1]); } catch { name = m[1]; } }
    if (!name) { try { name = decodeURIComponent(new URL(url).pathname.split('/').pop() || ''); } catch { /* */ } }
    return { name: name || 'picture', mime: res.headers.get('content-type') || 'application/octet-stream', data: buf.toString('base64') };
  });
  handle('setFileTime', async ({ uri, mtime }) => {
    const p = grantedPath(uri, true);
    const t = new Date(Number(mtime));
    if (Number.isNaN(t.getTime())) throw new Error('Bad time');
    fs.utimesSync(p, t, t);
    return { ok: true };
  });
  handle('getPortableMode', async () => {
    let available = true;
    try { fs.accessSync(exeDir, fs.constants.W_OK); } catch { available = false; }
    return { on: portableOn, dir: portableDir, available };
  });
  handle('setPortableMode', async ({ on }) => {
    try {
      if (on && !portableOn) {
        fs.mkdirSync(portableDir, { recursive: true });
        // Carry the current settings along: the Chromium profile holds localStorage and IndexedDB.
        fs.cpSync(app.getPath('userData'), portableDir, { recursive: true, force: true, filter: (src) => !/[\\/](Cache|Code Cache|GPUCache|DawnCache|logs)([\\/]|$)/.test(src) });
      } else if (!on && portableOn) {
        const profile = path.join(app.getPath('appData'), 'QuillLens');
        fs.mkdirSync(profile, { recursive: true });
        fs.cpSync(portableDir, profile, { recursive: true, force: true, filter: (src) => !/[\\/](Cache|Code Cache|GPUCache|DawnCache|logs)([\\/]|$)/.test(src) });
        fs.renameSync(portableDir, portableDir + '.off');
      }
      return { ok: true };
    } catch (e) { return { ok: false, error: e && e.message ? e.message : String(e) }; }
  });
  handle('relaunch', async () => { app.relaunch(); app.exit(0); });
}

// ------------------------------------------------------------------------------------------
// Window

// Content Security Policy for the app. 'unsafe-eval' stays off until macros can run scripts; wasm is for
// future codec modules; http to localhost is for AI servers (M7).
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' blob:",
  "worker-src 'self' blob:",
  "connect-src 'self' https: http://localhost:* http://127.0.0.1:* data: blob:",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-src 'none'",
].join('; ');

// Screen Capture: getDisplayMedia in the renderer is answered with the primary screen (or a window by name).
function setupDisplayMedia() {
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } }).then((sources) => {
      const want = String(request.frame && request.frame.url && new URL(request.frame.url).searchParams.get('capture') || '');
      const pick = (want && sources.find((s) => s.id === want)) || sources.find((s) => s.id.startsWith('screen')) || sources[0];
      if (!pick) { callback({}); return; }
      callback({ video: pick });
    }).catch(() => callback({}));
  }, { useSystemPicker: true });
}

function serveApp() {
  protocol.handle(SCHEME, async (req) => {
    const u = new URL(req.url);
    const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.resolve(DIST, rel);
    if (!file.startsWith(DIST + path.sep) && file !== DIST) return new Response('Forbidden', { status: 403 });
    const target = fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(DIST, 'index.html');
    const res = await net.fetch(pathToFileURL(target).href);
    const headers = new Headers(res.headers);
    headers.set('Content-Security-Policy', CSP);
    return new Response(res.body, { status: res.status, headers });
  });
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }, ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' }])] },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 360,
    minHeight: 480,
    title: 'Anne\'s Lens',
    backgroundColor: '#3a3f4a',
    autoHideMenuBar: process.platform !== 'darwin',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (safeUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(ORIGIN)) { e.preventDefault(); if (safeUrl(url)) void shell.openExternal(url); } });
  win.webContents.on('will-prevent-unload', (e) => {
    const choice = dialog.showMessageBoxSync(win, { type: 'question', buttons: ['Close without saving', 'Cancel'], defaultId: 1, cancelId: 1, title: 'Unsaved changes', message: 'Some pictures have unsaved changes. Close Anne\'s Lens anyway?' });
    if (choice === 0) e.preventDefault();
  });
  win.webContents.on('did-start-loading', () => { rendererReady = false; });
  win.on('closed', () => { win = null; rendererReady = false; });
  void win.loadURL(`${ORIGIN}/index.html`);
}

app.on('second-instance', (_e, argv) => {
  const files = filesFromArgs(argv);
  if (files.length) openExternalFiles(files);
  else if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});
// macOS: files opened from Finder (before or after launch).
app.on('open-file', (e, p) => { e.preventDefault(); if (app.isReady()) openExternalFiles([p]); else pendingFiles.push(p); });

app.whenReady().then(() => {
  loadGrants();
  const files = filesFromArgs(process.argv);
  pendingFiles.unshift(...files);
  for (const f of pendingFiles) { grant(f); grantDir(path.dirname(f)); }
  serveApp();
  registerIpc();
  try { setupDisplayMedia(); } catch (e) { console.warn('display media handler', e); }
  buildMenu();
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
