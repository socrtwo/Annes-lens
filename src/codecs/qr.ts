/**
 * QR Code encoder (ISO/IEC 18004): byte mode, versions 1–40, error-correction levels L, M, Q, H,
 * automatic version and mask selection. Returns the module matrix; `qrRaster` turns it into pixels.
 */
import { makeRaster, type Raster } from './raster';

export type EcLevel = 'L' | 'M' | 'Q' | 'H';
const ECL_BITS: Record<EcLevel, number> = { L: 1, M: 0, Q: 3, H: 2 };
const ECL_INDEX: Record<EcLevel, number> = { L: 0, M: 1, Q: 2, H: 3 };
const ECC_PER_BLOCK = [
  [7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];
const NUM_BLOCKS = [
  [1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];

function rawDataModules(ver: number): number {
  let r = (16 * ver + 128) * ver + 64;
  if (ver >= 2) { const n = Math.floor(ver / 7) + 2; r -= (25 * n - 10) * n - 55; if (ver >= 7) r -= 36; }
  return r;
}
const dataCodewords = (ver: number, ecl: EcLevel) => Math.floor(rawDataModules(ver) / 8) - ECC_PER_BLOCK[ECL_INDEX[ecl]][ver - 1] * NUM_BLOCKS[ECL_INDEX[ecl]][ver - 1];

// GF(256) Reed–Solomon ------------------------------------------------------------------------------
const gfMul = (x: number, y: number): number => { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x; } return z; };
function rsGenerator(degree: number): Uint8Array { const result = new Uint8Array(degree); result[degree - 1] = 1; let root = 1; for (let i = 0; i < degree; i++) { for (let j = 0; j < degree; j++) { result[j] = gfMul(result[j], root); if (j + 1 < degree) result[j] ^= result[j + 1]; } root = gfMul(root, 2); } return result; }
function rsRemainder(data: Uint8Array, gen: Uint8Array): Uint8Array { const result = new Uint8Array(gen.length); for (const b of data) { const factor = b ^ result[0]; result.copyWithin(0, 1); result[result.length - 1] = 0; for (let i = 0; i < gen.length; i++) result[i] ^= gfMul(gen[i], factor); } return result; }

function alignmentPositions(ver: number): number[] {
  if (ver === 1) return [];
  const n = Math.floor(ver / 7) + 2, size = ver * 4 + 17, step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
  const out = [6]; for (let p = size - 7; out.length < n; p -= step) out.splice(1, 0, p);
  return out;
}

export interface QrCode { version: number; size: number; ecl: EcLevel; mask: number; modules: Uint8Array /* size*size, 1 = dark */ }

/** Encodes text (UTF-8, byte mode) at the smallest version that fits; `boost` raises the EC level when room allows. */
export function encodeQr(text: string, ecl: EcLevel = 'M', opts: { minVersion?: number; maxVersion?: number; boost?: boolean } = {}): QrCode {
  const bytes = new TextEncoder().encode(text);
  const minV = opts.minVersion || 1, maxV = opts.maxVersion || 40;
  let version = minV, usedBits = 0;
  for (; ; version++) {
    const cap = dataCodewords(version, ecl) * 8;
    usedBits = 4 + (version < 10 ? 8 : 16) + bytes.length * 8;
    if (usedBits <= cap) break;
    if (version >= maxV) throw new Error(`Too much text for a QR code at level ${ecl} (${bytes.length} bytes).`);
  }
  if (opts.boost !== false) for (const e of ['M', 'Q', 'H'] as EcLevel[]) if (ECL_INDEX[e] > ECL_INDEX[ecl] && usedBits <= dataCodewords(version, e) * 8) ecl = e;
  // Data bit stream.
  const bits: number[] = [];
  const push = (v: number, n: number) => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
  push(4, 4); push(bytes.length, version < 10 ? 8 : 16); for (const b of bytes) push(b, 8);
  const cap = dataCodewords(version, ecl) * 8;
  push(0, Math.min(4, cap - bits.length)); while (bits.length % 8) bits.push(0);
  for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) push(pad, 8);
  const data = new Uint8Array(bits.length / 8); for (let i = 0; i < bits.length; i++) data[i >>> 3] |= bits[i] << (7 - (i & 7));
  // Blocks and interleaving.
  const li = ECL_INDEX[ecl], numBlocks = NUM_BLOCKS[li][version - 1], eccLen = ECC_PER_BLOCK[li][version - 1], rawCw = Math.floor(rawDataModules(version) / 8), shortBlocks = numBlocks - (rawCw % numBlocks), shortLen = Math.floor(rawCw / numBlocks);
  const blocks: Uint8Array[] = []; const gen = rsGenerator(eccLen);
  for (let i = 0, k = 0; i < numBlocks; i++) { const dlen = shortLen - eccLen + (i < shortBlocks ? 0 : 1); const dat = data.subarray(k, k + dlen); k += dlen; const ecc = rsRemainder(dat, gen); const block = new Uint8Array(shortLen + 1); block.set(dat); if (i < shortBlocks) block[shortLen - eccLen] = 0; block.set(ecc, shortLen + 1 - eccLen); blocks.push(block); }
  const result: number[] = [];
  for (let i = 0; i < blocks[0].length; i++) for (let j = 0; j < blocks.length; j++) { if (i !== shortLen - eccLen || j >= shortBlocks) result.push(blocks[j][i]); }
  const codewords = Uint8Array.from(result);
  // Matrix.
  const size = version * 4 + 17, modules = new Uint8Array(size * size), fixed = new Uint8Array(size * size);
  const set = (x: number, y: number, dark: boolean) => { modules[y * size + x] = dark ? 1 : 0; fixed[y * size + x] = 1; };
  const finder = (cx: number, cy: number) => { for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const x = cx + dx, y = cy + dy; if (x < 0 || y < 0 || x >= size || y >= size) continue; const d = Math.max(Math.abs(dx), Math.abs(dy)); set(x, y, d !== 2 && d !== 4); } };
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  const ap = alignmentPositions(version);
  for (let i = 0; i < ap.length; i++) for (let j = 0; j < ap.length; j++) { if ((i === 0 && j === 0) || (i === 0 && j === ap.length - 1) || (i === ap.length - 1 && j === 0)) continue; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ap[i] + dx, ap[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1); }
  const drawFormat = (mask: number) => {
    const dataBits = (ECL_BITS[ecl] << 3) | mask; let rem = dataBits; for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537); const f = ((dataBits << 10) | rem) ^ 0x5412;
    const bit = (i: number) => ((f >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i)); set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8)); for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i)); for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i)); set(8, size - 8, true);
  };
  drawFormat(0);
  if (version >= 7) { let rem = version; for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25); const v = (version << 12) | rem; for (let i = 0; i < 18; i++) { const b = ((v >>> i) & 1) === 1, a = size - 11 + (i % 3), c = Math.floor(i / 3); set(a, c, b); set(c, a, b); } }
  // Data placement in the zigzag.
  let bi = 0; const total = codewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) { if (right === 6) right = 5; for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) { const x = right - j, upward = ((right + 1) & 2) === 0, y = upward ? size - 1 - vert : vert; if (!fixed[y * size + x] && bi < total) { modules[y * size + x] = (codewords[bi >>> 3] >>> (7 - (bi & 7))) & 1; bi++; } } }
  // Masks.
  const maskFn = [(x: number, y: number) => (x + y) % 2 === 0, (_x: number, y: number) => y % 2 === 0, (x: number) => x % 3 === 0, (x: number, y: number) => (x + y) % 3 === 0, (x: number, y: number) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x: number, y: number) => ((x * y) % 2) + ((x * y) % 3) === 0, (x: number, y: number) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x: number, y: number) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0];
  const applyMask = (m: number) => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fixed[y * size + x] && maskFn[m](x, y)) modules[y * size + x] ^= 1; };
  const penalty = (): number => {
    let score = 0; const at = (x: number, y: number) => modules[y * size + x];
    const runPenalty = (hist: number[]) => { const n = hist[1]; return n > 0 && n % 2 === 0 && hist[2] === n && hist[3] === n * 3 && hist[4] === n && hist[5] === n && hist[6] >= n * 4 ? 1 : 0; };
    for (let y = 0; y < size; y++) { let run = 0, color = 0; const hist = [0, 0, 0, 0, 0, 0, 0]; for (let x = 0; x < size; x++) { const c = at(x, y); if (c === color) { run++; if (run === 5) score += 3; else if (run > 5) score++; } else { hist.shift(); hist.push(run); if (color === 0) score += runPenalty(hist) * 40; color = c; run = 1; } } hist.shift(); hist.push(run); if (color === 0) hist.push(4 * size), hist.shift(); score += runPenalty([0, ...hist].slice(-7)) * 40; }
    for (let x = 0; x < size; x++) { let run = 0, color = 0; const hist = [0, 0, 0, 0, 0, 0, 0]; for (let y = 0; y < size; y++) { const c = at(x, y); if (c === color) { run++; if (run === 5) score += 3; else if (run > 5) score++; } else { hist.shift(); hist.push(run); if (color === 0) score += runPenalty(hist) * 40; color = c; run = 1; } } hist.shift(); hist.push(run); score += runPenalty([0, ...hist].slice(-7)) * 40; }
    for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) { const c = at(x, y); if (c === at(x + 1, y) && c === at(x, y + 1) && c === at(x + 1, y + 1)) score += 3; }
    let dark = 0; for (const m of modules) dark += m; const k = Math.ceil(Math.abs(dark * 20 - size * size * 10) / (size * size)) - 1; score += k * 10;
    return score;
  };
  let best = 0, bestScore = Infinity;
  for (let m = 0; m < 8; m++) { applyMask(m); drawFormat(m); const s = penalty(); if (s < bestScore) { bestScore = s; best = m; } applyMask(m); }
  applyMask(best); drawFormat(best);
  return { version, size, ecl, mask: best, modules };
}

/** The code as pixels: `scale` pixels per module with a quiet zone of `border` modules. */
export function qrRaster(qr: QrCode, scale = 8, border = 4, dark: [number, number, number] = [0, 0, 0], light: [number, number, number] = [255, 255, 255]): Raster {
  const n = (qr.size + 2 * border) * scale, out = makeRaster(n, n), d = out.data;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const mx = Math.floor(x / scale) - border, my = Math.floor(y / scale) - border; const isDark = mx >= 0 && my >= 0 && mx < qr.size && my < qr.size && qr.modules[my * qr.size + mx] === 1; const c = isDark ? dark : light; const o = (y * n + x) * 4; d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255; }
  return out;
}
/** The code as an SVG document. */
export function qrSvg(qr: QrCode, border = 4): string {
  const n = qr.size + 2 * border; let path = '';
  for (let y = 0; y < qr.size; y++) for (let x = 0; x < qr.size; x++) if (qr.modules[y * qr.size + x]) path += `M${x + border} ${y + border}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}
