/**
 * Color transforms between ICC profiles through the D50 XYZ connection space: matrix-shaper and
 * gray profiles directly, LUT-based profiles (A2B/B2A) through a 33-point 3D grid. Relative and
 * absolute colorimetric intents, perceptual and saturation through the profile's own tables
 * (colorimetric for matrix-shapers), optional black point compensation, and soft proofing with a
 * gamut warning. Pixels are 8-bit RGBA in place; gray profiles read R and write R = G = B.
 */
import { evalLut, type IccProfile, type Lut, type Mat3 } from './icc';
import { D50, inv3, apply3, mul3 } from './spaces';

export type Intent = 0 | 1 | 2 | 3; // perceptual, relative colorimetric, saturation, absolute colorimetric
export const INTENTS: [Intent, string][] = [[0, 'Perceptual'], [1, 'Relative colorimetric'], [2, 'Saturation'], [3, 'Absolute colorimetric']];
type XYZ = [number, number, number];

const LAB_E = 216 / 24389, LAB_K = 24389 / 27;
const fLab = (t: number) => (t > LAB_E ? Math.cbrt(t) : (LAB_K * t + 16) / 116);
const fInv = (t: number) => (t * t * t > LAB_E ? t * t * t : (116 * t - 16) / LAB_K);
export function xyzToLab(v: ArrayLike<number>): XYZ { const x = fLab(v[0] / D50[0]), y = fLab(v[1] / D50[1]), z = fLab(v[2] / D50[2]); return [116 * y - 16, 500 * (x - y), 200 * (y - z)]; }
export function labToXyz(l: ArrayLike<number>): XYZ { const y = (l[0] + 16) / 116, x = y + l[1] / 500, z = y - l[2] / 200; return [fInv(x) * D50[0], fInv(y) * D50[1], fInv(z) * D50[2]]; }
export const deltaE = (a: ArrayLike<number>, b: ArrayLike<number>) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Numeric inverse of a monotonic curve on 0..1 as a table of `n` entries. */
export function invertCurve(f: (x: number) => number, n = 4096): Float32Array {
  const t = new Float32Array(n), lo0 = f(0), hi0 = f(1), up = hi0 >= lo0;
  for (let i = 0; i < n; i++) {
    const y = i / (n - 1); let lo = 0, hi = 1;
    for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; if ((f(m) < y) === up) lo = m; else hi = m; }
    t[i] = (lo + hi) / 2;
  }
  return t;
}
const tableFn = (t: Float32Array) => (x: number) => { const p = Math.max(0, Math.min(1, x)) * (t.length - 1), i = Math.min(t.length - 2, Math.floor(p)); return t[i] + (t[i + 1] - t[i]) * (p - i); };

/** One profile's device ↔ PCS (XYZ, D50, relative) functions for an intent. */
export interface Side { channels: number; toPcs(v: number[]): XYZ; fromPcs(x: XYZ): number[]; matrix?: { m: Mat3; trc: ((x: number) => number)[]; gray: boolean } }

function lutPcs(p: IccProfile, l: Lut, dir: 'in' | 'out'): { dec(v: number[]): XYZ; enc(x: XYZ): number[] } {
  void dir;
  if (p.pcs === 'Lab') {
    const dec = l.legacyLab ? (v: number[]): XYZ => labToXyz([v[0] * 65535 / 65280 * 100, v[1] * 65535 / 256 - 128, v[2] * 65535 / 256 - 128]) : (v: number[]): XYZ => labToXyz([v[0] * 100, v[1] * 255 - 128, v[2] * 255 - 128]);
    const enc = l.legacyLab ? (x: XYZ) => { const L = xyzToLab(x); return [L[0] / 100 * 65280 / 65535, (L[1] + 128) * 256 / 65535, (L[2] + 128) * 256 / 65535]; } : (x: XYZ) => { const L = xyzToLab(x); return [L[0] / 100, (L[1] + 128) / 255, (L[2] + 128) / 255]; };
    return { dec, enc };
  }
  const k = 65535 / 32768;
  return { dec: (v) => [v[0] * k, v[1] * k, v[2] * k], enc: (x) => [x[0] / k, x[1] / k, x[2] / k] };
}

const channelsOf = (p: IccProfile) => (p.colorSpace === 'GRAY' ? 1 : p.colorSpace === 'CMYK' ? 4 : p.colorSpace === 'RGB' ? 3 : Number.parseInt(p.colorSpace) || 3);

export function side(p: IccProfile, intent: Intent): Side {
  const channels = channelsOf(p);
  const tagIntent = intent === 3 ? 1 : intent;
  const a2b = p.a2b[tagIntent] || p.a2b[0], b2a = p.b2a[tagIntent] || p.b2a[0];
  const absIn = intent === 3 ? (x: XYZ): XYZ => [x[0] * p.whitePoint[0] / D50[0], x[1] * p.whitePoint[1] / D50[1], x[2] * p.whitePoint[2] / D50[2]] : (x: XYZ) => x;
  const absOut = intent === 3 ? (x: XYZ): XYZ => [x[0] * D50[0] / p.whitePoint[0], x[1] * D50[1] / p.whitePoint[1], x[2] * D50[2] / p.whitePoint[2]] : (x: XYZ) => x;
  if (a2b && b2a && !(p.matrix && p.trc && intent === 1)) {
    const i = lutPcs(p, a2b, 'in'), o = lutPcs(p, b2a, 'out');
    return { channels, toPcs: (v) => absIn(i.dec(evalLut(a2b, v))), fromPcs: (x) => evalLut(b2a, o.enc(absOut(x))).map((c) => Math.max(0, Math.min(1, c))) };
  }
  if (p.colorSpace === 'GRAY' && p.grayTrc) {
    const f = p.grayTrc, inv = tableFn(invertCurve(f));
    return { channels, toPcs: (v) => absIn([D50[0] * f(v[0]), D50[1] * f(v[0]), D50[2] * f(v[0])]), fromPcs: (x) => [inv(absOut(x)[1])], matrix: { m: [D50[0], 0, 0, D50[1], 0, 0, D50[2], 0, 0], trc: [f], gray: true } };
  }
  if (p.matrix && p.trc) {
    const m = p.matrix, mi = inv3(m), trc = p.trc, inv = trc.map((f) => tableFn(invertCurve(f)));
    return { channels, toPcs: (v) => absIn(apply3(m, [trc[0](v[0]), trc[1](v[1]), trc[2](v[2])])), fromPcs: (x) => { const l = apply3(mi, absOut(x)); return [inv[0](l[0]), inv[1](l[1]), inv[2](l[2])]; }, matrix: { m, trc, gray: false } };
  }
  if (a2b || b2a) throw new Error(`${p.description || 'This profile'} works in one direction only`);
  throw new Error(`${p.description || 'This profile'} is not a kind this program can use (${p.colorSpace} ${p.deviceClass})`);
}

/** The darkest color a profile reproduces (neutral, D50 relative): device black for inputs, a round trip for outputs. */
function blackPoint(s: Side, asOutput: boolean): XYZ {
  const y = asOutput ? s.toPcs(s.fromPcs([0, 0, 0]))[1] : s.toPcs(new Array(s.channels).fill(s.channels === 4 ? 1 : 0))[1];
  return [D50[0] * y, D50[1] * y, D50[2] * y];
}
/** Black point compensation as a per-axis scale and offset (the LittleCMS formulation). */
function bpcAffine(bIn: XYZ, bOut: XYZ): { a: XYZ; b: XYZ } {
  const a = [0, 1, 2].map((k) => (bOut[k] - D50[k]) / (bIn[k] - D50[k])) as XYZ;
  const b = [0, 1, 2].map((k) => -D50[k] * (bOut[k] - bIn[k]) / (bIn[k] - D50[k])) as XYZ;
  return { a, b };
}

export interface TransformOptions { intent?: Intent; bpc?: boolean }
export type PixelTransform = (data: Uint8ClampedArray) => void;

/** A float transform (device 0..1 → device 0..1) from one profile to another. */
export function colorFn(src: IccProfile, dst: IccProfile, o: TransformOptions = {}): (v: number[]) => number[] {
  const intent = o.intent ?? 1, a = side(src, intent), b = side(dst, intent);
  let adapt = (x: XYZ) => x;
  if (o.bpc && intent !== 3) { const { a: s, b: t } = bpcAffine(blackPoint(a, false), blackPoint(b, true)); if (s.some((v) => Math.abs(v - 1) > 1e-6)) adapt = (x) => [x[0] * s[0] + t[0], x[1] * s[1] + t[1], x[2] * s[2] + t[2]]; }
  return (v) => b.fromPcs(adapt(a.toPcs(v)));
}

const GRID = 33;
/** Samples `fn` (3 inputs → up to 4 outputs) on a GRID³ lattice and returns a trilinear pixel transform. */
function gridTransform(fn: (v: number[]) => number[], inCh: number, outCh: number): PixelTransform {
  if (inCh === 1) {
    const t = new Uint8ClampedArray(256 * 3);
    for (let i = 0; i < 256; i++) { const r = fn([i / 255]); for (let c = 0; c < 3; c++) t[i * 3 + c] = Math.round((outCh === 1 ? r[0] : r[c]) * 255); }
    return (d) => { for (let p = 0; p < d.length; p += 4) { const i = d[p] * 3; d[p] = t[i]; d[p + 1] = t[i + 1]; d[p + 2] = t[i + 2]; } };
  }
  const n = GRID, lat = new Float32Array(n * n * n * 3);
  for (let r = 0; r < n; r++) for (let g = 0; g < n; g++) for (let b = 0; b < n; b++) { const o = fn([r / (n - 1), g / (n - 1), b / (n - 1)]), k = ((r * n + g) * n + b) * 3; lat[k] = o[0]; lat[k + 1] = outCh === 1 ? o[0] : o[1]; lat[k + 2] = outCh === 1 ? o[0] : o[2]; }
  const s = (n - 1) / 255, sR = n * n * 3, sG = n * 3;
  return (d) => {
    for (let p = 0; p < d.length; p += 4) {
      const fr = d[p] * s, fg = d[p + 1] * s, fb = d[p + 2] * s;
      const r0 = Math.min(n - 2, fr | 0), g0 = Math.min(n - 2, fg | 0), b0 = Math.min(n - 2, fb | 0), dr = fr - r0, dg = fg - g0, db = fb - b0;
      const k = r0 * sR + g0 * sG + b0 * 3;
      for (let c = 0; c < 3; c++) {
        const c000 = lat[k + c], c001 = lat[k + 3 + c], c010 = lat[k + sG + c], c011 = lat[k + sG + 3 + c], c100 = lat[k + sR + c], c101 = lat[k + sR + 3 + c], c110 = lat[k + sR + sG + c], c111 = lat[k + sR + sG + 3 + c];
        const x00 = c000 + (c001 - c000) * db, x01 = c010 + (c011 - c010) * db, x10 = c100 + (c101 - c100) * db, x11 = c110 + (c111 - c110) * db;
        const y0 = x00 + (x01 - x00) * dg, y1 = x10 + (x11 - x10) * dg;
        d[p + c] = Math.round((y0 + (y1 - y0) * dr) * 255);
      }
    }
  };
}

/** An 8-bit RGBA pixel transform from `src` to `dst` (both RGB or gray). */
export function makeTransform(src: IccProfile, dst: IccProfile, o: TransformOptions = {}): PixelTransform {
  const intent = o.intent ?? 1, a = side(src, intent), b = side(dst, intent);
  if (b.channels > 3) throw new Error('Pixels can be converted to RGB or gray profiles only; use Soft Proof for printer profiles');
  if (a.channels > 3) throw new Error('The picture\'s profile must be an RGB or gray profile');
  const bpcOn = !!o.bpc && intent !== 3;
  const bpc = bpcOn ? bpcAffine(blackPoint(a, false), blackPoint(b, true)) : null;
  const bpcNoop = !bpc || bpc.a.every((v) => Math.abs(v - 1) < 1e-6);
  if (a.matrix && b.matrix && bpcNoop && intent !== 3) {
    // Direct path: 256-entry linearization, one matrix, a 65536-entry output table per channel.
    const lin = a.matrix.trc.map((f) => { const t = new Float32Array(256); for (let i = 0; i < 256; i++) t[i] = f(i / 255); return t; });
    const outInv: Mat3 = b.matrix.gray ? [0, 1, 0, 0, 1, 0, 0, 1, 0] : inv3(b.matrix.m);
    const M = mul3(outInv, a.matrix.m);
    const outT = (b.matrix.gray ? [b.matrix.trc[0], b.matrix.trc[0], b.matrix.trc[0]] : b.matrix.trc).map((f) => { const inv = tableFn(invertCurve(f)), t = new Uint8ClampedArray(65536); for (let i = 0; i < 65536; i++) t[i] = Math.round(inv(i / 65535) * 255); return t; });
    const g = a.matrix.gray;
    return (d) => {
      for (let p = 0; p < d.length; p += 4) {
        const r = lin[0][d[p]], gg = g ? r : lin[1][d[p + 1]], bb = g ? r : lin[2][d[p + 2]];
        for (let c = 0; c < 3; c++) { const v = M[c * 3] * r + M[c * 3 + 1] * (g ? 0 : gg) + M[c * 3 + 2] * (g ? 0 : bb); d[p + c] = outT[c][v <= 0 ? 0 : v >= 1 ? 65535 : Math.round(v * 65535)]; }
      }
    };
  }
  return gridTransform(colorFn(src, dst, o), a.channels, b.channels);
}

export interface ProofOptions { intent?: Intent; bpc?: boolean; paperWhite?: boolean; gamutWarning?: [number, number, number] | null; gamutDeltaE?: number }
/**
 * Soft proof: picture (src) → the proofing device (its rendering intent) → back through the proof
 * profile (relative colorimetric, or absolute to simulate the paper) → the display profile.
 */
export function makeProof(src: IccProfile, proof: IccProfile, display: IccProfile, o: ProofOptions = {}): PixelTransform {
  const a = side(src, 1), pRel = side(proof, 1), pBack = o.paperWhite ? side(proof, 3) : pRel, d = side(display, o.paperWhite ? 3 : 1);
  if (a.channels > 3) throw new Error('The picture\'s profile must be an RGB or gray profile');
  const toDev = colorFn(src, proof, { intent: o.intent ?? 1, bpc: o.bpc });
  const warn = o.gamutWarning, lim = o.gamutDeltaE ?? 6;
  const fn = (v: number[]) => {
    const dev = toDev(v), back = pBack.toPcs(dev);
    if (warn) { const orig = a.toPcs(v), rt = pRel.toPcs(dev); if (deltaE(xyzToLab(orig), xyzToLab(rt)) > lim) return warn.map((c) => c / 255); }
    return d.fromPcs(back);
  };
  return gridTransform(fn, a.channels, d.channels);
}
