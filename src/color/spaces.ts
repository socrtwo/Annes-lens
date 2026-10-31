/**
 * Built-in working spaces as ICC profiles written on demand: sRGB, Display P3, an Adobe RGB
 * (1998)-compatible space, ProPhoto RGB (ROMM), Rec. 2020, linear sRGB and three gray spaces.
 * The colorants are computed from the published primaries and white point and adapted to the
 * D50 PCS with Bradford, the same way LittleCMS builds its own sRGB profile.
 */
import { writeIcc, parseIcc, type IccProfile, type Mat3, type Para } from './icc';

export const D50: [number, number, number] = [0.9642, 1, 0.82491];
const D65xy: [number, number] = [0.3127, 0.329];
const D50xy: [number, number] = [0.3457, 0.3585];

export function mul3(a: Mat3, b: Mat3): Mat3 {
  const o = new Array(9) as Mat3;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  return o;
}
export function inv3(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m, A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
}
export const apply3 = (m: Mat3, v: ArrayLike<number>): [number, number, number] => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
const xyToXYZ = ([x, y]: [number, number]): [number, number, number] => [x / y, 1, (1 - x - y) / y];

/** Bradford chromatic adaptation from one white (XYZ) to another. */
export function bradford(from: ArrayLike<number>, to: ArrayLike<number>): Mat3 {
  const M: Mat3 = [0.8951, 0.2664, -0.1614, -0.7502, 1.7135, 0.0367, 0.0389, -0.0685, 1.0296];
  const s = apply3(M, from), d = apply3(M, to);
  return mul3(inv3(M), mul3([d[0] / s[0], 0, 0, 0, d[1] / s[1], 0, 0, 0, d[2] / s[2]], M));
}

/** RGB → XYZ (relative to the space's own white), then adapted to D50. Columns are the D50 colorants. */
export function rgbToD50(primaries: [number, number][], white: [number, number]): Mat3 {
  const P = primaries.map(xyToXYZ), W = xyToXYZ(white);
  const m: Mat3 = [P[0][0], P[1][0], P[2][0], P[0][1], P[1][1], P[2][1], P[0][2], P[1][2], P[2][2]];
  const S = apply3(inv3(m), W);
  const rgbXYZ: Mat3 = [m[0] * S[0], m[1] * S[1], m[2] * S[2], m[3] * S[0], m[4] * S[1], m[5] * S[2], m[6] * S[0], m[7] * S[1], m[8] * S[2]];
  return mul3(bradford(W, xyToXYZ(D50xy)), rgbXYZ);
}

const SRGB_TRC: Para = { g: 2.4, a: 1 / 1.055, b: 0.055 / 1.055, c: 1 / 12.92, d: 0.04045 };
const REC709_TRC: Para = { g: 1 / 0.45, a: 1 / 1.099, b: 0.099 / 1.099, c: 1 / 4.5, d: 0.081 };
const ROMM_TRC: Para = { g: 1.8, a: 1, b: 0, c: 1 / 16, d: 16 / 512 };

export interface Space { id: string; name: string; gray?: boolean; primaries?: [number, number][]; white?: [number, number]; trc: Para }
export const SPACES: Space[] = [
  { id: 'srgb', name: 'sRGB IEC61966-2.1', primaries: [[0.64, 0.33], [0.3, 0.6], [0.15, 0.06]], white: D65xy, trc: SRGB_TRC },
  { id: 'p3', name: 'Display P3', primaries: [[0.68, 0.32], [0.265, 0.69], [0.15, 0.06]], white: D65xy, trc: SRGB_TRC },
  { id: 'adobergb', name: 'Adobe RGB (1998) compatible', primaries: [[0.64, 0.33], [0.21, 0.71], [0.15, 0.06]], white: D65xy, trc: { g: 563 / 256 } },
  { id: 'prophoto', name: 'ProPhoto RGB (ROMM)', primaries: [[0.7347, 0.2653], [0.1596, 0.8404], [0.0366, 0.0001]], white: D50xy, trc: ROMM_TRC },
  { id: 'rec2020', name: 'Rec. ITU-R BT.2020', primaries: [[0.708, 0.292], [0.17, 0.797], [0.131, 0.046]], white: D65xy, trc: REC709_TRC },
  { id: 'srgb-linear', name: 'sRGB linear', primaries: [[0.64, 0.33], [0.3, 0.6], [0.15, 0.06]], white: D65xy, trc: { g: 1 } },
  { id: 'gray22', name: 'Gray Gamma 2.2', gray: true, trc: { g: 2.2 } },
  { id: 'gray18', name: 'Gray Gamma 1.8', gray: true, trc: { g: 1.8 } },
  { id: 'graysrgb', name: 'Gray (sRGB tone curve)', gray: true, trc: SRGB_TRC },
];

const cache = new Map<string, Uint8Array>();
/** The ICC bytes of a built-in space. */
export function spaceIcc(id: string): Uint8Array {
  let b = cache.get(id);
  if (!b) {
    const s = SPACES.find((x) => x.id === id); if (!s) throw new Error(`Unknown color space ${id}`);
    const chad = s.white ? bradford(xyToXYZ(s.white), xyToXYZ(D50xy)) : undefined;
    b = writeIcc({ description: s.name, gray: s.gray, trc: s.trc, matrix: s.primaries ? rgbToD50(s.primaries, s.white!) : undefined, chad: chad && s.white !== D50xy ? chad : undefined });
    cache.set(id, b);
  }
  return b;
}
export const spaceProfile = (id: string): IccProfile => parseIcc(spaceIcc(id));

/** True when a profile is an RGB matrix-shaper indistinguishable from sRGB (colorants within 0.002, curves within 1/512). */
export function isSrgb(p: IccProfile): boolean {
  if (p.colorSpace !== 'RGB' || !p.matrix || !p.trc) return false;
  const s = spaceProfile('srgb');
  if (p.matrix.some((v, i) => Math.abs(v - s.matrix![i]) > 0.002)) return false;
  for (let i = 0; i <= 16; i++) { const x = i / 16; if (p.trc.some((f) => Math.abs(f(x) - s.trc![0](x)) > 1 / 512)) return false; }
  return true;
}
