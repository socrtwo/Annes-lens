/**
 * JBIG (ITU T.82, .jbg/.bie; bilevel scans and fax archives) by the app's own decoder from the standard, and JBIG2
 * (ITU T.88, .jb2/.jbig2) files through pdf.js's JBIG2 decoder (PDFium's, WebAssembly).
 * JBIG: the lowest-resolution layer with the three- and two-line templates, the adaptive template pixel and its
 * moves, typical prediction, stripes (SDNORM and SDRST), NEWLEN with a variable length, comments, and several bit
 * planes (Gray-coded, as jbigkit writes them). Files with differential (higher-resolution) layers are shown at their
 * lowest layer, with a note: deterministic prediction for those layers is not decoded yet.
 * JBIG2: the file header, sequential or random-access organization, split into each page's segments and the
 * global ones (symbol dictionaries shared by pages), every page decoded.
 */
import { makeRaster, type DecodeResult, type DecodedPage } from './raster';

const be32 = (u: Uint8Array, o: number) => ((u[o] << 24) | (u[o + 1] << 16) | (u[o + 2] << 8) | u[o + 3]) >>> 0;

// The QM coder's probability estimation (T.82 Table 24, the same as JPEG's T.81 Table D.3):
// Qe << 16 | next index after an MPS << 8 | switch MPS << 7 | next index after an LPS.
const QM = [0x5a1d0181,0x2586020e,0x11140310,0x80b0412,0x3d80514,0x1da0617,0xe50719,0x6f081c,0x36091e,0x1a0a21,0xd0b23,0x60c09,0x30d0a,0x10d0c,0x5a7f0f8f,0x3f251024,0x2cf21126,0x207c1227,0x17b91328,0x1182142a,0xcef152b,0x9a1162d,0x72f172e,0x55c1830,0x4061931,0x3031a33,0x2401b34,0x1b11c36,0x1441d38,0xf51e39,0xb71f3b,0x8a203c,0x68213e,0x4e223f,0x3b2320,0x2c0921,0x5ae125a5,0x484c2640,0x3a0d2741,0x2ef12843,0x261f2944,0x1f332a45,0x19a82b46,0x15182c48,0x11772d49,0xe742e4a,0xbfb2f4b,0x9f8304d,0x861314e,0x706324f,0x5cd3330,0x4de3432,0x40f3532,0x3633633,0x2d43734,0x25c3835,0x1f83936,0x1a43a37,0x1603b38,0x1253c39,0xf63d3a,0xcb3e3b,0xab3f3d,0x8f203d,0x5b1241c1,0x4d044250,0x412c4351,0x37d84452,0x2fe84553,0x293c4654,0x23794756,0x1edf4857,0x1aa94957,0x174e4a48,0x14244b48,0x119c4c4a,0xf6b4d4a,0xd514e4b,0xbb64f4d,0xa40304d,0x583251d0,0x4d1c5258,0x438e5359,0x3bdd545a,0x34ee555b,0x2eae565c,0x299a575d,0x25164756,0x557059d8,0x4ca95a5f,0x44d95b60,0x3e225c61,0x38245d63,0x32b45e63,0x2e17565d,0x56a860df,0x4f466165,0x47e56266,0x41cf6367,0x3c3d6468,0x375e5d63,0x52316669,0x4c0f676a,0x4639686b,0x415e6367,0x56276ae9,0x50e76b6c,0x4b85676d,0x55976d6e,0x504f6b6f,0x5a106fee,0x55226d70,0x59eb6ff0];

/** The QM arithmetic decoder over one stripe's coded data (0xFF 0x00 is a data 0xFF; past the end, zeros). */
class QmDecoder {
  private c = 0; private a = 0; private ct = -16; private p: number;
  constructor(private readonly d: Uint8Array, start: number, private readonly end: number) { this.p = start; }
  private byte(): number {
    if (this.p >= this.end) return 0;
    const b = this.d[this.p++];
    if (b === 0xff) { if (this.d[this.p] === 0x00) { this.p++; return 0xff; } this.p = this.end; return 0; }
    return b;
  }
  decode(st: Uint8Array, cx: number): number {
    while (this.a < 0x8000) {
      if (--this.ct < 0) {
        this.c = this.c * 256 + this.byte();
        if ((this.ct += 8) < 0 && ++this.ct === 0) this.a = 0x8000;
      }
      this.a *= 2;
    }
    let sv = st[cx];
    const e = QM[sv & 0x7f], qe = e >>> 16, nm = (e >> 8) & 0x7f, nl = e & 0xff;
    let temp = this.a - qe;
    this.a = temp;
    temp *= 2 ** this.ct;
    if (this.c >= temp) {
      this.c -= temp;
      if (this.a < qe) { this.a = qe; st[cx] = (sv & 0x80) ^ nm; }
      else { this.a = qe; st[cx] = (sv & 0x80) ^ nl; sv ^= 0x80; }
    } else if (this.a < 0x8000) {
      if (this.a < qe) { st[cx] = (sv & 0x80) ^ nl; sv ^= 0x80; }
      else st[cx] = (sv & 0x80) ^ nm;
    }
    return sv >> 7;
  }
}

export const isJbig = (u8: Uint8Array): boolean => u8.length >= 20 && u8[3] === 0 && u8[2] >= 1 && u8[2] <= 32 && u8[1] >= u8[0] && u8[1] < 32 && be32(u8, 4) > 0 && be32(u8, 8) > 0 && be32(u8, 12) > 0 && (u8[19] & 0x80) === 0 && (u8[18] & 0xf0) === 0;
export const jbigOptions = { maxPixels: 200e6 };

interface Sde { start: number; end: number; reset: boolean; moves: { y: number; tx: number; ty: number }[] }

export function decodeJbig(u8: Uint8Array, o = jbigOptions): DecodeResult {
  const DL = u8[0], D = u8[1], P = u8[2];
  let XD = be32(u8, 4), YD = be32(u8, 8);
  const L0 = be32(u8, 12), MX = u8[16], order = u8[18], opts = u8[19];
  const warnings: string[] = [], notes: string[] = [];
  if (DL !== 0) throw new Error('This JBIG file starts above the lowest resolution layer (it continues another file)');
  const vlength = !!(opts & 0x20), tpbon = !!(opts & 0x08), lrltwo = !!(opts & 0x40);
  let p = 20;
  if (opts & 0x04 && opts & 0x02 && !(opts & 0x01)) p += 1728; // a private deterministic-prediction table
  // The lowest layer's size: each layer halves the width and height (rounding up).
  const sh = (v: number) => Math.ceil(v / 2 ** D);
  const w = sh(XD);
  let h = vlength && YD === 0xffffffff ? 0 : sh(YD);
  const lines0 = Math.max(1, L0); // lines per stripe at the lowest layer
  if (!(w > 0) || w * Math.max(h, 1) * P > o.maxPixels) throw new Error(`This JBIG picture is too large (${XD} × ${YD})`);
  // Split the data into stripe data entities and floating markers.
  const sdes: Sde[] = []; let moves: Sde['moves'] = [], comment = '', aborted = false;
  let start = p;
  while (p < u8.length) {
    if (u8[p] !== 0xff) { p++; continue; }
    const m = u8[p + 1];
    if (m === 0x00) { p += 2; continue; }
    if (m === 0x02 || m === 0x03) { sdes.push({ start, end: p, reset: m === 0x03, moves }); moves = []; p += 2; start = p; continue; }
    if (m === 0x05) { YD = be32(u8, p + 2); p += 6; start = p; continue; }
    if (m === 0x06) { moves.push({ y: be32(u8, p + 2), tx: u8[p + 6], ty: u8[p + 7] }); p += 8; start = p; continue; }
    if (m === 0x07) { const n = be32(u8, p + 2); comment += new TextDecoder('latin1').decode(u8.subarray(p + 6, p + 6 + n)).replace(/\0+$/, ''); p += 6 + n; start = p; continue; }
    if (m === 0x04) { aborted = true; break; }
    p++; // a reserved or damaged marker: skip the byte
  }
  if (start < u8.length && !aborted) sdes.push({ start, end: u8.length, reset: false, moves }); // a last stripe without its marker
  h = sh(YD);
  if (!(h > 0)) throw new Error('This JBIG file gives no height');
  const stripes = Math.ceil(h / lines0);
  // Stripe and plane order: planes inside each stripe (ILEAVE) or each plane's stripes in turn.
  const ileave = !!(order & 0x02);
  const planes = Array.from({ length: P }, () => ({ rows: [] as Uint8Array[], st: new Uint8Array(1024), lntp: 1, tx: 0, ty: 0, top: 0 }));
  const zero = new Uint8Array(w);
  const TPB = lrltwo ? 0x195 : 0x0e5;
  let k = 0, decodedLines = 0;
  const units: [number, number][] = [];
  if (ileave) { for (let s = 0; s < stripes; s++) for (let q = 0; q < P; q++) units.push([s, q]); }
  else { for (let q = 0; q < P; q++) for (let s = 0; s < stripes; s++) units.push([s, q]); }
  for (const [s, q] of units) {
    const sde = sdes[k++]; if (!sde) break;
    const pl = planes[q], dec = new QmDecoder(u8, sde.start, sde.end);
    for (const mv of sde.moves) if (mv.y === 0 || mv.y === s * lines0) { pl.tx = mv.tx; pl.ty = mv.ty; }
    const y0 = s * lines0, y1 = Math.min(h, y0 + lines0);
    const row = (y: number) => (y >= pl.top && y >= 0 ? pl.rows[y] || zero : zero);
    for (let y = y0; y < y1; y++) {
      for (const mv of sde.moves) if (mv.y === y - y0 && mv.y !== 0) { pl.tx = mv.tx; pl.ty = mv.ty; }
      const cur = new Uint8Array(w); pl.rows[y] = cur;
      if (tpbon) {
        pl.lntp = pl.lntp ^ dec.decode(pl.st, TPB) ^ 1; // LNTP: "line not typical", 1 before the first line
        if (!pl.lntp) { cur.set(row(y - 1)); continue; } // a typical line: the same as the one above
      }
      const r1 = row(y - 1), r2 = row(y - 2), tx = pl.tx, ty = pl.ty, at = tx ? row(y - ty) : zero;
      const g = (r: Uint8Array, x: number) => (x >= 0 && x < w ? r[x] : 0);
      for (let x = 0; x < w; x++) {
        let cx: number;
        const a = tx ? (ty === 0 ? (x - tx >= 0 ? cur[x - tx] : 0) : g(at, x - tx)) : -1;
        if (lrltwo) {
          cx = (g(r1, x - 3) << 9) | (g(r1, x - 2) << 8) | (g(r1, x - 1) << 7) | (g(r1, x) << 6) | (g(r1, x + 1) << 5) | ((a < 0 ? g(r1, x + 2) : a) << 4)
            | (g(cur, x - 4) << 3) | (g(cur, x - 3) << 2) | (g(cur, x - 2) << 1) | g(cur, x - 1);
        } else {
          cx = (g(r2, x - 1) << 9) | (g(r2, x) << 8) | (g(r2, x + 1) << 7) | (g(r1, x - 2) << 6) | (g(r1, x - 1) << 5) | (g(r1, x) << 4) | (g(r1, x + 1) << 3)
            | ((a < 0 ? g(r1, x + 2) : a) << 2) | (g(cur, x - 2) << 1) | g(cur, x - 1);
        }
        cur[x] = dec.decode(pl.st, cx);
      }
    }
    decodedLines = Math.max(decodedLines, y1);
    if (sde.reset) { pl.st.fill(0); pl.lntp = 1; pl.top = y1; }
  }
  if (k < units.length) warnings.push(`The picture data is cut short (${k} of ${units.length} stripes)`);
  if (aborted) warnings.push('The file was aborted by its writer (ABORT marker)');
  const r = makeRaster(w, h), d = r.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v: number;
    if (P === 1) v = (planes[0].rows[y]?.[x] ?? 0) ? 0 : 255;
    else { // Gray code, the first plane the most significant
      let g = 0, b = 0;
      for (let q = 0; q < P; q++) { b ^= planes[q].rows[y]?.[x] ?? 0; g = (g << 1) | b; }
      v = Math.round(g * 255 / (2 ** P - 1));
    }
    const i = (y * w + x) * 4; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
  }
  notes.push(`JBIG (T.82), ${P === 1 ? 'bilevel' : `${P} bit planes (Gray code)`}, ${stripes} stripe${stripes === 1 ? '' : 's'} of ${lines0} line${lines0 === 1 ? '' : 's'}, ${lrltwo ? 'two-line' : 'three-line'} template${tpbon ? ', typical prediction' : ''}${MX ? ', adaptive template' : ''}`);
  if (D > 0) { notes.push(`the lowest of ${D + 1} resolution layers (${w} × ${h} of ${XD} × ${YD})`); warnings.push(`Shown at the lowest resolution layer (${w} × ${h}); the file's ${D} higher layer${D === 1 ? ' is' : 's are'} not decoded yet`); }
  const info: Record<string, string> = {}; if (comment) info.comment = comment;
  const page: DecodedPage = { width: w, height: h, frames: [{ raster: r, delay: 0 }], loops: 0, bitDepth: P, hasAlpha: false, notes };
  return { pages: [page], info, warnings };
}

// JBIG2 -------------------------------------------------------------------------------------------------
export const isJbig2 = (u8: Uint8Array): boolean => u8.length >= 13 && u8[0] === 0x97 && u8[1] === 0x4a && u8[2] === 0x42 && u8[3] === 0x32 && u8[4] === 0x0d && u8[5] === 0x0a && u8[6] === 0x1a && u8[7] === 0x0a;
interface Seg { num: number; type: number; page: number; header: Uint8Array; data: Uint8Array }
/** The segments of a JBIG2 file, in either organization. */
export function jbig2Segments(u8: Uint8Array): { segs: Seg[]; warnings: string[] } {
  const flags = u8[8], sequential = !!(flags & 1), warnings: string[] = [];
  let p = 9 + (flags & 2 ? 0 : 4);
  const heads: { num: number; type: number; page: number; start: number; end: number; len: number }[] = [];
  const readHeader = (q: number) => {
    const num = be32(u8, q), f = u8[q + 4], type = f & 0x3f, longPage = !!(f & 0x40);
    let r = q + 5, count = u8[r] >> 5;
    if (count === 7) { count = be32(u8, r) & 0x1fffffff; r += 4 + Math.ceil((count + 1) / 8); } else r += 1;
    const refSize = num <= 256 ? 1 : num <= 65536 ? 2 : 4;
    r += count * refSize;
    const page = longPage ? be32(u8, r) : u8[r]; r += longPage ? 4 : 1;
    const len = be32(u8, r); r += 4;
    return { num, type, page, start: q, end: r, len };
  };
  while (p + 11 <= u8.length) {
    const h = readHeader(p);
    if (h.len === 0xffffffff) { warnings.push('A segment of unknown length (an immediate generic region) is not supported'); break; }
    heads.push(h);
    p = h.end + (sequential ? h.len : 0);
    if (h.type === 51) break; // end of file
  }
  const segs: Seg[] = [];
  let data = sequential ? 0 : p;
  for (const h of heads) {
    const at = sequential ? h.end : data;
    segs.push({ num: h.num, type: h.type, page: h.page, header: u8.subarray(h.start, h.end), data: u8.subarray(at, Math.min(u8.length, at + h.len)) });
    if (!sequential) data += h.len;
    if (at + h.len > u8.length) warnings.push(`Segment ${h.num} is cut short`);
  }
  return { segs, warnings };
}
/** `jbig2` is pdf.js's image-decoders module (its Jbig2Image). */
export async function decodeJbig2(u8: Uint8Array, jbig2: any): Promise<DecodeResult> {
  const { segs, warnings } = jbig2Segments(u8);
  const join = (list: Seg[]) => { const n = list.reduce((s, x) => s + x.header.length + x.data.length, 0), out = new Uint8Array(n); let o = 0; for (const x of list) { out.set(x.header, o); o += x.header.length; out.set(x.data, o); o += x.data.length; } return out; };
  const globals = join(segs.filter((s) => s.page === 0 && s.type !== 51));
  const pageNums = [...new Set(segs.filter((s) => s.page > 0).map((s) => s.page))];
  const pages: DecodedPage[] = [];
  for (const pg of pageNums) {
    const own = segs.filter((s) => s.page === pg && s.type !== 49 && s.type !== 51);
    const info = own.find((s) => s.type === 48);
    if (!info || info.data.length < 8) { warnings.push(`Page ${pg} has no page information`); continue; }
    const w = be32(info.data, 0); let h = be32(info.data, 4);
    if (h === 0xffffffff) { // striped page of unknown height: the end-of-stripe segments say how far it goes
      h = 0; for (const s of own) if (s.type === 50 && s.data.length >= 4) h = Math.max(h, be32(s.data, 0) + 1);
    }
    if (!(w > 0 && h > 0) || w * h > 400e6) { warnings.push(`Page ${pg} has an impossible size (${w} × ${h})`); continue; }
    try {
      const bits: Uint8Array = await jbig2.Jbig2Image.instance.decode(join(own), w, h, globals.length ? globals : null);
      const r = makeRaster(w, h), d = r.data, rb = Math.ceil(w / 8);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const v = (bits[y * rb + (x >> 3)] >> (7 - (x & 7))) & 1 ? 255 : 0; // pdf.js gives 1 for white (PDF's default decode)
        const i = (y * w + x) * 4; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
      }
      pages.push({ width: w, height: h, frames: [{ raster: r, delay: 0 }], loops: 0, bitDepth: 1, hasAlpha: false, notes: [`JBIG2 (T.88) page ${pg} of ${pageNums.length}, decoded by pdf.js (PDFium's JBIG2 decoder)`] });
    } catch (e: any) { warnings.push(`Page ${pg} could not be decoded (${e?.message || e})`); }
  }
  if (!pages.length) throw new Error(`This JBIG2 file could not be decoded${warnings.length ? ` (${warnings.join('; ')})` : ''}`);
  return { pages, info: { pages: String(pageNums.length), organization: u8[8] & 1 ? 'sequential' : 'random access' }, warnings };
}
