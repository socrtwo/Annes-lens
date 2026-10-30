/** View commands: zoom, navigation, full screen, menus and interface, inspect, display, Quick Access Bar. */
import { def, getCommand } from './registry';
import type { App } from '../app';
import { openDialog, toast } from '../ui/dialog';
import { addAllQatChoices, type ZoomMode, type MenuStyle } from '../prefs';
import { CLASSIC_LAYOUT_NAMES, CLASSIC_LAYOUT_MODELS } from '../ui/classicMenus';
import { keepAwake, desktopBridge, isDesktop } from '../platform/native';

const zoomCmd = (id: string, icon: string, mode: ZoomMode) => ({
  id, icon, kind: 'toggle' as const, noRecord: true,
  isActive: (app: App) => app.viewer?.mode === mode, isEnabled: (app: App) => !!app.picture,
  run: (app: App) => app.viewer.setZoom(mode),
});

function nav(app: App, d: number): void {
  const f = app.folder;
  if (!f.length) { toast('Open a picture or a folder first.'); return; }
  if (!f.step(d, app.prefs.wrap)) { app.viewer.flash(d > 0 ? 'Last picture' : 'First picture'); return; }
  void app.tab.show();
  if (document.fullscreenElement || document.body.classList.contains('ql-fullscreen')) app.viewer.flash(`${f.index + 1} / ${f.length}  ${f.current?.name || ''}`);
}

export function fullScreen(app: App, on: boolean): void {
  document.body.classList.toggle('ql-fullscreen', on);
  try { if (on) void document.documentElement.requestFullscreen?.(); else if (document.fullscreenElement) void document.exitFullscreen(); } catch { /* not allowed */ }
  void keepAwake(on);
  requestAnimationFrame(() => { for (const t of app.tabs) t.ui.layout(); });
  app.refresh();
}
if (typeof document !== 'undefined') document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && document.body.classList.contains('ql-fullscreen')) { document.body.classList.remove('ql-fullscreen'); void keepAwake(false); document.dispatchEvent(new CustomEvent('ql-layout')); } });

def([
  { id: 'view.zoomIn', icon: 'zoom_in', noRecord: true, isEnabled: (app) => !!app.picture, run: (app) => app.viewer.setZoom(app.viewer.zoom * 1.25) },
  { id: 'view.zoomOut', icon: 'zoom_out', noRecord: true, isEnabled: (app) => !!app.picture, run: (app) => app.viewer.setZoom(app.viewer.zoom / 1.25) },
  { id: 'view.zoomTo', label: 'Zoom To', icon: 'zoom_in', tab: 'View', internal: true, noRecord: true, run: (app, z: number) => app.viewer.setZoom(z) },
  zoomCmd('view.actualSize', 'crop_original', 'actual'),
  zoomCmd('view.fitWindow', 'fit_screen', 'fit'),
  zoomCmd('view.fitLarge', 'fit_screen', 'fit-large'),
  zoomCmd('view.fitWidth', 'fit_width', 'fit-width'),
  zoomCmd('view.fitHeight', 'fit_page_height', 'fit-height'),
  zoomCmd('view.fill', 'aspect_ratio', 'fill'),
  { id: 'view.zoomLock', icon: 'lock', kind: 'toggle', noRecord: true, isActive: (app) => app.prefs.zoomLock, run: (app) => { app.prefs.zoomLock = !app.prefs.zoomLock; app.savePrefs(); toast(app.prefs.zoomLock ? 'Zoom is kept between pictures' : 'Each picture opens with the default zoom'); } },
  { id: 'view.keepPosition', icon: 'my_location', kind: 'toggle', noRecord: true, isActive: (app) => app.prefs.keepPosition, run: (app) => { app.prefs.keepPosition = !app.prefs.keepPosition; if (app.prefs.keepPosition) app.prefs.zoomLock = true; app.savePrefs(); app.refresh(); } },
  {
    id: 'view.fitWindowToImage', icon: 'fit_screen', noRecord: true, isEnabled: (app) => isDesktop() && !!app.picture,
    run: (app) => { const p = app.picture!; const v = app.viewer; const chrome = { w: window.innerWidth - v.el.clientWidth, h: window.innerHeight - v.el.clientHeight }; const z = v.mode ? v.zoom : v.zoom; void desktopBridge()!.fitWindow({ width: Math.round(p.width * z + chrome.w), height: Math.round(p.height * z + chrome.h) }); },
  },
  { id: 'view.center', icon: 'center_focus_strong', noRecord: true, isEnabled: (app) => !!app.picture, run: (app) => app.viewer.center() },
]);

// Navigate --------------------------------------------------------------------------------------

def([
  { id: 'view.next', icon: 'navigate_next', popular: true, noRecord: true, isEnabled: (app) => app.folder.length > 0, run: (app) => nav(app, 1) },
  { id: 'view.previous', icon: 'navigate_before', popular: true, noRecord: true, isEnabled: (app) => app.folder.length > 0, run: (app) => nav(app, -1) },
  { id: 'view.first', icon: 'first_page', noRecord: true, isEnabled: (app) => app.folder.length > 0, run: (app) => { if (app.folder.select(0)) void app.tab.show(); } },
  { id: 'view.last', icon: 'last_page', noRecord: true, isEnabled: (app) => app.folder.length > 0, run: (app) => { if (app.folder.select(app.folder.length - 1)) void app.tab.show(); } },
  { id: 'view.random', icon: 'shuffle', noRecord: true, isEnabled: (app) => app.folder.length > 1, run: (app) => { const f = app.folder; let i = f.index; while (f.length > 1 && i === f.index) i = Math.floor(Math.random() * f.length); if (f.select(i)) void app.tab.show(); } },
  {
    id: 'view.gotoIndex', icon: 'pin', noRecord: true, isEnabled: (app) => app.folder.length > 0,
    run: async (app, n?: number) => {
      const f = app.folder;
      if (typeof n !== 'number') {
        const r = await openDialog({ title: 'Go to Picture', fields: [{ key: 'n', label: `Picture number (1–${f.length})`, type: 'number', min: 1, max: f.length, value: f.index + 1, autofocus: true }, { key: 'name', label: 'Or type part of a file name', type: 'combo', options: f.entries.slice(0, 500).map((e) => e.name), placeholder: 'IMG_01' }] });
        if (!r) return;
        if (r.name) { const i = f.entries.findIndex((e) => e.name.toLowerCase().includes(String(r.name).toLowerCase())); if (i < 0) { toast('No file name matches.'); return; } n = i + 1; }
        else n = +r.n;
      }
      if (f.select((n || 1) - 1)) void app.tab.show();
    },
  },
  { id: 'view.wrap', icon: 'repeat', kind: 'toggle', noRecord: true, isActive: (app) => app.prefs.wrap, run: (app) => { app.prefs.wrap = !app.prefs.wrap; app.savePrefs(); app.refresh(); } },
]);

// Window -----------------------------------------------------------------------------------------

async function menuMode(app: App, arg?: MenuStyle | string): Promise<void> {
  let v = arg as MenuStyle | undefined;
  if (!v || !['ribbon', 'classic', 'both'].includes(v)) {
    const r = await openDialog({ title: 'Menus', fields: [
      { key: 'style', label: 'Show', type: 'radio', value: app.prefs.menuStyle, options: [{ value: 'ribbon', label: 'Ribbon' }, { value: 'classic', label: 'Classic menu bar (the Quick Access Bar is the toolbar)' }, { value: 'both', label: 'Both (menu bar above the ribbon)' }] },
      { key: 'layout', label: 'Classic menu layout', type: 'select', value: app.prefs.menuLayout, options: Object.entries(CLASSIC_LAYOUT_NAMES).map(([value, label]) => ({ value, label })), visibleIf: (x) => x.style !== 'ribbon' },
      { key: 'info', type: 'info', label: 'Both reach the same commands. The classic menu bar follows the arrangement of the picture viewer you choose; IrfanView style is the default.' },
    ] });
    if (!r) return;
    v = r.style;
    if (r.layout && r.layout !== app.prefs.menuLayout) app.prefs.menuLayout = r.layout;
  }
  app.prefs.menuStyle = v || 'both';
  if (app.prefs.menuStyle === 'classic' && app.prefs.qatPosition === 'top') app.prefs.qatPosition = 'below';
  app.savePrefs();
  app.ui.applyPrefs();
}

def([
  {
    id: 'view.fullScreen', icon: 'fullscreen', kind: 'toggle', popular: true, noRecord: true,
    tip: 'The picture alone on a black background; Enter or Esc returns',
    isActive: () => document.body.classList.contains('ql-fullscreen') || !!document.fullscreenElement,
    run: (app) => fullScreen(app, !(document.body.classList.contains('ql-fullscreen') || !!document.fullscreenElement)),
  },
  { id: 'view.menuMode', icon: 'menu_open', noRecord: true, tip: 'Ribbon, classic menu bar, or both', run: (app, arg) => menuMode(app, arg) },
  {
    id: 'view.menuLayout', icon: 'menu', kind: 'menu', noRecord: true,
    menu: (app) => Object.entries(CLASSIC_LAYOUT_NAMES).map(([k, label]) => ({ id: 'view.menuLayout', arg: k, label, checked: app.prefs.menuLayout === k })),
    run: async (app, arg?: string) => {
      let v = arg;
      if (!v || !(v in CLASSIC_LAYOUT_NAMES)) {
        const r = await openDialog({ title: 'Classic Menu Layout', fields: [{ key: 'l', label: 'Menu bar layout', type: 'radio', value: app.prefs.menuLayout, options: Object.entries(CLASSIC_LAYOUT_NAMES).map(([value, label]) => ({ value, label: `${label} — ${CLASSIC_LAYOUT_MODELS[value]}` })) }] });
        if (!r) return;
        v = r.l;
      }
      app.prefs.menuLayout = v!;
      if (app.prefs.menuStyle === 'ribbon') app.prefs.menuStyle = 'both';
      app.savePrefs(); app.ui.applyPrefs();
      toast(`Menu bar: ${CLASSIC_LAYOUT_NAMES[v!]}`);
    },
  },
  { id: 'view.toolbar', icon: 'bolt', kind: 'toggle', noRecord: true, tip: 'The toolbar is the Quick Access Bar', isActive: (app) => !app.prefs.qatHidden, run: (app) => { app.prefs.qatHidden = !app.prefs.qatHidden; app.savePrefs(); app.ui.applyPrefs(); } },
  { id: 'view.statusBar', icon: 'horizontal_rule', kind: 'toggle', noRecord: true, isActive: (app) => app.prefs.statusBar, run: (app) => { app.prefs.statusBar = !app.prefs.statusBar; app.savePrefs(); app.ui.applyPrefs(); } },
  { id: 'view.collapseRibbon', icon: 'expand_less', kind: 'toggle', noRecord: true, isActive: (app) => app.prefs.ribbon !== 'full', run: (app) => { app.prefs.ribbon = app.prefs.ribbon === 'full' ? 'tabs' : 'full'; app.savePrefs(); app.ui.applyPrefs(); } },
  { id: 'view.alwaysOnTop', icon: 'push_pin', kind: 'toggle', noRecord: true, isEnabled: () => isDesktop(), isActive: () => !!(window as any).__qlOnTop, run: (app) => { const on = !(window as any).__qlOnTop; (window as any).__qlOnTop = on; void desktopBridge()!.setAlwaysOnTop({ on }); app.refresh(); } },
  { id: 'view.minimize', icon: 'minimize', noRecord: true, isEnabled: () => isDesktop(), run: () => desktopBridge()!.minimize() },
  { id: 'view.touchMode', icon: 'touch_app', kind: 'toggle', noRecord: true, tip: 'More space between commands for fingers', isActive: (app) => app.prefs.touchMode, run: (app) => { app.prefs.touchMode = !app.prefs.touchMode; app.savePrefs(); app.ui.applyPrefs(); } },
  {
    id: 'view.theme', icon: 'dark_mode', kind: 'menu', noRecord: true,
    menu: (app) => (['system', 'light', 'dark', 'black'] as const).map((t) => ({ id: 'view.theme', arg: t, label: t === 'system' ? 'Follow the System' : t === 'light' ? 'Light' : t === 'dark' ? 'Dark' : 'Black (OLED)', checked: app.prefs.theme === t })),
    run: (app, t?: 'system' | 'light' | 'dark' | 'black') => { app.prefs.theme = t || (app.prefs.theme === 'dark' ? 'light' : 'dark'); app.savePrefs(); app.ui.applyPrefs(); },
  },
]);

// Inspect and display ---------------------------------------------------------------------------

def([
  { id: 'view.pixelInfo', icon: 'colorize', kind: 'toggle', noRecord: true, isActive: (app) => app.prefs.pixelInfo, run: (app) => { app.prefs.pixelInfo = !app.prefs.pixelInfo; app.savePrefs(); app.refresh(); } },
  { id: 'view.pixelGrid', icon: 'grid_on', kind: 'toggle', noRecord: true, tip: 'Grid lines between pixels at 800% and above', isActive: (app) => !!(app as any).pixelGrid, run: (app) => { (app as any).pixelGrid = !(app as any).pixelGrid; app.viewer.draw(); app.refresh(); } },
  {
    id: 'view.alphaDisplay', icon: 'texture', kind: 'menu', noRecord: true,
    menu: (app) => (['checkerboard', 'white', 'black', 'custom'] as const).map((a) => ({ id: 'view.alphaDisplay', arg: a, label: a === 'custom' ? 'Custom Color…' : a[0].toUpperCase() + a.slice(1), checked: app.prefs.alphaDisplay === a })),
    run: async (app, a?: 'checkerboard' | 'white' | 'black' | 'custom') => {
      if (!a) a = (['checkerboard', 'white', 'black'] as const)[(['checkerboard', 'white', 'black'].indexOf(app.prefs.alphaDisplay) + 1) % 3];
      if (a === 'custom') { const r = await openDialog({ title: 'Transparency Color', fields: [{ key: 'c', label: 'Color behind transparent pixels', type: 'color', value: app.prefs.alphaColor }] }); if (!r) return; app.prefs.alphaColor = r.c; }
      app.prefs.alphaDisplay = a; app.savePrefs(); for (const t of app.tabs) t.ui.draw(); app.refresh();
    },
  },
  {
    id: 'view.background', icon: 'format_color_fill', noRecord: true,
    run: async (app) => {
      const r = await openDialog({ title: 'Background Color', fields: [{ key: 'c', label: 'Around the picture', type: 'color', value: app.prefs.background || '#2a2f3a' }, { key: 'f', label: 'In full screen', type: 'color', value: app.prefs.fullScreenBackground }, { key: 'theme', label: 'Use the theme color around the picture', type: 'checkbox', value: !app.prefs.background }] });
      if (!r) return;
      app.prefs.background = r.theme ? '' : r.c; app.prefs.fullScreenBackground = r.f; app.savePrefs(); app.ui.applyPrefs();
    },
  },
]);

// Quick Access Bar and search -------------------------------------------------------------------

def([
  { id: 'view.cmdSearch', icon: 'search', popular: true, noRecord: true, run: (app) => app.ui.commandPalette() },
  {
    id: 'view.qatAddAll', icon: 'sort_by_alpha', noRecord: true,
    tip: 'Put every drop-down choice on the Quick Access Bar: Save and Print first, then the rest alphabetically',
    run: (app) => { app.prefs.qat = addAllQatChoices(app.prefs.qat, (id) => getCommand(id)?.label); app.prefs.qatHidden = false; app.savePrefs(); app.ui.applyPrefs(); app.ui.renderQat(); toast('All Quick Access choices added'); },
  },
  {
    id: 'view.qatPosition', icon: 'swap_vert', kind: 'menu', noRecord: true,
    menu: (app) => (['top', 'below', 'bottom'] as const).map((p) => ({ id: 'view.qatPosition', arg: p, label: p === 'top' ? 'Show Above the Ribbon' : p === 'below' ? 'Show Below the Ribbon' : 'Show at the Bottom (near keyboard)', checked: app.prefs.qatPosition === p })),
    run: (app, pos?: 'top' | 'below' | 'bottom') => { const order: ('top' | 'below' | 'bottom')[] = ['top', 'below', 'bottom']; app.prefs.qatPosition = pos || order[(order.indexOf(app.prefs.qatPosition) + 1) % 3]; app.savePrefs(); app.ui.applyPrefs(); },
  },
  { id: 'view.qatLabels', icon: 'label', kind: 'toggle', noRecord: true, isActive: (app) => app.prefs.qatLabels, run: (app) => { app.prefs.qatLabels = !app.prefs.qatLabels; app.savePrefs(); app.ui.renderQat(); } },
  { id: 'view.qatShow', icon: 'bolt', noRecord: true, run: (app) => { app.prefs.qatHidden = false; app.savePrefs(); app.ui.applyPrefs(); } },
  { id: 'view.qatHide', icon: 'visibility_off', noRecord: true, run: (app) => { app.prefs.qatHidden = true; app.savePrefs(); app.ui.applyPrefs(); } },
]);
