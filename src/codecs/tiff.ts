/**
 * Baseline TIFF reader: every IFD (page) with 1, 2, 4, 8 or 16 bits per sample, bilevel, grayscale,
 * palette, RGB and RGBA (associated or unassociated alpha), uncompressed, PackBits, LZW (with the
 * horizontal predictor) or Deflate, in strips or tiles, chunky planar configuration, both byte orders
 * and BigTIFF. Separated (CMYK) data is converted naively. Anything else is reported in the warnings and
 * the page is skipped, so a file with one unreadable page still shows the others.
 */
import { makeRaster, type DecodeResult, type DecodedPage } from './raster';

export function isTiff(u8: Uint8Array): boolean {
  if (u8.length < 8) return false;
  const le = u8[0] === 0x49 && u8[1] === 0x49, be = u8[0] === 0x4d && u8[1] === 0x4d;
  if (!le && !be) return false;
  const magic = le ? u8[2] | (u8[3] << 8) : (u8[2] << 8) | u8[3];
  return magic === 42 || magic === 43;
}

export interface IfdEntry { tag: number; type: number; count: number; values: number[] }

/** Reads one IFD into a map of tag → values (the first 1M values of each). Shared with the EXIF reader. */
export function readIfd(u8: Uint8Array, offset: number, le: boolean, big = false): { tags: Map<number, IfdEntry>; next: number } {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const u16 = (o: number) => dv.getUint16(o, le);
  const u32 = (o: number) => dv.getUint32(o, le);
  const u64 = (o: number) => Number(dv.getBigUint64(o, le));
  const tags = new Map<number, IfdEntry>();
  if (offset + (big ? 8 : 2) > u8.length) return { tags, next: 0 };
  const n = big ? u64(offset) : u16(offset);
  const entrySize = big ? 20 : 12;
  const base0 = offset + (big ? 8 : 2);
  const sizes: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4, 16: 8, 17: 8, 18: 8 };
  for (let k = 0; k < Math.min(n, 4096); k++) {
    const e = base0 + k * entrySize;
    if (e + entrySize > u8.length) break;
    const tag = u16(e), type = u16(e + 2), count = big ? u64(e + 4) : u32(e + 4);
    const size = sizes[type] || 1;
    const inlineMax = big ? 8 : 4;
    const vo = e + (big ? 12 : 8);
    const base = size * count <= inlineMax ? vo : big ? u64(vo) : u32(vo);
    const values: number[] = [];
    const max = Math.min(count, 1 << 20);
    for (let i = 0; i < max; i++) {
      const o = base + i * size;
      if (o + size > u8.length) break;
      switch (type) {
        case 3: case 8: values.push(type === 3 ? u16(o) : dv.getInt16(o, le)); break;
        case 4: case 13: values.push(u32(o)); break;
        case 9: values.push(dv.getInt32(o, le)); break;
        case 5: { const d = u32(o + 4); values.push(d ? u32(o) / d : 0); break; }
        case 10: { const d = dv.getInt32(o + 4, le); values.push(d ? dv.getInt32(o, le) / d : 0); break; }
        case 11: values.push(dv.getFloat32(o, le)); break;
        case 12: values.push(dv.getFloat64(o, le)); break;
        case 16: case 17: case 18: values.push(u64(o)); break;
        default: values.push(u8[o]);
      }
    }
    tags.set(tag, { tag, type, count, values });
  }
  const nextAt = base0 + n * entrySize;
  const next = nextAt + (big ? 8 : 4) <= u8.length ? (big ? u64(nextAt) : u32(nextAt)) : 0;
  return { tags, next };
}

export async function decodeTiff(u8: Uint8Array): Promise<DecodeResult> {
  if (!isTiff(u8)) throw new Error('Not a TIFF file');
  const le = u8[0] === 0x49;
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const big = dv.getUint16(2, le) === 43;
  let ifd = big ? Number(dv.getBigUint64(8, le)) : dv.getUint32(4, le);
  const pages: DecodedPage[] = [];
  const warnings: string[] = [];
  const info: Record<string, string> = { byteOrder: le ? 'little-endian (II)' : 'big-endian (MM)', bigTiff: big ? 'yes' : 'no' };
  const seen = new Set<number>();
  let n = 0;
  while (ifd && !seen.has(ifd) && n < 500) {
    seen.add(ifd);
    n++;
    const { tags, next } = readIfd(u8, ifd, le, big);
    ifd = next;
    if (n === 1) {
      const str = (t: number) => { const e = tags.get(t); return e && e.type === 2 ? String.fromCharCode(...e.values.filter((c) => c)).trim() : ''; };
      for (const [t, k] of [[270, 'description'], [271, 'make'], [272, 'model'], [305, 'software'], [306, 'dateTime'], [315, 'artist'], [33432, 'copyright']] as [number, string][]) { const v = str(t); if (v) info[k] = v; }
      if (tags.has(34665)) info.exif = 'yes';
      if (tags.has(700)) info.xmp = 'yes';
      if (tags.has(33723)) info.iptc = 'yes';
      if (tags.has(34675)) info.icc = 'yes';
    }
    const sub = tags.get(254)?.values[0] || 0;
    if (sub & 1 && pages.length) continue; // reduced-resolution copy of an earlier page
    try {
      pages.push(await decodePage(u8, tags, le, warnings, n));
    } catch (e: any) {
      warnings.push(`Page ${n}: ${e?.message || e}`);
    }
  }
  if (!pages.length) throw new Error(warnings[0] || 'No readable page');
  return { pages, info, warnings };
}

async function decodePage(u8: Uint8Array, tags: Map<number, IfdEntry>, le: boolean, warnings: string[], pageNo: number): Promise<DecodedPage> {
  const g = (t: number, d: number) => tags.get(t)?.values[0] ?? d;
  const w = g(256, 0), h = g(257, 0);
  if (!w || !h) throw new Error('no dimensions');
  if (w * h > 80_000_000) throw new Error('too large');
  const bps = tags.get(258)?.values || [1];
  const comp = g(259, 1), photo = g(262, bps[0] === 1 ? 0 : 1), spp = g(277, bps.length || 1), planar = g(284, 1), pred = g(317, 1);
  const extra = tags.get(338)?.values || [];
  const sampleFormat = g(339, 1);
  const bits = bps[0];
  if (planar !== 1) throw new Error('planar (separate) sample layout is not supported yet');
  if (![1, 2, 3, 4, 8, 16].includes(bits)) throw new Error(`${bits}-bit samples are not supported yet`);
  if (sampleFormat === 3) throw new Error('floating-point samples are not supported yet');
  const compressionName: Record<number, string> = { 1: 'uncompressed', 2: 'CCITT RLE', 3: 'CCITT G3', 4: 'CCITT G4', 5: 'LZW', 6: 'old JPEG', 7: 'JPEG', 8: 'Deflate', 32773: 'PackBits', 32946: 'Deflate', 34712: 'JPEG 2000', 50000: 'ZSTD' };
  if (comp === 7 || comp === 6) return decodeJpegPage(u8, tags, w, h, spp, photo, extra, warnings, pageNo, g);
  if (![1, 5, 8, 32773, 32946].includes(comp)) throw new Error(`${compressionName[comp] || 'compression ' + comp} is not supported yet`);
  const rowBytes = Math.ceil((w * spp * bits) / 8);
  const raw = new Uint8Array(rowBytes * h);
  const tiled = tags.has(324);
  if (tiled) {
    const tw = g(322, w), th = g(323, h);
    const offsets = tags.get(324)!.values, counts = tags.get(325)?.values || [];
    const tilesAcross = Math.ceil(w / tw);
    const tileRowBytes = Math.ceil((tw * spp * bits) / 8);
    for (let t = 0; t < offsets.length; t++) {
      const tx = (t % tilesAcross) * tw, ty = Math.floor(t / tilesAcross) * th;
      if (ty >= h) break;
      const dec = await inflateChunk(u8.subarray(offsets[t], offsets[t] + (counts[t] ?? 0)), comp, tileRowBytes * th);
      undoPredictor(dec, pred, bits, spp, tw, th, tileRowBytes);
      const xBytes = Math.floor((tx * spp * bits) / 8);
      const copyBytes = Math.min(tileRowBytes, rowBytes - xBytes);
      for (let y = 0; y < th && ty + y < h; y++) raw.set(dec.subarray(y * tileRowBytes, y * tileRowBytes + copyBytes), (ty + y) * rowBytes + xBytes);
    }
  } else {
    const rps = Math.min(g(278, h), h);
    const offsets = tags.get(273)?.values || [], counts = tags.get(279)?.values || [];
    if (!offsets.length) throw new Error('no strips');
    let o = 0;
    for (let s = 0; s < offsets.length && o < raw.length; s++) {
      const rows = Math.min(rps, h - Math.floor(o / rowBytes));
      const want = rows * rowBytes;
      const cnt = counts[s] ?? (comp === 1 ? want : u8.length - offsets[s]);
      if (offsets[s] + cnt > u8.length) warnings.push(`Page ${pageNo}: strip ${s + 1} is truncated`);
      const dec = await inflateChunk(u8.subarray(offsets[s], Math.min(u8.length, offsets[s] + cnt)), comp, want);
      undoPredictor(dec, pred, bits, spp, w, rows, rowBytes);
      raw.set(dec.subarray(0, Math.min(want, raw.length - o)), o);
      o += want;
    }
  }
  const map = tags.get(320)?.values;
  const out = makeRaster(w, h);
  const d = out.data;
  const hasAlpha = extra.includes(1) || extra.includes(2) || (photo === 2 && spp === 4 && !extra.length);
  const assocAlpha = extra.includes(1);
  const maxv = (1 << bits) - 1;
  const sample = (row: number, i: number): number => {
    // sample index i within the row (0-based across samples)
    if (bits === 8) return raw[row + i];
    if (bits === 16) return le ? (raw[row + i * 2] | (raw[row + i * 2 + 1] << 8)) >> 8 : (raw[row + i * 2] << 8 | raw[row + i * 2 + 1]) >> 8;
    const bitPos = i * bits;
    const byte = raw[row + (bitPos >> 3)];
    return (byte >> (8 - bits - (bitPos & 7))) & maxv;
  };
  const scale = bits === 16 ? 255 : 255 / maxv;
  for (let y = 0; y < h; y++) {
    const row = y * rowBytes;
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const s0 = x * spp;
      if (photo === 3 && map) {
        const k = sample(row, s0), m = map.length / 3;
        d[o] = map[k] >> 8; d[o + 1] = map[m + k] >> 8; d[o + 2] = map[2 * m + k] >> 8; d[o + 3] = 255;
      } else if (photo === 2 || (spp >= 3 && photo !== 5)) {
        d[o] = sample(row, s0) * scale; d[o + 1] = sample(row, s0 + 1) * scale; d[o + 2] = sample(row, s0 + 2) * scale;
        d[o + 3] = hasAlpha && spp >= 4 ? sample(row, s0 + 3) * scale : 255;
        if (assocAlpha && d[o + 3] && d[o + 3] < 255) { const a = 255 / d[o + 3]; d[o] = Math.min(255, d[o] * a); d[o + 1] = Math.min(255, d[o + 1] * a); d[o + 2] = Math.min(255, d[o + 2] * a); }
      } else if (photo === 5 && spp >= 4) {
        const c = sample(row, s0) * scale, m = sample(row, s0 + 1) * scale, yy = sample(row, s0 + 2) * scale, k = sample(row, s0 + 3) * scale;
        d[o] = 255 - Math.min(255, c + k); d[o + 1] = 255 - Math.min(255, m + k); d[o + 2] = 255 - Math.min(255, yy + k); d[o + 3] = 255;
      } else {
        let v = sample(row, s0) * scale;
        if (photo === 0) v = 255 - v;
        d[o] = d[o + 1] = d[o + 2] = v;
        d[o + 3] = hasAlpha && spp >= 2 ? sample(row, s0 + 1) * scale : 255;
      }
    }
  }
  const unit = g(296, 2);
  const xr = g(282, 0), yr = g(283, 0);
  const dpi: [number, number] | undefined = xr && yr ? (unit === 3 ? [Math.round(xr * 2.54), Math.round(yr * 2.54)] : [Math.round(xr), Math.round(yr)]) : undefined;
  const notes = [compressionName[comp] || `compression ${comp}`, photo === 3 ? 'palette' : photo === 2 ? (spp >= 4 ? 'RGBA' : 'RGB') : photo === 5 ? 'CMYK' : bits === 1 ? 'bilevel' : 'grayscale', pred === 2 ? 'horizontal predictor' : '', tiled ? 'tiled' : 'strips'].filter(Boolean);
  return { width: w, height: h, frames: [{ raster: out, delay: 0 }], loops: 0, bitDepth: bits * spp, paletteSize: photo === 3 && map ? map.length / 3 : undefined, hasAlpha, dpi, notes };
}

function undoPredictor(dec: Uint8Array, pred: number, bits: number, spp: number, w: number, rows: number, rowBytes: number): void {
  if (pred !== 2) return;
  if (bits === 8) {
    for (let y = 0; y < rows; y++) { const r = y * rowBytes; for (let x = spp; x < w * spp && r + x < dec.length; x++) dec[r + x] = (dec[r + x] + dec[r + x - spp]) & 255; }
  } else if (bits === 16) {
    for (let y = 0; y < rows; y++) { const r = y * rowBytes; for (let x = spp; x < w * spp; x++) { const i = r + x * 2, j = r + (x - spp) * 2; if (i + 1 >= dec.length) break; const v = (dec[i] | (dec[i + 1] << 8)) + (dec[j] | (dec[j + 1] << 8)); dec[i] = v & 255; dec[i + 1] = (v >> 8) & 255; } }
  }
}

/** JPEG in TIFF (compression 7, and the old style 6 where each strip is a whole JPEG): every strip or tile is a JPEG, decoded by the platform, with the JPEGTables segments inserted after its SOI. */
async function decodeJpegPage(u8: Uint8Array, tags: Map<number, IfdEntry>, w: number, h: number, spp: number, photo: number, extra: number[], warnings: string[], pageNo: number, g: (t: number, d: number) => number): Promise<DecodedPage> {
  if (typeof document === 'undefined') throw new Error('JPEG-compressed TIFF needs the platform decoder');
  const tables = tags.get(347)?.values;
  let tableSegs: Uint8Array | null = null;
  if (tables && tables.length > 4) { const t = Uint8Array.from(tables); tableSegs = t.subarray(2, t.length - 2); } // between SOI and EOI
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const tiled = tags.has(324);
  const offsets = (tiled ? tags.get(324) : tags.get(273))?.values || [], counts = (tiled ? tags.get(325) : tags.get(279))?.values || [];
  if (!offsets.length) throw new Error('no strips');
  const tw = tiled ? g(322, w) : w, th = tiled ? g(323, h) : Math.min(g(278, h), h);
  const across = tiled ? Math.ceil(w / tw) : 1;
  let decoded = 0;
  for (let i = 0; i < offsets.length; i++) {
    const x = (i % across) * tw, y = Math.floor(i / across) * th;
    if (y >= h) break;
    const cnt = counts[i] ?? u8.length - offsets[i];
    let strip = u8.subarray(offsets[i], Math.min(u8.length, offsets[i] + cnt));
    if (strip.length < 4 || strip[0] !== 0xff || strip[1] !== 0xd8) { warnings.push(`Page ${pageNo}: ${tiled ? 'tile' : 'strip'} ${i + 1} is not a JPEG stream`); continue; }
    if (tableSegs) { const merged = new Uint8Array(2 + tableSegs.length + strip.length - 2); merged.set(strip.subarray(0, 2)); merged.set(tableSegs, 2); merged.set(strip.subarray(2), 2 + tableSegs.length); strip = merged; }
    try {
      const bmp = await createImageBitmap(new Blob([strip as BlobPart], { type: 'image/jpeg' }), { imageOrientation: 'none' as any, premultiplyAlpha: 'none' as any });
      ctx.drawImage(bmp, x, y);
      bmp.close();
      decoded++;
    } catch (e: any) { warnings.push(`Page ${pageNo}: ${tiled ? 'tile' : 'strip'} ${i + 1} could not be decoded (${e?.message || e})`); }
  }
  if (!decoded) throw new Error('no JPEG strip could be decoded');
  const id = ctx.getImageData(0, 0, w, h);
  const hasAlpha = extra.includes(1) || extra.includes(2);
  return { width: w, height: h, frames: [{ raster: { width: w, height: h, data: id.data as Uint8ClampedArray<ArrayBuffer> }, delay: 0 }], loops: 0, bitDepth: 8 * spp, hasAlpha, dpi: dpiOf(tags), notes: [`JPEG-compressed ${tiled ? 'tiles' : 'strips'} (${decoded} of ${offsets.length})`, photo === 6 ? 'YCbCr' : photo === 5 ? 'CMYK' : photo === 2 ? 'RGB' : 'grayscale'] };
}

function dpiOf(tags: Map<number, IfdEntry>): [number, number] | undefined {
  const unit = tags.get(296)?.values[0] ?? 2, xr = tags.get(282)?.values[0], yr = tags.get(283)?.values[0];
  if (!xr || unit === 1) return undefined;
  const y = yr || xr;
  return unit === 3 ? [Math.round(xr * 2.54), Math.round(y * 2.54)] : [Math.round(xr), Math.round(y)];
}

async function inflateChunk(src: Uint8Array, comp: number, want: number): Promise<Uint8Array> {
  if (comp === 1) { if (src.length >= want) return src; const out = new Uint8Array(want); out.set(src); return out; }
  if (comp === 32773) return packBits(src, want);
  if (comp === 5) return lzwTiff(src, want);
  // Deflate (zlib stream)
  const out = new Uint8Array(want);
  try {
    const ds = new DecompressionStream('deflate');
    const writer = ds.writable.getWriter();
    void writer.write(src.slice()).catch(() => undefined);
    void writer.close().catch(() => undefined);
    const reader = ds.readable.getReader();
    let o = 0;
    for (;;) { const { done, value } = await reader.read(); if (done || !value) break; const n = Math.min(value.length, want - o); out.set(value.subarray(0, n), o); o += n; if (o >= want) { void reader.cancel().catch(() => undefined); break; } }
  } catch (e: any) {
    throw new Error(`Deflate data could not be read (${e?.message || e})`);
  }
  return out;
}

export function packBits(src: Uint8Array, want: number): Uint8Array {
  const out = new Uint8Array(want);
  let i = 0, o = 0;
  while (i < src.length && o < want) {
    const n = (src[i++] << 24) >> 24;
    if (n >= 0) { for (let k = 0; k <= n && o < want && i < src.length; k++) out[o++] = src[i++]; }
    else if (n !== -128) { const v = src[i++]; for (let k = 0; k < 1 - n && o < want; k++) out[o++] = v; }
  }
  return out;
}

/** TIFF LZW: big-endian bit packing, early change. */
export function lzwTiff(src: Uint8Array, want: number): Uint8Array {
  const out = new Uint8Array(want);
  let o = 0, bitPos = 0, width = 9;
  const prefix = new Int32Array(4096), suffix = new Uint8Array(4096), lens = new Uint16Array(4096);
  let next = 258;
  const reset = () => { next = 258; width = 9; };
  for (let i = 0; i < 256; i++) { prefix[i] = -1; suffix[i] = i; lens[i] = 1; }
  let prev = -1;
  const total = src.length * 8;
  const read = () => {
    let v = 0;
    for (let k = 0; k < width; k++) { const bp = bitPos + k; v = (v << 1) | ((src[bp >> 3] >> (7 - (bp & 7))) & 1); }
    bitPos += width;
    return v;
  };
  const stack = new Uint8Array(4097);
  const emit = (code: number): number => {
    let n = 0, c = code;
    while (c >= 0) { stack[n++] = suffix[c]; c = prefix[c]; }
    for (let k = n - 1; k >= 0 && o < want; k--) out[o++] = stack[k];
    return stack[n - 1];
  };
  while (bitPos + width <= total && o < want) {
    const code = read();
    if (code === 256) { reset(); prev = -1; continue; }
    if (code === 257) break;
    let first: number;
    if (code < next) {
      first = emit(code);
    } else if (code === next && prev >= 0) {
      let c = prev; while (prefix[c] >= 0) c = prefix[c];
      first = suffix[c];
      emit(prev); if (o < want) out[o++] = first;
    } else break;
    if (prev >= 0 && next < 4096) { prefix[next] = prev; suffix[next] = first; lens[next] = lens[prev] + 1; next++; }
    prev = code;
    if (next + 1 >= 1 << width && width < 12) width++;
  }
  return out;
}
