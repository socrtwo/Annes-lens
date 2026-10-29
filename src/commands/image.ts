/** Image commands: information, histogram, color count, rotation and flips (view and save), EXIF auto-rotate. */
import { def } from './registry';
import type { App } from '../app';
import { openDialog, toast } from '../ui/dialog';
import { h } from '../ui/dom';
import { transformPage, orientationOps } from '../picture/model';
import { fmtSize } from '../ui/shell';
import { esc } from '../ui/dom';

const transform = (id: string, icon: string, op: 'cw' | 'ccw' | '180' | 'flipH' | 'flipV', label: string, popular = false) => ({
  id, icon, popular, edits: true,
  run: (app: App) => app.edit(label, (p) => { p.pages = p.pages.map((pg, i) => (i === p.page ? transformPage(pg, op) : pg)); }),
});

export function infoRows(app: App): [string, string][] {
  const pic = app.picture!;
  const pg = pic.current;
  const rows: [string, string][] = [
    ['File name', pic.name],
    ['Location', pic.entry.uri ? pic.entry.uri.replace(/^file:\/\//, '') : 'not on disk (dropped, pasted or shared)'],
    ['File size', `${fmtSize(pic.bytes.length)} (${pic.bytes.length.toLocaleString()} bytes)`],
    ['Format', `${pic.format.label}${pic.decoder.startsWith('platform') ? ' (platform decoder)' : ` (Anne's Lens ${pic.decoder} reader)`}`],
    ['Dimensions', `${pg.width} × ${pg.height} pixels (${(pg.width * pg.height / 1e6).toFixed(2)} megapixels)`],
    ['Print size', pg.dpi ? `${(pg.width / pg.dpi[0]).toFixed(2)} × ${(pg.height / pg.dpi[1]).toFixed(2)} in at ${pg.dpi[0]} × ${pg.dpi[1]} dpi` : 'no resolution stored (96 dpi assumed)'],
    ['Bits per pixel', `${pg.bitDepth}${pg.paletteSize ? ` (palette of ${pg.paletteSize} colors)` : ''}${pg.hasAlpha ? ', with transparency' : ''}`],
    ['Pages', `${pic.pages.length}${pic.pages.length > 1 ? ` (showing ${pic.page + 1})` : ''}`],
    ['Frames', `${pg.frames.length}${pg.frames.length > 1 ? `, ${pg.loops ? `${pg.loops} loop(s)` : 'loops forever'}, ${Math.round(pg.frames.reduce((s, f) => s + f.delay, 0) / 10) / 100} s` : ''}`],
    ['Details', pg.notes.join(', ') || '—'],
    ['Compression', `${(pic.bytes.length * 8 / (pg.width * pg.height)).toFixed(2)} bits per pixel in the file`],
    ['Decoded in', `${pic.loadMs} ms`],
  ];
  if (pic.exif) {
    const e = pic.exif;
    if (e.make || e.model) rows.push(['Camera', [e.make, e.model].filter(Boolean).join(' ')]);
    if (e.lens) rows.push(['Lens', e.lens]);
    if (e.exposure) rows.push(['Exposure', e.exposure]);
    if (e.dateTaken) rows.push(['Date taken', e.dateTaken]);
    if (e.orientation !== 1) rows.push(['EXIF orientation', String(e.orientation) + (pic.orientationApplied ? ' (applied)' : ' (not applied)')]);
    if (e.gps) rows.push(['Location (GPS)', `${e.gps.lat.toFixed(5)}, ${e.gps.lon.toFixed(5)}${e.gps.alt !== undefined ? `, ${Math.round(e.gps.alt)} m` : ''}`]);
    if (e.software) rows.push(['Software', e.software]);
    if (e.description) rows.push(['Description', e.description]);
    if (e.copyright) rows.push(['Copyright', e.copyright]);
  }
  for (const [k, v] of Object.entries(pic.info)) if (v && k !== 'segments' && k !== 'chunks') rows.push([k[0].toUpperCase() + k.slice(1), v.length > 300 ? v.slice(0, 300) + '…' : v]);
  if (pic.info.segments) rows.push(['JPEG segments', pic.info.segments]);
  if (pic.info.chunks) rows.push(['Chunks', pic.info.chunks]);
  if (pic.warnings.length) rows.push(['Warnings', pic.warnings.join('; ')]);
  return rows;
}

def([
  {
    id: 'image.info', icon: 'info', popular: true, noRecord: true, isEnabled: (app) => !!app.picture,
    run: async (app) => {
      const rows = infoRows(app);
      const table = h('table', { class: 'ql-stats qn-info' }, ...rows.map(([k, v]) => h('tr', null, h('td', null, k), h('td', null, v))));
      await openDialog({ title: 'Picture Information', wide: true, content: table, cancel: false, ok: 'Close', buttons: [
        { label: 'Copy', onClick: () => { navigator.clipboard?.writeText(rows.map(([k, v]) => `${k}: ${v}`).join('\n')); toast('Copied'); } },
        { label: 'EXIF…', onClick: (_v, ctl) => { ctl.close(null); app.exec('meta.exif'); } },
      ] });
    },
  },
  {
    id: 'image.histogram', icon: 'bar_chart', noRecord: true, isEnabled: (app) => !!app.picture,
    run: async (app) => {
      const pic = app.picture!;
      const c = pic.frameCanvas();
      const d = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height).data;
      const hist = { r: new Uint32Array(256), g: new Uint32Array(256), b: new Uint32Array(256), l: new Uint32Array(256) };
      let sum = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) { hist.r[d[i]]++; hist.g[d[i + 1]]++; hist.b[d[i + 2]]++; const l = Math.round(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]); hist.l[l]++; sum += l; n++; }
      let lo = 0, hi = 255; while (lo < 255 && !hist.l[lo]) lo++; while (hi > 0 && !hist.l[hi]) hi--;
      const svg = (arr: Uint32Array, color: string) => { const max = Math.max(...arr) || 1; return `<polygon fill="${color}" fill-opacity=".55" points="0,100 ${[...arr].map((v, i) => `${i},${100 - (Math.log1p(v) / Math.log1p(max)) * 100}`).join(' ')} 255,100"/>`; };
      const draw = (mode: string) => `<svg viewBox="0 0 256 100" preserveAspectRatio="none" style="width:100%;height:180px;background:#111;border-radius:6px">${mode === 'rgb' ? svg(hist.r, '#f44') + svg(hist.g, '#4f4') + svg(hist.b, '#48f') : svg(hist.l, '#ddd')}</svg>`;
      await openDialog({ title: 'Histogram', wide: true, cancel: false, ok: 'Close', fields: [
        { key: 'mode', label: 'Channels', type: 'radio', options: [{ value: 'lum', label: 'Luminance' }, { value: 'rgb', label: 'Red, green, blue' }], value: 'lum' },
        { key: 'stats', type: 'info', html: `<p class="ql-help">${n.toLocaleString()} pixels · mean luminance ${(sum / n).toFixed(1)} · range ${lo}–${hi} · logarithmic scale</p>` },
      ], preview: draw('lum'), onChange: (v, ctl) => ctl.setPreview(draw(v.mode)) });
    },
  },
  {
    id: 'image.countColors', icon: 'palette', noRecord: true, isEnabled: (app) => !!app.picture,
    run: (app) => {
      const c = app.picture!.frameCanvas();
      const d = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height).data;
      const seen = new Set<number>();
      for (let i = 0; i < d.length; i += 4) seen.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
      toast(`${seen.size.toLocaleString()} unique colors in ${c.width} × ${c.height} pixels`, { ms: 5000 });
    },
  },
  transform('image.rotateLeft', 'rotate_left', 'ccw', 'Rotate Left', true),
  transform('image.rotateRight', 'rotate_right', 'cw', 'Rotate Right', true),
  transform('image.rotate180', 'sync', '180', 'Rotate 180°'),
  transform('image.flipH', 'flip', 'flipH', 'Flip Horizontal'),
  transform('image.flipV', 'flip', 'flipV', 'Flip Vertical'),
  {
    id: 'image.autoRotateExif', icon: 'screen_rotation', kind: 'toggle', tip: 'Turn the picture upright by its EXIF Orientation tag; also the display setting in Options',
    isActive: (app) => app.prefs.autoRotateExif,
    run: (app) => {
      const pic = app.picture;
      if (!pic) { app.prefs.autoRotateExif = !app.prefs.autoRotateExif; app.savePrefs(); return; }
      const ops = orientationOps(pic.orientation);
      if (!ops.length) { toast('This picture has no EXIF orientation to apply.'); return; }
      if (pic.orientationApplied) { toast('The EXIF orientation is already applied (Options ▸ Auto-rotate).'); return; }
      app.edit('Auto-Rotate by EXIF', (p) => { p.pages = p.pages.map((pg) => ops.reduce((acc, op) => transformPage(acc, op), pg)); p.orientationApplied = true; });
    },
  },
]);

export { esc };
