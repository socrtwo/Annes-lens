/** Help tab: help, shortcuts, menu map, formats, releases, about. */
import { def, allCommands, getCommand, commandCount, plannedLabel } from './registry';
import { openDialog, toast } from '../ui/dialog';
import { h } from '../ui/dom';
import { FORMATS } from '../codecs/registry';
import { CLASSIC_MENUS, CLASSIC_LAYOUT_NAMES, menuPaths } from '../ui/classicMenus';
import { DEFAULT_TABS } from '../ui/ribbonLayout';
import { PLAN_COMMAND_COUNT } from '../plan.generated';

declare const __APP_VERSION__: string;
const VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
const REPO = 'https://github.com/socrtwo/QuillLens';

async function open(url: string): Promise<void> {
  const { openExternal } = await import('../platform/native');
  openExternal(url);
}

def([
  {
    id: 'help.contents', icon: 'help', noRecord: true,
    run: async () => {
      await openDialog({ title: 'Anne\'s Lens Help', wide: true, ok: 'Close', cancel: false, fields: [{ key: 'i', type: 'info', html: [
        '<p><b>Every feature is a command.</b> Search for any of them with Alt+Q (the magnifier in the title bar), put them on the Quick Access Bar, your own tabs or keyboard shortcuts, find them in the classic menus, or record them in macros.</p>',
        '<p><b>Viewing:</b> Space, PgDn or the right arrow show the next picture, Backspace, PgUp or the left arrow the previous one; Home and End jump to the ends. + and - zoom, Ctrl+wheel and pinch too; Shift+F fits the window, Ctrl+H is original size; Enter is full screen. Drag to pan; double-click switches between fit and 100%.</p>',
        '<p><b>IrfanView keys:</b> O open, S save as, I information, E EXIF, L and R rotate, H and V flip, P options, T thumbnails (M3), W slideshow (M5), B batch (M3). All keys can be changed in File ▸ Customize Keyboard, and an IrfanView-style key list can be pasted into Export / Import Settings.</p>',
        '<p><b>Menus:</b> View ▸ Menus shows the ribbon, a classic menu bar or both; View ▸ Classic Menu Layout picks the viewer whose arrangement the bar follows (IrfanView by default). Help ▸ Menu Map shows where any command lives in every layout.</p>',
        '<p><b>Files:</b> Open one picture (on the desktop its folder follows), several, or a whole folder; drop files on the window; paste; or use "Open with" and "Share to" from other apps. Save As writes PNG, JPEG, WebP and BMP.</p>',
        `<p>Documentation and the plan for the remaining milestones: <a href="${REPO}#readme" target="_blank" rel="noopener">${REPO}</a></p>`,
      ].join('') }] });
    },
  },
  { id: 'help.shortcuts', icon: 'keyboard', noRecord: true, run: (app) => app.ui.showShortcuts() },
  {
    id: 'help.menuMap', icon: 'map', noRecord: true, tip: 'Where a command lives in every classic layout and on the ribbon',
    run: async (app, id?: string) => {
      const ids = allCommands().sort((a, b) => a.label.localeCompare(b.label));
      const draw = (cid: string) => {
        const rows: HTMLElement[] = [];
        for (const t of DEFAULT_TABS) for (const g of t.groups) if (g.items.includes(cid)) rows.push(h('tr', null, h('td', null, 'Ribbon'), h('td', null, `${t.label} ▸ ${g.label}`)));
        for (const key of Object.keys(CLASSIC_MENUS)) for (const path of menuPaths(key, cid)) rows.push(h('tr', null, h('td', null, CLASSIC_LAYOUT_NAMES[key]), h('td', null, path.join(' ▸ '))));
        const custom = app.prefs.customTabs.flatMap((t) => t.groups.filter((g) => g.items.includes(cid)).map((g) => `${t.label} ▸ ${g.label}`));
        for (const c of custom) rows.push(h('tr', null, h('td', null, 'Custom tab'), h('td', null, c)));
        if (app.prefs.qat.includes(cid)) rows.push(h('tr', null, h('td', null, 'Quick Access Bar'), h('td', null, 'yes')));
        return rows.length ? h('table', { class: 'ql-stats' }, ...rows) : h('p', { class: 'ql-help' }, 'Not on any menu or tab: reachable through command search, the Quick Access Bar and Customize Tabs.');
      };
      const box = h('div', null);
      const sel = h('select', { style: 'width:100%' }, ...ids.map((c) => h('option', { value: c.id, selected: c.id === id }, c.label))) as HTMLSelectElement;
      const redraw = () => { box.replaceChildren(draw(sel.value)); };
      sel.addEventListener('change', redraw);
      redraw();
      await openDialog({ title: 'Menu Map', wide: true, content: h('div', null, h('label', { class: 'ql-label' }, 'Command'), sel, box), cancel: false, ok: 'Close' });
    },
  },
  {
    id: 'help.formats', icon: 'collections', noRecord: true,
    run: async () => {
      const table = h('table', { class: 'ql-stats qn-formats' }, h('tr', null, h('th', null, 'Format'), h('th', null, 'Open'), h('th', null, 'Save'), h('th', null, 'Notes')),
        ...FORMATS.filter((f) => f.id !== 'apng').map((f) => h('tr', null, h('td', null, `${f.label} (.${f.extensions.join(', .')})`), h('td', null, f.decoder === 'own' ? 'Anne\'s Lens reader' : f.decoder === 'platform' ? 'platform' : 'platform, then Anne\'s Lens'), h('td', null, f.save ? 'yes' : 'no'), h('td', { class: 'ql-help' }, f.notes || ''))));
      await openDialog({ title: 'Supported Formats (milestone 1)', wide: true, content: h('div', null, table, h('p', { class: 'ql-help' }, 'Pictures are recognized by their contents, not their names. The rest of the plan (AVIF and JPEG XL everywhere, JPEG 2000, PSD, TGA, RAW, SVG rendering options, historical formats) comes in later milestones; see docs/FORMATS-PLAN.md.')), cancel: false, ok: 'Close' });
    },
  },
  { id: 'help.whatsNew', icon: 'new_releases', noRecord: true, run: () => open(`${REPO}/releases`) },
  { id: 'help.reportIssue', icon: 'feedback', noRecord: true, run: () => open(`${REPO}/issues/new/choose`) },
  { id: 'help.checkUpdates', icon: 'system_update', noRecord: true, tip: 'Open the releases page to compare with this version', run: () => open(`${REPO}/releases/latest`) },
  {
    id: 'help.about', icon: 'info', noRecord: true,
    run: async () => {
      await openDialog({ title: 'About Anne\'s Lens', ok: 'Close', cancel: false, fields: [{ key: 'i', type: 'info', html: `<p><b>Anne's Lens ${VERSION}</b> — an original, open-source picture viewer, organizer and converter in the tradition of IrfanView. Part of the Anne's Office suite (Anne's Pen, Anne's Grid, Anne's Post, Anne's Stage, Anne's Loom, Anne's Press, Anne's Folio).</p><p>${commandCount()} of the ${PLAN_COMMAND_COUNT} planned commands are built (milestone 1: shell and viewer); every one can go on the Quick Access Bar, a tab, a classic menu, a shortcut or a macro.</p><p>MIT License. Copyright © 2026 Paul D Pruitt. Not affiliated with Irfan Skiljan or the makers of XnView, FastStone, ACDSee, Picasa, Photos, Preview or digiKam; product names describe compatibility and the origin of ideas only.</p><p><a href="${REPO}" target="_blank" rel="noopener">${REPO}</a></p>` }] });
    },
  },
]);

export { toast, getCommand, plannedLabel };
