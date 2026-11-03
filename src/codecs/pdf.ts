/**
 * PDF and PDF-compatible Illustrator files, rendered page by page with pdf.js (Apache-2.0; its
 * JPEG 2000, JBIG2 and color-management decoders are BSD and MIT licensed WebAssembly). pdf.js loads
 * like the other runtimes: from the build's local copy (runtimes.json, the desktop app) or from its
 * pinned CDN address. Pages are rendered at 150 dpi on white, within a page and pixel budget so a
 * long document stays within memory: past the budget the resolution drops (not below 72 dpi), and
 * past the page limit the rest is reported.
 */
import type { Page } from '../picture/model';
import { runtimeBase } from '../platform/runtimes';

export const PDFJS_VERSION = '6.5.438';
export const PDFJS_CDN = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/`;
/** Rendering settings (Options): resolution, how many pages, and the total pixels for the pages together. */
export const pdfOptions = { dpi: 150, maxPages: 100, budget: 60e6, maxSide: 5000 };

export function isPdf(u8: Uint8Array): boolean {
  const n = Math.min(u8.length - 5, 1024);
  for (let i = 0; i <= n; i++) if (u8[i] === 0x25 && u8[i + 1] === 0x50 && u8[i + 2] === 0x44 && u8[i + 3] === 0x46 && u8[i + 4] === 0x2d) return true; // %PDF-
  return false;
}

let lib: Promise<{ m: any; base: string }> | null = null;
async function pdfjs(): Promise<{ m: any; base: string }> {
  return (lib ??= (async () => {
    const base = await runtimeBase('pdf', PDFJS_CDN);
    const m: any = await import(/* @vite-ignore */ base + 'build/pdf.min.mjs');
    m.GlobalWorkerOptions.workerSrc = base + 'build/pdf.worker.min.mjs';
    return { m, base };
  })().catch((e) => { lib = null; throw new Error(`The PDF renderer (pdf.js) could not be loaded: ${(e as Error).message}`); }));
}

export interface PdfResult { pages: Page[]; info: Record<string, string>; warnings: string[] }
/** Renders the pages of a PDF. */
export async function decodePdf(u8: Uint8Array, o = pdfOptions, password?: string): Promise<PdfResult> {
  const { m, base } = await pdfjs();
  const task = m.getDocument({ data: u8.slice(), password, cMapUrl: base + 'cmaps/', cMapPacked: true, standardFontDataUrl: base + 'standard_fonts/', wasmUrl: base + 'wasm/', iccUrl: base + 'iccs/', enableXfa: false, verbosity: 0 });
  let doc: any;
  try { doc = await task.promise; }
  catch (e: any) {
    if (e?.name === 'PasswordException') throw Object.assign(new Error(e.code === 2 ? 'The password is not right for this PDF' : 'This PDF is protected by a password'), { password: e.code === 2 ? 'wrong' : 'needed' });
    throw new Error(`This PDF could not be read (${e?.message || e})`);
  }
  try {
    const n: number = doc.numPages, count = Math.min(n, Math.max(1, o.maxPages)), warnings: string[] = [];
    const pages: any[] = [], sizes: [number, number][] = [];
    for (let i = 1; i <= count; i++) { const p = await doc.getPage(i); const v = p.getViewport({ scale: 1 }); pages.push(p); sizes.push([v.width, v.height]); }
    // Resolution: the chosen dpi, lowered (not below 72) when the pages together would pass the pixel budget.
    const area = sizes.reduce((s, [w, h]) => s + w * h, 0);
    let dpi = o.dpi;
    if (area * (dpi / 72) ** 2 > o.budget) dpi = Math.max(72, Math.floor(72 * Math.sqrt(o.budget / area)));
    const out: Page[] = [];
    for (let i = 0; i < count; i++) {
      const scale = Math.min(dpi / 72, o.maxSide / Math.max(sizes[i][0], sizes[i][1]));
      const vp = pages[i].getViewport({ scale });
      const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(vp.width)); canvas.height = Math.max(1, Math.round(vp.height));
      const ctx = canvas.getContext('2d', { willReadFrequently: false })!;
      try { await pages[i].render({ canvas, canvasContext: ctx, viewport: vp, background: 'rgb(255,255,255)', annotationMode: 1 }).promise; }
      catch (e: any) { warnings.push(`Page ${i + 1}: ${e?.message || e}`); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
      pages[i].cleanup();
      const d = Math.round(scale * 72);
      out.push({ width: canvas.width, height: canvas.height, frames: [{ image: canvas, width: canvas.width, height: canvas.height, delay: 0 }], loops: 0, bitDepth: 24, hasAlpha: false, dpi: [d, d], notes: [`PDF page ${i + 1} of ${n}`, `${Math.round(sizes[i][0] / 72 * 25.4)} × ${Math.round(sizes[i][1] / 72 * 25.4)} mm`, `rendered at ${d} dpi by pdf.js`] });
    }
    if (count < n) warnings.push(`Pages 1–${count} of ${n} are shown (Options: PDF pages); open the PDF in Anne's Folio for all of them`);
    if (dpi < o.dpi) warnings.push(`Rendered at ${dpi} dpi instead of ${o.dpi} to keep ${count} pages within memory`);
    const info: Record<string, string> = { pages: String(n) };
    try {
      const md = await doc.getMetadata();
      const inf = md?.info || {};
      if (inf.PDFFormatVersion) info['PDF version'] = String(inf.PDFFormatVersion);
      for (const [k, label] of [['Title', 'title'], ['Author', 'author'], ['Subject', 'subject'], ['Creator', 'creator'], ['Producer', 'producer']] as const) if (inf[k]) info[label] = String(inf[k]);
    } catch { /* no metadata */ }
    return { pages: out, info, warnings };
  } finally { try { void (task.destroy ? task.destroy() : doc.destroy?.()); } catch { /* already closed */ } }
}
