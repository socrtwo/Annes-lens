/**
 * JPEG 2000: JP2/JPX files and raw codestreams (.j2k/.j2c/.jpc), High-Throughput JPEG 2000 (HTJ2K) too.
 * The header is read here (size, components, bit depths, subsampling, tiles, resolution levels, quality
 * layers, reversible or not, color space, ICC profile, resolution, XMP); the pixels are decoded by
 * OpenJPEG, the JPEG 2000 reference decoder (BSD-2-Clause), as WebAssembly from pdf.js's image decoders
 * (Apache-2.0), loaded with the PDF runtime (the build's local copy, or its pinned CDN address).
 * Samples come back at 8 bits; sYCC and CMYK are converted to RGB here; very large pictures are decoded
 * at a reduced resolution level instead of running out of memory.
 */
import { makeRaster, type DecodeResult } from './raster';
import { runtimeBase } from '../platform/runtimes';
import { PDFJS_CDN } from './pdf';

const be32 = (u: Uint8Array, o: number) => ((u[o] << 24) | (u[o + 1] << 16) | (u[o + 2] << 8) | u[o + 3]) >>> 0;
const be16 = (u: Uint8Array, o: number) => (u[o] << 8) | u[o + 1];
const tag = (u: Uint8Array, o: number) => String.fromCharCode(u[o], u[o + 1], u[o + 2], u[o + 3]);

export const isJp2 = (u8: Uint8Array): boolean => u8.length > 12 && be32(u8, 0) === 12 && tag(u8, 4) === 'jP  ' && be32(u8, 8) === 0x0d0a870a;
export const isJ2k = (u8: Uint8Array): boolean => u8.length > 4 && u8[0] === 0xff && u8[1] === 0x4f && u8[2] === 0xff && u8[3] === 0x51;

export interface JpxInfo {
  width: number; height: number; x0: number; y0: number; components: number; depths: number[]; signed: boolean[]; sub: [number, number][];
  tiles: [number, number]; levels: number; layers: number; reversible: boolean; progression: string; ht: boolean;
  family: 'jp2' | 'jpx' | 'jph' | 'j2k'; colorspace: string | null; icc: Uint8Array | null; palette: number; alpha: number[];
  dpi: [number, number] | null; xmp: string | null; codestream: number;
}
const COLORSPACES: Record<number, string> = { 0: 'bilevel', 12: 'CMYK', 13: 'YCCK', 14: 'CIELab', 16: 'sRGB', 17: 'grayscale', 18: 'sYCC', 20: 'e-sRGB', 21: 'ROMM-RGB', 22: 'YPbPr(1125/60)', 23: 'YPbPr(1250/50)', 24: 'e-sYCC' };
const PROGRESSIONS = ['LRCP', 'RLCP', 'RPCL', 'PCRL', 'CPRL'];
const XMP_UUID = 'be7acfcb97a942e89c71999491e3afac';

/** Reads the JP2 boxes (if any) and the codestream's main header. */
export function jpxInfo(u8: Uint8Array): JpxInfo {
  const info: JpxInfo = { width: 0, height: 0, x0: 0, y0: 0, components: 0, depths: [], signed: [], sub: [], tiles: [1, 1], levels: 0, layers: 0, reversible: false, progression: '', ht: false, family: 'j2k', colorspace: null, icc: null, palette: 0, alpha: [], dpi: null, xmp: null, codestream: 0 };
  if (isJp2(u8)) {
    const boxes = (start: number, end: number, fn: (type: string, at: number, end: number) => void) => {
      let p = start;
      while (p + 8 <= end) {
        let len = be32(u8, p); const type = tag(u8, p + 4); let head = 8;
        if (len === 1) { len = be32(u8, p + 8) * 4294967296 + be32(u8, p + 12); head = 16; } else if (len === 0) len = end - p;
        if (len < head || p + len > end) break;
        fn(type, p + head, p + len);
        p += len;
      }
    };
    let found = -1;
    boxes(0, u8.length, (type, at, end) => {
      if (type === 'ftyp') { const brand = tag(u8, at); info.family = brand === 'jpx ' ? 'jpx' : brand === 'jph ' ? 'jph' : 'jp2'; }
      else if (type === 'jp2h') boxes(at, end, (t, a, e) => {
        if (t === 'colr' && !info.colorspace && !info.icc) {
          const meth = u8[a];
          if (meth === 1) info.colorspace = COLORSPACES[be32(u8, a + 3)] ?? `enumerated ${be32(u8, a + 3)}`;
          else if (meth === 2 || meth === 3) { info.icc = u8.slice(a + 3, e); info.colorspace = 'ICC'; }
        } else if (t === 'pclr') info.palette = be16(u8, a);
        else if (t === 'cdef') { const n = be16(u8, a); for (let i = 0; i < n; i++) { const typ = be16(u8, a + 2 + i * 6 + 2); if (typ === 1 || typ === 2) info.alpha.push(be16(u8, a + 2 + i * 6)); } }
        else if (t === 'res ') boxes(a, e, (rt, ra) => {
          if (rt !== 'resd' && !(rt === 'resc' && !info.dpi)) return;
          const v = (be16(u8, ra) / (be16(u8, ra + 2) || 1)) * 10 ** ((u8[ra + 8] << 24) >> 24), h = (be16(u8, ra + 4) / (be16(u8, ra + 6) || 1)) * 10 ** ((u8[ra + 9] << 24) >> 24);
          if (v > 0 && h > 0) info.dpi = [Math.round(h * 0.0254), Math.round(v * 0.0254)];
        });
      });
      else if (type === 'jp2c' && found < 0) found = at;
      else if (type === 'uuid' && end - at > 16 && Array.from(u8.subarray(at, at + 16), (b) => b.toString(16).padStart(2, '0')).join('') === XMP_UUID) info.xmp = new TextDecoder().decode(u8.subarray(at + 16, end));
    });
    if (found < 0) throw new Error('This JPEG 2000 file holds no codestream');
    info.codestream = found;
  }
  // Codestream main header: SOC, SIZ, then COD and the rest until the first tile.
  let p = info.codestream;
  if (!(u8[p] === 0xff && u8[p + 1] === 0x4f)) throw new Error('Damaged JPEG 2000 codestream (no start marker)');
  p += 2;
  while (p + 4 <= u8.length) {
    const marker = be16(u8, p), len = be16(u8, p + 2), a = p + 4;
    if (marker === 0xff90 || marker === 0xff93) break; // SOT, SOD
    if (marker === 0xff51) {
      const rsiz = be16(u8, a), x1 = be32(u8, a + 2), y1 = be32(u8, a + 6), x0 = be32(u8, a + 10), y0 = be32(u8, a + 14);
      const tw = be32(u8, a + 18), th = be32(u8, a + 22), tx0 = be32(u8, a + 26), ty0 = be32(u8, a + 30), n = be16(u8, a + 34);
      Object.assign(info, { width: x1 - x0, height: y1 - y0, x0, y0, components: n, ht: !!(rsiz & 0x4000) });
      info.tiles = [Math.ceil((x1 - tx0) / (tw || 1)), Math.ceil((y1 - ty0) / (th || 1))];
      for (let i = 0; i < n; i++) { const s = u8[a + 36 + i * 3]; info.depths.push((s & 0x7f) + 1); info.signed.push(!!(s & 0x80)); info.sub.push([u8[a + 37 + i * 3], u8[a + 38 + i * 3]]); }
    } else if (marker === 0xff52) {
      info.progression = PROGRESSIONS[u8[a + 1]] ?? '?'; info.layers = be16(u8, a + 2);
      info.levels = u8[a + 5]; info.reversible = u8[a + 9] === 1;
    } else if (marker === 0xff50) info.ht = true; // CAP: Part 15
    p += 2 + len;
  }
  if (!info.width || !info.height || !info.components) throw new Error('Damaged JPEG 2000 codestream (no size)');
  return info;
}

// OpenJPEG through pdf.js's image decoders, loaded once.
let mod: Promise<any> | null = null;
/** For tests and tools: use an already loaded pdf.js image-decoders module. */
export function setJpxModule(m: any): void { mod = Promise.resolve(m); }
async function openjpeg(): Promise<any> {
  return (mod ??= (async () => {
    const base = await runtimeBase('pdf', PDFJS_CDN);
    const m: any = await import(/* @vite-ignore */ base + 'image_decoders/pdf.image_decoders.min.mjs');
    m.JpxImage.setOptions({ useWasm: true, useWorkerFetch: true, wasmUrl: base + 'wasm/' });
    return m;
  })().catch((e) => { mod = null; throw new Error(`The JPEG 2000 decoder (OpenJPEG) could not be loaded: ${(e as Error).message}`); }));
}

export const jpxOptions = { maxPixels: 120e6, maxSide: 16384 };

export async function decodeJpx(u8: Uint8Array, o = jpxOptions): Promise<DecodeResult> {
  const info = jpxInfo(u8), warnings: string[] = [];
  // Reduce resolution levels until the picture fits.
  let r = 0;
  const at = (v0: number, v1: number, k: number) => Math.ceil(v1 / 2 ** k) - Math.ceil(v0 / 2 ** k);
  while (r < info.levels && (at(info.x0, info.x0 + info.width, r) * at(info.y0, info.y0 + info.height, r) > o.maxPixels || Math.max(at(info.x0, info.x0 + info.width, r), at(info.y0, info.y0 + info.height, r)) > o.maxSide)) r++;
  const w = at(info.x0, info.x0 + info.width, r), h = at(info.y0, info.y0 + info.height, r);
  if (r) warnings.push(`Shown at 1/${2 ** r} size (${w} × ${h}); the full picture is ${info.width} × ${info.height}`);
  const m = await openjpeg();
  let data: Uint8ClampedArray;
  try { data = await m.JpxImage.instance.decode(u8, { reducePower: r }); }
  catch (e) { throw new Error(`JPEG 2000: ${(e as Error).message || e}`); }
  const n = data.length / (w * h);
  if (!Number.isInteger(n) || n < 1 || n > 4) throw new Error(`JPEG 2000: unexpected decoded size (${data.length} bytes for ${w} × ${h})`);
  const out = makeRaster(w, h), d = out.data;
  const cs = info.colorspace;
  let mode: string;
  if (n === 1 || n === 2) {
    mode = n === 2 ? 'gray with alpha' : 'gray';
    for (let i = 0, j = 0; i < w * h; i++, j += n) { const v = data[j]; d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = n === 2 ? data[j + 1] : 255; }
  } else if (n === 4 && cs === 'CMYK') {
    mode = 'CMYK (converted without a profile)';
    for (let i = 0, j = 0; i < w * h; i++, j += 4) { const k = data[j + 3]; d[i * 4] = 255 - Math.min(255, data[j] + k); d[i * 4 + 1] = 255 - Math.min(255, data[j + 1] + k); d[i * 4 + 2] = 255 - Math.min(255, data[j + 2] + k); d[i * 4 + 3] = 255; }
  } else {
    const ycc = cs === 'sYCC' || cs === 'e-sYCC';
    mode = ycc ? 'sYCC' : n === 4 ? 'RGB with alpha' : 'RGB';
    for (let i = 0, j = 0; i < w * h; i++, j += n) {
      let R = data[j], G = data[j + 1], B = data[j + 2];
      if (ycc) { const Y = R, cb = G - 128, cr = B - 128; R = Y + 1.402 * cr; G = Y - 0.344136 * cb - 0.714136 * cr; B = Y + 1.772 * cb; }
      d[i * 4] = R; d[i * 4 + 1] = G; d[i * 4 + 2] = B; d[i * 4 + 3] = n === 4 ? data[j + 3] : 255;
    }
  }
  if (cs && !['sRGB', 'grayscale', 'sYCC', 'CMYK', 'ICC', 'bilevel'].includes(cs)) warnings.push(`Color space ${cs} is shown as if it were sRGB`);
  const subsampled = info.sub.some(([x, y]) => x !== 1 || y !== 1);
  const depth = Math.max(...info.depths);
  const notes = [
    `JPEG 2000 ${info.family === 'j2k' ? 'codestream' : info.family.toUpperCase()}${info.ht ? ' (High-Throughput, HTJ2K)' : ''}, ${info.reversible ? 'lossless (5/3 wavelet)' : 'lossy (9/7 wavelet)'}`,
    `${mode}; ${info.components} component${info.components > 1 ? 's' : ''} of ${info.depths.join('/')} bits${info.signed.some((s) => s) ? ' (signed)' : ''}${subsampled ? `, subsampled ${info.sub.map(([x, y]) => `${x}×${y}`).join('/')}` : ''}${info.palette ? `, palette of ${info.palette}` : ''}${depth > 8 ? '; shown at 8 bits' : ''}`,
    `${info.levels + 1} resolution levels, ${info.layers} quality layer${info.layers === 1 ? '' : 's'}, ${info.progression} progression${info.tiles[0] * info.tiles[1] > 1 ? `, ${info.tiles[0]} × ${info.tiles[1]} tiles` : ''}`,
    'decoded by OpenJPEG',
  ];
  const result: DecodeResult = { pages: [{ width: w, height: h, frames: [{ raster: out, delay: 0 }], loops: 0, bitDepth: info.depths.reduce((a, b) => a + b, 0), hasAlpha: n === 2 || (n === 4 && cs !== 'CMYK'), dpi: info.dpi ?? undefined, notes }], info: {}, warnings };
  if (info.xmp) result.info.XMP = info.xmp;
  return result;
}
