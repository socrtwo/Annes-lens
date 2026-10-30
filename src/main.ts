/** Anne's Lens entry point. */
import 'material-symbols/outlined.css';
import './styles/app.css';
import './styles/lens.css';
import './ui/scrollcue.css';
import './commands';
import { App } from './app';
import { Shell } from './ui/shell';
import { launchFiles, onFilesOpened, onBackButton, isNative, isDesktop, isCapacitor, desktopBridge, type OpenedFile } from './platform/native';
import { closeMenus, inDialog } from './ui/dialog';
import { allCommands, getCommand } from './commands/registry';
import { installScrollCues } from './ui/scrollcue';
import { openFiles, openDroppedFiles } from './commands/file';
import { pasteAsNew } from './commands/edit';

const host = document.getElementById('app')!;

installScrollCues({
  selector: ['.ql-menu', '.ql-dialog-body', '.ql-cmdlist', '.ql-listbox', '.ql-bs-nav', '.ql-bs-body', '.ql-palette-list', '.ql-notices'].join(', '),
});

const app = new App(host);
app.ui = new Shell(app);
app.rebuildKeyIndex();
app.createTab();
app.ui.tabsChanged();
(window as any).qn = app;
(window as any).__qnAllIds = allCommands().map((c) => c.id);
(window as any).__qnGetCommand = getCommand;
(window as any).__qnCodecs = () => import('./codecs/registry');
(window as any).__qnLossless = () => import('./codecs/jpegLossless');
(window as any).__qnPalette = () => import('./codecs/palette');
(window as any).__qnImageOps = () => import('./commands/imageOps');
(window as any).__qnBatch = () => Promise.all([import('./commands/batch'), import('./picture/batch')]).then(([c, p]) => ({ ...c, ...p }));
(window as any).__qnBatchSteps = () => import('./commands/batchSteps');
(window as any).__qnEffects = () => import('./picture/effects');
(window as any).__qnSimilar = () => import('./picture/similar');
(window as any).__qnAnim = () => Promise.all([import('./codecs/pngenc'), import('./codecs/tiffwrite'), import('./commands/pagesEdit')]).then(([a, t, pe]) => ({ ...a, ...t, ...pe }));
(window as any).__qnSeam = () => Promise.all([import('./picture/seam'), import('./codecs/palette')]).then(([s, p]) => ({ ...s, ...p }));
(window as any).__qnMask = () => import('./picture/mask');
(window as any).__qnMerge = () => Promise.all([import('./picture/merge'), import('./commands/create2')]).then(([m, c]) => ({ ...m, ...c }));
(window as any).__qnFolderInfo = () => import('./picture/folderInfo');
(window as any).__qnTools = () => Promise.all([import('./codecs/qr'), import('./codecs/carve'), import('./codecs/encrypt'), import('./commands/tools')]).then(([q, c, e, t]) => ({ ...q, ...c, ...e, ...t }));
(window as any).__qnShow = () => import('./picture/slideshow');
(window as any).__qnOverlays = () => import('./ui/overlays');
(window as any).__qnNative = () => import('./platform/native');
(window as any).__qnMeta = () => Promise.all([import('./picture/metadata'), import('./meta/xmp'), import('./meta/metaEdit'), import('./meta/iptc'), import('./meta/metaWrite')]).then(([m, x, e, i, w]) => ({ ...m, ...x, ...e, ...i, ...w }));

// Files dropped on the window open as a folder of their own.
window.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); });
window.addEventListener('drop', (e) => {
  const files = [...(e.dataTransfer?.files || [])];
  if (!files.length) return;
  e.preventDefault();
  void openDroppedFiles(app, files);
});
// Ctrl+V with a picture on the clipboard (browsers allow reading it from the paste event).
document.addEventListener('paste', (e) => {
  const t = e.target as HTMLElement;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
  const file = item?.getAsFile();
  if (file) { e.preventDefault(); void pasteAsNew(app, file); }
});
document.addEventListener('ql-layout', () => { for (const t of app.tabs) t.ui.layout(); });

async function start() {
  let ready = false;
  const queued: OpenedFile[] = [];
  onFilesOpened((fs) => { if (ready) void openFiles(app, fs); else queued.push(...fs); });
  const lf = await launchFiles();
  if (lf.length) await openFiles(app, lf);
  const openedAny = lf.length > 0 || queued.length > 0;
  if (queued.length) await openFiles(app, queued.splice(0));
  ready = true;
  // PWA file handling ("Open with" from the operating system's file manager).
  const lq = (window as any).launchQueue;
  if (lq?.setConsumer) lq.setConsumer(async (params: any) => { const files: File[] = []; for (const hnd of params.files || []) { try { files.push(await hnd.getFile()); } catch { /* */ } } if (files.length) void openDroppedFiles(app, files); });
  if (isDesktop()) { try { const st = await desktopBridge()!.getPortableMode(); (window as any).__qlPortable = st.on; } catch { /* */ } }
  if (app.prefs.firstRun && !openedAny) setTimeout(() => app.ui.tour(), 600);
  app.focus();
}
void start();

if (!isNative() && !isCapacitor() && 'serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !import.meta.env.DEV) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => undefined); });
}

onBackButton(() => {
  if (document.querySelector('.ql-menu')) { closeMenus(); return true; }
  if (inDialog()) { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); return true; }
  if (host.classList.contains('ql-backstage-open')) { app.ui.hideBackstage(); return true; }
  if (document.body.classList.contains('ql-fullscreen')) { app.exec('view.fullScreen'); return true; }
  return false;
});

window.addEventListener('beforeunload', (e) => {
  if ((!isNative() || isDesktop()) && app.tabs.some((d) => d.dirty)) { e.preventDefault(); e.returnValue = ''; }
});
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => app.ui.applyPrefs());
