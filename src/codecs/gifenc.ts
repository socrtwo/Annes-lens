/** GIF writer: global palette, LZW-compressed frames with delays, loop count and a transparent index. */
import { type Palette } from './palette';

export interface GifFrame { indexes: Uint8Array; delay: number /* ms */ }

export function encodeGif(width: number, height: number, pal: Palette, frames: GifFrame[], opts: { loops?: number; transparent?: number } = {}): Uint8Array {
  const out: number[] = [...'GIF89a'].map((c) => c.charCodeAt(0));
  let bits = 1; while ((1 << bits) < Math.max(pal.colors.length, opts.transparent !== undefined ? opts.transparent + 1 : 0)) bits++;
  bits = Math.max(1, Math.min(8, bits));
  const size = 1 << bits;
  out.push(width & 255, width >> 8, height & 255, height >> 8, 0x80 | ((bits - 1) << 4) | (bits - 1), 0, 0);
  for (let i = 0; i < size; i++) { const c = pal.colors[i] || [0, 0, 0]; out.push(c[0], c[1], c[2]); }
  if (frames.length > 1) out.push(0x21, 0xff, 11, ...[...'NETSCAPE2.0'].map((c) => c.charCodeAt(0)), 3, 1, (opts.loops || 0) & 255, ((opts.loops || 0) >> 8) & 255, 0);
  for (const f of frames) {
    const delay = Math.max(0, Math.round(f.delay / 10));
    const t = opts.transparent;
    out.push(0x21, 0xf9, 4, (t !== undefined ? 1 : 0) | (frames.length > 1 ? 2 << 2 : 0), delay & 255, delay >> 8, t ?? 0, 0);
    out.push(0x2c, 0, 0, 0, 0, width & 255, width >> 8, height & 255, height >> 8, 0);
    const minCode = Math.max(2, bits);
    out.push(minCode);
    const data = lzwEncode(f.indexes, minCode);
    for (let i = 0; i < data.length; i += 255) { const chunk = data.subarray(i, i + 255); out.push(chunk.length, ...chunk); }
    out.push(0);
  }
  out.push(0x3b);
  return Uint8Array.from(out);
}

/** GIF-flavored LZW (variable code size, clear and end codes, LSB-first packing). */
export function lzwEncode(src: Uint8Array, minCode: number): Uint8Array {
  const clear = 1 << minCode, eoi = clear + 1;
  const out: number[] = [];
  let acc = 0, nacc = 0;
  let codeSize = minCode + 1;
  const emit = (code: number) => { acc |= code << nacc; nacc += codeSize; while (nacc >= 8) { out.push(acc & 255); acc >>>= 8; nacc -= 8; } };
  let dict = new Map<number, number>();
  let next = eoi + 1;
  emit(clear);
  if (!src.length) { emit(eoi); if (nacc) out.push(acc & 255); return Uint8Array.from(out); }
  let prefix = src[0];
  for (let i = 1; i < src.length; i++) {
    const k = src[i];
    const key = (prefix << 8) | k;
    const found = dict.get(key);
    if (found !== undefined) { prefix = found; continue; }
    emit(prefix);
    if (next < 4096) { dict.set(key, next++); if (next > (1 << codeSize) && codeSize < 12) codeSize++; }
    else { emit(clear); dict = new Map(); next = eoi + 1; codeSize = minCode + 1; }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (nacc) out.push(acc & 255);
  return Uint8Array.from(out);
}
