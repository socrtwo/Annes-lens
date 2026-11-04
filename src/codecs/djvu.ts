/**
 * DjVu (scanned books, parish registers, archive documents): single pages and bundled multipage documents,
 * with their text layer, decoded by djvu-rs (MIT), a Rust decoder written from the public DjVu v3
 * specification (no DjVuLibre code), as WebAssembly. It renders IW44 (photo and background), JB2 (bitonal
 * text, with shared dictionaries), the foreground colors and the page rotation the way DjVuLibre does.
 * The runtime loads like the others: the build's local copy (runtimes.json, the desktop app) or the pinned
 * CDN address. Pages render at the resolution they were scanned at, within the same page and pixel budget
 * as PDF pages: past the budget the resolution drops (not below 72 dpi), past the page limit the rest is reported.
 * A file cut short shows the pages (and refinement chunks) that arrived.
 * Indirect documents (an index file with each page in a file of its own) are not read: the pages are
 * ordinary DjVu files in the same folder.
 */
import { makeRaster, type DecodeResult, type DecodedPage, type TextLayer } from './raster';
import { runtimeBase } from '../platform/runtimes';

export const DJVU_CDN = 'https://cdn.jsdelivr.net/npm/djvu-rs@0.43.0/';
/** How many pages open and the total pixels for them together (the page count follows the PDF option). */
export const djvuOptions = { maxPages: 100, budget: 60e6, maxSide: 12000, minDpi: 72 };

const tag = (u: Uint8Array, o: number) => String.fromCharCode(u[o], u[o + 1], u[o + 2], u[o + 3]);
/** 'AT&T' then an IFF FORM of a DjVu kind (single page, bundled or indirect document, shared data). */
export function djvuKind(u8: Uint8Array): 'DJVU' | 'DJVM' | 'DJVI' | 'THUM' | null {
  if (u8.length < 16 || tag(u8, 0) !== 'AT&T' || tag(u8, 4) !== 'FORM') return null;
  const k = tag(u8, 12);
  return k === 'DJVU' || k === 'DJVM' || k === 'DJVI' || k === 'THUM' ? k : null;
}
export const isDjvu = (u8: Uint8Array): boolean => djvuKind(u8) !== null;

const be32 = (u: Uint8Array, o: number) => ((u[o] << 24) | (u[o + 1] << 16) | (u[o + 2] << 8) | u[o + 3]) >>> 0;
/**
 * A file cut short (an interrupted download or copy): the chunks that are complete, with the FORM lengths
 * set to match, so the pages (and the refinement chunks of a page) that arrived can still be shown.
 * Returns null when nothing had to change.
 */
export function repairDjvu(u8: Uint8Array): { bytes: Uint8Array; kept: number } | null {
  const out = u8.slice();
  let changed = false;
  /** The end of the complete content of the FORM at `at` (its tag), fixing its length; nested FORMs too. */
  const form = (at: number, end: number): number => {
    let p = at + 12;
    while (p + 8 <= end) {
      const n = be32(out, p + 4), next = p + 8 + n;
      if (next > end) {
        if (tag(out, p) === 'FORM' && n >= 4 && p + 12 <= end) { const e = form(p, end); if (e > p + 12) p = e; }
        changed = true; break;
      }
      p = next + (n & 1);
    }
    p = Math.min(p, end);
    const len = p - at - 8;
    if (len !== be32(out, at + 4)) { changed = true; out[at + 4] = len >>> 24; out[at + 5] = (len >>> 16) & 255; out[at + 6] = (len >>> 8) & 255; out[at + 7] = len & 255; }
    return p;
  };
  const end = form(4, out.length);
  return changed ? { bytes: out.subarray(0, end), kept: end } : null;
}

let mod: Promise<any> | null = null;
/** For tests and tools: an already initialized djvu-rs module. */
export function setDjvuModule(m: any): void { mod = Promise.resolve(m); }
function runtime(): Promise<any> {
  return (mod ??= (async () => {
    const base = await runtimeBase('djvu', DJVU_CDN);
    const m: any = await import(/* @vite-ignore */ base + 'djvu_rs.js'); // picks its SIMD or scalar build
    await m.default();
    return m;
  })().catch((e) => { mod = null; throw new Error(`The DjVu decoder (djvu-rs) could not be loaded: ${(e as Error).message}`); }));
}

/** The words of a page's text layer, at the rendered size (zones from djvu-rs, top-left origin). */
function textLayer(page: any, dpi: number): TextLayer | undefined {
  const text: string | undefined = page.text();
  if (text === undefined || !text.trim()) return undefined;
  const zones: { t: string; x: number; y: number; w: number; h: number }[] = JSON.parse(page.text_zones_json(dpi) || '[]');
  return {
    source: 'DjVu text layer',
    text: text.split('\n').map((l) => l.trimEnd()).join('\n').trim(),
    words: zones.filter((z) => z.t.trim()).map((z) => ({ text: z.t.trim(), conf: 100, bbox: { x0: z.x, y0: z.y, x1: z.x + z.w, y1: z.y + z.h } })),
  };
}

/** The complete chunks between `start` and `end` (each with its padding byte). */
function chunks(u8: Uint8Array, start: number, end: number): { tag: string; at: number; next: number; complete: boolean }[] {
  const out: { tag: string; at: number; next: number; complete: boolean }[] = [];
  for (let p = start; p + 8 <= end;) {
    const n = be32(u8, p + 4), next = p + 8 + n + (n & 1);
    out.push({ tag: tag(u8, p), at: p, next: Math.min(next, end), complete: p + 8 + n <= end });
    if (p + 8 + n > end) break;
    p = next;
  }
  return out;
}
/**
 * The pages of a bundled document whose directory no longer matches (the file is cut short): each page that
 * arrived (complete, or up to its last complete chunk) as a single-page file. A page that includes shared data
 * (a JB2 dictionary) gets the nearest shared component before it put into the page, which is where encoders
 * write a dictionary (its name is in the compressed directory). The page order is the order in the file.
 */
export function salvageBundle(u8: Uint8Array): Uint8Array[] {
  if (djvuKind(u8) !== 'DJVM') return [];
  const shared: Uint8Array[][] = [], pages: { body: Uint8Array[]; shared: number }[] = [];
  for (const c of chunks(u8, 16, u8.length)) {
    if (c.tag !== 'FORM' || c.at + 12 > u8.length) continue;
    const kind = tag(u8, c.at + 8), inner = chunks(u8, c.at + 12, c.next).filter((x) => x.complete);
    if (kind === 'DJVI' && (c.complete || inner.length)) shared.push(inner.map((x) => u8.subarray(x.at, x.next)));
    else if (kind === 'DJVU' && inner.some((x) => x.tag === 'INFO')) pages.push({ body: inner.map((x) => u8.subarray(x.at, x.next)), shared: shared.length - 1 });
  }
  return pages.map((pg) => {
    const dict = shared[Math.max(0, pg.shared)] || [];
    const parts = pg.body.flatMap((b) => (tag(b, 0) === 'INCL' ? dict : [b]));
    const len = parts.reduce((n, b) => n + b.length, 4), out = new Uint8Array(12 + len);
    out.set([0x41, 0x54, 0x26, 0x54, 0x46, 0x4f, 0x52, 0x4d, len >>> 24, (len >>> 16) & 255, (len >>> 8) & 255, len & 255]); // AT&T FORM length
    out.set([0x44, 0x4a, 0x56, 0x55], 12); // DJVU
    let o = 16; for (const b of parts) { out.set(b, o); o += b.length; }
    return out;
  });
}

interface Pages { n: number; page(i: number): any; free(): void; label(i: number): string }

export async function decodeDjvu(u8: Uint8Array, o = djvuOptions): Promise<DecodeResult> {
  const kind = djvuKind(u8);
  if (kind === 'DJVI' || kind === 'THUM') throw new Error('This DjVu file holds data shared by the pages of a document (no page of its own): open the document or its pages');
  const m = await runtime();
  const warnings: string[] = [];
  const open = (b: Uint8Array): Pages => { const d = m.WasmDocument.from_bytes(b), n: number = d.page_count(); return { n, page: (i) => d.page(i), free: () => d.free(), label: (i) => `DjVu page ${i + 1} of ${n}` }; };
  let src: Pages;
  try { src = open(u8); }
  catch (e: any) {
    const msg = String(e?.message || e);
    if (/indirect/i.test(msg)) throw new Error('This is the index of an indirect DjVu document: its pages are separate DjVu files in the same folder, open those (or bundle the document into one file with djvm -c)');
    const fix = repairDjvu(u8);
    if (!fix) throw new Error(`This DjVu file could not be read (${msg})`);
    try { src = open(fix.bytes); }
    catch {
      // A bundle whose directory lists pages that are missing: its pages one by one.
      const docs: any[] = [];
      for (const f of salvageBundle(u8)) { try { docs.push(m.WasmDocument.from_bytes(f)); } catch { /* not readable on its own */ } }
      if (!docs.length) throw new Error(`This DjVu file could not be read (${msg})`);
      src = { n: docs.length, page: (i) => docs[i].page(0), free: () => { for (const d of docs) d.free(); }, label: (i) => `DjVu page ${i + 1} (of a document cut short)` };
    }
    warnings.push(`The file is cut short (${u8.length} bytes; ${u8.length - fix.kept} at the end are an incomplete part): the ${src.n === 1 ? 'page' : `${src.n} pages`} that arrived ${src.n === 1 ? 'is' : 'are'} shown`);
  }
  try {
    const n = src.n, count = Math.min(n, Math.max(1, o.maxPages));
    if (!n) throw new Error('This DjVu document has no pages');
    // Sizes at the scanned resolution, then one scale for all pages to stay within the pixel budget.
    const sizes: ({ dpi: number; w: number; h: number } | null)[] = [];
    for (let i = 0; i < count; i++) {
      let p: any = null;
      try { p = src.page(i); const dpi = p.dpi() || 300; sizes.push({ dpi, w: p.width_at(dpi), h: p.height_at(dpi) }); }
      catch (e: any) { sizes.push(null); warnings.push(`Page ${i + 1} could not be read (${e?.message || e})`); }
      finally { p?.free(); }
    }
    const area = sizes.reduce((s, z) => s + (z ? z.w * z.h : 0), 0), scale = Math.min(1, Math.sqrt(o.budget / Math.max(1, area)));
    const pages: DecodedPage[] = []; let reduced = false;
    for (let i = 0; i < count; i++) {
      const z = sizes[i];
      if (!z) continue;
      let dpi = Math.max(Math.min(z.dpi, o.minDpi), Math.floor(z.dpi * scale));
      dpi = Math.max(1, Math.min(dpi, Math.floor(z.dpi * o.maxSide / Math.max(z.w, z.h))));
      if (dpi < z.dpi) reduced = true;
      const p = src.page(i);
      try {
        const w: number = p.width_at(dpi), h: number = p.height_at(dpi);
        let px: Uint8ClampedArray;
        try { px = p.render(dpi); }
        catch (e: any) { warnings.push(`Page ${i + 1}: ${e?.message || e}`); px = new Uint8ClampedArray(w * h * 4).fill(255); }
        const r = makeRaster(w, h); r.data.set(px.subarray(0, r.data.length));
        const bg = p.bg44_chunk_count();
        const layers = bg ? `IW44 background in ${bg} refinement chunk${bg === 1 ? '' : 's'}` : 'bitonal (no background layer)';
        let text: TextLayer | undefined;
        try { text = textLayer(p, dpi); } catch (e: any) { warnings.push(`Page ${i + 1}: the text layer could not be read (${e?.message || e})`); }
        pages.push({
          width: w, height: h, frames: [{ raster: r, delay: 0 }], loops: 0, bitDepth: 24, hasAlpha: false, dpi: [dpi, dpi], textLayer: text,
          notes: [src.label(i), `${Math.round(z.w / z.dpi * 25.4)} × ${Math.round(z.h / z.dpi * 25.4)} mm, scanned at ${z.dpi} dpi`, layers, dpi === z.dpi ? 'rendered at full resolution by djvu-rs' : `rendered at ${dpi} dpi by djvu-rs`, ...(text ? [`text layer: ${text.words.length} word${text.words.length === 1 ? '' : 's'} (Tools ▸ Recognize Text shows it)`] : [])],
        });
      } finally { p.free(); }
    }
    if (count < n) warnings.push(`Pages 1–${count} of ${n} are shown (Options: PDF and DjVu pages)`);
    if (reduced) warnings.push(`Rendered below the scanned resolution to keep ${count} page${count === 1 ? '' : 's'} within memory`);
    if (!pages.length) throw new Error(`This DjVu file could not be read (${warnings.join('; ')})`);
    const withText = pages.filter((p) => p.textLayer).length;
    return { pages, info: { pages: String(n), document: kind === 'DJVM' ? 'bundled (several pages in one file)' : 'single page', ...(withText ? { 'text layer': `${withText} of ${count} page${count === 1 ? '' : 's'}` } : {}) }, warnings };
  } finally { src.free(); }
}
