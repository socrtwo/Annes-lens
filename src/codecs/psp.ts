/**
 * Paint Shop Pro pictures (.psp, .pspimage, .tub; Jasc's file format versions 3 to 6+, Paint Shop Pro 5 to 9 and
 * later), read by the app's own code from the format's description: the raster layers merged as Paint Shop Pro
 * shows them, each at its place, with its transparency mask, opacity, visibility and blend mode (Normal,
 * Multiply, Screen, Darken, Lighten, Difference, Overlay, Hard Light, Soft Light, Dodge, Burn, Exclusion; the
 * hue and saturation modes as Normal, with a note). Channels uncompressed, RLE or LZ77 (zlib); 24-bit, 8-bit
 * gray and 8-, 4- and 1-bit palette pictures. Vector and adjustment layers are not drawn (noted).
 */
import { makeRaster, type DecodeResult } from './raster';
import { inflate } from './inflate';

const le16 = (u: Uint8Array, o: number) => u[o] | (u[o + 1] << 8);
const le32 = (u: Uint8Array, o: number) => (u[o] | (u[o + 1] << 8) | (u[o + 2] << 16) | (u[o + 3] << 24)) >>> 0;
const i32 = (u: Uint8Array, o: number) => le32(u, o) | 0;
const SIG = 'Paint Shop Pro Image File\n\x1a';
export const isPsp = (u8: Uint8Array): boolean => u8.length > 40 && String.fromCharCode(...u8.subarray(0, SIG.length)) === SIG;

interface Block { id: number; start: number; end: number; init: number }
function blocks(u8: Uint8Array, start: number, end: number, major: number): Block[] {
  const out: Block[] = [];
  let p = start;
  while (p + 10 <= end && u8[p] === 0x7e && u8[p + 1] === 0x42 && u8[p + 2] === 0x4b && u8[p + 3] === 0) {
    const id = le16(u8, p + 4);
    const head = major >= 4 ? 10 : 14, len = le32(u8, p + (major >= 4 ? 6 : 10));
    out.push({ id, start: p + head, end: Math.min(end, p + head + len), init: major >= 4 ? 0 : le32(u8, p + 6) });
    p += head + len;
  }
  return out;
}

/** PSP RLE: a count above 128 repeats the next byte (count − 128) times; otherwise that many literal bytes. */
function unRle(src: Uint8Array, n: number): Uint8Array {
  const out = new Uint8Array(n); let p = 0, o = 0;
  while (o < n && p < src.length) {
    const c = src[p++];
    if (c > 128) { out.fill(src[p++] ?? 0, o, Math.min(n, o + c - 128)); o += c - 128; }
    else { out.set(src.subarray(p, p + Math.min(c, n - o)), o); o += c; p += c; }
  }
  return out;
}

const BLEND = ['Normal', 'Darken', 'Lighten', 'Hue', 'Saturation', 'Color', 'Luminosity', 'Multiply', 'Screen', 'Dissolve', 'Overlay', 'Hard Light', 'Soft Light', 'Difference', 'Dodge', 'Burn', 'Exclusion'];
function blend(mode: number, b: number, s: number): number {
  switch (mode) {
    case 1: return Math.min(b, s);
    case 2: return Math.max(b, s);
    case 7: return (b * s) / 255;
    case 8: return 255 - ((255 - b) * (255 - s)) / 255;
    case 10: return b < 128 ? (2 * b * s) / 255 : 255 - (2 * (255 - b) * (255 - s)) / 255;
    case 11: return s < 128 ? (2 * b * s) / 255 : 255 - (2 * (255 - b) * (255 - s)) / 255;
    case 12: { const B = b / 255, S = s / 255; return 255 * (S <= 0.5 ? B - (1 - 2 * S) * B * (1 - B) : B + (2 * S - 1) * ((B <= 0.25 ? ((16 * B - 12) * B + 4) * B : Math.sqrt(B)) - B)); }
    case 13: return Math.abs(b - s);
    case 14: return s >= 255 ? 255 : Math.min(255, (b * 255) / (255 - s));
    case 15: return s <= 0 ? 0 : 255 - Math.min(255, ((255 - b) * 255) / s);
    case 16: return b + s - (2 * b * s) / 255;
    default: return s;
  }
}

export function decodePsp(u8: Uint8Array): DecodeResult {
  const major = le16(u8, 32), minor = le16(u8, 34), warnings: string[] = [];
  if (major < 3) throw new Error(`Paint Shop Pro files of format version ${major}.${minor} (Paint Shop Pro 4 and earlier) are not supported`);
  const v3 = major === 3; // Paint Shop Pro 5: no chunk sizes (the block header gives the info length), fixed 256-byte names
  const top = blocks(u8, 36, u8.length, major);
  const attrBlock = top.find((b) => b.id === 0);
  if (!attrBlock) throw new Error('This Paint Shop Pro file has no image attributes');
  const a = attrBlock.start + (v3 ? 0 : 4); // after the chunk size
  const W = i32(u8, a), H = i32(u8, a + 4), dpiValue = new DataView(u8.buffer, u8.byteOffset + a + 8, 8).getFloat64(0, true), metric = u8[a + 16];
  const comp = le16(u8, a + 17), depth = le16(u8, a + 19), gray = u8[a + 27] === 1;
  if (!(W > 0 && H > 0) || W * H > 200e6) throw new Error(`This Paint Shop Pro picture has an impossible size (${W} × ${H})`);
  if (comp > 2) throw new Error(`Paint Shop Pro compression ${comp} is not supported`);
  let palette: number[][] | null = null;
  const pb = top.find((b) => b.id === 2);
  if (pb) { const n = le32(u8, pb.start + (v3 ? 0 : 4)), q = v3 ? pb.start + 4 : pb.start + le32(u8, pb.start); palette = []; for (let i = 0; i < n && q + i * 4 + 3 <= pb.end; i++) palette.push([u8[q + i * 4 + 2], u8[q + i * 4 + 1], u8[q + i * 4]]); }
  // The merged picture, transparent where no layer covers it.
  const R = new Float32Array(W * H), G = new Float32Array(W * H), B = new Float32Array(W * H), A = new Float32Array(W * H);
  const bank = top.find((b) => b.id === 3);
  if (!bank) throw new Error('This Paint Shop Pro file has no layers');
  let layers = 0, skipped = 0, approx = new Set<string>();
  for (const lb of blocks(u8, bank.start, bank.end, major).filter((b) => b.id === 4)) {
    const infoSize = v3 ? lb.init : le32(u8, lb.start); let q = lb.start + (v3 ? 0 : 4);
    let name: string;
    if (v3) { name = new TextDecoder('latin1').decode(u8.subarray(q, q + 256)).replace(/\0.*$/s, ''); q += 256; }
    else { const nameLen = le16(u8, q); name = new TextDecoder('latin1').decode(u8.subarray(q + 2, q + 2 + nameLen)); q += 2 + nameLen; }
    const type = u8[q]; q += 1;
    const ir = [i32(u8, q), i32(u8, q + 4), i32(u8, q + 8), i32(u8, q + 12)], sr = [i32(u8, q + 16), i32(u8, q + 20), i32(u8, q + 24), i32(u8, q + 28)]; q += 32;
    const opacity = u8[q], mode = u8[q + 1], visible = u8[q + 2];
    let p = lb.start + infoSize, channelCount: number;
    if (major >= 5) { channelCount = le16(u8, p + 6); p += le32(u8, p); }
    else channelCount = le16(u8, lb.start + infoSize - 2);
    const raster = major >= 5 ? type === 1 || type === 2 : true; // versions 3 and 4: 0 normal, 1 floating selection
    if (!raster) { skipped++; warnings.push(`Layer "${name}" (${type === 3 ? 'vector' : type === 4 ? 'adjustment' : `type ${type}`}) is not drawn`); continue; }
    if (!visible) continue;
    const lw = sr[2] - sr[0], lh = sr[3] - sr[1], ox = ir[0] + sr[0], oy = ir[1] + sr[1];
    if (!(lw > 0 && lh > 0) || lw * lh > 200e6) continue;
    // Channels: image (composite index or gray, red, green, blue) and the transparency mask.
    const planes: Record<string, Uint8Array> = {};
    for (const cb of blocks(u8, p, lb.end, major).filter((b) => b.id === 5).slice(0, channelCount)) {
      const c0 = cb.start + (v3 ? -4 : 0); // version 3 has no chunk size before the lengths
      const cs = v3 ? cb.init : le32(u8, cb.start), clen = le32(u8, c0 + 4), ulen = le32(u8, c0 + 8), btype = le16(u8, c0 + 12), ctype = le16(u8, c0 + 14);
      const src = u8.subarray(cb.start + cs, Math.min(cb.end, cb.start + cs + clen));
      let raw: Uint8Array;
      try { raw = comp === 0 ? src : comp === 1 ? unRle(src, ulen) : inflate(src, ulen).data; }
      catch (e: any) { warnings.push(`Layer "${name}": a channel could not be decompressed (${e?.message || e})`); continue; }
      const key = btype === 1 ? 'alpha' : btype === 0 ? ['index', 'r', 'g', 'b'][ctype] ?? 'x' : btype === 2 ? 'mask' : 'x';
      if (key === 'mask' && !planes.mask) warnings.push(`Layer "${name}": its layer mask is not applied`);
      planes[key] = raw;
    }
    // Rows: 8-bit samples unpadded; 1- and 4-bit samples packed, rows padded to four bytes.
    const bits = depth === 24 || depth === 8 ? 8 : depth;
    const stride = bits === 8 ? lw : (((lw * bits + 7) >> 3) + 3) & ~3;
    const sample = (pl: Uint8Array | undefined, x: number, y: number) => {
      if (!pl) return 0;
      if (bits === 8) return pl[y * lw + x] ?? 0;
      const per = 8 / bits, byte = pl[y * stride + Math.floor(x / per)] ?? 0;
      return (byte >> (8 - bits * ((x % per) + 1))) & ((1 << bits) - 1);
    };
    if (!BLEND[mode] || [3, 4, 5, 6, 9].includes(mode)) approx.add(BLEND[mode] || `mode ${mode}`);
    const op = opacity / 255;
    for (let y = 0; y < lh; y++) {
      const ty = oy + y; if (ty < 0 || ty >= H) continue;
      for (let x = 0; x < lw; x++) {
        const tx = ox + x; if (tx < 0 || tx >= W) continue;
        let r: number, g: number, b: number;
        if (depth === 24) { r = sample(planes.r, x, y); g = sample(planes.g, x, y); b = sample(planes.b, x, y); }
        else { const v = sample(planes.index, x, y); const c = palette && !gray ? palette[v] || [v, v, v] : gray && palette ? palette[v] || [v, v, v] : [v, v, v]; [r, g, b] = c; }
        const as = (planes.alpha ? sample(planes.alpha, x, y) / 255 : 1) * op;
        if (as <= 0) continue;
        const i = ty * W + tx, ab = A[i];
        const mix = (cb: number, cs: number) => (1 - ab) * cs + ab * blend(mode, cb, cs);
        const ao = as + ab * (1 - as);
        R[i] = (as * mix(R[i], r) + (1 - as) * ab * R[i]) / ao;
        G[i] = (as * mix(G[i], g) + (1 - as) * ab * G[i]) / ao;
        B[i] = (as * mix(B[i], b) + (1 - as) * ab * B[i]) / ao;
        A[i] = ao;
      }
    }
    layers++;
  }
  if (approx.size) warnings.push(`Blend mode${approx.size === 1 ? '' : 's'} ${[...approx].join(', ')} shown as Normal`);
  if (!layers && skipped) throw new Error('This Paint Shop Pro file has no raster layer to show (vector or adjustment layers only)');
  const r = makeRaster(W, H), d = r.data;
  let alpha = false;
  for (let i = 0; i < W * H; i++) { d[i * 4] = Math.round(R[i]); d[i * 4 + 1] = Math.round(G[i]); d[i * 4 + 2] = Math.round(B[i]); d[i * 4 + 3] = Math.round(A[i] * 255); if (A[i] < 1) alpha = true; }
  const dpi = metric === 1 ? dpiValue : metric === 2 ? dpiValue * 2.54 : 0;
  const ver = major >= 10 ? 'X or later' : String(major + 2);
  const notes = [`Paint Shop Pro ${ver} picture (format ${major}.${minor}), ${layers} layer${layers === 1 ? '' : 's'} merged, ${depth === 24 ? '24-bit' : gray ? '8-bit gray' : `${depth}-bit palette`}${['', ', RLE', ', LZ77'][comp]}`];
  return { pages: [{ width: W, height: H, frames: [{ raster: r, delay: 0 }], loops: 0, bitDepth: depth, hasAlpha: alpha, dpi: dpi ? [Math.round(dpi), Math.round(dpi)] : undefined, notes }], info: {}, warnings };
}
