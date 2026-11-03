/**
 * JPEG XL and AVIF decoders of the app's own, for platforms that do not decode them (the platform's are used
 * first). JPEG XL: jxl-oxide (MIT/Apache-2.0), a complete decoder tested against the JPEG XL conformance
 * suite, rendering every frame of an animation, converted to sRGB (HDR and wide-gamut pictures included).
 * AVIF: libavif with the libaom AV1 decoder (BSD-2-Clause, with the AOMedia patent license) and libyuv
 * (BSD-3-Clause), as packaged by jSquash from Squoosh (Apache-2.0).
 * Both are WebAssembly runtimes loaded like the others: the build's local copy, or a pinned CDN address.
 */
import { makeRaster, type DecodeResult, type DecodedPage } from './raster';
import { decodePngTolerant } from './png';
import { runtimeBase } from '../platform/runtimes';

export const JXL_CDN = 'https://cdn.jsdelivr.net/npm/jxl-oxide-wasm@0.12.6/';
export const AVIF_CDN = 'https://cdn.jsdelivr.net/npm/@jsquash/avif@2.1.1/';

let jxlMod: Promise<any> | null = null, avifMod: Promise<any> | null = null;
/** For tests and tools: use already initialized modules. */
export function setModernModules(m: { jxl?: any; avif?: any }): void { if (m.jxl) jxlMod = Promise.resolve(m.jxl); if (m.avif) avifMod = Promise.resolve(m.avif); }
function jxlRuntime(): Promise<any> {
  return (jxlMod ??= (async () => {
    const base = await runtimeBase('jxl', JXL_CDN);
    const m: any = await import(/* @vite-ignore */ base + 'jxl_oxide_wasm.js');
    await m.default({ module_or_path: base + 'jxl_oxide_wasm_bg.wasm' });
    return m;
  })().catch((e) => { jxlMod = null; throw new Error(`The JPEG XL decoder (jxl-oxide) could not be loaded: ${(e as Error).message}`); }));
}
function avifRuntime(): Promise<any> {
  return (avifMod ??= (async () => {
    const base = await runtimeBase('avif', AVIF_CDN);
    const m: any = await import(/* @vite-ignore */ base + 'decode.js');
    await m.init({ locateFile: (f: string) => base + 'codec/dec/' + f });
    return m;
  })().catch((e) => { avifMod = null; throw new Error(`The AVIF decoder (libavif) could not be loaded: ${(e as Error).message}`); }));
}

const be32 = (u: Uint8Array, o: number) => ((u[o] << 24) | (u[o + 1] << 16) | (u[o + 2] << 8) | u[o + 3]) >>> 0;
const tag = (u: Uint8Array, o: number) => String.fromCharCode(u[o], u[o + 1], u[o + 2], u[o + 3]);
/** Top-level ISO-BMFF boxes (JPEG XL container, AVIF). */
function topBoxes(u8: Uint8Array): { type: string; start: number; end: number }[] {
  const out: { type: string; start: number; end: number }[] = []; let p = 0;
  while (p + 8 <= u8.length) {
    let len = be32(u8, p), head = 8; const type = tag(u8, p + 4);
    if (len === 1) { len = be32(u8, p + 8) * 4294967296 + be32(u8, p + 12); head = 16; } else if (len === 0) len = u8.length - p;
    if (len < head || p + len > u8.length) break;
    out.push({ type, start: p + head, end: p + len }); p += len;
  }
  return out;
}

/** The codestream of a JPEG XL file (bare, or from its jxlc / jxlp boxes). */
function jxlCodestream(u8: Uint8Array): Uint8Array {
  if (u8[0] === 0xff && u8[1] === 0x0a) return u8;
  const parts: Uint8Array[] = [];
  for (const b of topBoxes(u8)) { if (b.type === 'jxlc') return u8.subarray(b.start, b.end); if (b.type === 'jxlp') parts.push(u8.subarray(b.start + 4, b.end)); }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
/**
 * The animation's ticks per second, from the codestream header (ISO/IEC 18181-1: SizeHeader, then ImageMetadata up to
 * its AnimationHeader; fields are read least significant bit first), or null for a still picture.
 */
export function jxlTicksPerSecond(u8: Uint8Array): [number, number] | null {
  const cs = jxlCodestream(u8); let pos = 16; // after FF 0A
  const bit = () => { const v = (cs[pos >> 3] >> (pos & 7)) & 1; pos++; return v; };
  const u = (n: number) => { let v = 0; for (let i = 0; i < n; i++) v += bit() * 2 ** i; return v; };
  const u32 = (d: ([number] | [number, number])[]) => { const c = d[u(2)]; return c.length === 1 ? c[0] : u(c[0]) + c[1]; };
  const size = () => { // SizeHeader
    const div8 = bit();
    if (div8) u(5); else u32([[9, 1], [13, 1], [18, 1], [30, 1]]);
    if (u(3) === 0) { if (div8) u(5); else u32([[9, 1], [13, 1], [18, 1], [30, 1]]); }
  };
  size();
  if (bit()) return null; // all_default
  if (bit()) { // extra_fields
    u(3); // orientation
    if (bit()) size(); // intrinsic size
    if (bit()) { // preview
      const div8 = bit();
      if (div8) u32([[16], [32], [5, 1], [9, 33]]); else u32([[6, 1], [8, 65], [10, 321], [12, 1345]]);
      if (u(3) === 0) { if (div8) u32([[16], [32], [5, 1], [9, 33]]); else u32([[6, 1], [8, 65], [10, 321], [12, 1345]]); }
    }
    if (bit()) return [u32([[100], [1000], [10, 1], [30, 1]]), u32([[1], [1001], [8, 1], [10, 1]])];
  }
  return null;
}

export async function decodeJxl(u8: Uint8Array): Promise<DecodeResult> {
  const m = await jxlRuntime();
  const img = new m.JxlImage();
  try {
    img.forceSrgb = true;
    img.feedBytes(u8);
    if (!img.tryInit()) throw new Error('JPEG XL: the file ends before its header');
    const w = img.width as number, h = img.height as number, n = Math.max(1, img.numLoadedKeyframes as number);
    const frames: { raster: ReturnType<typeof makeRaster>; delay: number }[] = [];
    // jxl-oxide-wasm reports a frame's duration as ticks × tps_numerator / tps_denominator; a frame lasts
    // ticks × tps_denominator / tps_numerator seconds, so its figure is scaled back with the header's rate.
    const tps = img.animated ? (() => { try { return jxlTicksPerSecond(u8); } catch { return null; } })() : null;
    const seconds = (v: number) => (tps ? (v * tps[1] * tps[1]) / (tps[0] * tps[0]) : v / 1000);
    let alpha = false, depth = 8;
    for (let k = 0; k < (img.animated ? n : 1); k++) {
      const r = img.render(img.animated ? k : null);
      const duration = r.duration as number; // read first: encodeToPng() consumes the result
      const pg = decodePngTolerant(r.encodeToPng()).pages[0];
      if (pg.hasAlpha) alpha = true;
      depth = Math.max(depth, pg.bitDepth / (pg.hasAlpha ? 4 : 3));
      frames.push({ raster: pg.frames[0].raster, delay: img.animated && Number.isFinite(duration) ? Math.round(seconds(duration) * 1000) : 0 });
    }
    const boxes = topBoxes(u8), container = u8[0] === 0 && tag(u8, 4) === 'JXL ';
    const notes = [`JPEG XL ${container ? 'file' : 'codestream'}${img.animated ? `, animation of ${frames.length} frames` : ''}${boxes.some((b) => b.type === 'jbrd') ? '; a recompressed JPEG (the original JPEG can be rebuilt bit for bit)' : ''}`, 'decoded by jxl-oxide, converted to sRGB'];
    if (!img.loaded) notes.push('the file is incomplete: shown as far as it goes');
    const page: DecodedPage = { width: w, height: h, frames, loops: img.animated ? (img.numLoops ?? 0) : 0, bitDepth: Math.round(depth) * (alpha ? 4 : 3), hasAlpha: alpha, notes };
    const info: Record<string, string> = {};
    const xmp = boxes.find((b) => b.type === 'xml ');
    if (xmp) info.XMP = new TextDecoder().decode(u8.subarray(xmp.start, xmp.end));
    return { pages: [page], info, warnings: [] };
  } catch (e) {
    throw new Error(String((e as Error)?.message || e).startsWith('JPEG XL') ? (e as Error).message : `JPEG XL: ${(e as Error)?.message || e}`);
  } finally { img.free(); }
}

export async function decodeAvif(u8: Uint8Array): Promise<DecodeResult> {
  const m = await avifRuntime();
  let r: { data: Uint8ClampedArray; width: number; height: number } | null;
  try { r = await m.default(u8.slice().buffer, { bitDepth: 8 }); }
  catch (e) { throw new Error(`AVIF: ${(e as Error)?.message || e}`); }
  if (!r) throw new Error('AVIF: the picture could not be decoded');
  const out = makeRaster(r.width, r.height); out.data.set(r.data);
  let alpha = false; for (let i = 3; i < out.data.length; i += 4) if (out.data[i] !== 255) { alpha = true; break; }
  const ftyp = topBoxes(u8).find((b) => b.type === 'ftyp'), brand = ftyp ? tag(u8, ftyp.start) : '';
  const warnings = brand === 'avis' ? ['An AVIF image sequence: its first frame is shown'] : [];
  return { pages: [{ width: r.width, height: r.height, frames: [{ raster: out, delay: 0 }], loops: 0, bitDepth: alpha ? 32 : 24, hasAlpha: alpha, notes: ['AVIF, decoded by libavif with libaom (8 bits per sample)'] }], info: {}, warnings };
}
