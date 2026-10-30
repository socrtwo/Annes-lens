/**
 * Printing (M2): Print Setup (paper, orientation, margins, captions), Print Layouts (several pictures
 * per page: fixed grids, wallet, 4×6 / 5×7 / 8×10 cells, contact pages) and Print Copies and Posters
 * (copies per page, or one picture tiled across pages with overlap and cut marks). Pages are built as
 * HTML sized in millimeters with an @page rule, previewed in the dialog and sent to the platform's
 * print service.
 */
import { def } from './registry';
import type { App } from '../app';
import { openDialog, toast } from '../ui/dialog';
import { h, esc } from '../ui/dom';
import { encodeCanvas } from '../codecs/registry';
import { printDocument } from '../platform/native';
import type { Entry } from '../picture/folder';

export const PAPERS: Record<string, { label: string; w: number; h: number }> = {
  a4: { label: 'A4 (210 × 297 mm)', w: 210, h: 297 }, letter: { label: 'US Letter (8.5 × 11 in)', w: 215.9, h: 279.4 }, legal: { label: 'US Legal (8.5 × 14 in)', w: 215.9, h: 355.6 },
  a3: { label: 'A3 (297 × 420 mm)', w: 297, h: 420 }, a5: { label: 'A5 (148 × 210 mm)', w: 148, h: 210 }, '4x6': { label: '4 × 6 in photo paper', w: 101.6, h: 152.4 }, '5x7': { label: '5 × 7 in photo paper', w: 127, h: 177.8 }, '8x10': { label: '8 × 10 in photo paper', w: 203.2, h: 254 },
};

interface Sheet { w: number; h: number; margin: number; landscape: boolean }

function sheetFor(app: App, override: Partial<{ paper: string; orientation: string; margin: number }> = {}, wantLandscape?: boolean): Sheet {
  const p = { ...app.prefs.print, ...override };
  const paper = PAPERS[p.paper] || PAPERS.a4;
  const landscape = p.orientation === 'landscape' || (p.orientation === 'auto' && !!wantLandscape);
  return { w: landscape ? paper.h : paper.w, h: landscape ? paper.w : paper.h, margin: Math.max(0, +p.margin || 0), landscape };
}

/** Sends pages (each a .ql-print-page sized in mm) to the printer with the matching @page rule. */
async function printPages(pages: HTMLElement[], sheet: Sheet, jobName: string): Promise<void> {
  const root = document.getElementById('ql-print-root') || document.body.appendChild(h('div', { id: 'ql-print-root' }));
  root.innerHTML = '';
  const style = h('style', null, `@page { size: ${sheet.w}mm ${sheet.h}mm; margin: ${sheet.margin}mm; } @media print { .ql-print-page { width: ${sheet.w - 2 * sheet.margin}mm; height: ${sheet.h - 2 * sheet.margin}mm; } }`);
  root.append(style, ...pages);
  await Promise.all([...root.querySelectorAll('img')].map((img) => (img.complete ? null : new Promise((r) => { img.onload = () => r(null); img.onerror = () => r(null); }))));
  document.body.classList.add('ql-printing');
  try { await printDocument(jobName); } finally { setTimeout(() => { document.body.classList.remove('ql-printing'); root.innerHTML = ''; }, 1000); }
}

/** A scaled preview of one page for the dialog. */
function previewHtml(page: HTMLElement, sheet: Sheet, maxPx = 360): string {
  const pw = sheet.w - 2 * sheet.margin, ph = sheet.h - 2 * sheet.margin;
  const scale = Math.min(maxPx / sheet.w, maxPx / sheet.h);
  return `<div style="display:inline-block;background:#fff;box-shadow:0 1px 6px rgba(0,0,0,.4);width:${sheet.w * scale}px;height:${sheet.h * scale}px;position:relative;overflow:hidden"><div style="position:absolute;left:${sheet.margin * scale}px;top:${sheet.margin * scale}px;width:${pw}mm;height:${ph}mm;transform:scale(${scale});transform-origin:0 0">${page.outerHTML}</div></div>`;
}

interface Pic { url: string; name: string; width: number; height: number }

async function picturesFor(app: App, which: 'current' | 'folder', limit = 200): Promise<Pic[]> {
  const out: Pic[] = [];
  const entries: Entry[] = which === 'folder' ? app.tab.folder.entries.slice(0, limit) : app.tab.entry ? [app.tab.entry] : [];
  if (which === 'folder' && app.tab.folder.length > limit) toast(`Only the first ${limit} pictures of the folder are laid out.`);
  for (const e of entries) {
    try {
      const pic = e === app.picture?.entry ? app.picture! : await app.tab.loader.get(e);
      const blob = await encodeCanvas(pic.frameCanvas(), pic.current.hasAlpha ? 'png' : 'jpeg', 0.92);
      out.push({ url: URL.createObjectURL(blob), name: e.name, width: pic.width, height: pic.height });
    } catch { /* skipped */ }
  }
  return out;
}

const release = (pics: Pic[]) => { for (const p of pics) URL.revokeObjectURL(p.url); };

/** Lays pictures into cells of cw × ch mm (or a cols × rows grid when cw is 0) and returns the pages. */
function layoutPages(pics: Pic[], sheet: Sheet, opts: { cols?: number; rows?: number; cellW?: number; cellH?: number; captions: boolean; gap: number; repeat?: number }): HTMLElement[] {
  const pw = sheet.w - 2 * sheet.margin, ph = sheet.h - 2 * sheet.margin;
  let cols = opts.cols || 1, rows = opts.rows || 1, cw: number, ch: number;
  if (opts.cellW && opts.cellH) {
    // Fixed cells: as many as fit, in the orientation that fits more.
    const fit = (a: number, b: number) => [Math.floor((pw + opts.gap) / (a + opts.gap)), Math.floor((ph + opts.gap) / (b + opts.gap))];
    const [c1, r1] = fit(opts.cellW, opts.cellH), [c2, r2] = fit(opts.cellH, opts.cellW);
    if (c2 * r2 > c1 * r1) { cols = c2; rows = r2; cw = opts.cellH; ch = opts.cellW; } else { cols = c1; rows = r1; cw = opts.cellW; ch = opts.cellH; }
    if (!cols || !rows) { cols = rows = 1; cw = Math.min(pw, opts.cellW); ch = Math.min(ph, opts.cellH); }
  } else { cw = (pw - (cols - 1) * opts.gap) / cols; ch = (ph - (rows - 1) * opts.gap) / rows; }
  const per = cols * rows;
  const list: Pic[] = [];
  for (const p of pics) for (let k = 0; k < (opts.repeat || 1); k++) list.push(p);
  const pages: HTMLElement[] = [];
  for (let i = 0; i < list.length; i += per) {
    const page = h('div', { class: 'ql-print-page', style: `width:${pw}mm;height:${ph}mm;display:grid;grid-template-columns:repeat(${cols},${cw}mm);grid-template-rows:repeat(${rows},${ch}mm);gap:${opts.gap}mm;justify-content:center;align-content:center` });
    for (const p of list.slice(i, i + per)) {
      const capH = opts.captions ? 5 : 0;
      page.appendChild(h('div', { style: `width:${cw}mm;height:${ch}mm;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden` },
        h('img', { src: p.url, alt: p.name, style: `max-width:${cw}mm;max-height:${ch - capH}mm;object-fit:contain` }),
        opts.captions ? h('div', { style: `font:8pt sans-serif;height:${capH}mm;line-height:${capH}mm;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:${cw}mm;color:#000` }, p.name) : null));
    }
    pages.push(page);
  }
  return pages;
}

const LAYOUTS: Record<string, { label: string; cols?: number; rows?: number; cellW?: number; cellH?: number; landscapeCells?: boolean }> = {
  one: { label: 'One per page', cols: 1, rows: 1 }, two: { label: 'Two per page', cols: 1, rows: 2 }, four: { label: 'Four per page', cols: 2, rows: 2 }, six: { label: 'Six per page', cols: 2, rows: 3 },
  wallet: { label: 'Wallet (2.5 × 3.5 in)', cellW: 63.5, cellH: 88.9 }, '4x6': { label: '4 × 6 in', cellW: 101.6, cellH: 152.4 }, '5x7': { label: '5 × 7 in', cellW: 127, cellH: 177.8 }, '8x10': { label: '8 × 10 in', cellW: 203.2, cellH: 254 },
  contact: { label: 'Contact page (columns × rows below)' },
};

def([
  {
    id: 'file.printSetup', icon: 'print_connect', noRecord: true,
    run: async (app) => {
      const p = app.prefs.print;
      const r = await openDialog({ title: 'Print Setup', fields: [
        { key: 'paper', label: 'Paper', type: 'select', options: Object.entries(PAPERS).map(([value, v]) => ({ value, label: v.label })), value: p.paper, half: true },
        { key: 'orientation', label: 'Orientation', type: 'select', options: [{ value: 'auto', label: 'Automatic (by the picture)' }, { value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }], value: p.orientation, half: true },
        { key: 'margin', label: 'Margins (mm)', type: 'number', min: 0, max: 50, step: 1, value: p.margin, half: true },
        { key: 'fit', label: 'Default size', type: 'select', options: [{ value: 'page', label: 'Fit to the page' }, { value: 'actual', label: 'Actual size (by the picture\'s DPI)' }], value: p.fit, half: true },
        { key: 'captions', label: 'Print file names under pictures by default', type: 'checkbox', value: p.captions },
        { key: 'i', type: 'info', label: 'The printer, copies and the real paper tray are chosen in the system print dialog that follows every print command; these settings size the pages.' },
      ] });
      if (!r) return;
      app.prefs.print = { paper: r.paper, orientation: r.orientation, margin: Math.max(0, +r.margin || 0), captions: !!r.captions, fit: r.fit };
      app.savePrefs();
    },
  },
  {
    id: 'file.printLayouts', icon: 'grid_view', noRecord: true, isEnabled: (app) => !!app.picture,
    tip: 'Wallet, 4×6, 5×7, 8×10, two or four per page, contact pages, for the current picture or the whole folder',
    run: async (app) => {
      const pics = await picturesFor(app, 'current');
      let folderPics: Pic[] | null = null;
      const p = app.prefs.print;
      let lastPages: HTMLElement[] = [], lastSheet: Sheet | null = null;
      const build = async (v: Record<string, any>) => {
        const L = LAYOUTS[v.layout] || LAYOUTS.one;
        const source = v.pictures === 'folder' ? (folderPics ||= await picturesFor(app, 'folder')) : pics;
        const first = source[0];
        const wantLandscape = L.cols && L.rows ? (L.cols > L.rows ? true : L.cols < L.rows ? false : !!first && first.width > first.height) : undefined;
        const sheet = sheetFor(app, { paper: v.paper, orientation: v.orientation, margin: +v.margin }, wantLandscape);
        const opts = v.layout === 'contact' ? { cols: Math.max(1, +v.cols || 4), rows: Math.max(1, +v.rows || 5) } : { cols: L.cols, rows: L.rows, cellW: L.cellW, cellH: L.cellH };
        lastPages = layoutPages(source, sheet, { ...opts, captions: !!v.captions, gap: 3, repeat: Math.max(1, +v.repeat || 1) });
        lastSheet = sheet;
        return { sheet, pages: lastPages };
      };
      const r = await openDialog({ title: 'Print Layouts', wide: true, ok: 'Print…', preview: true, previewStyle: 'text-align:center',
        fields: [
          { key: 'layout', label: 'Layout', type: 'select', options: Object.entries(LAYOUTS).map(([value, v]) => ({ value, label: v.label })), value: 'four', half: true },
          { key: 'pictures', label: 'Pictures', type: 'select', options: [{ value: 'current', label: 'This picture' }, { value: 'folder', label: `Every picture in the folder (${app.tab.folder.length})` }], value: 'current', half: true },
          { key: 'repeat', label: 'Copies of each picture', type: 'number', min: 1, max: 99, value: 1, half: true },
          { key: 'captions', label: 'File names under the pictures', type: 'checkbox', value: p.captions, half: true },
          { key: 'cols', label: 'Contact page columns', type: 'number', min: 1, max: 20, value: 4, half: true, visibleIf: (v) => v.layout === 'contact' },
          { key: 'rows', label: 'Contact page rows', type: 'number', min: 1, max: 30, value: 5, half: true, visibleIf: (v) => v.layout === 'contact' },
          { key: 'paper', label: 'Paper', type: 'select', options: Object.entries(PAPERS).map(([value, v]) => ({ value, label: v.label })), value: p.paper, half: true },
          { key: 'orientation', label: 'Orientation', type: 'select', options: [{ value: 'auto', label: 'Automatic' }, { value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }], value: p.orientation, half: true },
          { key: 'margin', label: 'Margins (mm)', type: 'number', min: 0, max: 50, value: p.margin, half: true },
        ],
        onChange: (v, ctl) => { void build(v).then(({ sheet, pages }) => ctl.setPreview(pages.length ? previewHtml(pages[0], sheet) + `<div class="ql-help">${pages.length} page${pages.length > 1 ? 's' : ''}</div>` : '<div class="ql-help">Nothing to print</div>')); },
        onOpen: (ctl) => { void build(ctl.values()).then(({ sheet, pages }) => ctl.setPreview(pages.length ? previewHtml(pages[0], sheet) + `<div class="ql-help">${pages.length} page${pages.length > 1 ? 's' : ''}</div>` : '')); },
      });
      try {
        if (!r) return;
        await build(r);
        if (!lastPages.length || !lastSheet) { toast('Nothing to print.'); return; }
        app.ui.hideBackstage();
        await printPages(lastPages, lastSheet, 'Anne\'s Lens layout');
      } finally { release(pics); if (folderPics) release(folderPics); }
    },
  },
  {
    id: 'file.copyShop', icon: 'photo_prints', noRecord: true, isEnabled: (app) => !!app.picture,
    tip: 'Several copies per page, or one picture tiled across pages as a poster with overlap and cut marks',
    run: async (app) => {
      const pic = app.picture!;
      const pics = await picturesFor(app, 'current');
      const p = app.prefs.print;
      let lastPages: HTMLElement[] = [], lastSheet: Sheet | null = null;
      const build = (v: Record<string, any>) => {
        const sheet = sheetFor(app, { paper: v.paper, orientation: v.orientation, margin: +v.margin }, pic.width > pic.height);
        if (v.mode === 'copies') {
          const n = Math.max(1, +v.copies || 1), per = Math.max(1, +v.perPage || 4);
          const cols = Math.ceil(Math.sqrt(per * (sheet.w / sheet.h))), rows = Math.ceil(per / cols);
          lastPages = layoutPages(pics, sheet, { cols, rows, captions: false, gap: 3, repeat: n });
        } else {
          const cols = Math.max(1, +v.pcols || 2), rows = Math.max(1, +v.prows || 2), overlap = Math.max(0, +v.overlap || 0);
          const pw = sheet.w - 2 * sheet.margin, ph = sheet.h - 2 * sheet.margin;
          const totalW = cols * pw - (cols - 1) * overlap, totalH = rows * ph - (rows - 1) * overlap;
          // The picture fills the poster area, keeping its shape.
          const s = Math.min(totalW / pic.width, totalH / pic.height);
          const iw = pic.width * s, ih = pic.height * s, ox = (totalW - iw) / 2, oy = (totalH - ih) / 2;
          lastPages = [];
          for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
            const left = c * (pw - overlap), top = r * (ph - overlap);
            const page = h('div', { class: 'ql-print-page', style: `width:${pw}mm;height:${ph}mm;position:relative;overflow:hidden` },
              h('img', { src: pics[0]?.url || '', alt: pic.name, style: `position:absolute;left:${ox - left}mm;top:${oy - top}mm;width:${iw}mm;height:${ih}mm` }));
            if (v.marks && overlap > 0) {
              const mark = (style: string) => page.appendChild(h('div', { style: `position:absolute;background:#000;${style}` }));
              if (c > 0) mark(`left:${overlap}mm;top:0;width:0.2mm;height:4mm`), mark(`left:${overlap}mm;bottom:0;width:0.2mm;height:4mm`);
              if (c < cols - 1) mark(`right:${overlap}mm;top:0;width:0.2mm;height:4mm`), mark(`right:${overlap}mm;bottom:0;width:0.2mm;height:4mm`);
              if (r > 0) mark(`top:${overlap}mm;left:0;height:0.2mm;width:4mm`), mark(`top:${overlap}mm;right:0;height:0.2mm;width:4mm`);
              if (r < rows - 1) mark(`bottom:${overlap}mm;left:0;height:0.2mm;width:4mm`), mark(`bottom:${overlap}mm;right:0;height:0.2mm;width:4mm`);
            }
            page.appendChild(h('div', { style: 'position:absolute;right:1mm;bottom:0;font:6pt sans-serif;color:#888' }, `${esc(pic.name)} — tile ${r + 1},${c + 1} of ${rows}×${cols}`));
            lastPages.push(page);
          }
        }
        lastSheet = sheet;
        return { sheet, pages: lastPages };
      };
      const r = await openDialog({ title: 'Print Copies and Posters', wide: true, ok: 'Print…', preview: true, previewStyle: 'text-align:center',
        fields: [
          { key: 'mode', label: 'Print', type: 'radio', options: [{ value: 'copies', label: 'Several copies per page' }, { value: 'poster', label: 'One picture across several pages (poster)' }], value: 'copies' },
          { key: 'copies', label: 'Copies', type: 'number', min: 1, max: 999, value: 4, half: true, visibleIf: (v) => v.mode === 'copies' },
          { key: 'perPage', label: 'Per page', type: 'number', min: 1, max: 64, value: 4, half: true, visibleIf: (v) => v.mode === 'copies' },
          { key: 'pcols', label: 'Pages across', type: 'number', min: 1, max: 12, value: 2, half: true, visibleIf: (v) => v.mode === 'poster' },
          { key: 'prows', label: 'Pages down', type: 'number', min: 1, max: 12, value: 2, half: true, visibleIf: (v) => v.mode === 'poster' },
          { key: 'overlap', label: 'Overlap (mm)', type: 'number', min: 0, max: 50, value: 10, half: true, visibleIf: (v) => v.mode === 'poster' },
          { key: 'marks', label: 'Cut marks', type: 'checkbox', value: true, half: true, visibleIf: (v) => v.mode === 'poster' },
          { key: 'paper', label: 'Paper', type: 'select', options: Object.entries(PAPERS).map(([value, v]) => ({ value, label: v.label })), value: p.paper, half: true },
          { key: 'orientation', label: 'Orientation', type: 'select', options: [{ value: 'auto', label: 'Automatic' }, { value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }], value: p.orientation, half: true },
          { key: 'margin', label: 'Margins (mm)', type: 'number', min: 0, max: 50, value: p.margin, half: true },
        ],
        onChange: (v, ctl) => { const { sheet, pages } = build(v); ctl.setPreview(previewHtml(pages[0], sheet) + `<div class="ql-help">${pages.length} page${pages.length > 1 ? 's' : ''}</div>`); },
        onOpen: (ctl) => { const { sheet, pages } = build(ctl.values()); ctl.setPreview(previewHtml(pages[0], sheet) + `<div class="ql-help">${pages.length} page${pages.length > 1 ? 's' : ''}</div>`); },
      });
      try {
        if (!r) return;
        build(r);
        if (!lastSheet) return;
        app.ui.hideBackstage();
        await printPages(lastPages, lastSheet, 'Anne\'s Lens print');
      } finally { release(pics); }
    },
  },
]);
