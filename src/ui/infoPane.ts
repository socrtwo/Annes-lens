/**
 * Info Pane (Ctrl+I): a panel over the right edge of the picture with the file facts, the EXIF
 * summary, the location (with a map link), rating and keywords, and an RGB histogram. It follows
 * the active window and refreshes when the picture or its pixels change.
 */
import type { App } from '../app';
import { h } from './dom';
import { histogram } from './overlays';
import { propsOf } from '../picture/metadata';
import { openExternal } from '../platform/native';

const size = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(2)} MB`);
const exifDate = (s?: string) => (s ? s.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3') : '');

/** The rows the pane shows for the current picture (label, value). Pure so tests can read them. */
export function infoRows(app: App): [string, string][] {
  const p = app.picture; if (!p) return [];
  const pg = p.current, ex = p.exif, x = propsOf(p.entry);
  const rows: [string, string][] = [['Name', p.name], ['Format', `${p.format.label}${p.decoder && p.decoder !== 'platform' ? ` (${p.decoder} decoder)` : ''}`], ['Dimensions', `${p.width} × ${p.height} (${(p.width * p.height / 1e6).toFixed(2)} MP)`]];
  const depth = `${pg.bitDepth}-bit${pg.paletteSize ? `, ${pg.paletteSize}-color palette` : ''}${pg.hasAlpha ? ', transparency' : ''}`;
  rows.push(['Color', depth]);
  if (pg.dpi) rows.push(['Resolution', `${pg.dpi[0]}${pg.dpi[1] !== pg.dpi[0] ? ` × ${pg.dpi[1]}` : ''} dpi (${(p.width / pg.dpi[0]).toFixed(2)} × ${(p.height / pg.dpi[1]).toFixed(2)} in)`]);
  rows.push(['File size', size(p.bytes.length)]);
  if (p.pages.length > 1) rows.push(['Page', `${p.page + 1} of ${p.pages.length}`]);
  if (pg.frames.length > 1) rows.push(['Frames', `${pg.frames.length}`]);
  const f = app.folder; if (f.length > 1) rows.push(['Position', `${f.index + 1} of ${f.length}`]);
  if (ex?.dateTaken) rows.push(['Taken', exifDate(ex.dateTaken)]);
  const cam = [ex?.make, ex?.model].filter(Boolean).join(' '); if (cam) rows.push(['Camera', cam]);
  if (ex?.lens) rows.push(['Lens', ex.lens]);
  if (ex?.exposure) rows.push(['Exposure', ex.exposure]);
  const lat = x?.lat ?? ex?.gps?.lat, lon = x?.lon ?? ex?.gps?.lon;
  if (lat !== undefined && lon !== undefined) rows.push(['Location', `${lat.toFixed(5)}, ${lon.toFixed(5)}`]);
  const place = [x?.city, x?.state, x?.country].filter(Boolean).join(', '); if (place) rows.push(['Place', place]);
  if (x?.title) rows.push(['Title', x.title]);
  if (x?.description) rows.push(['Caption', x.description]);
  if (x?.rating) rows.push(['Rating', '★'.repeat(x.rating) + '☆'.repeat(Math.max(0, 5 - x.rating))]);
  if (x?.label) rows.push(['Label', x.label]);
  if (x?.keywords?.length) rows.push(['Keywords', x.keywords.join(', ')]);
  if (x?.personInImage?.length) rows.push(['People', x.personInImage.join(', ')]);
  if (x?.altText) rows.push(['Alt text', x.altText]);
  if (app.tab.dirty) rows.push(['Edited', 'unsaved changes']);
  return rows;
}

export class InfoPane {
  el: HTMLElement;
  private body: HTMLElement;
  private hist: HTMLCanvasElement;
  private key = '';
  open = false;
  constructor(private app: App) {
    this.body = h('div', { class: 'qn-info-rows' });
    this.hist = h('canvas', { class: 'qn-info-hist', width: '256', height: '80' }) as HTMLCanvasElement;
    this.el = h('aside', { class: 'qn-infopane', 'aria-label': 'Picture information' },
      h('div', { class: 'qn-info-head' }, h('b', null, 'Info'), h('button', { class: 'ql-iconbtn', type: 'button', 'aria-label': 'Close', onclick: () => this.toggle(false) }, '×')),
      this.hist, this.body);
    for (const ev of ['pointerdown', 'wheel', 'dblclick', 'contextmenu']) this.el.addEventListener(ev, (e) => e.stopPropagation());
    app.onRefresh(() => this.update());
  }
  toggle(on = !this.open): void { this.open = on; if (!on) this.el.remove(); this.key = ''; this.update(); this.app.refresh(); }
  update(): void {
    if (!this.open) return;
    const host = this.app.viewer?.el; if (!host) return;
    if (this.el.parentElement !== host) host.appendChild(this.el);
    const p = this.app.picture;
    const x = p ? propsOf(p.entry) : undefined;
    const key = p ? `${p.name}|${p.version}|${p.page}|${p.frame}|${this.app.folder.index}|${this.app.tab.dirty}|${JSON.stringify(x || {})}` : 'none';
    if (key === this.key) return;
    this.key = key;
    this.body.replaceChildren(...(p ? infoRows(this.app).map(([k, v]) => h('div', { class: 'qn-info-row' }, h('span', { class: 'qn-info-k' }, k), h('span', { class: 'qn-info-v' }, v))) : [h('p', { class: 'ql-help' }, 'No picture.')]));
    const loc = p && (x?.lat ?? p.exif?.gps?.lat);
    if (p && loc !== undefined) { const lat = x?.lat ?? p.exif!.gps!.lat, lon = x?.lon ?? p.exif!.gps!.lon; this.body.appendChild(h('button', { class: 'ql-link', type: 'button', onclick: () => openExternal(`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=15/${lat}/${lon}`) }, 'Show on OpenStreetMap')); }
    this.drawHistogram();
  }
  private drawHistogram(): void {
    const p = this.app.picture, c = this.hist, x = c.getContext('2d')!;
    x.clearRect(0, 0, c.width, c.height);
    if (!p) { c.style.display = 'none'; return; }
    c.style.display = '';
    const src = p.frameCanvas(), k = Math.min(1, 256 / Math.max(src.width, src.height));
    const t = document.createElement('canvas'); t.width = Math.max(1, Math.round(src.width * k)); t.height = Math.max(1, Math.round(src.height * k));
    const tx = t.getContext('2d', { willReadFrequently: true })!; tx.drawImage(src, 0, 0, t.width, t.height);
    const hs = histogram(tx.getImageData(0, 0, t.width, t.height).data);
    x.fillStyle = 'rgba(0,0,0,0.5)'; x.fillRect(0, 0, c.width, c.height);
    x.globalCompositeOperation = 'lighter';
    const draw = (hh: Uint32Array, color: string) => { let mx = 1; for (let i = 1; i < 255; i++) mx = Math.max(mx, hh[i]); x.fillStyle = color; for (let i = 0; i < 256; i++) { const b = Math.min(1, hh[i] / mx) * c.height; x.fillRect(i, c.height - b, 1, b); } };
    draw(hs.r, 'rgba(255,60,60,0.75)'); draw(hs.g, 'rgba(60,255,60,0.75)'); draw(hs.b, 'rgba(80,80,255,0.75)');
    x.globalCompositeOperation = 'source-over';
  }
}

let pane: InfoPane | null = null;
export const infoPane = (app: App): InfoPane => (pane ??= new InfoPane(app));
export const infoPaneOpen = (): boolean => !!pane?.open;
