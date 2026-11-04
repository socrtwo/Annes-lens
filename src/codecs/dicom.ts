/**
 * DICOM pictures (.dcm; the medical imaging standard, PS3.5 and PS3.10), read by the app's own code: the Part 10
 * header and raw data sets without it; implicit and explicit VR, little and big endian, deflated; the pixel module
 * (1, 8, 16 and 32 bits, signed and unsigned, BitsStored/HighBit, planar RGB, YBR_FULL and YBR_FULL_422, palette
 * color, MONOCHROME1/2); every frame as a page; the modality rescale and the first window (LINEAR, LINEAR_EXACT and
 * SIGMOID functions), or the full range of the frame when there is none. Compressed pixel data: RLE (own), JPEG
 * baseline and 12-bit extended (pdf.js's decoder and the app's own DCT decoder), JPEG lossless (the app's own process
 * 14 decoder), JPEG 2000 and HTJ2K (OpenJPEG as WebAssembly at full precision, or pdf.js's 8-bit build of it when
 * that runtime is not available). JPEG-LS and the video syntaxes are named in the error. Overlay planes, VOI lookup tables and presentation states are not applied.
 *
 * The pictures are for viewing only: the app is not a medical device and shows nothing for diagnosis.
 */
import { makeRaster, type DecodeResult, type DecodedPage } from './raster';
import { inflate } from './inflate';
import { jpxInfo } from './jpx';
import { decodeLjpeg } from '../raw/ljpeg';
import { decodeDctSamples } from './jpegdct';
import { openJpegReady, decodeJ2k16 } from './openjpeg16';

export const NOT_FOR_DIAGNOSIS = 'For viewing only: Anne\'s Lens is not a medical device, and this picture is not for diagnosis or treatment decisions';

/** The transfer syntax UID of a Part 10 file ('' when there is none). */
export function dicomTransferSyntax(u8: Uint8Array): string { try { return parseFile(u8).ts; } catch { return ''; } }
export const isJ2kTransferSyntax = (ts: string): boolean => /^1\.2\.840\.10008\.1\.2\.4\.(9[0-3]|20[1-3])$/.test(ts);
export const isDicom = (u8: Uint8Array): boolean => u8.length > 132 && u8[128] === 0x44 && u8[129] === 0x49 && u8[130] === 0x43 && u8[131] === 0x4d;
/** A raw data set without the Part 10 header: a plausible first element (group 0002 or 0008, explicit or implicit VR). */
export function isRawDicom(u8: Uint8Array): boolean {
  if (u8.length < 16 || isDicom(u8)) return false;
  const g = u8[0] | (u8[1] << 8), e = u8[2] | (u8[3] << 8);
  if (!(g === 0x0002 || g === 0x0008) || e > 0x1000) return false;
  const vr = String.fromCharCode(u8[4], u8[5]);
  if (/^[A-Z]{2}$/.test(vr)) return true; // explicit VR
  const len = u8[4] | (u8[5] << 8) | (u8[6] << 16) | (u8[7] << 24);
  return len >= 0 && len < 4096; // implicit VR with a short value
}

const TS: Record<string, string> = {
  '1.2.840.10008.1.2': 'implicit VR little endian', '1.2.840.10008.1.2.1': 'explicit VR little endian', '1.2.840.10008.1.2.1.98': 'encapsulated uncompressed',
  '1.2.840.10008.1.2.1.99': 'deflated explicit VR little endian', '1.2.840.10008.1.2.2': 'explicit VR big endian', '1.2.840.10008.1.2.5': 'RLE lossless',
  '1.2.840.10008.1.2.4.50': 'JPEG baseline', '1.2.840.10008.1.2.4.51': 'JPEG extended (12-bit)', '1.2.840.10008.1.2.4.57': 'JPEG lossless', '1.2.840.10008.1.2.4.70': 'JPEG lossless (SV1)',
  '1.2.840.10008.1.2.4.80': 'JPEG-LS lossless', '1.2.840.10008.1.2.4.81': 'JPEG-LS near-lossless', '1.2.840.10008.1.2.4.90': 'JPEG 2000 lossless', '1.2.840.10008.1.2.4.91': 'JPEG 2000',
  '1.2.840.10008.1.2.4.92': 'JPEG 2000 multi-component lossless', '1.2.840.10008.1.2.4.93': 'JPEG 2000 multi-component', '1.2.840.10008.1.2.4.201': 'HTJ2K lossless', '1.2.840.10008.1.2.4.202': 'HTJ2K lossless RPCL', '1.2.840.10008.1.2.4.203': 'HTJ2K',
  '1.2.840.10008.1.2.4.100': 'MPEG-2 video', '1.2.840.10008.1.2.4.101': 'MPEG-2 video', '1.2.840.10008.1.2.4.102': 'MPEG-4 video', '1.2.840.10008.1.2.4.103': 'MPEG-4 video', '1.2.840.10008.1.2.4.104': 'MPEG-4 video', '1.2.840.10008.1.2.4.105': 'MPEG-4 video', '1.2.840.10008.1.2.4.106': 'MPEG-4 video', '1.2.840.10008.1.2.4.107': 'HEVC video', '1.2.840.10008.1.2.4.108': 'HEVC video',
};
const SOP: Record<string, string> = {
  '1.2.840.10008.5.1.4.1.1.1': 'Computed Radiography', '1.2.840.10008.5.1.4.1.1.1.1': 'Digital X-Ray', '1.2.840.10008.5.1.4.1.1.1.2': 'Digital Mammography', '1.2.840.10008.5.1.4.1.1.2': 'CT image', '1.2.840.10008.5.1.4.1.1.2.1': 'Enhanced CT image',
  '1.2.840.10008.5.1.4.1.1.3.1': 'Ultrasound multi-frame', '1.2.840.10008.5.1.4.1.1.4': 'MR image', '1.2.840.10008.5.1.4.1.1.4.1': 'Enhanced MR image', '1.2.840.10008.5.1.4.1.1.6.1': 'Ultrasound image', '1.2.840.10008.5.1.4.1.1.7': 'Secondary capture',
  '1.2.840.10008.5.1.4.1.1.12.1': 'X-Ray angiography', '1.2.840.10008.5.1.4.1.1.12.2': 'X-Ray fluoroscopy', '1.2.840.10008.5.1.4.1.1.20': 'Nuclear medicine', '1.2.840.10008.5.1.4.1.1.66.4': 'Segmentation', '1.2.840.10008.5.1.4.1.1.77.1.4': 'VL photograph',
  '1.2.840.10008.5.1.4.1.1.77.1.5.1': 'Ophthalmic photography', '1.2.840.10008.5.1.4.1.1.128': 'PET image', '1.2.840.10008.5.1.4.1.1.481.2': 'RT dose', '1.2.840.10008.5.1.4.1.1.481.1': 'RT image',
};
const CHARSETS: Record<string, string> = {
  'ISO_IR 100': 'iso-8859-1', 'ISO_IR 101': 'iso-8859-2', 'ISO_IR 109': 'iso-8859-3', 'ISO_IR 110': 'iso-8859-4', 'ISO_IR 144': 'iso-8859-5', 'ISO_IR 127': 'iso-8859-6', 'ISO_IR 126': 'iso-8859-7', 'ISO_IR 138': 'iso-8859-8', 'ISO_IR 148': 'iso-8859-9', 'ISO_IR 203': 'iso-8859-15',
  'ISO_IR 166': 'windows-874', 'ISO_IR 13': 'shift_jis', 'ISO_IR 192': 'utf-8', 'GB18030': 'gb18030', 'GBK': 'gbk', 'ISO 2022 IR 87': 'iso-2022-jp', 'ISO 2022 IR 149': 'euc-kr', 'ISO 2022 IR 58': 'gb2312',
};
const LONG_VR = new Set(['OB', 'OW', 'OF', 'OD', 'OL', 'OV', 'SQ', 'UT', 'UN', 'UC', 'UR', 'SV', 'UV']);
const T = (g: number, e: number) => ((g << 16) | e) >>> 0;
const PIXEL = T(0x7fe0, 0x0010), FLOAT_PIXEL = T(0x7fe0, 0x0008), DOUBLE_PIXEL = T(0x7fe0, 0x0009), ITEM = 0xfffee000, ITEM_END = 0xfffee00d, SEQ_END = 0xfffee0dd;

interface Element { vr: string; off: number; len: number; be: boolean; frags?: { off: number; len: number }[]; bot?: number[] }
type Elements = Map<number, Element>;

/** Parses one data set (or sequence item) into `into`, top-level elements only; returns the position after `end` or the delimiter. */
function parseDataset(u8: Uint8Array, start: number, end: number, explicit: boolean, be: boolean, into: Elements, depth: number): number {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const u16 = (o: number) => dv.getUint16(o, !be), u32 = (o: number) => dv.getUint32(o, !be);
  let p = start;
  while (p + 8 <= end) {
    const tag = T(u16(p), u16(p + 2));
    if (tag === ITEM_END || tag === SEQ_END) return p + 8;
    let vr = '', len: number, hdr: number;
    if (tag === ITEM) { vr = 'IT'; len = u32(p + 4); hdr = 8; }
    else if (explicit) {
      vr = String.fromCharCode(u8[p + 4], u8[p + 5]);
      if (LONG_VR.has(vr)) { len = u32(p + 8); hdr = 12; } else { len = u16(p + 6); hdr = 8; }
    } else { len = u32(p + 4); hdr = 8; }
    const off = p + hdr;
    if (len === 0xffffffff) {
      if (tag === PIXEL || tag === FLOAT_PIXEL || tag === DOUBLE_PIXEL) {
        // Encapsulated: a basic offset table item, then fragments, to the sequence delimiter.
        const frags: { off: number; len: number }[] = [], bot: number[] = [];
        let q = off, first = true;
        while (q + 8 <= u8.length) {
          const t = T(u16(q), u16(q + 2)), l = u32(q + 4);
          if (t === SEQ_END) { q += 8; break; }
          if (t !== ITEM) throw new Error(`Unexpected tag in encapsulated pixel data at ${q}`);
          if (first) { for (let i = 0; i + 4 <= l; i += 4) bot.push(u32(q + 8 + i)); first = false; }
          else frags.push({ off: q + 8, len: Math.min(l, u8.length - q - 8) });
          q += 8 + l;
        }
        into.set(tag, { vr: vr || 'OB', off, len: q - off, be, frags, bot });
        p = q; continue;
      }
      // A sequence (or UN) of undefined length: walk its items to the delimiter (UN items are implicit VR little endian).
      let q = off;
      const nested = new Map<number, Element>(), nestedExplicit = explicit && vr !== 'UN', nestedBe = vr === 'UN' ? false : be;
      while (q + 8 <= u8.length) {
        const t = T(nestedBe ? dv.getUint16(q, false) : dv.getUint16(q, true), nestedBe ? dv.getUint16(q + 2, false) : dv.getUint16(q + 2, true));
        const l = nestedBe ? dv.getUint32(q + 4, false) : dv.getUint32(q + 4, true);
        if (t === SEQ_END) { q += 8; break; }
        if (t !== ITEM) { q = u8.length; break; }
        if (l === 0xffffffff) { if (depth > 16) throw new Error('Sequences nested too deeply'); q = parseDataset(u8, q + 8, u8.length, nestedExplicit, nestedBe, nested, depth + 1); }
        else q += 8 + l;
      }
      if (!into.has(tag)) into.set(tag, { vr: vr || 'SQ', off, len: q - off, be });
      p = q; continue;
    }
    if (tag === ITEM) { p = off + len; continue; } // an item in a data set is out of place: skip it
    if (!into.has(tag) || tag === PIXEL) into.set(tag, { vr, off, len: Math.min(len, u8.length - off), be });
    p = off + len;
    if (p > u8.length) break;
  }
  return p;
}

interface Parsed { el: Elements; u8: Uint8Array; ts: string; explicit: boolean; be: boolean; charset: string[] }

function parseFile(input: Uint8Array): Parsed {
  let u8 = input, p = 0, ts = '';
  const meta: Elements = new Map();
  if (isDicom(u8)) {
    p = 132;
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    // The meta group is explicit VR little endian; its group length says where the data set starts.
    let q = p;
    while (q + 8 <= u8.length && dv.getUint16(q, true) === 0x0002) {
      const vr = String.fromCharCode(u8[q + 4], u8[q + 5]);
      const long = LONG_VR.has(vr), len = long ? dv.getUint32(q + 8, true) : dv.getUint16(q + 6, true), off = q + (long ? 12 : 8);
      meta.set(T(2, dv.getUint16(q + 2, true)), { vr, off, len, be: false });
      q = off + len;
    }
    p = q;
    const tsEl = meta.get(T(2, 0x10));
    if (tsEl) ts = latin1(u8, tsEl.off, tsEl.len).replace(/\0+$/, '').trim();
  }
  let explicit: boolean, be = false;
  if (ts === '1.2.840.10008.1.2.1.99') { u8 = inflate(u8.subarray(p)).data; p = 0; explicit = true; }
  else if (ts === '1.2.840.10008.1.2') explicit = false;
  else if (ts === '1.2.840.10008.1.2.2') { explicit = true; be = true; }
  else if (ts) explicit = true;
  else { // no transfer syntax: guess from the first element
    explicit = /^[A-Z]{2}$/.test(String.fromCharCode(u8[p + 4], u8[p + 5]));
    ts = explicit ? '1.2.840.10008.1.2.1' : '1.2.840.10008.1.2';
  }
  // Some writers label the data set wrongly: trust the bytes of its first element (two VR letters, or not).
  if (p + 6 <= u8.length) { const looksExplicit = /^[A-Z]{2}$/.test(String.fromCharCode(u8[p + 4], u8[p + 5])); if (looksExplicit !== explicit) { explicit = looksExplicit; if (explicit) be = false; } }
  const el: Elements = new Map();
  parseDataset(u8, p, u8.length, explicit, be, el, 0);
  if (!el.size) throw new Error('No DICOM data set was found');
  const cs = el.get(T(8, 5));
  const charset = cs ? latin1(u8, cs.off, cs.len).split('\\').map((s) => s.trim()) : [];
  return { el, u8, ts, explicit, be, charset };
}

const latin1 = (u8: Uint8Array, o: number, n: number) => { let s = ''; for (let i = o; i < o + n; i++) s += String.fromCharCode(u8[i]); return s; };
function decodeText(d: Parsed, e: Element): string {
  const bytes = d.u8.subarray(e.off, e.off + e.len);
  const label = d.charset.find((c) => c) || '';
  let s: string;
  try { s = new TextDecoder(CHARSETS[label] || 'iso-8859-1').decode(bytes); } catch { s = latin1(d.u8, e.off, e.len); }
  return s.replace(/[\0 ]+$/, '').replace(/^ +/, '');
}
const str = (d: Parsed, g: number, e: number): string | undefined => { const el = d.el.get(T(g, e)); return el ? decodeText(d, el) : undefined; };
const strs = (d: Parsed, g: number, e: number): string[] => (str(d, g, e) || '').split('\\').map((s) => s.trim()).filter((s) => s !== '');
const nums = (d: Parsed, g: number, e: number): number[] => strs(d, g, e).map(Number).filter((v) => Number.isFinite(v));
/** A US (or SS) value, by the transfer syntax's byte order. */
function u16v(d: Parsed, g: number, e: number): number | undefined {
  const el = d.el.get(T(g, e));
  if (!el || el.len < 2) return undefined;
  if (el.vr === 'IS' || el.vr === 'DS') return nums(d, g, e)[0];
  const dv = new DataView(d.u8.buffer, d.u8.byteOffset + el.off, el.len);
  if (el.len >= 4 && (el.vr === 'UL' || el.vr === 'SL')) return dv.getUint32(0, !el.be);
  return dv.getUint16(0, !el.be);
}
const u16s = (d: Parsed, g: number, e: number): number[] => { const el = d.el.get(T(g, e)); if (!el) return []; const dv = new DataView(d.u8.buffer, d.u8.byteOffset + el.off, el.len), out: number[] = []; for (let i = 0; i + 2 <= el.len; i += 2) out.push(dv.getUint16(i, !el.be)); return out; };
const personName = (s?: string) => s ? s.split('=')[0].split('^').filter(Boolean).join(' ').trim() : undefined;
const dicomDate = (s?: string) => s && /^\d{8}/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : s;

/** Samples of one frame, unpacked (not yet rescaled or windowed): `rows × cols × spp` values, pixel-interleaved. */
interface Frame { v: Float32Array; alreadyRgb?: boolean; depthNote?: string }
interface PixelInfo { rows: number; cols: number; spp: number; pi: string; planar: number; bitsAlloc: number; bitsStored: number; highBit: number; signed: boolean; frames: number }

function unpackNative(bytes: Uint8Array, pi: PixelInfo, be: boolean): Float32Array {
  const { rows, cols, spp, bitsAlloc, bitsStored, highBit, signed, planar } = pi, n = rows * cols, out = new Float32Array(n * spp);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const shift = Math.max(0, highBit + 1 - bitsStored), mask = bitsStored >= 32 ? 0xffffffff : (1 << bitsStored) - 1, signBit = 2 ** (bitsStored - 1), wrap = 2 ** bitsStored;
  const raw = (i: number): number => {
    switch (bitsAlloc) {
      case 1: return (bytes[i >> 3] >> (i & 7)) & 1;
      case 8: return i < bytes.length ? bytes[i] : 0;
      case 16: return i * 2 + 2 <= bytes.length ? dv.getUint16(i * 2, !be) : 0;
      case 32: return i * 4 + 4 <= bytes.length ? dv.getUint32(i * 4, !be) : 0;
      case 64: return i * 8 + 8 <= bytes.length ? Number(dv.getBigUint64(i * 8, !be) & 0xffffffffn) : 0;
      default: throw new Error(`${bitsAlloc} bits allocated per sample are not supported`);
    }
  };
  for (let s = 0; s < spp; s++) for (let i = 0; i < n; i++) {
    let v = raw(planar === 1 ? s * n + i : i * spp + s);
    if (bitsAlloc > 1) { v = bitsStored >= 32 ? v >>> 0 : (v >>> shift) & mask; if (signed && v >= signBit) v -= wrap; }
    out[i * spp + s] = v;
  }
  return out;
}

/** PS3.5 Annex G: segments of PackBits-coded bytes, the most significant byte of each sample first. */
function unpackRle(bytes: Uint8Array, pi: PixelInfo): Float32Array {
  const { rows, cols, spp, bitsAlloc, bitsStored, signed } = pi, n = rows * cols, perSample = bitsAlloc / 8;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const nseg = dv.getUint32(0, true);
  if (nseg !== spp * perSample) throw new Error(`RLE pixel data with ${nseg} segments for ${spp} samples of ${bitsAlloc} bits`);
  const out = new Float32Array(n * spp), seg = new Uint8Array(n);
  const signBit = 2 ** (bitsStored - 1), wrap = 2 ** bitsStored, mask = bitsStored >= 32 ? 0xffffffff : (1 << bitsStored) - 1;
  for (let s = 0; s < spp; s++) for (let b = 0; b < perSample; b++) {
    const k = s * perSample + b, start = dv.getUint32(4 + k * 4, true), end = k + 1 < nseg ? dv.getUint32(8 + k * 4, true) : bytes.length;
    let p = start, q = 0;
    seg.fill(0);
    while (p < end && q < n) {
      const h = bytes[p++];
      if (h < 128) { for (let i = 0; i <= h && q < n && p < end; i++) seg[q++] = bytes[p++]; }
      else if (h > 128) { const v = bytes[p++]; for (let i = 0; i < 257 - h && q < n; i++) seg[q++] = v; }
    }
    const scale = 2 ** (8 * (perSample - 1 - b));
    for (let i = 0; i < n; i++) out[i * spp + s] += seg[i] * scale;
  }
  if (bitsAlloc > 8 || signed) for (let i = 0; i < out.length; i++) { let v = out[i]; v = bitsStored >= 32 ? v : v % 2 ** bitsStored & mask; if (signed && v >= signBit) v -= wrap; out[i] = v; }
  return out;
}

const hasJfif = (u8: Uint8Array): boolean => { for (let p = 2; p + 4 < u8.length && u8[p] === 0xff && u8[p + 1] !== 0xda; p += 2 + ((u8[p + 2] << 8) | u8[p + 3])) { if (u8[p + 1] === 0xe0 && u8[p + 4] === 0x4a && u8[p + 5] === 0x46) return true; } return false; };

/** Frame bytes from the encapsulated fragments (PS3.5 A.4): the offset table, one fragment per frame, or JPEG starts. */
function frameFragments(pix: Element, u8: Uint8Array, frames: number): Uint8Array[] {
  const frags = pix.frags || [], out: Uint8Array[] = [];
  const join = (parts: { off: number; len: number }[]) => { if (parts.length === 1) return u8.subarray(parts[0].off, parts[0].off + parts[0].len); const n = parts.reduce((a, f) => a + f.len, 0), j = new Uint8Array(n); let q = 0; for (const f of parts) { j.set(u8.subarray(f.off, f.off + f.len), q); q += f.len; } return j; };
  if (!frags.length) return [];
  if (frames <= 1) return [join(frags)];
  if (pix.bot && pix.bot.length === frames) {
    const base = frags[0].off - 8;
    for (let f = 0; f < frames; f++) { const from = base + pix.bot[f], to = f + 1 < frames ? base + pix.bot[f + 1] : Infinity; out.push(join(frags.filter((g) => g.off - 8 >= from && g.off - 8 < to))); }
    return out;
  }
  if (frags.length === frames) return frags.map((f) => join([f]));
  // Group by the start of a JPEG or JPEG 2000 codestream.
  const starts = (f: { off: number }) => (u8[f.off] === 0xff && (u8[f.off + 1] === 0xd8 || u8[f.off + 1] === 0x4f)) || (u8[f.off] === 0 && u8[f.off + 1] === 0 && u8[f.off + 2] === 0 && u8[f.off + 3] === 0x0c);
  let cur: { off: number; len: number }[] = [];
  for (const f of frags) { if (starts(f) && cur.length) { out.push(join(cur)); cur = []; } cur.push(f); }
  if (cur.length) out.push(join(cur));
  if (out.length === frames) return out;
  throw new Error(`${frags.length} fragments for ${frames} frames without an offset table`);
}

/** `dec` is pdf.js's image-decoders module (JpegImage, JpxImage); needed only for JPEG and JPEG 2000 pixel data. */
export async function decodeDicom(input: Uint8Array, dec: any = null, o: { maxFrames?: number; maxPixels?: number } = {}): Promise<DecodeResult> {
  const d = parseFile(input), warnings: string[] = [], info: Record<string, string> = {};
  const { u8, ts, be } = d;
  const rows = u16v(d, 0x28, 0x10) || 0, cols = u16v(d, 0x28, 0x11) || 0;
  const pix = d.el.get(PIXEL) || d.el.get(FLOAT_PIXEL) || d.el.get(DOUBLE_PIXEL);
  const sop = str(d, 8, 0x16) || '', modality = str(d, 8, 0x60);
  const describe = () => {
    const put = (k: string, v?: string) => { if (v) info[k] = v; };
    put('kind', SOP[sop] || (sop ? `SOP class ${sop}` : undefined));
    put('modality', modality);
    put('patient', personName(str(d, 0x10, 0x10)));
    put('patient ID', str(d, 0x10, 0x20));
    put('born', dicomDate(str(d, 0x10, 0x30)));
    put('sex', str(d, 0x10, 0x40));
    put('study date', dicomDate(str(d, 8, 0x20)));
    put('study', str(d, 8, 0x1030));
    put('series', str(d, 8, 0x103e));
    put('body part', str(d, 0x18, 0x15));
    put('institution', str(d, 8, 0x80));
    put('equipment', [str(d, 8, 0x70), str(d, 8, 0x1090)].filter(Boolean).join(' '));
    put('instance', str(d, 0x20, 0x13));
    put('comments', str(d, 0x20, 0x4000));
    put('transfer syntax', `${TS[ts] || ts}${ts && TS[ts] ? ` (${ts})` : ''}`);
    put('character set', d.charset.filter(Boolean).join(', '));
    if (str(d, 0x28, 0x2110) === '01') put('lossy compression', [str(d, 0x28, 0x2114), nums(d, 0x28, 0x2112)[0] ? `ratio ${nums(d, 0x28, 0x2112)[0]}` : ''].filter(Boolean).join(', ') || 'yes');
  };
  describe();
  if (!pix || !rows || !cols) throw new Error(`This DICOM file has no picture${info.kind ? ` (${info.kind}${modality ? `, ${modality}` : ''})` : ''}`);
  const pi: PixelInfo = {
    rows, cols, spp: u16v(d, 0x28, 2) || 1, pi: (str(d, 0x28, 4) || 'MONOCHROME2').toUpperCase(), planar: u16v(d, 0x28, 6) || 0,
    bitsAlloc: u16v(d, 0x28, 0x100) || 8, bitsStored: u16v(d, 0x28, 0x101) || 0, highBit: u16v(d, 0x28, 0x102) || 0, signed: u16v(d, 0x28, 0x103) === 1, frames: Math.max(1, nums(d, 0x28, 8)[0] || 1),
  };
  if (!pi.bitsStored) pi.bitsStored = pi.bitsAlloc;
  if (pi.highBit < pi.bitsStored - 1) pi.highBit = pi.bitsStored - 1;
  const floatPixels = !d.el.get(PIXEL) && !!pix;
  if (floatPixels) { pi.bitsAlloc = d.el.get(DOUBLE_PIXEL) ? 64 : 32; pi.signed = false; }
  const maxFrames = o.maxFrames ?? 400, maxPixels = o.maxPixels ?? 150e6;
  let frames = pi.frames;
  if (frames > maxFrames) { warnings.push(`Only the first ${maxFrames} of ${frames} frames are shown`); frames = maxFrames; }
  if (rows * cols * frames > maxPixels) { const f = Math.max(1, Math.floor(maxPixels / (rows * cols))); warnings.push(`Only the first ${f} of ${frames} frames are shown (too many pixels)`); frames = f; }
  const encapsulated = !!pix.frags;
  const jpegTs = ts.startsWith('1.2.840.10008.1.2.4.');
  const needDec = jpegTs && /\.(50|51|9[0-3]|20[1-3])$/.test(ts);
  const noDecoder = () => new Error(`${TS[ts]} pixel data needs the JPEG decoders, which did not load`);
  if (/\.(8[01])$/.test(ts)) throw new Error(`${TS[ts]} (JPEG-LS) pixel data is not supported yet`);
  if (/\.10[0-8]$/.test(ts)) throw new Error(`${TS[ts]} pixel data is a video stream, not a picture`);
  if (jpegTs && !needDec && !/\.(57|70)$/.test(ts)) throw new Error(`Transfer syntax ${ts} is not supported`);
  const frameBytes = encapsulated ? frameFragments(pix, u8, pi.frames) : null;
  const is422 = pi.pi === 'YBR_FULL_422' && pi.spp === 3 && !encapsulated;
  const frameSize = is422 ? rows * cols * 2 * (pi.bitsAlloc / 8) : Math.ceil((rows * cols * pi.spp * pi.bitsAlloc) / 8);
  const rescaleSlope = nums(d, 0x28, 0x1053)[0], rescaleIntercept = nums(d, 0x28, 0x1052)[0];
  const wc = nums(d, 0x28, 0x1050)[0], ww = nums(d, 0x28, 0x1051)[0], voiFn = (str(d, 0x28, 0x1056) || 'LINEAR').toUpperCase();
  const haveWindow = Number.isFinite(wc) && Number.isFinite(ww) && ww >= 1;
  const haveRescale = Number.isFinite(rescaleSlope) && Number.isFinite(rescaleIntercept) && !(rescaleSlope === 1 && rescaleIntercept === 0);
  const spacing = nums(d, 0x28, 0x30).length === 2 ? nums(d, 0x28, 0x30) : nums(d, 0x18, 0x1164).length === 2 ? nums(d, 0x18, 0x1164) : null;
  if (spacing) info['pixel spacing'] = `${spacing[0]} × ${spacing[1]} mm`;
  const thick = nums(d, 0x18, 0x50)[0];
  if (Number.isFinite(thick)) info['slice thickness'] = `${thick} mm`;
  if (haveRescale) info.rescale = `× ${rescaleSlope} + ${rescaleIntercept}${modality === 'CT' ? ' (Hounsfield units)' : ''}`;
  if (haveWindow) info.window = `center ${wc}, width ${ww}${voiFn !== 'LINEAR' ? ` (${voiFn})` : ''}${nums(d, 0x28, 0x1050).length > 1 ? ` (first of ${nums(d, 0x28, 0x1050).length})` : ''}`;
  info.pixels = `${pi.spp === 1 ? 'monochrome' : `${pi.spp} samples`}, ${pi.bitsStored} of ${pi.bitsAlloc} bits${pi.signed ? ', signed' : ''}, ${pi.pi}${pi.frames > 1 ? `, ${pi.frames} frames` : ''}`;
  for (const g of [0x6000, 0x6002, 0x6004]) if (d.el.has(T(g, 0x3000))) { warnings.push('Overlay planes are not shown'); break; }
  if (d.el.has(T(0x28, 0x3010))) warnings.push('The VOI lookup table is not applied (the window is used instead)');

  // The palette (PS3.3 C.7.6.3.1.5/6): descriptors [entries, first index, bits], data as 16-bit words (or bytes).
  let palette: Uint8Array[] | null = null, paletteFirst = 0, paletteN = 0;
  if (pi.pi === 'PALETTE COLOR') {
    const desc = u16s(d, 0x28, 0x1101);
    if (d.el.has(T(0x28, 0x1221))) warnings.push('A segmented palette is not applied: the picture is shown gray');
    else if (desc.length >= 3) {
      paletteN = desc[0] || 65536; paletteFirst = desc[1] > 32767 ? desc[1] - 65536 : desc[1];
      palette = [0x1201, 0x1202, 0x1203].map((e) => {
        const el = d.el.get(T(0x28, e)), out = new Uint8Array(paletteN);
        if (!el) return out;
        const wide = desc[2] === 16 && el.len >= paletteN * 2;
        const dv = new DataView(u8.buffer, u8.byteOffset + el.off, el.len);
        for (let i = 0; i < paletteN; i++) out[i] = wide ? (i * 2 + 2 <= el.len ? Math.round((dv.getUint16(i * 2, !el.be) * 255) / 65535) : 0) : i < el.len ? u8[el.off + i] : 0;
        return out;
      });
    } else warnings.push('The palette is missing: the picture is shown gray');
  }

  const pages: DecodedPage[] = [];
  let depthNote = '';
  for (let f = 0; f < frames; f++) {
    let fr: Frame;
    if (!encapsulated) {
      const start = pix.off + f * frameSize;
      if (start >= pix.off + pix.len) { warnings.push(`The pixel data ends after frame ${f} of ${frames}`); break; }
      if (floatPixels) {
        const n = rows * cols * pi.spp, v = new Float32Array(n), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), w = pi.bitsAlloc / 8;
        for (let i = 0; i < n; i++) { const at = start + i * w; v[i] = at + w <= u8.length ? (w === 4 ? dv.getFloat32(at, !be) : dv.getFloat64(at, !be)) : 0; }
        fr = { v };
      } else if (is422) fr = { v: deinterleave422(unpackNative(u8.subarray(start, Math.min(u8.length, start + frameSize)), { ...pi, spp: 1, cols: cols * 2 }, be), rows, cols) };
      else fr = { v: unpackNative(u8.subarray(start, Math.min(u8.length, start + frameSize)), pi, be) };
    } else {
      const bytes = frameBytes![f];
      if (!bytes) { warnings.push(`Frame ${f + 1} is missing from the pixel data`); break; }
      if (ts === '1.2.840.10008.1.2.5') fr = { v: unpackRle(bytes, pi) };
      else if (ts === '1.2.840.10008.1.2.1.98') fr = { v: unpackNative(bytes, pi, false) };
      else if (/\.(57|70)$/.test(ts)) {
        const lj = decodeLjpeg(bytes);
        if (lj.width !== cols || lj.height !== rows) warnings.push(`Frame ${f + 1} is ${lj.width} × ${lj.height}, not ${cols} × ${rows}`);
        fr = { v: samplesFrom(lj.data, lj.width, lj.height, lj.comps, pi, pi.signed) };
      } else if (/\.(50|51)$/.test(ts)) {
        let precision = 8;
        for (let p = 2; p + 9 < bytes.length && bytes[p] === 0xff; p += 2 + ((bytes[p + 2] << 8) | bytes[p + 3])) if ((bytes[p + 1] >= 0xc0 && bytes[p + 1] <= 0xc3) || (bytes[p + 1] >= 0xc5 && bytes[p + 1] <= 0xc7) || (bytes[p + 1] >= 0xc9 && bytes[p + 1] <= 0xcb)) { precision = bytes[p + 4]; break; }
        if (precision > 8 || pi.spp === 1 && pi.bitsStored > 8) {
          const s = decodeDctSamples(bytes);
          if (s.width !== cols || s.height !== rows) warnings.push(`Frame ${f + 1} is ${s.width} × ${s.height}, not ${cols} × ${rows}`);
          fr = { v: samplesFrom(s.data, s.width, s.height, s.comps, pi, pi.signed) };
        } else {
          if (!dec) throw noDecoder();
          const img = new dec.JpegImage(pi.pi === 'RGB' && !hasJfif(bytes) ? { colorTransform: 0 } : {});
          img.parse(bytes);
          const out: Uint8ClampedArray = img.getData({ width: img.width, height: img.height, forceRGB: false });
          const n = out.length / (img.width * img.height);
          if (img.width !== cols || img.height !== rows) warnings.push(`Frame ${f + 1} is ${img.width} × ${img.height}, not ${cols} × ${rows}`);
          fr = { v: samplesFrom(out, img.width, img.height, n, pi, false), alreadyRgb: n === 3 };
        }
      } else if (openJpegReady()) { // JPEG 2000 / HTJ2K through OpenJPEG at full precision
        const j = decodeJ2k16(bytes);
        if (j.width !== cols || j.height !== rows) warnings.push(`Frame ${f + 1} is ${j.width} × ${j.height}, not ${cols} × ${rows}`);
        fr = { v: samplesFrom(j.samples, j.width, j.height, j.components, pi, false), alreadyRgb: j.components === 3 && pi.pi.startsWith('YBR') };
      } else { // JPEG 2000 / HTJ2K through pdf.js's OpenJPEG: 8-bit samples, negative values lost
        if (!dec) throw noDecoder();
        const jinfo = jpxInfo(bytes), depth = jinfo.depths[0] || 8, signed = jinfo.signed[0];
        const data: Uint8ClampedArray = await dec.JpxImage.instance.decode(bytes, {});
        const n = data.length / (jinfo.width * jinfo.height);
        if (jinfo.width !== cols || jinfo.height !== rows) warnings.push(`Frame ${f + 1} is ${jinfo.width} × ${jinfo.height}, not ${cols} × ${rows}`);
        const v = samplesFrom(data, jinfo.width, jinfo.height, n, pi, false);
        if (depth > 8) { const k = 2 ** (depth - 8); for (let i = 0; i < v.length; i++) v[i] *= k; depthNote = `the full-precision JPEG 2000 decoder was not available: these ${depth}-bit samples were reduced to 8 bits, so the window is applied in steps of ${k}${signed ? ' and negative values are lost' : ''}`; }
        fr = { v, alreadyRgb: n === 3 && (jinfo.colorspace === 'sYCC' || pi.pi.startsWith('YBR')) };
      }
    }
    const r = makeRaster(cols, rows), out = r.data, n = rows * cols, v = fr.v, spp = v.length / n;
    const notes: string[] = [];
    if (pi.pi === 'PALETTE COLOR' && palette) {
      for (let i = 0; i < n; i++) { const k = Math.min(paletteN - 1, Math.max(0, Math.round(v[i]) - paletteFirst)); out[i * 4] = palette[0][k]; out[i * 4 + 1] = palette[1][k]; out[i * 4 + 2] = palette[2][k]; out[i * 4 + 3] = 255; }
      notes.push(`palette color, ${paletteN} entries`);
    } else if (spp >= 3) {
      const max = pi.bitsStored > 8 && !fr.alreadyRgb ? 2 ** pi.bitsStored - 1 : 255;
      const ybr = !fr.alreadyRgb && (pi.pi === 'YBR_FULL' || pi.pi === 'YBR_FULL_422');
      for (let i = 0; i < n; i++) {
        let R = v[i * spp] * 255 / max, G = v[i * spp + 1] * 255 / max, B = v[i * spp + 2] * 255 / max;
        if (ybr) { const Y = R, cb = G - 128, cr = B - 128; R = Y + 1.402 * cr; G = Y - 0.344136 * cb - 0.714136 * cr; B = Y + 1.772 * cb; }
        out[i * 4] = Math.round(R); out[i * 4 + 1] = Math.round(G); out[i * 4 + 2] = Math.round(B); out[i * 4 + 3] = 255;
      }
      notes.push(`${pi.pi}${pi.bitsStored > 8 ? `, ${pi.bitsStored} bits per sample` : ''}`);
    } else {
      let lo = Infinity, hi = -Infinity;
      const slope = haveRescale ? rescaleSlope : 1, icpt = haveRescale ? rescaleIntercept : 0;
      if (!haveWindow) for (let i = 0; i < n; i++) { const x = v[i * spp] * slope + icpt; if (x < lo) lo = x; if (x > hi) hi = x; }
      const inv = pi.pi === 'MONOCHROME1';
      for (let i = 0; i < n; i++) {
        const x = v[i * spp] * slope + icpt;
        let y: number;
        if (haveWindow) {
          if (voiFn === 'SIGMOID') y = 255 / (1 + Math.exp((-4 * (x - wc)) / ww));
          else if (voiFn === 'LINEAR_EXACT') y = x <= wc - ww / 2 ? 0 : x > wc + ww / 2 ? 255 : ((x - (wc - ww / 2)) / ww) * 255;
          else y = x <= wc - 0.5 - (ww - 1) / 2 ? 0 : x > wc - 0.5 + (ww - 1) / 2 ? 255 : ((x - (wc - 0.5)) / (ww - 1) + 0.5) * 255;
        } else y = hi > lo ? ((x - lo) / (hi - lo)) * 255 : 0;
        y = Math.round(Math.max(0, Math.min(255, y)));
        if (inv) y = 255 - y;
        out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = y; out[i * 4 + 3] = 255;
      }
      notes.push(haveWindow ? `window center ${wc}, width ${ww}${voiFn !== 'LINEAR' ? ` (${voiFn})` : ''}${haveRescale ? ', after the rescale' : ''}` : `shown over the frame's range ${fmt(lo)} to ${fmt(hi)}${haveRescale ? ' (rescaled values)' : ''} (no window in the file)`);
      if (inv) notes.push('MONOCHROME1: low values are bright');
    }
    if (pi.frames > 1) notes.unshift(`frame ${f + 1} of ${pi.frames}`);
    notes.push(`${pi.bitsStored}-bit ${pi.spp === 1 ? 'monochrome' : `${pi.spp}-sample`} ${TS[ts] || 'DICOM'} pixel data`);
    if (depthNote) notes.push(depthNote);
    notes.push(NOT_FOR_DIAGNOSIS);
    pages.push({ width: cols, height: rows, frames: [{ raster: r, delay: 0 }], loops: 0, bitDepth: pi.bitsStored, hasAlpha: false, notes, dpi: spacing && spacing[0] > 0 && spacing[1] > 0 ? [25.4 / spacing[1], 25.4 / spacing[0]] : undefined });
  }
  if (!pages.length) throw new Error('No frame could be read');
  info.notice = NOT_FOR_DIAGNOSIS;
  return { pages, info, warnings };
}

/** Decoder output (interleaved samples) into the frame's layout, applying BitsStored masking and the sign when asked. */
function samplesFrom(src: ArrayLike<number>, w: number, h: number, comps: number, pi: PixelInfo, signed: boolean): Float32Array {
  const n = pi.rows * pi.cols, spp = Math.min(comps, 4), out = new Float32Array(n * spp);
  const signBit = 2 ** (pi.bitsStored - 1), wrap = 2 ** pi.bitsStored;
  for (let y = 0; y < pi.rows; y++) for (let x = 0; x < pi.cols; x++) {
    const i = y * pi.cols + x, j = (Math.min(y, h - 1) * w + Math.min(x, w - 1)) * comps;
    for (let c = 0; c < spp; c++) { let v = src[j + c]; if (signed && v >= signBit) v -= wrap; out[i * spp + c] = v; }
  }
  return out;
}
/** YBR_FULL_422 as stored (Y0 Y1 Cb Cr for each pair of pixels along a row) to Y Cb Cr per pixel. */
function deinterleave422(src: Float32Array, rows: number, cols: number): Float32Array {
  const n = rows * cols, v = new Float32Array(n * 3);
  for (let i = 0, p = 0; i + 1 < n; i += 2, p += 4) {
    const y0 = src[p], y1 = src[p + 1], cb = src[p + 2], cr = src[p + 3];
    v[i * 3] = y0; v[i * 3 + 1] = cb; v[i * 3 + 2] = cr; v[i * 3 + 3] = y1; v[i * 3 + 4] = cb; v[i * 3 + 5] = cr;
  }
  return v;
}
const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2));
