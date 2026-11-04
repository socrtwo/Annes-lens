/**
 * JBIG (ITU T.82, .jbg/.bie; bilevel scans and fax archives) by the app's own decoder from the standard, and JBIG2
 * (ITU T.88, .jb2/.jbig2) files through pdf.js's JBIG2 decoder (PDFium's, WebAssembly).
 * JBIG: the lowest-resolution layer with the three- and two-line templates, the adaptive template pixel and its
 * moves, typical prediction, stripes (SDNORM and SDRST), NEWLEN with a variable length, comments, and several bit
 * planes (Gray-coded, as jbigkit writes them); the differential (higher-resolution) layers with their templates,
 * typical and deterministic prediction (the default tables of T.82, or a private one from the header), in every
 * stripe order of Table 11, decoded to the full resolution.
 * JBIG2: the file header, sequential or random-access organization, split into each page's segments and the
 * global ones (symbol dictionaries shared by pages), every page decoded.
 */
import { makeRaster, type DecodeResult, type DecodedPage } from './raster';
import { DP_TABLES } from './jbigdp';

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
/** One bit plane of one resolution layer: its lines, adaptive states, AT pixel and typical-prediction state. */
interface Plane { rows: Uint8Array[]; st: Uint8Array; lntp: number; tx: number; ty: number; top: number }

/** A private DP table (1728 bytes, four entries a byte, the earlier entries in the higher bits) as the four tables. */
function unpackDpTable(u8: Uint8Array, at: number): Uint8Array[] {
  const sizes = [256, 512, 2048, 4096], out: Uint8Array[] = []; let i = 0;
  for (const n of sizes) { const t = new Uint8Array(n); for (let k = 0; k < n; k++, i++) t[k] = (u8[at + (i >> 2)] >> (6 - 2 * (i & 3))) & 3; out.push(t); }
  return out;
}

export function decodeJbig(u8: Uint8Array, o = jbigOptions): DecodeResult {
  const DL = u8[0], D = u8[1], P = u8[2];
  const XD = be32(u8, 4);
  let YD = be32(u8, 8);
  const L0 = be32(u8, 12), MX = u8[16], order = u8[18], opts = u8[19];
  const warnings: string[] = [], notes: string[] = [];
  if (DL !== 0) throw new Error('This JBIG file starts above the lowest resolution layer (it continues another file)');
  const vlength = !!(opts & 0x20), tpdon = !!(opts & 0x10), tpbon = !!(opts & 0x08), dpon = !!(opts & 0x04), dppriv = !!(opts & 0x02), dplast = !!(opts & 0x01), lrltwo = !!(opts & 0x40);
  let p = 20, dpTables: Uint8Array[] | null = null;
  if (dpon && dppriv && !dplast) { dpTables = unpackDpTable(u8, p); p += 1728; } // a private deterministic-prediction table
  else if (dpon) dpTables = DP_TABLES;
  const lines0 = Math.max(1, L0);
  if (!(XD > 0) || XD * Math.max(vlength && YD === 0xffffffff ? 1 : YD, 1) * P > o.maxPixels) throw new Error(`This JBIG picture is too large (${XD} × ${YD})`);
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
  if (!(YD > 0) || YD === 0xffffffff) throw new Error('This JBIG file gives no height');
  if (XD * YD * P > o.maxPixels) throw new Error(`This JBIG picture is too large (${XD} × ${YD})`);
  // The layers: layer d is the full size halved D − d times (rounding up); a stripe has L0 · 2^d lines in it.
  const layers = Array.from({ length: D + 1 }, (_, d) => ({ w: Math.ceil(XD / 2 ** (D - d)), h: Math.ceil(YD / 2 ** (D - d)), lines: lines0 * 2 ** d }));
  const stripes = Math.ceil(YD / (lines0 * 2 ** D));
  // The order of stripe data entities in the file (Table 11): the loops over stripes s, layers d and planes p.
  const seq = !!(order & 0x04), ileave = !!(order & 0x02), smid = !!(order & 0x01), hitolo = !!(order & 0x08);
  const loops = !seq && !ileave ? 'pds' : !seq && ileave && !smid ? 'dps' : !seq && ileave && smid ? 'dsp' : seq && !ileave && !smid ? 'spd' : seq && !ileave && smid ? 'psd' : 'sdp';
  const ranges: Record<string, number[]> = { s: Array.from({ length: stripes }, (_, i) => i), d: Array.from({ length: D + 1 }, (_, i) => (hitolo ? D - i : i)), p: Array.from({ length: P }, (_, i) => P - 1 - i) };
  const units: { s: number; d: number; p: number; k: number }[] = []; let k = 0;
  for (const a of ranges[loops[0]]) for (const b of ranges[loops[1]]) for (const c of ranges[loops[2]]) { const u: any = { [loops[0]]: a, [loops[1]]: b, [loops[2]]: c }; units.push({ s: u.s, d: u.d, p: u.p, k: k++ }); }
  // Decoded in dependency order: every layer needs the one below it, stripe by stripe.
  units.sort((a, b) => a.d - b.d || a.s - b.s || b.p - a.p);
  const planes: Plane[][] = layers.map((L) => Array.from({ length: P }, () => ({ rows: Array.from({ length: L.h }, () => new Uint8Array(L.w)), st: new Uint8Array(L === layers[0] ? 1024 : 4096), lntp: 1, tx: 0, ty: 0, top: 0 })));
  const TPB = lrltwo ? 0x195 : 0x0e5; // the lowest layer's TP pseudo-pixel context (Figures 11 and 12)
  const TPD = (3 << 10) | (63 << 4); // the differential layers' (Figure 8: phase 3, every template pixel foreground, every low-resolution pixel background)
  let decoded = 0;
  for (const u of units) {
    const sde = sdes[u.k]; if (!sde) continue;
    const L = layers[u.d], pl = planes[u.d][u.p], dec = new QmDecoder(u8, sde.start, sde.end), w = L.w;
    for (const mv of sde.moves) if (mv.y === 0) { pl.tx = mv.tx; pl.ty = mv.ty; }
    const y0 = u.s * L.lines, y1 = Math.min(L.h, y0 + L.lines);
    const zero = new Uint8Array(w);
    const row = (y: number) => (y >= pl.top && y >= 0 && y < L.h ? pl.rows[y] : zero);
    const g = (r: Uint8Array, x: number) => (x >= 0 && x < w ? r[x] : 0);
    if (u.d === 0) {
      for (let y = y0; y < y1; y++) {
        for (const mv of sde.moves) if (mv.y === y - y0 && mv.y !== 0) { pl.tx = mv.tx; pl.ty = mv.ty; }
        const cur = pl.rows[y];
        if (tpbon) {
          pl.lntp = pl.lntp ^ dec.decode(pl.st, TPB) ^ 1; // LNTP: "line not typical", 1 before the first line
          if (!pl.lntp) { cur.set(row(y - 1)); continue; } // a typical line: the same as the one above
        }
        const r1 = row(y - 1), r2 = row(y - 2), tx = pl.tx, ty = pl.ty, at = tx ? row(y - ty) : zero;
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
    } else {
      // A differential layer: each pixel from its neighbors here and the pixels of the layer below (Figure 16), after
      // typical prediction (6.4) and deterministic prediction (6.6).
      const lo = planes[u.d - 1][u.p], LL = layers[u.d - 1], lw = LL.w;
      const loEnd = Math.min(LL.h, (u.s + 1) * LL.lines); // below the current stripe, the last line of it stands in
      const lzero = new Uint8Array(lw);
      // After an SDRST the stripe starts as at the top of the image: the rows above it, in this layer and the one below, read as background.
      const loStart = u.s * LL.lines, loTop = pl.top >= y0 && y0 > 0 ? loStart : 0;
      const lrow = (ly: number) => (ly < loTop ? lzero : lo.rows[Math.min(ly, loEnd - 1)]);
      const lpx = (lx: number, ly: number) => (lx >= 0 && lx < lw ? lrow(ly)[lx] : 0);
      const lg = (r: Uint8Array, lx: number) => (lx >= 0 && lx < lw ? r[lx] : 0); // low-resolution rows have their own width
      const dp = dpTables, tpLine = new Int8Array(lw);
      let lntp = 1;
      for (let y = y0; y < y1; y++) {
        for (const mv of sde.moves) if (mv.y === y - y0 && mv.y !== 0) { pl.tx = mv.tx; pl.ty = mv.ty; }
        const cur = pl.rows[y], ly = y >> 1, phaseY = (y & 1) << 1;
        if ((y & 1) === 0) {
          if (tpdon) {
            lntp = dec.decode(pl.st, TPD);
            // A low-resolution pixel whose 8 neighbors share its color predicts its four pixels (when the line pair is typical).
            if (!lntp) {
              const a = lrow(ly - 1), b = lrow(ly), c = lrow(ly + 1);
              for (let lx = 0; lx < lw; lx++) {
                const v = b[lx];
                const same = lg(a, lx - 1) === v && lg(a, lx) === v && lg(a, lx + 1) === v && lg(b, lx - 1) === v && lg(b, lx + 1) === v && lg(c, lx - 1) === v && lg(c, lx) === v && lg(c, lx + 1) === v;
                tpLine[lx] = same ? v : 2;
              }
            } else tpLine.fill(2);
          } else tpLine.fill(2);
        }
        const r1 = row(y - 1), r2 = row(y - 2), tx = pl.tx, ty = pl.ty, at = tx || ty ? row(y - ty) : r1;
        const lcur = lrow(ly), lnext = lrow(ly + 1);
        for (let x = 0; x < w; x++) {
          const lx = x >> 1, phase = phaseY | (x & 1);
          const tp = tpLine[lx];
          if (tp !== 2) { cur[x] = tp; continue; }
          if (dp) {
            // The reference pixels of Figure 13: low-resolution 0–3, then the high-resolution pixels around the 2 × 2 block.
            const bx = lx * 2, by = ly * 2;
            const hp = (hx: number, hy: number) => (hy === y ? g(cur, hx) : hy === y - 1 ? g(r1, hx) : hy === y - 2 ? g(r2, hx) : 0);
            let idx = lpx(lx - 1, ly - 1) | (lpx(lx, ly - 1) << 1) | (lpx(lx - 1, ly) << 2) | (lpx(lx, ly) << 3)
              | (hp(bx - 1, by - 1) << 4) | (hp(bx, by - 1) << 5) | (hp(bx + 1, by - 1) << 6) | (hp(bx - 1, by) << 7);
            if (phase >= 1) idx |= hp(bx, by) << 8;
            if (phase >= 2) idx |= (hp(bx + 1, by) << 9) | (hp(bx - 1, by + 1) << 10);
            if (phase === 3) idx |= hp(bx, by + 1) << 11;
            const v = dp[phase][idx];
            if (v !== 2) { cur[x] = v; continue; }
          }
          const a = tx || ty ? (ty === 0 ? g(cur, x - tx) : g(at, x - tx)) : g(r1, x - 1);
          const hi = (g(r2, x) << 5) | (a << 4) | (g(r1, x) << 3) | (g(r1, x + 1) << 2) | (g(cur, x - 2) << 1) | g(cur, x - 1);
          const l0 = x & 1 ? lx : lx - 1, l1 = l0 + 1; // the current low-resolution pixel and its neighbor, and the row below
          const low = (lg(lcur, l0) << 3) | (lg(lcur, l1) << 2) | (lg(lnext, l0) << 1) | lg(lnext, l1);
          cur[x] = dec.decode(pl.st, (phase << 10) | (hi << 4) | low);
        }
      }
    }
    decoded++;
    if (sde.reset) { pl.st.fill(0); pl.lntp = 1; pl.tx = 0; pl.ty = 0; pl.top = y1; }
  }
  if (decoded < units.length) warnings.push(`The picture data is cut short (${decoded} of ${units.length} stripes)`);
  if (aborted) warnings.push('The file was aborted by its writer (ABORT marker)');
  const top = layers[D], w = top.w, h = top.h, out = planes[D];
  const r = makeRaster(w, h), d = r.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v: number;
    if (P === 1) v = out[0].rows[y][x] ? 0 : 255;
    else { // Gray code, the first plane the most significant
      let gc = 0, bit = 0;
      for (let q = P - 1; q >= 0; q--) { bit ^= out[q].rows[y][x]; gc = (gc << 1) | bit; }
      v = Math.round(gc * 255 / (2 ** P - 1));
    }
    const i = (y * w + x) * 4; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
  }
  notes.push(`JBIG (T.82), ${P === 1 ? 'bilevel' : `${P} bit planes (Gray code)`}, ${stripes} stripe${stripes === 1 ? '' : 's'} of ${lines0} line${lines0 === 1 ? '' : 's'}${D ? ` (${lines0 * 2 ** D} at full resolution)` : ''}, ${lrltwo ? 'two-line' : 'three-line'} template${tpbon ? ', typical prediction' : ''}${MX ? ', adaptive template' : ''}`);
  if (D > 0) {
    const pred = [...(tpdon ? ['typical'] : []), ...(dpon ? ['deterministic'] : [])];
    notes.push(`${D + 1} resolution layers (${layers.map((L) => `${L.w} × ${L.h}`).join(', ')}), decoded to the full resolution${pred.length ? ` with ${pred.join(' and ')} prediction` : ''}${dpon && dppriv ? ' (a private DP table)' : ''}`);
  }
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
