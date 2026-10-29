/** File backstage: Home, Open, Info, Save As, Print, Share, Options. */
import type { App } from '../app';
import { h, icon, clear } from './dom';
import { FORMATS } from '../codecs/registry';
import { isDesktop } from '../platform/native';

const PAGES: [string, string, string][] = [
  ['home', 'Home', 'home'], ['open', 'Open', 'folder_open'], ['info', 'Info', 'info'],
  ['save', 'Save', 'save'], ['saveas', 'Save As', 'save_as'], ['print', 'Print', 'print'],
  ['share', 'Share', 'share'], ['close', 'Close', 'close'], ['options', 'Options', 'settings'],
];

export function renderBackstage(app: App, root: HTMLElement, page: string): void {
  clear(root);
  const nav = h('nav', { class: 'ql-bs-nav' }, h('button', { class: 'ql-bs-back', onclick: () => app.ui.hideBackstage(), 'aria-label': 'Back to the picture' }, icon('arrow_back'), ' Back'));
  for (const [id, label, ic] of PAGES) {
    nav.appendChild(h('button', { class: 'ql-bs-item' + (id === page ? ' ql-on' : ''), onclick: () => {
      if (id === 'save') { app.ui.hideBackstage(); app.exec('file.save'); return; }
      if (id === 'close') { app.exec('file.close'); return; }
      if (id === 'options') { app.exec('file.options'); return; }
      renderBackstage(app, root, id);
    } }, icon(ic), ' ', label));
  }
  const body = h('div', { class: 'ql-bs-body' });
  root.append(nav, body);
  const card = (title: string, sub: string, ic: string, onclick: () => void) => h('button', { class: 'ql-bs-card', onclick }, icon(ic, 'ql-bs-card-icon'), h('div', null, h('b', null, title), h('div', { class: 'ql-help' }, sub)));
  const run = (id: string, arg?: any) => () => { app.ui.hideBackstage(); app.exec(id, arg); };
  switch (page) {
    case 'home': {
      const hr = new Date().getHours();
      body.appendChild(h('h1', null, 'Good ' + (hr < 12 ? 'morning' : hr < 18 ? 'afternoon' : 'evening')));
      const grid = h('div', { class: 'ql-bs-cards' });
      grid.append(
        card('Open pictures…', 'One or several files; the rest of their folder follows on the desktop', 'folder_open', run('file.open')),
        card('Open folder…', 'Every picture in a folder, in order', 'folder', run('file.openFolder')),
        card('Paste as new picture', 'The picture on the clipboard', 'content_paste', run('edit.pasteAsNew')),
        card('Search commands', 'Every feature is a command (Alt+Q)', 'search', run('view.cmdSearch')));
      body.appendChild(grid);
      body.appendChild(h('h2', null, 'Recent'));
      recentList(app, body);
      break;
    }
    case 'open': {
      body.append(h('h1', null, 'Open'),
        card('Browse…', 'Open pictures from this device, Drive, or any document provider', 'folder_open', run('file.open')),
        card('Open folder…', 'Every picture in a folder', 'folder', run('file.openFolder')),
        h('h2', null, 'Recent'));
      recentList(app, body, true);
      break;
    }
    case 'info': {
      const pic = app.picture;
      body.append(h('h1', null, 'Info'));
      if (!pic) { body.appendChild(h('p', { class: 'ql-help' }, 'No picture is open.')); break; }
      const pg = pic.current;
      body.append(h('h2', null, pic.name),
        h('div', { class: 'ql-bs-cards' },
          card('Picture Information', 'Format, dimensions, colors, pages, metadata', 'info', run('image.info')),
          card('EXIF Information', 'Camera, exposure, date and place', 'photo_camera', run('meta.exif')),
          card('Reload', 'Discard unsaved changes and read the file again', 'refresh', run('file.reload'))),
        h('h3', null, 'Properties'),
        h('table', { class: 'ql-stats' },
          ...[['Format', pic.format.label], ['Dimensions', `${pg.width} × ${pg.height}`], ['Bits per pixel', String(pg.bitDepth)], ['Pages / frames', `${pic.pages.length} / ${pg.frames.length}`], ['File size', `${(pic.bytes.length / 1024).toFixed(1)} KB`], ['Location', pic.entry.uri ? pic.entry.uri.replace(/^file:\/\//, '') : 'Not on disk (dropped, pasted or shared)'], ['Decoded in', `${pic.loadMs} ms`]].map(([k, v]) => h('tr', null, h('td', null, k), h('td', null, v)))));
      break;
    }
    case 'saveas': {
      body.append(h('h1', null, 'Save As'), h('p', { class: 'ql-help' }, 'Choose the format; the system file dialog lets you pick the folder (device, SD card, Drive, Dropbox…). Save As ▸ Options chooses quality and what is kept.'));
      const grid = h('div', { class: 'ql-bs-cards' });
      for (const f of FORMATS.filter((x) => x.save)) grid.appendChild(card(f.label, f.notes || `.${f.extensions[0]}`, 'image', run('file.saveAs', f.id)));
      grid.appendChild(card('Save As… (choose in the dialog)', 'Format options per type', 'save_as', run('file.saveAs')));
      body.appendChild(grid);
      break;
    }
    case 'print': {
      body.append(h('h1', null, 'Print'),
        card('Print…', 'Position, size and scale, through the system print service', 'print', run('file.print')),
        card('Quick Print', 'Fit to the page with the current settings', 'print', run('file.quickPrint')),
        card('Print Preview', 'See the page before printing', 'preview', run('file.printPreview')));
      break;
    }
    case 'share': {
      body.append(h('h1', null, 'Share'),
        card('Share…', 'Send the picture through the share sheet', 'share', run('file.share')),
        card('Email…', 'Attach to an email (Anne\'s Post when installed)', 'mail', run('file.email')),
        ...(isDesktop() ? [card('Show in Folder', 'Open the file manager at this picture', 'folder_open', run('file.revealInFolder')), card('Open With…', 'The program registered for this type', 'open_in_new', run('file.openWith'))] : []));
      break;
    }
  }
}

function recentList(app: App, body: HTMLElement, full = false) {
  const list = h('div', { class: 'ql-recent' });
  const rec = app.prefs.recent;
  if (!rec.length) list.appendChild(h('p', { class: 'ql-help' }, 'Pictures you open appear here.'));
  for (const r of rec.slice(0, full ? 40 : 8)) {
    list.appendChild(h('div', { class: 'ql-recent-row' },
      h('button', { class: 'ql-recent-open', onclick: () => app.exec('file.openRecent', r.key) }, icon('image'), h('div', null, h('b', null, r.name), h('div', { class: 'ql-help' }, new Date(r.when).toLocaleString()))),
      h('button', { class: 'ql-iconbtn', title: r.pinned ? 'Unpin' : 'Pin', onclick: () => { r.pinned = !r.pinned; app.savePrefs(); renderBackstage(app, body.parentElement!, full ? 'open' : 'home'); } }, icon(r.pinned ? 'keep_off' : 'keep')),
      h('button', { class: 'ql-iconbtn', title: 'Remove from list', onclick: () => { app.prefs.recent = app.prefs.recent.filter((x) => x !== r); app.savePrefs(); renderBackstage(app, body.parentElement!, full ? 'open' : 'home'); } }, icon('close'))));
  }
  if (full && rec.length) list.appendChild(h('button', { class: 'ql-btn', onclick: () => app.exec('file.clearRecent') }, 'Clear unpinned'));
  body.appendChild(list);
}
