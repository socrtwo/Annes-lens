/**
 * Finding duplicates and look-alikes, and scoring quality. Perceptual hashes (difference hash and
 * DCT hash) on small grayscale copies; Hamming distance as the similarity measure; quality from the
 * variance of the Laplacian (sharpness), a high-pass residual (noise), clipping and mean (exposure)
 * and bytes per pixel (compression). The pure functions take gray arrays so they can be tested; the
 * decoding helpers take folder entries.
 */
import type { Entry } from './folder';
import type { App } from '../app';
import { sniff, decodePicture } from '../codecs/registry';

const PLATFORM = new Set(['jpeg', 'png', 'apng', 'webp', 'gif', 'bmp', 'avif', 'heic', 'jxl', 'svg']);

/** A canvas with the picture scaled to at most `max` pixels on the long side (platform decoder first). */
export async function decodeSmall(app: App, e: Entry, max = 160): Promise<HTMLCanvasElement | null> {
  const draw = (img: CanvasImageSource, w: number, h: number) => { const k = Math.min(1, max / Math.max(w, h)); const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k)); c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height); return c; };
  try {
    const cur = app.tab.picture;
    if (cur && cur.entry === e) { const fc = cur.frameCanvas(); return draw(fc, fc.width, fc.height); }
    const u8 = new Uint8Array(await e.read());
    const fmt = sniff(u8, e.name);
    if (fmt && PLATFORM.has(fmt.id)) {
      try { const bmp = await createImageBitmap(new Blob([u8 as BlobPart], { type: fmt.mime }), { imageOrientation: 'from-image' as any }); const c = draw(bmp, bmp.width, bmp.height); bmp.close(); return c; } catch { /* app decoders */ }
    }
    const pic = await decodePicture(u8, e);
    const fc = pic.frameCanvas(); const c = draw(fc, fc.width, fc.height); pic.release();
    return c;
  } catch { return null; }
}

/** Luminance of a canvas resampled to w×h (box filter through drawImage). */
export function grayOf(src: HTMLCanvasElement, w: number, h: number): Float32Array {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true })!; x.imageSmoothingEnabled = true; (x as any).imageSmoothingQuality = 'high';
  x.drawImage(src, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data, g = new Float32Array(w * h);
  for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  return g;
}

/** Difference hash of a 9×8 gray block → 64 bits as a 16-digit hex string. */
export function dhash(g9x8: Float32Array): string {
  let bits = '';
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += g9x8[y * 9 + x] < g9x8[y * 9 + x + 1] ? '1' : '0';
  return bitsToHex(bits);
}

/** DCT (perceptual) hash of a 32×32 gray block: the 8×8 low frequencies against their median → 64 bits. */
export function phash(g32: Float32Array): string {
  const N = 32, cosT: number[][] = [];
  for (let u = 0; u < 8; u++) { cosT[u] = []; for (let x = 0; x < N; x++) cosT[u][x] = Math.cos(((2 * x + 1) * u * Math.PI) / (2 * N)); }
  const rows: number[][] = [];
  for (let y = 0; y < N; y++) { rows[y] = []; for (let u = 0; u < 8; u++) { let s = 0; for (let x = 0; x < N; x++) s += g32[y * N + x] * cosT[u][x]; rows[y][u] = s; } }
  const dct: number[] = [];
  for (let v = 0; v < 8; v++) for (let u = 0; u < 8; u++) { let s = 0; for (let y = 0; y < N; y++) s += rows[y][u] * cosT[v][y]; dct.push(s); }
  const ac = dct.slice(1).sort((a, b) => a - b), med = (ac[31] + ac[32]) / 2;
  let bits = ''; for (let i = 0; i < 64; i++) bits += dct[i] > med ? '1' : '0';
  return bitsToHex(bits);
}
const bitsToHex = (bits: string) => { let out = ''; for (let i = 0; i < 64; i += 4) out += parseInt(bits.slice(i, i + 4), 2).toString(16); return out; };

/** Number of differing bits between two hex hashes (0 = identical, 64 = opposite). */
export function hamming(a: string, b: string): number {
  let n = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) { let x = parseInt(a[i], 16) ^ parseInt(b[i], 16); while (x) { n += x & 1; x >>= 1; } }
  return n + Math.abs(a.length - b.length) * 4;
}

/** Mean absolute difference of two gray arrays of the same size (0–255). */
export function meanAbsDiff(a: Float32Array, b: Float32Array): number {
  let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
}

export interface Quality { sharpness: number; noise: number; exposure: number; compression: number; score: number }
/**
 * Quality of a gray copy (w×h, long side ~128) and the file's bytes per pixel. Scores are 0–100:
 * sharpness from the variance of the Laplacian, noise from the high-pass residual on flat areas,
 * exposure from clipping and the distance of the mean from mid-gray, compression from bytes per pixel.
 */
export function quality(g: Float32Array, w: number, h: number, bytesPerPixel: number | null): Quality {
  let lapVar = 0, n = 0, mean = 0, clipped = 0;
  const flat: number[] = [];
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x, c = g[i];
    const lap = 4 * c - g[i - 1] - g[i + 1] - g[i - w] - g[i + w];
    lapVar += lap * lap; n++;
    const local = (g[i - 1] + g[i + 1] + g[i - w] + g[i + w]) / 4;
    const grad = Math.abs(g[i + 1] - g[i - 1]) + Math.abs(g[i + w] - g[i - w]);
    if (grad < 12) flat.push(Math.abs(c - local));
  }
  for (let i = 0; i < g.length; i++) { mean += g[i]; if (g[i] < 4 || g[i] > 251) clipped++; }
  mean /= g.length; clipped /= g.length;
  const sharp = n ? Math.sqrt(lapVar / n) : 0; // typical: < 4 blurry, 10–40 sharp
  const sharpness = clamp01(Math.log10(1 + sharp) / Math.log10(41)) * 100;
  flat.sort((a, b) => a - b);
  const mad = flat.length ? flat[flat.length >> 1] : 0; // median residual on flat areas; > 3 noisy
  const noise = clamp01(1 - mad / 8) * 100;
  const exposure = clamp01(1 - clipped * 4 - Math.abs(mean - 118) / 160) * 100;
  const compression = bytesPerPixel === null ? 70 : clamp01(Math.log10(1 + bytesPerPixel * 10) / Math.log10(31)) * 100;
  const score = sharpness * 0.4 + noise * 0.2 + exposure * 0.25 + compression * 0.15;
  return { sharpness: round(sharpness), noise: round(noise), exposure: round(exposure), compression: round(compression), score: round(score) };
}
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const round = (v: number) => Math.round(v * 10) / 10;

export interface Fingerprint { entry: Entry; width: number; height: number; size: number; dhash: string; phash: string; gray: Float32Array; bytesHash: string; canvas: HTMLCanvasElement | null }
/** Hashes of a folder entry (null when it cannot be decoded). */
export async function fingerprint(app: App, e: Entry, withBytesHash: boolean): Promise<Fingerprint | null> {
  const c = await decodeSmall(app, e, 128);
  if (!c) return null;
  const g9 = grayOf(c, 9, 8), g32 = grayOf(c, 32, 32), g16 = grayOf(c, 16, 16);
  let bytesHash = '';
  if (withBytesHash) { try { const pic = app.tab.picture; const u8 = pic && pic.entry === e ? pic.bytes : new Uint8Array(await e.read()); bytesHash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', u8 as BufferSource))].map((b) => b.toString(16).padStart(2, '0')).join(''); } catch { /* none */ } }
  const dims = await dimensionsOf(app, e, c);
  return { entry: e, width: dims[0], height: dims[1], size: e.size || 0, dhash: dhash(g9), phash: phash(g32), gray: g16, bytesHash, canvas: c };
}
async function dimensionsOf(app: App, e: Entry, small: HTMLCanvasElement): Promise<[number, number]> {
  const pic = app.tab.picture;
  if (pic && pic.entry === e) return [pic.width, pic.height];
  try {
    const u8 = new Uint8Array(await e.read());
    const fmt = sniff(u8, e.name);
    if (fmt && PLATFORM.has(fmt.id)) { const b = await createImageBitmap(new Blob([u8 as BlobPart], { type: fmt.mime })); const r: [number, number] = [b.width, b.height]; b.close(); return r; }
  } catch { /* fall back */ }
  return [small.width, small.height];
}

export type DupKind = 'identical' | 'pixels' | 'resized' | 'similar';
export interface DupGroup { kind: DupKind; items: Fingerprint[] }
/** Groups fingerprints: byte-identical, same pixels (same size, hash distance 0, tiny difference), the same picture at another size, or merely similar (within `threshold` bits). */
export function groupDuplicates(fps: Fingerprint[], opts: { identical: boolean; pixels: boolean; resized: boolean; similar: boolean; threshold: number }): DupGroup[] {
  const groups: DupGroup[] = [];
  const used = new Set<Fingerprint>();
  const classify = (a: Fingerprint, b: Fingerprint): DupKind | null => {
    if (a.bytesHash && a.bytesHash === b.bytesHash) return 'identical';
    const d = Math.min(hamming(a.phash, b.phash), hamming(a.dhash, b.dhash));
    const same = a.width === b.width && a.height === b.height;
    if (same && d <= 2 && meanAbsDiff(a.gray, b.gray) < 2) return 'pixels';
    if (!same && d <= 3 && meanAbsDiff(a.gray, b.gray) < 6) return 'resized';
    if (d <= opts.threshold) return 'similar';
    return null;
  };
  const rank: Record<DupKind, number> = { identical: 0, pixels: 1, resized: 2, similar: 3 };
  for (let i = 0; i < fps.length; i++) {
    if (used.has(fps[i])) continue;
    const items = [fps[i]]; let kind: DupKind | null = null;
    for (let j = i + 1; j < fps.length; j++) {
      if (used.has(fps[j])) continue;
      const k = classify(fps[i], fps[j]);
      if (!k || !opts[k]) continue;
      items.push(fps[j]); used.add(fps[j]);
      if (kind === null || rank[k] > rank[kind]) kind = k;
    }
    if (items.length > 1 && kind) { used.add(fps[i]); groups.push({ kind, items: items.sort((a, b) => b.width * b.height - a.width * a.height || b.size - a.size) }); }
  }
  return groups;
}
