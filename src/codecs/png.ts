/**
 * A tolerant PNG reader for damaged files: chunk walking without CRC checks, every IDAT concatenated and
 * inflated with the app's own inflater (which keeps what a truncated or corrupt stream yields), all
 * color types and bit depths, Adam7 interlacing, tRNS, and gAMA/pHYs notes. Missing rows are left
 * transparent and reported. The platform decoder is used first; this is the fallback and the repair path.
 */
import { makeRaster, type DecodeResult } from './raster';
import { inflate } from './inflate';

export const isPng = (u8: Uint8Array): boolean => u8.length > 8 && u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47;

export function decodePngTolerant(u8: Uint8Array): DecodeResult & { rowsDecoded: number; rowsTotal: number } {
  if (!isPng(u8)) throw new Error('Not a PNG file');
  const warnings: string[] = [];
  const info: Record<string, string> = {};
  let w = 0, h = 0, depth = 8, ct = 0, interlace = 0;
  let palette: Uint8Array | null = null, trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  let dpi: [number, number] | undefined;
  let p = 8, sawIend = false, badCrc = 0;
  const be32 = (o: number) => ((u8[o] << 24) | (u8[o + 1] << 16) | (u8[o + 2] << 8) | u8[o + 3]) >>> 0;
  while (p + 8 <= u8.length) {
    const len = be32(p);
    const type = String.fromCharCode(u8[p + 4], u8[p + 5], u8[p + 6], u8[p + 7]);
    if (!/^[A-Za-z]{4}$/.test(type)) { warnings.push(`Unreadable chunk header at byte ${p}; stopped reading chunks there`); break; }
    const d = p + 8, end = Math.min(u8.length, d + len);
    if (d + len + 4 > u8.length) warnings.push(`The ${type} chunk is cut off (${u8.length - d} of ${len} bytes)`);
    else if (crc32(u8, p + 4, d + len) !== be32(d + len)) badCrc++;
    if (type === 'IHDR' && len >= 13) { w = be32(d); h = be32(d + 4); depth = u8[d + 8]; ct = u8[d + 9]; interlace = u8[d + 12]; }
    else if (type === 'PLTE') palette = u8.subarray(d, end);
    else if (type === 'tRNS') trns = u8.subarray(d, end);
    else if (type === 'IDAT') idat.push(u8.subarray(d, end));
    else if (type === 'pHYs' && len >= 9 && u8[d + 8] === 1) dpi = [Math.round(be32(d) * 0.0254), Math.round(be32(d + 4) * 0.0254)];
    else if (type === 'gAMA' && len >= 4) info.gamma = String(be32(d) / 100000);
    else if (type === 'IEND') { sawIend = true; if (d + 4 < u8.length) warnings.push(`${u8.length - d - 4} bytes follow IEND (another file may be appended)`); break; }
    p = d + len + 4;
  }
  if (badCrc) warnings.push(`${badCrc} chunk${badCrc > 1 ? 's have' : ' has'} a wrong CRC (ignored)`);
  if (!sawIend) warnings.push('The file ends before the IEND chunk (truncated)');
  if (!w || !h) throw new Error('No readable IHDR chunk');
  if (w * h > 80_000_000) throw new Error('The picture is too large');
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[ct];
  if (!channels) throw new Error(`Unknown color type ${ct}`);
  const bpp = Math.max(1, (channels * depth) >> 3); // bytes per complete pixel (for filtering)
  const rowBytes = (width: number) => Math.ceil((width * channels * depth) / 8);
  let total = 0;
  for (const c of idat) total += c.length;
  const z = new Uint8Array(total);
  { let o = 0; for (const c of idat) { z.set(c, o); o += c.length; } }
  const expected = interlace ? adam7Size(w, h, rowBytes) : (rowBytes(w) + 1) * h;
  const inf = inflate(z, expected);
  if (inf.error) warnings.push(`Compressed data ${inf.complete ? 'has a problem' : 'is damaged'}: ${inf.error}; ${Math.round((100 * inf.data.length) / expected)}% of the pixel data was recovered`);
  else if (inf.data.length < expected) warnings.push(`Compressed data is short: ${Math.round((100 * inf.data.length) / expected)}% of the pixel data present`);
  const raw = inf.data;
  const out = makeRaster(w, h);
  const d = out.data;
  const sample16 = depth === 16;
  const maxv = (1 << depth) - 1;
  let hasAlpha = ct === 4 || ct === 6 || !!trns;
  let rowsDecoded = 0, rowsTotal = 0;
  // Decodes one pass of rows of a given width into the output at (x0 + x*dx, y0 + y*dy).
  const decodePass = (pw: number, ph: number, at: number, x0: number, y0: number, dx: number, dy: number): number => {
    const rb = rowBytes(pw);
    let prev = new Uint8Array(rb), cur = new Uint8Array(rb);
    for (let y = 0; y < ph; y++) {
      rowsTotal++;
      if (at + 1 + rb > raw.length) return at;
      const ft = raw[at];
      cur.set(raw.subarray(at + 1, at + 1 + rb));
      at += 1 + rb;
      unfilter(ft, cur, prev, bpp);
      const oy = y0 + y * dy;
      for (let x = 0; x < pw; x++) {
        const ox = x0 + x * dx;
        const o = (oy * w + ox) * 4;
        let r = 0, g = 0, b = 0, a = 255;
        if (ct === 3) {
          const idx = bitSample(cur, x, depth);
          if (palette && idx * 3 + 2 < palette.length) { r = palette[idx * 3]; g = palette[idx * 3 + 1]; b = palette[idx * 3 + 2]; }
          if (trns && idx < trns.length) a = trns[idx];
        } else if (ct === 0 || ct === 4) {
          const v = sample16 ? cur[x * (ct === 4 ? 4 : 2)] : depth === 8 ? cur[x * (ct === 4 ? 2 : 1)] : Math.round((bitSample(cur, x, depth) * 255) / maxv);
          r = g = b = v;
          if (ct === 4) a = sample16 ? cur[x * 4 + 2] : cur[x * 2 + 1];
          else if (trns && trns.length >= 2) { const key = (trns[0] << 8) | trns[1]; const rawv = sample16 ? (cur[x * 2] << 8) | cur[x * 2 + 1] : bitSample(cur, x, depth); if (rawv === key) a = 0; }
        } else {
          const s = sample16 ? 2 : 1, n = ct === 6 ? 4 : 3;
          const base = x * n * s;
          r = cur[base]; g = cur[base + s]; b = cur[base + 2 * s];
          if (ct === 6) a = cur[base + 3 * s];
          else if (trns && trns.length >= 6) { const key = [(trns[0] << 8) | trns[1], (trns[2] << 8) | trns[3], (trns[4] << 8) | trns[5]]; const rv = sample16 ? [(cur[base] << 8) | cur[base + 1], (cur[base + 2] << 8) | cur[base + 3], (cur[base + 4] << 8) | cur[base + 5]] : [r, g, b]; if (rv[0] === key[0] && rv[1] === key[1] && rv[2] === key[2]) a = 0; }
        }
        d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = a;
      }
      rowsDecoded++;
      const t = prev; prev = cur; cur = t;
    }
    return at;
  };
  if (!interlace) decodePass(w, h, 0, 0, 0, 1, 1);
  else {
    const passes = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];
    let at = 0;
    for (const [x0, y0, dx, dy] of passes) {
      const pw = Math.ceil((w - x0) / dx), ph = Math.ceil((h - y0) / dy);
      if (pw <= 0 || ph <= 0) continue;
      at = decodePass(pw, ph, at, x0, y0, dx, dy);
    }
  }
  if (rowsDecoded < rowsTotal) { warnings.push(`${rowsDecoded} of ${rowsTotal} rows${interlace ? ' (over 7 interlace passes)' : ''} decoded; the rest is left transparent`); hasAlpha = true; }
  const notes = [({ 0: 'grayscale', 2: 'RGB', 3: 'palette', 4: 'grayscale + alpha', 6: 'RGBA' } as Record<number, string>)[ct], `${depth} bits per channel`, interlace ? 'interlaced (Adam7)' : '', 'decoded by the app\'s tolerant PNG reader'].filter(Boolean);
  return { pages: [{ width: w, height: h, frames: [{ raster: out, delay: 0 }], loops: 0, bitDepth: depth * channels, paletteSize: ct === 3 && palette ? palette.length / 3 : undefined, hasAlpha, dpi, notes }], info, warnings, rowsDecoded, rowsTotal };
}

function adam7Size(w: number, h: number, rowBytes: (n: number) => number): number {
  const passes = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];
  let n = 0;
  for (const [x0, y0, dx, dy] of passes) { const pw = Math.ceil((w - x0) / dx), ph = Math.ceil((h - y0) / dy); if (pw > 0 && ph > 0) n += (rowBytes(pw) + 1) * ph; }
  return n;
}

function bitSample(row: Uint8Array, x: number, depth: number): number {
  if (depth === 8) return row[x];
  if (depth === 16) return (row[x * 2] << 8) | row[x * 2 + 1];
  const bit = x * depth;
  return (row[bit >> 3] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
}

function unfilter(ft: number, cur: Uint8Array, prev: Uint8Array, bpp: number): void {
  const n = cur.length;
  switch (ft) {
    case 1: for (let i = bpp; i < n; i++) cur[i] = (cur[i] + cur[i - bpp]) & 255; break;
    case 2: for (let i = 0; i < n; i++) cur[i] = (cur[i] + prev[i]) & 255; break;
    case 3: for (let i = 0; i < n; i++) cur[i] = (cur[i] + (((i >= bpp ? cur[i - bpp] : 0) + prev[i]) >> 1)) & 255; break;
    case 4: for (let i = 0; i < n; i++) { const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0; const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); cur[i] = (cur[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255; } break;
    default: break; // 0 (none) and unknown types (treated as none)
  }
}

const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8: Uint8Array, start: number, end: number): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ u8[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
