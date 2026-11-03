/**
 * OpenEXR DWAA and DWAB (DreamWorks Animation's lossy compression), as OpenEXR's DwaCompressor writes
 * it (version 2 blocks). A block holds a header of eleven 64-bit sizes, the channel rules, then four
 * streams: "unknown" channels (zlib), the AC coefficients (OpenEXR's static Huffman or zlib), the DC
 * coefficients (zlib with the ZIP predictor) and RLE channels (zlib, then OpenEXR's run-length code over
 * byte planes). Lossy channels are 8 × 8 DCT blocks of nonlinear half floats; R, G and B of one layer are
 * stored as Rec. 709 Y'CbCr and converted back; values go back to linear through the same curve as
 * OpenEXR's (gamma 2.2 below 1, logarithmic above), which a lone channel marked perceptually linear skips
 * (R, G, B sets always use it, as OpenEXR does).
 */

export interface DwaChannel { name: string; type: number; linear: boolean; xs: number; ys: number }
export interface DwaPlane { ch: DwaChannel; nx: number; ny: number }
export interface DwaHelpers {
  half: Float32Array;
  huffman: (u8: Uint8Array, p: number, n: number, nRaw: number) => Uint16Array;
  zlib: (src: Uint8Array, size: number) => Uint8Array;
  rle: (src: Uint8Array, size: number) => Uint8Array;
  predictReorder: (t: Uint8Array) => Uint8Array;
}

const BYTES = [4, 2, 4];
const UNKNOWN = 0, LOSSY_DCT = 1, RLE = 2;
// Natural (row-major) position → index in the zig-zag order of a JPEG-style 8 × 8 block.
const ZIG = [0, 1, 5, 6, 14, 15, 27, 28, 2, 4, 7, 13, 16, 26, 29, 42, 3, 8, 12, 17, 25, 30, 41, 43, 9, 11, 18, 24, 31, 40, 44, 53, 10, 19, 23, 32, 39, 45, 52, 54, 20, 22, 33, 38, 46, 51, 55, 60, 21, 34, 37, 47, 50, 56, 59, 61, 35, 36, 48, 49, 57, 58, 62, 63];

// float → half bits, rounding to nearest, ties to even (as Imath does).
const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
export function toHalf(v: number): number {
  f32[0] = v; const x = u32[0], sign = (x >>> 16) & 0x8000; let e = (x >>> 23) & 255; let m = x & 0x7fffff;
  if (e === 255) return sign | 0x7c00 | (m ? 0x200 : 0);
  e = e - 127 + 15;
  if (e >= 31) return sign | 0x7c00;
  if (e <= 0) {
    if (e < -10) return sign;
    m |= 0x800000; const shift = 14 - e; let h = m >>> shift; const rem = m & ((1 << shift) - 1), halfway = 1 << (shift - 1);
    if (rem > halfway || (rem === halfway && h & 1)) h++;
    return sign | h;
  }
  let h = (e << 10) | (m >>> 13); const rem = m & 0x1fff;
  if (rem > 0x1000 || (rem === 0x1000 && h & 1)) h++;
  return sign | h;
}

let TO_LINEAR: Uint16Array | null = null;
/** OpenEXR's dwaCompressorToLinear table: nonlinear half → linear half; infinities and NaN become 0. */
function toLinearTable(half: Float32Array): Uint16Array {
  if (TO_LINEAR) return TO_LINEAR;
  const t = new Uint16Array(65536), logBase = Math.fround(Math.pow(2.7182818, 2.2));
  for (let i = 1; i < 65536; i++) {
    if ((i & 0x7c00) === 0x7c00) continue;
    const h = half[i], a = Math.abs(h), s = h < 0 ? -1 : 1;
    t[i] = toHalf(s * Math.fround(a <= 1 ? Math.pow(a, 2.2) : Math.pow(logBase, Math.fround(a - 1))));
  }
  return (TO_LINEAR = t);
}

// OpenEXR's inverse 8 × 8 DCT (dctInverse8x8_scalar), in single precision, rows then columns.
const fr = Math.fround, PI_F = 3.14159;
const [KA, KB, KC, KD, KE, KF, KG] = [PI_F / 4, PI_F / 16, PI_F / 8, (3 * PI_F) / 16, (5 * PI_F) / 16, (3 * PI_F) / 8, (7 * PI_F) / 16].map((x) => fr(0.5 * fr(Math.cos(fr(x)))));
function idct1(d: Float32Array, o: number, s: number): void {
  const x0 = d[o], x1 = d[o + s], x2 = d[o + 2 * s], x3 = d[o + 3 * s], x4 = d[o + 4 * s], x5 = d[o + 5 * s], x6 = d[o + 6 * s], x7 = d[o + 7 * s];
  const a0 = fr(KC * x2), a1 = fr(KF * x2), a2 = fr(KC * x6), a3 = fr(KF * x6);
  const b0 = fr(fr(fr(fr(KB * x1) + fr(KD * x3)) + fr(KE * x5)) + fr(KG * x7));
  const b1 = fr(fr(fr(fr(KD * x1) - fr(KG * x3)) - fr(KB * x5)) - fr(KE * x7));
  const b2 = fr(fr(fr(fr(KE * x1) - fr(KB * x3)) + fr(KG * x5)) + fr(KD * x7));
  const b3 = fr(fr(fr(fr(KG * x1) - fr(KE * x3)) + fr(KD * x5)) - fr(KB * x7));
  const t0 = fr(KA * fr(x0 + x4)), t3 = fr(KA * fr(x0 - x4)), t1 = fr(a0 + a3), t2 = fr(a1 - a2);
  const g0 = fr(t0 + t1), g1 = fr(t3 + t2), g2 = fr(t3 - t2), g3 = fr(t0 - t1);
  d[o] = g0 + b0; d[o + s] = g1 + b1; d[o + 2 * s] = g2 + b2; d[o + 3 * s] = g3 + b3;
  d[o + 4 * s] = g3 - b3; d[o + 5 * s] = g2 - b2; d[o + 6 * s] = g1 - b1; d[o + 7 * s] = g0 - b0;
}
function idct8x8(d: Float32Array): void {
  for (let r = 0; r < 8; r++) idct1(d, r * 8, 1);
  for (let c = 0; c < 8; c++) idct1(d, c, 8);
}
const DC_ONLY = fr(3.535536e-1), CSC = [1.5747, 0.1873, 0.4682, 1.8556].map(fr); // Rec. 709 Y'CbCr → R'G'B'

/** Decodes one lossy set (three channels of a Y'CbCr set, or one channel) into half-float planes. */
function lossyDct(out: Uint16Array[], lin: boolean[], w: number, h: number, ac: Uint16Array, acPos: { v: number }, dc: Uint16Array, dcPos: { v: number }, H: DwaHelpers): void {
  const n = out.length, bx = Math.ceil(w / 8), by = Math.ceil(h / 8), dcBase = dcPos.v, toLin = toLinearTable(H.half);
  dcPos.v += n * bx * by;
  const zig = new Uint16Array(64), blocks = out.map(() => new Float32Array(64));
  for (let byi = 0; byi < by; byi++) for (let bxi = 0; bxi < bx; bxi++) {
    for (let c = 0; c < n; c++) {
      zig.fill(0); zig[0] = dc[dcBase + c * bx * by + byi * bx + bxi] ?? 0;
      let k = 1, last = 0;
      while (k < 64) {
        if (acPos.v >= ac.length) throw new Error('DWA data is damaged (AC data ends early)');
        const v = ac[acPos.v++];
        if (v === 0xff00) k = 64; else if (v >> 8 === 0xff) k += v & 0xff; else { last = k; zig[k] = v; k++; }
      }
      const b = blocks[c];
      if (!last) b.fill(fr(fr(H.half[zig[0]] * DC_ONLY) * DC_ONLY));
      else { for (let i = 0; i < 64; i++) b[i] = H.half[zig[ZIG[i]]]; idct8x8(b); }
    }
    if (n === 3) {
      const [y, cb, cr] = blocks;
      for (let i = 0; i < 64; i++) { const Y = y[i], B = cb[i], R = cr[i]; y[i] = Y + fr(CSC[0] * R); cb[i] = fr(Y - fr(CSC[1] * B)) - fr(CSC[2] * R); cr[i] = Y + fr(CSC[3] * B); }
    }
    const maxY = Math.min(8, h - byi * 8), maxX = Math.min(8, w - bxi * 8);
    for (let c = 0; c < n; c++) for (let yy = 0; yy < maxY; yy++) for (let xx = 0; xx < maxX; xx++) {
      const hv = toHalf(blocks[c][yy * 8 + xx]);
      out[c][(byi * 8 + yy) * w + bxi * 8 + xx] = lin[c] ? hv : toLin[hv];
    }
  }
}

/** One DWAA/DWAB block of `planes` (sample counts per channel), rows y0 … y0 + h − 1, in the scanline layout. */
export function decodeDwa(src: Uint8Array, planes: DwaPlane[], y0: number, h: number, H: DwaHelpers): Uint8Array {
  const dv = new DataView(src.buffer, src.byteOffset, src.byteLength);
  if (src.length < 90) throw new Error('DWA data is damaged (header)');
  const u64 = (i: number) => dv.getUint32(i * 8, true) + dv.getUint32(i * 8 + 4, true) * 4294967296;
  const [version, unkU, unkC, acC, dcC, rleC, rleU, rleRaw, acN, dcN, acComp] = Array.from({ length: 11 }, (_, i) => u64(i));
  if (version !== 2) throw new Error(`DWA version ${version} blocks are not supported`);
  // Channel rules: suffix, (CSC index + 1) << 4 | scheme << 2 | case-insensitive, pixel type.
  const ruleSize = dv.getUint16(88, true); let q = 90; const rulesEnd = 88 + ruleSize;
  const rules: { suffix: string; csc: number; scheme: number; ci: boolean; type: number }[] = [];
  while (q < rulesEnd) {
    let e = q; while (e < rulesEnd && src[e]) e++;
    const suffix = new TextDecoder().decode(src.subarray(q, e)), v = src[e + 1], type = src[e + 2];
    rules.push({ suffix, csc: (v >> 4) - 1, scheme: (v >> 2) & 3, ci: !!(v & 1), type }); q = e + 3;
  }
  q = rulesEnd;
  // Classify the channels; the last matching rule wins, and an R, G, B set needs all three.
  const scheme = planes.map(() => UNKNOWN), sets = new Map<string, number[]>();
  planes.forEach((p, i) => {
    const dot = p.ch.name.lastIndexOf('.'), prefix = p.ch.name.slice(0, dot + 1), suffix = p.ch.name.slice(dot + 1);
    for (const r of rules) {
      if (r.type !== p.ch.type || (r.ci ? r.suffix.toLowerCase() !== suffix.toLowerCase() : r.suffix !== suffix)) continue;
      scheme[i] = r.scheme;
      if (r.csc >= 0) { if (!sets.has(prefix)) sets.set(prefix, [-1, -1, -1]); sets.get(prefix)![r.csc] = i; }
    }
  });
  const csc = [...sets.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).map((k) => sets.get(k)!).filter((s) => s.every((i) => i >= 0));
  // The four streams.
  const take = (n: number) => { if (q + n > src.length) throw new Error('DWA data is damaged (sizes)'); const s = src.subarray(q, q + n); q += n; return s; };
  const unknown = unkC ? H.zlib(take(unkC), unkU) : new Uint8Array(0);
  let ac: Uint16Array = new Uint16Array(0);
  if (acC) {
    if (acComp === 0) ac = H.huffman(take(acC), 0, acC, acN);
    else { const b = H.zlib(take(acC), acN * 2); ac = new Uint16Array(acN); for (let i = 0; i < acN; i++) ac[i] = b[2 * i] | (b[2 * i + 1] << 8); }
  }
  let dc = new Uint16Array(0);
  if (dcC) { const b = H.predictReorder(H.zlib(take(dcC), dcN * 2)); dc = new Uint16Array(dcN); for (let i = 0; i < dcN; i++) dc[i] = b[2 * i] | (b[2 * i + 1] << 8); }
  const rleBuf = rleRaw ? H.rle(H.zlib(take(rleC), rleU), rleRaw) : new Uint8Array(0);
  // Each channel as planar bytes in the file's (little-endian) sample layout.
  const planar = planes.map((p) => new Uint8Array(p.nx * p.ny * BYTES[p.ch.type]));
  const acPos = { v: 0 }, dcPos = { v: 0 }, done = planes.map(() => false);
  const writeHalves = (i: number, v: Uint16Array) => {
    const out = planar[i], d = new DataView(out.buffer);
    if (planes[i].ch.type === 1) for (let k = 0; k < v.length; k++) d.setUint16(k * 2, v[k], true);
    else if (planes[i].ch.type === 2) for (let k = 0; k < v.length; k++) d.setFloat32(k * 4, H.half[v[k]], true);
    else throw new Error('DWA: a lossy UINT channel');
  };
  for (const set of csc) {
    const p = planes[set[0]], out = set.map(() => new Uint16Array(p.nx * p.ny));
    lossyDct(out, set.map(() => false), p.nx, p.ny, ac, acPos, dc, dcPos, H);
    set.forEach((i, c) => { writeHalves(i, out[c]); done[i] = true; });
  }
  let unkPos = 0, rlePos = 0;
  planes.forEach((p, i) => {
    if (done[i]) return;
    const size = planar[i].length;
    if (scheme[i] === LOSSY_DCT) { const out = new Uint16Array(p.nx * p.ny); lossyDct([out], [p.ch.linear], p.nx, p.ny, ac, acPos, dc, dcPos, H); writeHalves(i, out); }
    else if (scheme[i] === RLE) { // byte planes: all first bytes, then all second bytes, …
      const n = p.nx * p.ny, bpp = BYTES[p.ch.type];
      for (let k = 0; k < n; k++) for (let b = 0; b < bpp; b++) planar[i][k * bpp + b] = rleBuf[rlePos + b * n + k];
      rlePos += size;
    } else { planar[i].set(unknown.subarray(unkPos, unkPos + size)); unkPos += size; }
  });
  // Back to the scanline layout.
  const out = new Uint8Array(planar.reduce((a, b) => a + b.length, 0)), rowIdx = planes.map(() => 0); let o = 0;
  for (let y = y0; y < y0 + h; y++) planes.forEach((p, i) => {
    if (((y % p.ch.ys) + p.ch.ys) % p.ch.ys) return;
    const n = p.nx * BYTES[p.ch.type]; out.set(planar[i].subarray(rowIdx[i] * n, rowIdx[i] * n + n), o); o += n; rowIdx[i]++;
  });
  return out;
}
