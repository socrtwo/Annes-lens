/**
 * Recognize Text (OCR) on the device with Tesseract (tesseract.js, LSTM engine, best_int models).
 * The engine, its worker and the English data come from the build's local copy (runtimes.json)
 * or from pinned CDN addresses; other languages are fetched once from the CDN and cached by the
 * browser (IndexedDB). Small text is enlarged before recognition, and word boxes come back in the
 * picture's own pixel coordinates.
 */
import type { Raster } from '../codecs/raster';
import { resample, grayscale } from './ops';
import { localRuntimes, runtimeBase } from '../platform/runtimes';

export const TESSERACT_VERSION = '7.0.0', CORE_VERSION = '7.0.0', DATA_VERSION = '1.0.0';
const CDN = `https://cdn.jsdelivr.net/npm/tesseract.js@${TESSERACT_VERSION}/dist/`;
const CORE_CDN = `https://cdn.jsdelivr.net/npm/tesseract.js-core@${CORE_VERSION}/`;
const langCdn = (lang: string) => `https://cdn.jsdelivr.net/npm/@tesseract.js-data/${lang}@${DATA_VERSION}/4.0.0_best_int`;

/** Languages offered (published as @tesseract.js-data packages; Apache-2.0 models). */
export const OCR_LANGS: { id: string; label: string }[] = [
  { id: 'eng', label: 'English' }, { id: 'deu', label: 'German' }, { id: 'frk', label: 'German (Fraktur)' }, { id: 'fra', label: 'French' },
  { id: 'nld', label: 'Dutch' }, { id: 'ita', label: 'Italian' }, { id: 'spa', label: 'Spanish' }, { id: 'pol', label: 'Polish' },
  { id: 'swe', label: 'Swedish' }, { id: 'lat', label: 'Latin' },
];

export interface OcrWord { text: string; conf: number; bbox: { x0: number; y0: number; x1: number; y1: number } }
export interface OcrResult { text: string; confidence: number; words: OcrWord[]; lines: number; langs: string; ms: number }
export type OcrLayout = 'auto' | 'block' | 'column' | 'line' | 'sparse';
const PSM: Record<OcrLayout, string> = { auto: '3', column: '4', block: '6', line: '7', sparse: '11' };

/** How much to enlarge a picture before OCR: Tesseract wants capital letters about 20–40 px tall. */
export function ocrScale(w: number, h: number, maxSide = 4000): number {
  const long = Math.max(w, h);
  if (long >= 1800) return 1;
  return Math.max(1, Math.min(3, maxSide / long, 1800 / long));
}

let tess: Promise<any> | null = null;
let worker: { langs: string; w: any } | null = null;

async function loadTesseract(): Promise<{ T: any; base: string }> {
  const base = await runtimeBase('ocr', CDN);
  tess ??= import(/* @vite-ignore */ base + 'tesseract.esm.min.js').then((m) => m.default || m);
  return { T: await tess, base };
}

/** A worker for the languages (reused while they stay the same). */
async function getWorker(langs: string[], progress?: (status: string, p: number) => void): Promise<any> {
  const key = langs.join('+');
  if (worker && worker.langs === key) return worker.w;
  if (worker) { try { await worker.w.terminate(); } catch { /* */ } worker = null; }
  const { T, base } = await loadTesseract();
  const m = await localRuntimes();
  const local = new Set(m.ocrLangs || []), ocrDir = m.ocr ? m.ocr.replace(/\/?$/, '/') : '';
  const opts: Record<string, any> = { workerPath: base + 'worker.min.js', corePath: ocrDir ? new URL(ocrDir + 'core', document.baseURI).href : CORE_CDN, gzip: true, workerBlobURL: true, logger: (x: any) => progress?.(String(x.status || ''), Number(x.progress) || 0) };
  // One langPath serves every language: the local copy when it has them all, a pinned package for a
  // single language, else Tesseract's own per-language address on the same CDN.
  if (ocrDir && langs.every((l) => local.has(l))) opts.langPath = new URL(ocrDir + 'lang', document.baseURI).href;
  else if (langs.length === 1) opts.langPath = langCdn(langs[0]);
  const w = await T.createWorker(key, 1, opts);
  worker = { langs: key, w };
  return w;
}

export async function terminateOcr(): Promise<void> { if (worker) { try { await worker.w.terminate(); } catch { /* */ } worker = null; } }

/** Recognizes text in a raster. Coordinates in the result are the raster's own pixels. */
export async function recognize(r: Raster, o: { langs: string[]; layout?: OcrLayout; enhance?: boolean; progress?: (status: string, p: number) => void }): Promise<OcrResult> {
  const t0 = performance.now();
  const k = o.enhance === false ? 1 : ocrScale(r.width, r.height);
  let src = o.enhance === false ? r : grayscale(r);
  if (k > 1) src = resample(src, Math.round(r.width * k), Math.round(r.height * k), 'lanczos3');
  const c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
  c.getContext('2d')!.putImageData(new ImageData(src.data, src.width, src.height), 0, 0);
  const w = await getWorker(o.langs.length ? o.langs : ['eng'], o.progress);
  await w.setParameters({ tessedit_pageseg_mode: PSM[o.layout || 'auto'], preserve_interword_spaces: '1', user_defined_dpi: '300' });
  const { data } = await w.recognize(c, {}, { text: true, blocks: true });
  const words: OcrWord[] = [];
  let lines = 0;
  for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) {
    lines++;
    for (const wd of l.words || []) if (String(wd.text).trim()) words.push({ text: String(wd.text), conf: Math.round(wd.confidence), bbox: { x0: wd.bbox.x0 / k, y0: wd.bbox.y0 / k, x1: wd.bbox.x1 / k, y1: wd.bbox.y1 / k } });
  }
  return { text: String(data.text || '').replace(/\n{3,}/g, '\n\n').trim(), confidence: Math.round(data.confidence || 0), words, lines, langs: o.langs.join('+'), ms: Math.round(performance.now() - t0) };
}

/** Words whose text contains `q` (case- and accent-insensitive). */
export function findWords(words: OcrWord[], q: string): OcrWord[] {
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const n = norm(q.trim()); if (!n) return [];
  return words.filter((w) => norm(w.text).includes(n));
}
