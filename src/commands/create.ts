/**
 * Create tab: pictures made from several pictures — Join Side by Side, Image Strip, Comparison
 * Picture, Contact Sheet (picture or PDF), Collage, Animation from Pictures, Multipage TIFF or PDF,
 * Icon Set (web and app icons with a manifest snippet) and Extract All Frames. Inputs are the marked
 * thumbnails, else the whole folder; results open in a new window or save as a file.
 */
import { def } from './registry';
import type { App } from '../app';
import type { Entry } from '../picture/folder';
import { Folder, entryFromBytes } from '../picture/folder';
import { openDialog, toast } from '../ui/dialog';
import type { Field } from '../ui/dialog';
import { decodePicture, encodeCanvas } from '../codecs/registry';
import { encodePng, encodeApng, encodeIco } from '../codecs/pngenc';
import { encodeGif } from '../codecs/gifenc';
import { medianCut, mapToPalette } from '../codecs/palette';
import { makePdf, PAPER_PT } from '../codecs/pdfwrite';
import { encodeTiff } from '../codecs/tiffwrite';
import { writeZip } from '../picture/batch';
import { saveAs } from '../platform/native';
import { fmtSize } from '../ui/shell';
import { hexToRgb } from '../picture/ops';
import type { Raster } from '../codecs/raster';

const rasterOf = (c: HTMLCanvasElement): Raster => { const id = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height); return { width: c.width, height: c.height, data: id.data as Uint8ClampedArray<ArrayBuffer> }; };
const base = (name: string) => name.replace(/\.[^.]+$/, '') || 'picture';
const many = (app: App) => app.folder.length > 1 || app.tab.marked.size > 1;

/** The inputs: marked thumbnails in folder order, else the whole folder. */
function inputsOf(app: App): Entry[] { const t = app.tab; const m = t.folder.entries.filter((e) => t.marked.has(e)); return m.length ? m : [...t.folder.entries]; }

interface Loaded { entry: Entry; canvas: HTMLCanvasElement; name: string; date?: string; camera?: string }
/** Decodes inputs at full size (or scaled to `max` on the long side), skipping files that fail. */
async function loadAll(app: App, entries: Entry[], max = 0): Promise<Loaded[]> {
  const out: Loaded[] = []; let i = 0;
  for (const e of entries) {
    i++; if (i % 5 === 0) toast(`Loading ${i} of ${entries.length}…`, { ms: 700 });
    try {
      const cur = app.tab.picture; let c: HTMLCanvasElement; let exif = cur && cur.entry === e ? cur.exif : null;
      if (cur && cur.entry === e) c = cur.frameCanvas();
      else { const u8 = new Uint8Array(await e.read()); const pic = await decodePicture(u8, e); c = pic.frameCanvas(); exif = pic.exif; pic.release(); }
      if (max && Math.max(c.width, c.height) > max) { const k = max / Math.max(c.width, c.height); const s = document.createElement('canvas'); s.width = Math.max(1, Math.round(c.width * k)); s.height = Math.max(1, Math.round(c.height * k)); const x = s.getContext('2d')!; x.imageSmoothingQuality = 'high'; x.drawImage(c, 0, 0, s.width, s.height); c = s; }
      else if (cur && cur.entry === e) { const s = document.createElement('canvas'); s.width = c.width; s.height = c.height; s.getContext('2d')!.drawImage(c, 0, 0); c = s; }
      out.push({ entry: e, canvas: c, name: e.name, date: exif?.dateTaken, camera: [exif?.make, exif?.model].filter(Boolean).join(' ') || undefined });
    } catch { /* skipped */ }
  }
  return out;
}

async function openResult(app: App, c: HTMLCanvasElement, name: string, folderName: string, format: 'png' | 'jpeg' = 'png'): Promise<void> {
  const blob = await encodeCanvas(c, format, 0.92);
  await app.openFolder(new Folder([entryFromBytes(name, await blob.arrayBuffer())], folderName), 0, { newWindow: true });
}
const fill = (c: HTMLCanvasElement, color: string, transparent = false) => { const x = c.getContext('2d')!; if (!transparent) { x.fillStyle = color; x.fillRect(0, 0, c.width, c.height); } return x; };
const caption = (x: CanvasRenderingContext2D, text: string, cx: number, y: number, size: number, color: string, maxW: number) => { x.font = `${size}px sans-serif`; x.textAlign = 'center'; x.textBaseline = 'top'; x.fillStyle = color; let t = text; while (t.length > 4 && x.measureText(t).width > maxW) t = t.slice(0, -2) + '…'; x.fillText(t, cx, y); };
const captionOf = (l: Loaded, mode: string) => mode === 'none' ? '' : mode === 'date' ? `${l.name}${l.date ? ` — ${l.date.slice(0, 10).replace(/:/g, '-')}` : ''}` : mode === 'size' ? `${l.name} (${l.canvas.width}×${l.canvas.height})` : mode === 'camera' ? `${l.name}${l.camera ? ` — ${l.camera}` : ''}` : l.name;
const CAPTIONS = [{ value: 'name', label: 'File name' }, { value: 'size', label: 'File name and dimensions' }, { value: 'date', label: 'File name and date taken' }, { value: 'camera', label: 'File name and camera' }, { value: 'none', label: 'None' }];

/** Lays pictures on a grid (uniform cells) and returns the canvas. */
function grid(items: Loaded[], o: { cols: number; cell: number; gap: number; bg: string; captions: string; captionSize: number; captionColor: string; frame: number; frameColor: string; transparent?: boolean }): HTMLCanvasElement {
  const capH = o.captions === 'none' ? 0 : o.captionSize * 1.6;
  const rows = Math.ceil(items.length / o.cols);
  const c = document.createElement('canvas'); c.width = o.cols * (o.cell + o.gap) + o.gap; c.height = rows * (o.cell + capH + o.gap) + o.gap;
  const x = fill(c, o.bg, o.transparent); x.imageSmoothingQuality = 'high';
  items.forEach((it, i) => {
    const col = i % o.cols, row = Math.floor(i / o.cols), x0 = o.gap + col * (o.cell + o.gap), y0 = o.gap + row * (o.cell + capH + o.gap);
    const inner = o.cell - 2 * o.frame, k = Math.min(inner / it.canvas.width, inner / it.canvas.height), w = it.canvas.width * k, h = it.canvas.height * k, px = x0 + (o.cell - w) / 2, py = y0 + (o.cell - h) / 2;
    if (o.frame) { x.fillStyle = o.frameColor; x.fillRect(px - o.frame, py - o.frame, w + 2 * o.frame, h + 2 * o.frame); }
    x.drawImage(it.canvas, px, py, w, h);
    if (capH) caption(x, captionOf(it, o.captions), x0 + o.cell / 2, y0 + o.cell + 2, o.captionSize, o.captionColor, o.cell);
  });
  return c;
}

async function animationFrom(app: App, items: Loaded[], r: Record<string, any>, name: string): Promise<void> {
  const w = Math.max(...items.map((i) => i.canvas.width)), h = Math.max(...items.map((i) => i.canvas.height));
  const max = +r.maxSide || 0, k = max ? Math.min(1, max / Math.max(w, h)) : 1, W = Math.max(1, Math.round(w * k)), H = Math.max(1, Math.round(h * k));
  const rasters = items.map((it) => { const c = document.createElement('canvas'); c.width = W; c.height = H; const x = fill(c, r.bg || '#000000'); x.imageSmoothingQuality = 'high'; const kk = Math.min(W / it.canvas.width, H / it.canvas.height); const ww = it.canvas.width * kk, hh = it.canvas.height * kk; x.drawImage(it.canvas, (W - ww) / 2, (H - hh) / 2, ww, hh); return { raster: rasterOf(c), delay: Math.max(10, +r.delay || 500) }; });
  toast('Encoding…', { ms: 2000 });
  let bytes: Uint8Array, ext: string, mime: string;
  if (r.format === 'apng') { bytes = await encodeApng(rasters, +r.loops || 0); ext = 'png'; mime = 'image/png'; }
  else { const all = new Uint8ClampedArray(rasters.reduce((s, f) => s + f.raster.data.length, 0)); let o = 0; for (const f of rasters) { all.set(f.raster.data, o); o += f.raster.data.length; } const pal = medianCut(all, 256); bytes = encodeGif(W, H, pal, rasters.map((f) => ({ indexes: mapToPalette(f.raster.data, pal, -1), delay: f.delay })), { loops: +r.loops || 0 }); ext = 'gif'; mime = 'image/gif'; }
  const saved = await saveAs(new Blob([bytes as BlobPart], { type: mime }), `${name}.${ext}`);
  if (saved) toast(`Saved ${saved.name} (${rasters.length} frames, ${fmtSize(bytes.length)})`);
}

async function jpegOf(c: HTMLCanvasElement, q: number): Promise<Uint8Array> { const flat = document.createElement('canvas'); flat.width = c.width; flat.height = c.height; const x = fill(flat, '#ffffff'); x.drawImage(c, 0, 0); return new Uint8Array(await (await encodeCanvas(flat, 'jpeg', q)).arrayBuffer()); }

const bgField = (value = '#ffffff'): Field => ({ key: 'bg', label: 'Background', type: 'color', value, half: true });
const capFields = (value = 'name'): Field[] => [{ key: 'captions', label: 'Captions', type: 'select', options: CAPTIONS, value, half: true }, { key: 'captionSize', label: 'Caption size (px)', type: 'number', min: 6, max: 200, value: 14, half: true }, { key: 'captionColor', label: 'Caption color', type: 'color', value: '#222222', half: true }];

def([
  {
    id: 'create.panoramaJoin', icon: 'view_column', popular: true, noRecord: true, isEnabled: many, tip: 'The marked pictures (or the folder) side by side or stacked, with spacing and alignment',
    run: async (app) => {
      const entries = inputsOf(app);
      const r = await openDialog({ title: 'Join Side by Side', ok: 'Join', help: `${entries.length} pictures in folder order (mark thumbnails to choose and order a subset).`, fields: [
        { key: 'dir', label: 'Direction', type: 'select', options: [{ value: 'h', label: 'Horizontal (left to right)' }, { value: 'v', label: 'Vertical (top to bottom)' }], value: 'h', half: true },
        { key: 'match', label: 'Sizes', type: 'select', options: [{ value: 'keep', label: 'Keep each size' }, { value: 'fit', label: 'Scale to the same height (or width)' }], value: 'fit', half: true },
        { key: 'align', label: 'Alignment', type: 'select', options: [{ value: 'start', label: 'Top / left' }, { value: 'center', label: 'Center' }, { value: 'end', label: 'Bottom / right' }], value: 'center', half: true },
        { key: 'gap', label: 'Spacing (px)', type: 'number', min: 0, max: 2000, value: 0, half: true }, bgField(), { key: 'transparent', label: 'Transparent background', type: 'checkbox', value: false, half: true },
      ] });
      if (!r) return;
      const items = await loadAll(app, entries); if (items.length < 2) { toast('Fewer than two pictures could be loaded.'); return; }
      const horiz = r.dir === 'h', gap = +r.gap || 0;
      const sizes = items.map((it) => { if (r.match !== 'fit') return [it.canvas.width, it.canvas.height]; const target = horiz ? Math.min(...items.map((x) => x.canvas.height)) : Math.min(...items.map((x) => x.canvas.width)); const k = horiz ? target / it.canvas.height : target / it.canvas.width; return [Math.round(it.canvas.width * k), Math.round(it.canvas.height * k)]; });
      const W = horiz ? sizes.reduce((s, z) => s + z[0], 0) + gap * (items.length - 1) : Math.max(...sizes.map((z) => z[0]));
      const H = horiz ? Math.max(...sizes.map((z) => z[1])) : sizes.reduce((s, z) => s + z[1], 0) + gap * (items.length - 1);
      const c = document.createElement('canvas'); c.width = W; c.height = H; const x = fill(c, r.bg, !!r.transparent); x.imageSmoothingQuality = 'high';
      let p = 0;
      items.forEach((it, i) => { const [w, h] = sizes[i]; const off = r.align === 'start' ? 0 : r.align === 'end' ? (horiz ? H - h : W - w) : (horiz ? (H - h) / 2 : (W - w) / 2); if (horiz) x.drawImage(it.canvas, p, off, w, h); else x.drawImage(it.canvas, off, p, w, h); p += (horiz ? w : h) + gap; });
      await openResult(app, c, `${base(items[0].name)}-joined.png`, 'Joined');
    },
  },
  {
    id: 'create.imageStrip', icon: 'view_carousel', noRecord: true, isEnabled: many, tip: 'A filmstrip of thumbnails of equal height with captions',
    run: async (app) => {
      const entries = inputsOf(app);
      const r = await openDialog({ title: 'Image Strip', ok: 'Create', help: `${entries.length} pictures.`, fields: [{ key: 'height', label: 'Thumbnail height (px)', type: 'number', min: 16, max: 2000, value: 200, half: true }, { key: 'gap', label: 'Spacing (px)', type: 'number', min: 0, max: 500, value: 8, half: true }, { key: 'vertical', label: 'Vertical strip', type: 'checkbox', value: false, half: true }, bgField('#202020'), ...capFields('name')] });
      if (!r) return;
      const items = await loadAll(app, entries, Math.max(+r.height * 2, 400)); if (!items.length) return;
      const hh = +r.height, gap = +r.gap, capH = r.captions === 'none' ? 0 : +r.captionSize * 1.6;
      const sizes = items.map((it) => [Math.round((it.canvas.width * hh) / it.canvas.height), hh] as [number, number]);
      const vertical = !!r.vertical;
      const W = vertical ? Math.max(...sizes.map((s) => s[0])) + 2 * gap : sizes.reduce((s, z) => s + z[0], 0) + gap * (items.length + 1);
      const H = vertical ? sizes.reduce((s, z) => s + z[1] + capH, 0) + gap * (items.length + 1) : hh + capH + 2 * gap;
      const c = document.createElement('canvas'); c.width = W; c.height = H; const x = fill(c, r.bg); x.imageSmoothingQuality = 'high';
      let p = gap;
      items.forEach((it, i) => { const [w] = sizes[i]; if (vertical) { x.drawImage(it.canvas, (W - w) / 2, p, w, hh); if (capH) caption(x, captionOf(it, r.captions), W / 2, p + hh + 2, +r.captionSize, r.captionColor, W - 2 * gap); p += hh + capH + gap; } else { x.drawImage(it.canvas, p, gap, w, hh); if (capH) caption(x, captionOf(it, r.captions), p + w / 2, gap + hh + 2, +r.captionSize, r.captionColor, w); p += w + gap; } });
      await openResult(app, c, `${app.tab.folder.name || 'pictures'}-strip.png`, 'Image strip');
    },
  },
  {
    id: 'create.comparison', icon: 'compare', noRecord: true, isEnabled: many, tip: 'Two to four pictures side by side with labels, for reports',
    run: async (app) => {
      const entries = inputsOf(app).slice(0, 4);
      if (entries.length < 2) { toast('Mark two to four pictures first.'); return; }
      const r = await openDialog({ title: 'Comparison Picture', ok: 'Create', help: `${entries.length} pictures: ${entries.map((e) => e.name).join(', ')}.`, fields: [
        ...entries.map((e, i) => ({ key: `label${i}`, label: `Label ${i + 1}`, type: 'text' as const, value: ['Before', 'After', 'Variant C', 'Variant D'][i], half: true })),
        { key: 'layout', label: 'Layout', type: 'select', options: [{ value: 'row', label: 'In a row' }, { value: 'grid', label: '2 × 2 grid' }, { value: 'column', label: 'In a column' }], value: 'row', half: true },
        { key: 'cell', label: 'Picture width (px)', type: 'number', min: 50, max: 4000, value: 600, half: true }, { key: 'gap', label: 'Spacing (px)', type: 'number', min: 0, max: 500, value: 16, half: true },
        { key: 'labelSize', label: 'Label size (px)', type: 'number', min: 8, max: 200, value: 22, half: true }, bgField(), { key: 'labelColor', label: 'Label color', type: 'color', value: '#111111', half: true },
      ] });
      if (!r) return;
      const items = await loadAll(app, entries, +r.cell * 2); if (items.length < 2) return;
      const cols = r.layout === 'row' ? items.length : r.layout === 'column' ? 1 : 2, cell = +r.cell, gap = +r.gap, labelH = +r.labelSize * 1.8;
      const hts = items.map((it) => Math.round((it.canvas.height * cell) / it.canvas.width)), rowH = Math.max(...hts);
      const rows = Math.ceil(items.length / cols);
      const c = document.createElement('canvas'); c.width = cols * (cell + gap) + gap; c.height = rows * (rowH + labelH + gap) + gap; const x = fill(c, r.bg); x.imageSmoothingQuality = 'high';
      items.forEach((it, i) => { const col = i % cols, row = Math.floor(i / cols), x0 = gap + col * (cell + gap), y0 = gap + row * (rowH + labelH + gap); x.font = `bold ${+r.labelSize}px sans-serif`; x.textAlign = 'center'; x.textBaseline = 'top'; x.fillStyle = r.labelColor; x.fillText(String(r[`label${i}`] || ''), x0 + cell / 2, y0 + +r.labelSize * 0.3); x.drawImage(it.canvas, x0, y0 + labelH, cell, hts[i]); });
      await openResult(app, c, `${base(items[0].name)}-comparison.png`, 'Comparison');
    },
  },
  {
    id: 'create.contactSheet', icon: 'grid_on', popular: true, noRecord: true, isEnabled: (app) => app.folder.length > 0, tip: 'Thumbnails on pages with captions; as pictures or a PDF',
    run: async (app) => {
      const entries = inputsOf(app);
      const r = await openDialog({ title: 'Contact Sheet', wide: true, ok: 'Create', help: `${entries.length} pictures.`, fields: [
        { key: 'out', label: 'Output', type: 'select', options: [{ value: 'picture', label: 'Pictures (one per page, opened in a new window)' }, { value: 'pdf', label: 'PDF file' }], value: 'picture', half: true },
        { key: 'paper', label: 'Page', type: 'select', options: [{ value: 'a4', label: 'A4 portrait' }, { value: 'a4l', label: 'A4 landscape' }, { value: 'letter', label: 'Letter portrait' }, { value: 'letterl', label: 'Letter landscape' }, { value: 'square', label: 'Square (2048 px)' }], value: 'a4', half: true },
        { key: 'dpi', label: 'Resolution (dpi)', type: 'number', min: 50, max: 600, value: 150, half: true }, { key: 'cols', label: 'Columns', type: 'number', min: 1, max: 20, value: 4, half: true }, { key: 'rows', label: 'Rows', type: 'number', min: 1, max: 20, value: 5, half: true },
        { key: 'margin', label: 'Margin (mm)', type: 'number', min: 0, max: 50, value: 10, half: true }, bgField(), ...capFields('name'), { key: 'title', label: 'Page title (blank for the folder name)', type: 'text', value: '' },
        { key: 'quality', label: 'JPEG quality for PDF (%)', type: 'number', min: 30, max: 100, value: 85, half: true, visibleIf: (v) => v.out === 'pdf' },
      ] });
      if (!r) return;
      const dpi = +r.dpi; const mm = (v: number) => (v / 25.4) * dpi;
      const paperPt = r.paper.startsWith('a4') ? PAPER_PT.a4 : r.paper.startsWith('letter') ? PAPER_PT.letter : [1474.56, 1474.56];
      let [pw, ph] = [paperPt[0] * (dpi / 72), paperPt[1] * (dpi / 72)]; if (r.paper.endsWith('l')) [pw, ph] = [ph, pw]; pw = Math.round(pw); ph = Math.round(ph);
      const cols = +r.cols, rows = +r.rows, per = cols * rows, margin = mm(+r.margin), titleH = mm(8), capH = r.captions === 'none' ? 0 : +r.captionSize * 1.6, gap = mm(3);
      const cellW = (pw - 2 * margin - (cols - 1) * gap) / cols, cellH = (ph - 2 * margin - titleH - (rows - 1) * gap) / rows - capH;
      const items = await loadAll(app, entries, Math.round(Math.max(cellW, cellH) * 1.5)); if (!items.length) return;
      const pages: HTMLCanvasElement[] = [];
      const title = String(r.title || app.tab.folder.name || 'Contact sheet');
      for (let p = 0; p * per < items.length; p++) {
        const c = document.createElement('canvas'); c.width = pw; c.height = ph; const x = fill(c, r.bg); x.imageSmoothingQuality = 'high';
        x.font = `bold ${Math.round(mm(4))}px sans-serif`; x.textAlign = 'left'; x.textBaseline = 'top'; x.fillStyle = r.captionColor; x.fillText(`${title} — page ${p + 1} of ${Math.ceil(items.length / per)}`, margin, margin);
        items.slice(p * per, (p + 1) * per).forEach((it, i) => { const col = i % cols, row = Math.floor(i / cols), x0 = margin + col * (cellW + gap), y0 = margin + titleH + row * (cellH + capH + gap); const k = Math.min(cellW / it.canvas.width, cellH / it.canvas.height), w = it.canvas.width * k, h = it.canvas.height * k; x.drawImage(it.canvas, x0 + (cellW - w) / 2, y0 + (cellH - h) / 2, w, h); if (capH) caption(x, captionOf(it, r.captions), x0 + cellW / 2, y0 + cellH + 2, +r.captionSize, r.captionColor, cellW); });
        pages.push(c);
      }
      if (r.out === 'pdf') {
        const q = (+r.quality || 85) / 100; const pdfPages = [];
        for (const c of pages) pdfPages.push({ image: await jpegOf(c, q), width: c.width, height: c.height, pageWidth: (c.width * 72) / dpi, pageHeight: (c.height * 72) / dpi });
        const bytes = makePdf(pdfPages, { title });
        const saved = await saveAs(new Blob([bytes as BlobPart], { type: 'application/pdf' }), `${title.replace(/[\\/:*?"<>|]/g, '_')}.pdf`);
        if (saved) toast(`Saved ${saved.name} (${pages.length} page${pages.length === 1 ? '' : 's'}, ${fmtSize(bytes.length)})`);
        return;
      }
      const folder = new Folder([], 'Contact sheet');
      for (let i = 0; i < pages.length; i++) folder.entries.push(entryFromBytes(`${title.replace(/[\\/:*?"<>|]/g, '_')}-${String(i + 1).padStart(2, '0')}.png`, await (await encodeCanvas(pages[i], 'png')).arrayBuffer()));
      await app.openFolder(folder, 0, { newWindow: true });
    },
  },
  {
    id: 'create.collage', icon: 'dashboard', noRecord: true, isEnabled: many, tip: 'Grid, justified mosaic or scattered prints with frames',
    run: async (app) => {
      const entries = inputsOf(app);
      const r = await openDialog({ title: 'Collage', ok: 'Create', help: `${entries.length} pictures.`, fields: [
        { key: 'layout', label: 'Layout', type: 'select', options: [{ value: 'grid', label: 'Grid' }, { value: 'mosaic', label: 'Mosaic (justified rows)' }, { value: 'scatter', label: 'Scattered prints' }], value: 'mosaic', half: true },
        { key: 'width', label: 'Width (px)', type: 'number', min: 200, max: 8000, value: 1600, half: true }, { key: 'rowH', label: 'Row height / cell (px)', type: 'number', min: 40, max: 2000, value: 320, half: true },
        { key: 'gap', label: 'Spacing (px)', type: 'number', min: 0, max: 200, value: 8, half: true }, { key: 'frame', label: 'Frame (px)', type: 'number', min: 0, max: 100, value: 0, half: true }, { key: 'frameColor', label: 'Frame color', type: 'color', value: '#ffffff', half: true }, bgField('#111111'),
      ] });
      if (!r) return;
      const items = await loadAll(app, entries, +r.rowH * 2); if (!items.length) return;
      const W = +r.width, gap = +r.gap, frame = +r.frame;
      let c: HTMLCanvasElement;
      if (r.layout === 'grid') { const cols = Math.max(1, Math.floor((W - gap) / (+r.rowH + gap))); c = grid(items, { cols, cell: +r.rowH, gap, bg: r.bg, captions: 'none', captionSize: 0, captionColor: '#000', frame, frameColor: r.frameColor }); }
      else if (r.layout === 'mosaic') {
        // Justified rows: fill each row to the width, scaling its pictures to a common height.
        const rows: { items: Loaded[]; h: number }[] = []; let row: Loaded[] = [], arSum = 0; const target = +r.rowH;
        for (const it of items) { row.push(it); arSum += it.canvas.width / it.canvas.height; const h = (W - gap * (row.length + 1) - 2 * frame * row.length) / arSum; if (h <= target) { rows.push({ items: row, h }); row = []; arSum = 0; } }
        if (row.length) rows.push({ items: row, h: Math.min(target, (W - gap * (row.length + 1) - 2 * frame * row.length) / arSum) });
        c = document.createElement('canvas'); c.width = W; c.height = Math.round(rows.reduce((s, rw) => s + rw.h + 2 * frame + gap, gap)); const x = fill(c, r.bg); x.imageSmoothingQuality = 'high';
        let y = gap; for (const rw of rows) { let xx = gap; for (const it of rw.items) { const w = (it.canvas.width * rw.h) / it.canvas.height; if (frame) { x.fillStyle = r.frameColor; x.fillRect(xx, y, w + 2 * frame, rw.h + 2 * frame); } x.drawImage(it.canvas, xx + frame, y + frame, w, rw.h); xx += w + 2 * frame + gap; } y += rw.h + 2 * frame + gap; }
      } else {
        const H = Math.round(W * 0.75); c = document.createElement('canvas'); c.width = W; c.height = H; const x = fill(c, r.bg); x.imageSmoothingQuality = 'high';
        let seed = 12345; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
        const size = +r.rowH, fr = frame || Math.round(size * 0.05);
        items.forEach((it, i) => { const k = size / Math.max(it.canvas.width, it.canvas.height), w = it.canvas.width * k, h = it.canvas.height * k; const cx = (W * (0.5 + (i % 3 - 1) * 0.3)) + (rnd() - 0.5) * W * 0.25, cy = (H * (0.5 + (Math.floor(i / 3) % 3 - 1) * 0.3)) + (rnd() - 0.5) * H * 0.25; x.save(); x.translate(cx, cy); x.rotate((rnd() - 0.5) * 0.5); x.shadowColor = 'rgba(0,0,0,0.5)'; x.shadowBlur = size * 0.06; x.shadowOffsetY = size * 0.03; x.fillStyle = r.frameColor; x.fillRect(-w / 2 - fr, -h / 2 - fr, w + 2 * fr, h + 2 * fr + fr * 2); x.shadowColor = 'transparent'; x.drawImage(it.canvas, -w / 2, -h / 2, w, h); x.restore(); });
      }
      await openResult(app, c, `${app.tab.folder.name || 'pictures'}-collage.png`, 'Collage');
    },
  },
  {
    id: 'create.animation', icon: 'animation', noRecord: true, isEnabled: many, tip: 'The marked pictures (or the folder) as an animated GIF or APNG',
    run: async (app) => {
      const entries = inputsOf(app);
      const r = await openDialog({ title: 'Animation from Pictures', ok: 'Save…', help: `${entries.length} frames in folder order.`, fields: [
        { key: 'format', label: 'Format', type: 'radio', options: [{ value: 'gif', label: 'GIF (256 colors)' }, { value: 'apng', label: 'APNG (full color)' }], value: 'gif' },
        { key: 'delay', label: 'Frame delay (ms)', type: 'number', min: 10, max: 60000, value: 500, half: true }, { key: 'loops', label: 'Loops (0 = forever)', type: 'number', min: 0, max: 65535, value: 0, half: true },
        { key: 'maxSide', label: 'Longest side (px, 0 = keep)', type: 'number', min: 0, max: 4096, value: 800, half: true }, bgField('#000000'),
      ] });
      if (!r) return;
      const items = await loadAll(app, entries, +r.maxSide || 0); if (!items.length) return;
      await animationFrom(app, items, r, `${app.tab.folder.name || 'animation'}`);
    },
  },
  {
    id: 'create.multipage', icon: 'auto_stories', noRecord: true, isEnabled: (app) => app.folder.length > 0, tip: 'The marked pictures (or the folder) as one multipage TIFF or PDF',
    run: async (app) => {
      const entries = inputsOf(app);
      const r = await openDialog({ title: 'Multipage TIFF or PDF', ok: 'Save…', help: `${entries.length} pages in folder order.`, fields: [
        { key: 'format', label: 'File', type: 'radio', options: [{ value: 'pdf', label: 'PDF (JPEG pages)' }, { value: 'tiff', label: 'TIFF (uncompressed RGB)' }], value: 'pdf' },
        { key: 'paper', label: 'PDF page', type: 'select', options: [{ value: 'fit', label: 'Each page the picture\'s size' }, { value: 'a4', label: 'A4' }, { value: 'letter', label: 'Letter' }], value: 'fit', half: true, visibleIf: (v) => v.format === 'pdf' },
        { key: 'quality', label: 'JPEG quality (%)', type: 'number', min: 30, max: 100, value: 88, half: true, visibleIf: (v) => v.format === 'pdf' },
        { key: 'maxSide', label: 'Longest side (px, 0 = keep)', type: 'number', min: 0, max: 10000, value: 0, half: true },
      ] });
      if (!r) return;
      const items = await loadAll(app, entries, +r.maxSide || 0); if (!items.length) return;
      let bytes: Uint8Array, ext: string, mime: string;
      if (r.format === 'tiff') { bytes = encodeTiff(items.map((it) => ({ raster: rasterOf(it.canvas) }))); ext = 'tif'; mime = 'image/tiff'; }
      else {
        const paper = r.paper === 'a4' ? PAPER_PT.a4 : r.paper === 'letter' ? PAPER_PT.letter : null; const pages = [];
        for (const it of items) { const landscape = it.canvas.width > it.canvas.height; pages.push({ image: await jpegOf(it.canvas, (+r.quality || 88) / 100), width: it.canvas.width, height: it.canvas.height, pageWidth: paper ? (landscape ? paper[1] : paper[0]) : undefined, pageHeight: paper ? (landscape ? paper[0] : paper[1]) : undefined, margin: paper ? 18 : 0 }); }
        bytes = makePdf(pages, { title: app.tab.folder.name || 'Pictures' }); ext = 'pdf'; mime = 'application/pdf';
      }
      const saved = await saveAs(new Blob([bytes as BlobPart], { type: mime }), `${app.tab.folder.name || 'pictures'}.${ext}`);
      if (saved) toast(`Saved ${saved.name} (${items.length} pages, ${fmtSize(bytes.length)})`);
    },
  },
  {
    id: 'create.icon', icon: 'apps', noRecord: true, isEnabled: (app) => !!app.picture, tip: 'favicon.ico, PNG icons (16–512), apple-touch-icon and a web manifest snippet, zipped',
    run: async (app) => {
      const pic = app.picture!;
      const r = await openDialog({ title: 'Icon Set', ok: 'Save…', fields: [{ key: 'name', label: 'App name (for the manifest)', type: 'text', value: base(pic.name) }, { key: 'bg', label: 'Background for the maskable icon', type: 'color', value: '#ffffff', half: true }, { key: 'square', label: 'Crop to a centered square (else pad)', type: 'checkbox', value: true, half: true }] });
      if (!r) return;
      const src = pic.frameCanvas(); const s = Math.min(src.width, src.height);
      const make = (size: number, pad = 0, bg?: string) => { const c = document.createElement('canvas'); c.width = size; c.height = size; const x = c.getContext('2d')!; x.imageSmoothingQuality = 'high'; if (bg) { x.fillStyle = bg; x.fillRect(0, 0, size, size); } const inner = size - 2 * pad; if (r.square) x.drawImage(src, (src.width - s) / 2, (src.height - s) / 2, s, s, pad, pad, inner, inner); else { const k = Math.min(inner / src.width, inner / src.height); const w = src.width * k, h = src.height * k; x.drawImage(src, pad + (inner - w) / 2, pad + (inner - h) / 2, w, h); } return c; };
      const files: { name: string; data: Uint8Array }[] = [];
      for (const size of [16, 32, 48, 64, 96, 128, 192, 256, 512]) files.push({ name: `icon-${size}.png`, data: await encodePng(rasterOf(make(size))) });
      files.push({ name: 'apple-touch-icon.png', data: await encodePng(rasterOf(make(180, 0, r.bg))) });
      files.push({ name: 'icon-512-maskable.png', data: await encodePng(rasterOf(make(512, 51, r.bg))) });
      const icoEntries = []; for (const size of [16, 32, 48]) icoEntries.push({ size, png: await encodePng(rasterOf(make(size))) });
      files.push({ name: 'favicon.ico', data: encodeIco(icoEntries) });
      const manifest = { name: String(r.name || 'App'), short_name: String(r.name || 'App').slice(0, 12), icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png' }, { src: 'icon-512.png', sizes: '512x512', type: 'image/png' }, { src: 'icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }], theme_color: r.bg, background_color: r.bg, display: 'standalone' };
      files.push({ name: 'manifest.webmanifest', data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) });
      files.push({ name: 'head-snippet.html', data: new TextEncoder().encode(`<link rel="icon" href="favicon.ico" sizes="any">\n<link rel="icon" href="icon-32.png" type="image/png" sizes="32x32">\n<link rel="apple-touch-icon" href="apple-touch-icon.png">\n<link rel="manifest" href="manifest.webmanifest">\n<meta name="theme-color" content="${r.bg}">\n`) });
      const zip = writeZip(files);
      const saved = await saveAs(new Blob([zip as BlobPart], { type: 'application/zip' }), `${base(pic.name)}-icons.zip`);
      if (saved) toast(`Saved ${saved.name} (${files.length} files, ${fmtSize(zip.length)})`);
    },
  },
  {
    id: 'create.extractFrames', icon: 'burst_mode', noRecord: true, isEnabled: (app) => !!app.picture && (app.picture.animated || app.picture.multipage), tip: 'Every frame or page of this picture as PNG files in a ZIP',
    run: async (app) => {
      const pic = app.picture!;
      const frames = pic.animated ? pic.current.frames : pic.pages.map((p) => p.frames[0]);
      const r = await openDialog({ title: 'Extract All Frames', ok: 'Save…', help: `${frames.length} ${pic.animated ? 'frames' : 'pages'}.`, fields: [{ key: 'format', label: 'Format', type: 'select', options: [{ value: 'png', label: 'PNG' }, { value: 'jpeg', label: 'JPEG' }], value: 'png', half: true }, { key: 'every', label: 'Every Nth frame', type: 'number', min: 1, max: 1000, value: 1, half: true }] });
      if (!r) return;
      const files: { name: string; data: Uint8Array }[] = []; const every = Math.max(1, +r.every || 1);
      for (let i = 0; i < frames.length; i += every) { const f = frames[i]; const c = document.createElement('canvas'); c.width = f.width; c.height = f.height; c.getContext('2d')!.drawImage(f.image as CanvasImageSource, 0, 0); files.push({ name: `${base(pic.name)}-${String(i + 1).padStart(3, '0')}.${r.format === 'jpeg' ? 'jpg' : 'png'}`, data: new Uint8Array(await (await encodeCanvas(c, r.format, 0.92)).arrayBuffer()) }); }
      const zip = writeZip(files);
      const saved = await saveAs(new Blob([zip as BlobPart], { type: 'application/zip' }), `${base(pic.name)}-frames.zip`);
      if (saved) toast(`Saved ${saved.name} (${files.length} files, ${fmtSize(zip.length)})`);
    },
  },
]);
