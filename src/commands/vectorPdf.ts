/**
 * Trace to Vector (SVG) and Generate Vector; Export as PDF (paper, orientation, margins, fit or fill
 * or actual size, captions); Magnifier Callout; Search by Color; New Folder.
 */
import { def } from './registry';
import type { App } from '../app';
import type { Raster } from '../codecs/raster';
import { openDialog, promptDialog, toast, type Field } from '../ui/dialog';
import { h } from '../ui/dom';
import { encodeCanvas } from '../codecs/registry';
import { makePdf, PAPER_PT, type PdfPage } from '../codecs/pdfwrite';
import { Folder, entryFromBytes, type Entry } from '../picture/folder';
import { frameRaster, rasterFrame, editRaster } from '../picture/edit';
import { resample } from '../picture/ops';
import { traceToSvg, type TraceOptions } from '../picture/trace';
import { drawCallout, type CalloutOptions } from '../picture/callout';
import { colorShare, averageColor } from '../picture/colorSearch';
import { saveAs, writeClipboardText, createSubfolder, canCreateSubfolder } from '../platform/native';
import { updateXmp } from '../meta/xmp';
import { makePictures, withJob, hasImage, needImage, provenanceProps } from '../ai';
import { entryRaster } from './aiShared';
import { inputsOf } from './batch';
import { dirUriOf } from './fileOps';

const has = (app: App) => !!app.picture;
const base = (n: string) => n.replace(/\.[^.]+$/, '');
const shrink = (r: Raster, max: number): Raster => { const k = Math.min(1, max / Math.max(r.width, r.height)); return k < 1 ? resample(r, Math.max(1, Math.round(r.width * k)), Math.max(1, Math.round(r.height * k)), 'lanczos3') : r; };
const hexOf = (c: [number, number, number]) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
const rgbOf = (hex: string): [number, number, number] => { const m = String(hex).match(/^#?([0-9a-f]{6})$/i); const v = m ? parseInt(m[1], 16) : 0; return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };

// Trace to Vector ------------------------------------------------------------------------------------

const traceFields = (colorDefault: 'bw' | 'color', colors = 8): Field[] => [
  { key: 'mode', label: 'Kind', type: 'select', options: [{ value: 'bw', label: 'Line art (one color)' }, { value: 'color', label: 'Color (posterized shapes)' }], value: colorDefault, half: true },
  { key: 'colors', label: 'Colors', type: 'range', min: 2, max: 32, value: colors, half: true, visibleIf: (v) => v.mode === 'color' },
  { key: 'auto', label: 'Automatic threshold (Otsu)', type: 'checkbox', value: true, half: true, visibleIf: (v) => v.mode === 'bw' },
  { key: 'threshold', label: 'Threshold', type: 'range', min: 0, max: 255, value: 128, half: true, visibleIf: (v) => v.mode === 'bw' && !v.auto },
  { key: 'invert', label: 'Trace the light parts', type: 'checkbox', value: false, half: true, visibleIf: (v) => v.mode === 'bw' },
  { key: 'fill', label: 'Line art color', type: 'color', value: '#000000', half: true, visibleIf: (v) => v.mode === 'bw' },
  { key: 'tolerance', label: 'Simplify (px)', type: 'range', min: 0, max: 4, step: 0.25, value: 1, half: true },
  { key: 'minArea', label: 'Drop specks smaller than (px²)', type: 'range', min: 0, max: 400, value: 8, half: true },
  { key: 'smooth', label: 'Smooth curves', type: 'checkbox', value: true, half: true },
  { key: 'background', label: 'Background', type: 'select', options: [{ value: '', label: 'Transparent' }, { value: '#ffffff', label: 'White' }], value: '', half: true },
  { key: 'maxSide', label: 'Trace at most (px, long side)', type: 'number', min: 64, max: 4096, value: 1600, half: true },
];
const traceOpts = (v: Record<string, any>, extra = ''): TraceOptions => ({ mode: v.mode, colors: +v.colors, threshold: v.auto ? -1 : +v.threshold, invert: !!v.invert, fill: v.fill, tolerance: +v.tolerance, smooth: !!v.smooth, minArea: +v.minArea, background: v.background, extra });

async function openSvg(app: App, svg: string, name: string): Promise<void> {
  const bytes = new TextEncoder().encode(svg);
  await app.openFolder(new Folder([entryFromBytes(name, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)], 'Vector'), 0, { newWindow: true });
}
async function saveSvg(svg: string, name: string): Promise<void> {
  const r = await saveAs(new Blob([svg], { type: 'image/svg+xml' }), name);
  toast(r ? `Saved ${r.name}.` : 'Not saved.');
}

async function vectorizeDialog(app: App, src: Raster, name: string, o: { title: string; mode: 'bw' | 'color'; colors?: number; extra?: string; note?: string }): Promise<void> {
  const preview = shrink(src, 360);
  const render = (v: Record<string, any>) => { try { const t = traceToSvg(preview, { ...traceOpts(v), minArea: Math.max(0, +v.minArea * (preview.width / src.width) ** 2), tolerance: +v.tolerance * Math.max(0.35, preview.width / src.width) }); return `${t.svg}<p class="ql-help">${t.paths} path${t.paths === 1 ? '' : 's'}${t.colors.length > 1 ? `; ${t.colors.length} colors` : ''} (preview)</p>`; } catch (e) { return `<p class="ql-help">${(e as Error).message}</p>`; } };
  let timer = 0;
  const full = (v: Record<string, any>) => traceToSvg(shrink(src, Math.max(64, +v.maxSide || 1600)), traceOpts(v, o.extra || ''));
  const v = await openDialog({ title: o.title, ok: 'Open as Picture', wide: true, preview: true, previewStyle: 'max-height:46vh;overflow:auto;background:repeating-conic-gradient(#ddd 0% 25%, #fff 0% 50%) 50%/16px 16px', help: o.note || 'Line art and logos trace best; photos become posterized shapes. The SVG opens as a picture you can save, or save it directly.', fields: traceFields(o.mode, o.colors),
    onOpen: (ctl) => ctl.setPreview(render(ctl.values())),
    onChange: (vals, ctl) => { clearTimeout(timer); timer = window.setTimeout(() => ctl.setPreview(render(vals)), 120); },
    buttons: [
      { label: 'Save SVG…', onClick: async (vals) => { await saveSvg(full(vals).svg, `${base(name)}.svg`); } },
      { label: 'Copy SVG', onClick: async (vals) => { await writeClipboardText(full(vals).svg); toast('SVG copied.'); } },
    ] });
  if (!v) return;
  const t = full(v);
  await openSvg(app, t.svg, `${base(name)}.svg`);
  toast(`${t.paths} path${t.paths === 1 ? '' : 's'} traced.`);
}

// Export as PDF ----------------------------------------------------------------------------------------

async function jpegOf(r: Raster, quality: number): Promise<Uint8Array> {
  const c = rasterFrame(r, 0).image as HTMLCanvasElement;
  const flat = document.createElement('canvas'); flat.width = c.width; flat.height = c.height;
  const x = flat.getContext('2d')!; x.fillStyle = '#ffffff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(c, 0, 0);
  return new Uint8Array(await (await encodeCanvas(flat, 'jpeg', quality)).arrayBuffer());
}

/** Page geometry for one picture (points). */
export function pdfPageSize(paper: string, orientation: 'auto' | 'portrait' | 'landscape', w: number, h: number, dpi: number): [number, number] {
  if (paper === 'picture') return [w * 72 / dpi, h * 72 / dpi];
  const [a, b] = PAPER_PT[paper] || PAPER_PT.a4;
  const landscape = orientation === 'landscape' || (orientation === 'auto' && w > h);
  return landscape ? [Math.max(a, b), Math.min(a, b)] : [Math.min(a, b), Math.max(a, b)];
}

def([
  {
    id: 'tools.vectorize', icon: 'polyline', noRecord: true, isEnabled: has, tip: 'Line art and logos to SVG paths (or posterized color shapes), with a live preview',
    run: async (app) => { const p = app.picture!; await vectorizeDialog(app, frameRaster(p.currentFrame), p.name, { title: 'Trace to Vector (SVG)', mode: 'bw' }); },
  },
  {
    id: 'ai.generateVector', icon: 'draw', noRecord: true, isEnabled: hasImage, tip: 'A picture from the picture service in a flat vector style, traced to SVG on this device',
    run: async (app) => {
      if (!hasImage(app)) { toast(needImage(app)!); return; }
      const v = await openDialog({ title: 'Generate Vector', ok: 'Generate', fields: [
        { key: 'prompt', label: 'Prompt', type: 'textarea', rows: 3, value: '', autofocus: true, placeholder: 'a fox logo, orange and white' },
        { key: 'colors', label: 'Colors in the SVG', type: 'range', min: 2, max: 16, value: 6, half: true },
      ] });
      if (!v || !String(v.prompt).trim()) return;
      const prompt = `${String(v.prompt).trim()}. Flat vector illustration: solid flat colors, no gradients, no texture, no shading, clean hard edges, simple shapes, plain white background.`;
      const r = await withJob(app, 'ai.generateVector', (status, signal) => makePictures(app, { command: 'ai.generateVector', prompt, width: 1024, height: 1024 }, status, signal));
      if (!r) return;
      const xmp = updateXmp(null, provenanceProps(app, { command: 'ai.generateVector', service: r.service, model: r.model, prompt: String(v.prompt).trim(), kind: 'generated' })).replace(/<\?xpacket[^>]*\?>\s*/g, '');
      await vectorizeDialog(app, r.rasters[0], `Vector ${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.png`, { title: 'Generate Vector: trace', mode: 'color', colors: +v.colors, extra: app.prefs.ai.credentials ? `<metadata>${xmp}</metadata>\n` : '', note: `${r.service} (${r.model}) drew the picture; it is traced here, on this device. ${app.prefs.ai.credentials ? 'The SVG carries AI provenance metadata.' : ''}` });
    },
  },
  {
    id: 'file.export.pdf', icon: 'picture_as_pdf', noRecord: true, isEnabled: (app) => app.folder.length > 0, tip: 'One or many pictures as a PDF: paper size, orientation, margins, fit or fill the page or actual size, captions',
    run: async (app) => {
      const { entries, marked } = inputsOf(app);
      const cur = app.picture?.entry;
      const v = await openDialog({ title: 'Export as PDF', ok: 'Save PDF…', wide: true, fields: [
        { key: 'which', label: 'Pages', type: 'select', options: [...(cur ? [{ value: 'current', label: `The current picture (${app.picture!.name})` }] : []), ...(marked ? [{ value: 'marked', label: `The ${entries.length} marked pictures` }] : []), { value: 'folder', label: `The whole folder (${app.folder.length})` }], value: marked ? 'marked' : cur ? 'current' : 'folder' },
        { key: 'paper', label: 'Paper', type: 'select', options: [{ value: 'a4', label: 'A4' }, { value: 'letter', label: 'US Letter' }, { value: 'legal', label: 'US Legal' }, { value: 'a3', label: 'A3' }, { value: 'a5', label: 'A5' }, { value: 'picture', label: 'The picture\'s own size (at the DPI below)' }], value: 'a4', half: true },
        { key: 'orientation', label: 'Orientation', type: 'select', options: [{ value: 'auto', label: 'Follow each picture' }, { value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }], value: 'auto', half: true, visibleIf: (x) => x.paper !== 'picture' },
        { key: 'fit', label: 'Placement', type: 'select', options: [{ value: 'contain', label: 'Fit inside the margins' }, { value: 'cover', label: 'Fill the area (crops)' }, { value: 'actual', label: 'Actual size at the DPI below' }], value: 'contain', half: true, visibleIf: (x) => x.paper !== 'picture' },
        { key: 'margin', label: 'Margins (mm)', type: 'number', min: 0, max: 60, value: 10, half: true, visibleIf: (x) => x.paper !== 'picture' },
        { key: 'dpi', label: 'DPI (actual size, picture-size paper)', type: 'number', min: 36, max: 2400, value: app.picture?.current.dpi || 300, half: true, visibleIf: (x) => x.paper === 'picture' || x.fit === 'actual' },
        { key: 'quality', label: 'JPEG quality', type: 'range', min: 40, max: 100, value: 88, half: true },
        { key: 'captions', label: 'Caption each page with the file name', type: 'checkbox', value: false, half: true },
        { key: 'title', label: 'Document title', type: 'text', value: app.folder.name || (app.picture ? base(app.picture.name) : 'Pictures') },
      ] });
      if (!v) return;
      const list: Entry[] = v.which === 'current' && cur ? [cur] : v.which === 'marked' ? entries : [...app.folder.entries];
      const pages: PdfPage[] = [];
      let i = 0;
      for (const e of list) {
        i++; if (list.length > 3 && i % 3 === 1) toast(`PDF page ${i} of ${list.length}…`, { ms: 1200 });
        try {
          const r = await entryRaster(app, e);
          const dpi = +v.dpi || 300;
          const [pw, ph] = pdfPageSize(v.paper, v.orientation, r.width, r.height, dpi);
          pages.push({ image: await jpegOf(r, (+v.quality || 88) / 100), width: r.width, height: r.height, pageWidth: pw, pageHeight: ph, margin: v.paper === 'picture' ? 0 : (+v.margin || 0) * 72 / 25.4, fit: v.paper === 'picture' ? 'contain' : v.fit, dpi, caption: v.captions ? e.name : undefined });
        } catch { toast(`Skipped ${e.name} (could not be read).`); }
      }
      if (!pages.length) { toast('No pages.'); return; }
      const bytes = makePdf(pages, { title: String(v.title || 'Pictures') });
      const saved = await saveAs(new Blob([bytes as BlobPart], { type: 'application/pdf' }), `${String(v.title || 'pictures').replace(/[\\/:*?"<>|]/g, '_')}.pdf`);
      toast(saved ? `${pages.length} page${pages.length === 1 ? '' : 's'} saved as ${saved.name}.` : 'Not saved.');
    },
  },
  {
    id: 'edit.callout', icon: 'zoom_in', edits: true, isEnabled: (app) => has(app) && !!app.tab.selection, tip: 'An enlarged inset of the selected area in a corner, framed and connected to it',
    run: async (app) => {
      const sel = { ...app.tab.selection! };
      const p = app.picture!; const ref = Math.max(p.width, p.height);
      const v = await openDialog({ title: 'Magnifier Callout', ok: 'Add', fields: [
        { key: 'zoom', label: 'Magnification', type: 'range', min: 1.5, max: 8, step: 0.5, value: 2.5, half: true },
        { key: 'position', label: 'Inset in', type: 'select', options: [{ value: 'auto', label: 'The corner farthest from the area' }, { value: 'tl', label: 'Top left' }, { value: 'tr', label: 'Top right' }, { value: 'bl', label: 'Bottom left' }, { value: 'br', label: 'Bottom right' }], value: 'auto', half: true },
        { key: 'shape', label: 'Shape', type: 'select', options: [{ value: 'rect', label: 'Rectangle' }, { value: 'circle', label: 'Circle' }], value: 'rect', half: true },
        { key: 'border', label: 'Frame width (px)', type: 'number', min: 0, max: 60, value: Math.max(2, Math.round(ref / 300)), half: true },
        { key: 'color', label: 'Frame color', type: 'color', value: '#ffffff', half: true },
        { key: 'maxShare', label: 'Inset at most (% of the picture)', type: 'range', min: 15, max: 70, value: 45, half: true },
        { key: 'connector', label: 'Connector lines', type: 'checkbox', value: true, half: true },
        { key: 'shadow', label: 'Shadow', type: 'checkbox', value: true, half: true },
        { key: 'pixelated', label: 'Show pixels (no smoothing)', type: 'checkbox', value: false, half: true },
      ] });
      if (!v) return;
      const o: CalloutOptions = { zoom: +v.zoom, position: v.position, shape: v.shape, border: +v.border, color: v.color, connector: !!v.connector, shadow: !!v.shadow, pixelated: !!v.pixelated, margin: Math.round(ref / 60), maxShare: +v.maxShare / 100 };
      editRaster(app, 'Magnifier Callout', (r) => drawCallout(r, sel, o).raster);
      app.tab.setSelection(null);
    },
  },
  {
    id: 'browse.searchColor', icon: 'format_color_fill', noRecord: true, isEnabled: (app) => app.folder.length > 0, tip: 'Pictures with much of a color (perceptual distance in L*a*b*); the thumbnails are filtered to them',
    run: async (app) => {
      const sel = app.tab.selection, p = app.picture;
      const start = p && sel ? hexOf(averageColor(frameRaster(p.currentFrame), sel)) : '#c03030';
      const v = await openDialog({ title: 'Search by Color', ok: 'Search', help: sel ? 'The color starts as the average of the selection.' : 'Tip: select an area first to start from its color.', fields: [
        { key: 'color', label: 'Color', type: 'color', value: start, half: true },
        { key: 'tolerance', label: 'How close (ΔE)', type: 'range', min: 4, max: 60, value: 20, half: true },
        { key: 'min', label: 'At least this share of the picture (%)', type: 'number', min: 0.1, max: 100, step: 0.1, value: 5, half: true },
      ] });
      if (!v) return;
      const rgb = rgbOf(v.color), tol = +v.tolerance, min = +v.min / 100;
      const hits: { entry: Entry; share: number }[] = [];
      let i = 0;
      for (const e of app.folder.entries) {
        i++; if (i % 25 === 0) toast(`Searched ${i} of ${app.folder.length}…`, { ms: 1000 });
        try { const share = colorShare(shrink(await entryRaster(app, e), 96), rgb, tol); if (share >= min) hits.push({ entry: e, share }); } catch { /* unreadable */ }
      }
      hits.sort((a, b) => b.share - a.share);
      if (!hits.length) { toast('No pictures have that much of the color.'); return; }
      const set = new Set(hits.map((x) => x.entry)), t = app.tab.thumbs;
      if (t) { t.filter = (e) => set.has(e); t.filterLabel = `Color ${v.color}`; t.refilter(); }
      const list = h('div', { class: 'qn-ai-chat' }, ...hits.map((x) => h('button', { class: 'qn-ai-card', type: 'button', onclick: () => { const k = app.folder.entries.indexOf(x.entry); if (k >= 0) app.folder.select(k); } }, `${x.entry.name} — ${Math.round(x.share * 1000) / 10}%`)));
      await openDialog({ title: `Color ${v.color}`, content: list, ok: 'Close', cancel: false, help: `${hits.length} picture${hits.length === 1 ? '' : 's'}; the thumbnail panel is filtered to them (Browse ▸ Filter clears it).` });
    },
  },
  {
    id: 'browse.newFolder', icon: 'create_new_folder', noRecord: true, isEnabled: (app) => canCreateSubfolder(dirUriOf(app.folder.current, app.folder)), tip: 'A new folder inside the current one',
    run: async (app) => {
      const dir = dirUriOf(app.folder.current, app.folder);
      if (!dir) { toast('Open a folder first.'); return; }
      const name = (await promptDialog('New Folder', 'Name', 'New folder'))?.trim();
      if (!name) return;
      if (/[\\/:*?"<>|]/.test(name) || name === '.' || name === '..') { toast('That name has characters a folder cannot use.'); return; }
      try { const r = await createSubfolder(dir, name); toast(`Folder "${r.name}" created.`); }
      catch (e) { toast(`Could not create the folder: ${(e as Error).message}`); }
    },
  },
]);
