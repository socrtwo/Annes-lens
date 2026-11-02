/**
 * Stitch Panorama: overlapping pictures joined into one.
 *
 * 1. Each picture is reduced to a working size; Harris corners (spread over a grid) get normalized
 *    8×8 patch descriptors, matched with Lowe's ratio test and a mutual check.
 * 2. Every pair is fitted with RANSAC (a homography; a similarity for flat scans) and accepted when
 *    the inliers pass Brown and Lowe's test (n > 8 + 0.3 · matches).
 * 3. A maximum spanning tree over the inlier counts links the pictures; its center is the reference.
 *    Pictures that match nothing are left out and reported.
 * 4. Projection: planar (homographies to the reference), cylindrical (the focal length estimated
 *    from the homographies, else from EXIF, then translations on the cylinder, which suits a camera
 *    turned about a vertical axis), or flat (similarity transforms, for scanned pieces of a large
 *    original). Auto picks cylindrical when the planar result would cover more than about 100°.
 * 5. Gains even out the exposure along the tree; feathered blending (smooth, or sharp to avoid ghosts
 *    from moving things) is done in strips of rows to bound memory; the result can be cropped to the
 *    largest rectangle without gaps.
 */
import type { Raster } from '../codecs/raster';

export type Mat3 = number[];
export type Projection = 'auto' | 'planar' | 'cylindrical' | 'flat';
export interface StitchOptions { projection?: Projection; blend?: 'smooth' | 'sharp'; evenExposure?: boolean; crop?: boolean; maxPixels?: number; workSide?: number; focal35?: (number | undefined)[]; seed?: number; progress?: (text: string) => void }
export interface StitchResult { raster: Raster; used: number[]; skipped: number[]; projection: 'planar' | 'cylindrical' | 'flat'; focal?: number; links: { a: number; b: number; inliers: number }[]; transforms: Mat3[]; offsets?: [number, number][]; gains: number[]; cropped: boolean }

// Linear algebra ----------------------------------------------------------------------------------
export const I3: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
export function mul3(a: Mat3, b: Mat3): Mat3 {
  const o = new Array(9).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  return o;
}
export function inv3(m: Mat3): Mat3 | null {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  const k = 1 / det;
  return [A * k, -(b * i - c * h) * k, (b * f - c * e) * k, B * k, (a * i - c * g) * k, -(a * f - c * d) * k, C * k, -(a * h - b * g) * k, (a * e - b * d) * k];
}
export function apply3(m: Mat3, x: number, y: number): [number, number] {
  const w = m[6] * x + m[7] * y + m[8];
  return [(m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w];
}
const tr = (x: number, y: number): Mat3 => [1, 0, x, 0, 1, y, 0, 0, 1];
const sc = (s: number): Mat3 => [s, 0, 0, 0, s, 0, 0, 0, 1];
/** Solves A·x = b (Gaussian elimination, partial pivoting). */
export function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) { const k = M[r][c] / M[c][c]; if (k) for (let j = c; j <= n; j++) M[r][j] -= k * M[c][j]; }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) { let s = M[r][n]; for (let j = r + 1; j < n; j++) s -= M[r][j] * x[j]; x[r] = s / M[r][r]; }
  return x;
}
type Pt = [number, number];
function normalizer(p: Pt[]): Mat3 {
  let mx = 0, my = 0; for (const q of p) { mx += q[0]; my += q[1]; } mx /= p.length; my /= p.length;
  let d = 0; for (const q of p) d += Math.hypot(q[0] - mx, q[1] - my); d = d / p.length || 1;
  const s = Math.SQRT2 / d; return [s, 0, -s * mx, 0, s, -s * my, 0, 0, 1];
}
/** The homography taking `a` to `b` (least squares over all pairs, Hartley-normalized). */
export function homographyFrom(a: Pt[], b: Pt[]): Mat3 | null {
  if (a.length < 4) return null;
  const Ta = normalizer(a), Tb = normalizer(b);
  const AtA = Array.from({ length: 8 }, () => new Array(8).fill(0)), Atb = new Array(8).fill(0);
  const add = (row: number[], v: number) => { for (let i = 0; i < 8; i++) { Atb[i] += row[i] * v; for (let j = 0; j < 8; j++) AtA[i][j] += row[i] * row[j]; } };
  for (let k = 0; k < a.length; k++) {
    const [x, y] = apply3(Ta, a[k][0], a[k][1]), [X, Y] = apply3(Tb, b[k][0], b[k][1]);
    add([x, y, 1, 0, 0, 0, -x * X, -y * X], X); add([0, 0, 0, x, y, 1, -x * Y, -y * Y], Y);
  }
  const h = solve(AtA, Atb); if (!h) return null;
  const Tbi = inv3(Tb); if (!Tbi) return null;
  const H = mul3(Tbi, mul3([...h, 1], Ta));
  return Math.abs(H[8]) > 1e-12 ? H.map((v) => v / H[8]) : null;
}
/** The similarity (rotation, uniform scale, shift) taking `a` to `b`. */
export function similarityFrom(a: Pt[], b: Pt[]): Mat3 | null {
  if (a.length < 2) return null;
  const AtA = Array.from({ length: 4 }, () => new Array(4).fill(0)), Atb = new Array(4).fill(0);
  const add = (row: number[], v: number) => { for (let i = 0; i < 4; i++) { Atb[i] += row[i] * v; for (let j = 0; j < 4; j++) AtA[i][j] += row[i] * row[j]; } };
  for (let k = 0; k < a.length; k++) { const [x, y] = a[k], [X, Y] = b[k]; add([x, -y, 1, 0], X); add([y, x, 0, 1], Y); }
  const s = solve(AtA, Atb); if (!s) return null;
  return [s[0], -s[1], s[2], s[1], s[0], s[3], 0, 0, 1];
}
export function translationFrom(a: Pt[], b: Pt[]): Mat3 | null {
  if (!a.length) return null;
  let dx = 0, dy = 0; for (let k = 0; k < a.length; k++) { dx += b[k][0] - a[k][0]; dy += b[k][1] - a[k][1]; }
  return tr(dx / a.length, dy / a.length);
}
type Model = 'homography' | 'similarity' | 'translation';
const MIN: Record<Model, number> = { homography: 4, similarity: 2, translation: 1 };
const FIT: Record<Model, (a: Pt[], b: Pt[]) => Mat3 | null> = { homography: homographyFrom, similarity: similarityFrom, translation: translationFrom };
export function mulberry(seed: number): () => number { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
/** RANSAC: the model with the most pairs within `thresh` pixels, refitted on its inliers. */
export function ransac(a: Pt[], b: Pt[], model: Model, thresh = 3, iters = 1200, rnd = mulberry(1)): { M: Mat3; inliers: number[] } | null {
  const n = a.length, m = MIN[model]; if (n < m) return null;
  const t2 = thresh * thresh;
  const sane = (M: Mat3) => { if (model !== 'homography') return true; const det = M[0] * M[4] - M[1] * M[3]; return det > 0.2 && det < 5 && Math.abs(M[6]) < 0.01 && Math.abs(M[7]) < 0.01; };
  const count = (M: Mat3): number[] => { const ins: number[] = []; for (let k = 0; k < n; k++) { const [x, y] = apply3(M, a[k][0], a[k][1]); if ((x - b[k][0]) ** 2 + (y - b[k][1]) ** 2 < t2) ins.push(k); } return ins; };
  let best: number[] = [], bestM: Mat3 | null = null;
  for (let it = 0; it < iters; it++) {
    const idx = new Set<number>(); while (idx.size < m) idx.add(Math.floor(rnd() * n));
    const s = [...idx], M = FIT[model](s.map((k) => a[k]), s.map((k) => b[k]));
    if (!M || !sane(M)) continue;
    const ins = count(M); if (ins.length > best.length) { best = ins; bestM = M; if (best.length > 0.9 * n) break; }
  }
  if (!bestM) return null;
  for (let r = 0; r < 3; r++) { const M = FIT[model](best.map((k) => a[k]), best.map((k) => b[k])); if (!M || !sane(M)) break; const ins = count(M); if (ins.length < best.length) break; bestM = M; best = ins; }
  return { M: bestM, inliers: best };
}

// Features ----------------------------------------------------------------------------------------
export interface Gray { w: number; h: number; v: Float32Array }
/** Luminance (0…1) at `scale` of the raster's size (box-averaged when reducing). */
export function grayAt(r: Raster, scale: number): Gray {
  const w = Math.max(1, Math.round(r.width * scale)), h = Math.max(1, Math.round(r.height * scale)), v = new Float32Array(w * h), d = r.data;
  const fx = r.width / w, fy = r.height / h;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * fy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * fy));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * fx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * fx)); let s = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { const i = (yy * r.width + xx) * 4; s += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; n++; }
      v[y * w + x] = s / n / 255;
    }
  }
  return { w, h, v };
}
export function blurGray(g: Gray, sigma: number): Gray {
  const r = Math.max(1, Math.ceil(sigma * 3)), k = new Float32Array(2 * r + 1); let s = 0;
  for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma)); s += k[i + r]; } for (let i = 0; i < k.length; i++) k[i] /= s;
  const { w, h } = g, t = new Float32Array(w * h), o = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let a = 0; for (let i = -r; i <= r; i++) a += k[i + r] * g.v[y * w + Math.min(w - 1, Math.max(0, x + i))]; t[y * w + x] = a; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let a = 0; for (let i = -r; i <= r; i++) a += k[i + r] * t[Math.min(h - 1, Math.max(0, y + i)) * w + x]; o[y * w + x] = a; }
  return { w, h, v: o };
}
const at = (g: Gray, x: number, y: number) => { const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, i = y0 * g.w + x0; return (g.v[i] * (1 - fx) + g.v[i + 1] * fx) * (1 - fy) + (g.v[i + g.w] * (1 - fx) + g.v[i + g.w + 1] * fx) * fy; };
/** Harris corners, strongest first, spread over an 8×8 grid. */
export function harrisCorners(g: Gray, max = 400, border = 12): Pt[] {
  const { w, h } = g, ix = new Float32Array(w * h), iy = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x, v = g.v;
    ix[i] = (v[i - w + 1] + 2 * v[i + 1] + v[i + w + 1] - v[i - w - 1] - 2 * v[i - 1] - v[i + w - 1]) / 8;
    iy[i] = (v[i + w - 1] + 2 * v[i + w] + v[i + w + 1] - v[i - w - 1] - 2 * v[i - w] - v[i - w + 1]) / 8;
  }
  const xx = new Float32Array(w * h), yy = new Float32Array(w * h), xy = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) { xx[i] = ix[i] * ix[i]; yy[i] = iy[i] * iy[i]; xy[i] = ix[i] * iy[i]; }
  const A = blurGray({ w, h, v: xx }, 1.5).v, B = blurGray({ w, h, v: yy }, 1.5).v, C = blurGray({ w, h, v: xy }, 1.5).v, R = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) R[i] = A[i] * B[i] - C[i] * C[i] - 0.04 * (A[i] + B[i]) ** 2;
  const cand: { x: number; y: number; r: number }[] = [];
  let top = 0; for (let i = 0; i < R.length; i++) if (R[i] > top) top = R[i];
  const floor = top * 1e-4;
  for (let y = border; y < h - border; y++) for (let x = border; x < w - border; x++) {
    const r = R[y * w + x]; if (r <= floor) continue;
    let peak = true; for (let dy = -3; dy <= 3 && peak; dy++) for (let dx = -3; dx <= 3; dx++) if ((dx || dy) && R[(y + dy) * w + x + dx] >= r) { peak = false; break; }
    if (peak) cand.push({ x, y, r });
  }
  cand.sort((p, q) => q.r - p.r);
  const per = Math.ceil(max / 64) * 2, cells = new Map<number, number>(), out: Pt[] = [];
  for (const c of cand) { const k = Math.floor((c.y / h) * 8) * 8 + Math.floor((c.x / w) * 8), n = cells.get(k) || 0; if (n >= per) continue; cells.set(k, n + 1); out.push([c.x, c.y]); if (out.length >= max) break; }
  return out;
}
/** Normalized 8×8 patch descriptors (spacing 2 px); points too flat to describe are dropped. */
export function describe(g: Gray, pts: Pt[]): { pts: Pt[]; desc: Float32Array[] } {
  const keep: Pt[] = [], desc: Float32Array[] = [];
  for (const [x, y] of pts) {
    if (x < 9 || y < 9 || x > g.w - 10 || y > g.h - 10) continue;
    const d = new Float32Array(64); let m = 0;
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) { const v = at(g, x - 7 + i * 2, y - 7 + j * 2); d[j * 8 + i] = v; m += v; }
    m /= 64; let s = 0; for (let k = 0; k < 64; k++) { d[k] -= m; s += d[k] * d[k]; }
    s = Math.sqrt(s / 64); if (s < 2e-3) continue;
    for (let k = 0; k < 64; k++) d[k] /= s;
    keep.push([x, y]); desc.push(d);
  }
  return { pts: keep, desc };
}
const ssd = (a: Float32Array, b: Float32Array) => { let s = 0; for (let k = 0; k < 64; k++) { const t = a[k] - b[k]; s += t * t; } return s; };
/** Ratio-test matches that are each other's nearest neighbors. */
export function matchFeatures(da: Float32Array[], db: Float32Array[], ratio = 0.8): [number, number][] {
  const bestB = new Int32Array(db.length).fill(-1), bestBd = new Float64Array(db.length).fill(Infinity);
  const fwd: [number, number][] = [];
  for (let i = 0; i < da.length; i++) {
    let b1 = Infinity, b2 = Infinity, j1 = -1;
    for (let j = 0; j < db.length; j++) { const s = ssd(da[i], db[j]); if (s < b1) { b2 = b1; b1 = s; j1 = j; } else if (s < b2) b2 = s; if (s < bestBd[j]) { bestBd[j] = s; bestB[j] = i; } }
    if (j1 >= 0 && b1 < ratio * ratio * b2) fwd.push([i, j1]);
  }
  return fwd.filter(([i, j]) => bestB[j] === i);
}

// Focal length from a rotation-only homography (Szeliski; the form OpenCV uses) ------------------
/** Focal lengths (f0 of the first picture, f1 of the second) of a homography in centered pixels. */
export function focalsFromHomography(H: Mat3): { f0?: number; f1?: number } {
  const h = H.map((v) => v / H[8]);
  // Each focal has two estimates; the one with the larger denominator is the better conditioned. A pure
  // pan makes one of them 0/0, so only finite positive values count.
  const pick = (v1: number, d1: number, v2: number, d2: number): number | undefined => {
    const ok1 = Number.isFinite(v1) && v1 > 0, ok2 = Number.isFinite(v2) && v2 > 0;
    return ok1 && ok2 ? Math.sqrt(Math.abs(d1) > Math.abs(d2) ? v1 : v2) : ok1 ? Math.sqrt(v1) : ok2 ? Math.sqrt(v2) : undefined;
  };
  let d1 = h[6] * h[7], d2 = (h[7] - h[6]) * (h[7] + h[6]);
  const f1 = pick(-(h[0] * h[1] + h[3] * h[4]) / d1, d1, (h[0] * h[0] + h[3] * h[3] - h[1] * h[1] - h[4] * h[4]) / d2, d2);
  d1 = h[0] * h[3] + h[1] * h[4]; d2 = h[0] * h[0] + h[1] * h[1] - h[3] * h[3] - h[4] * h[4];
  const f0 = pick((-h[2] * h[5]) / d1, d1, (h[5] * h[5] - h[2] * h[2]) / d2, d2);
  const out: { f0?: number; f1?: number } = {}; if (f0 !== undefined) out.f0 = f0; if (f1 !== undefined) out.f1 = f1;
  return out;
}
/** Cylindrical coordinates (radius f) of a centered pixel, and back. */
export const toCyl = (x: number, y: number, f: number): Pt => [f * Math.atan2(x, f), (f * y) / Math.hypot(x, f)];
export const fromCyl = (u: number, v: number, f: number): Pt => { const x = f * Math.tan(u / f); return [x, (v * Math.hypot(x, f)) / f]; };

// Largest rectangle inside a mask -----------------------------------------------------------------
export function largestRect(mask: Uint8Array, w: number, h: number): { x: number; y: number; w: number; h: number } {
  const hist = new Int32Array(w); let best = { x: 0, y: 0, w: 0, h: 0 }, area = 0;
  const stack: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) hist[x] = mask[y * w + x] ? hist[x] + 1 : 0;
    stack.length = 0;
    for (let x = 0; x <= w; x++) {
      const cur = x < w ? hist[x] : 0;
      while (stack.length && hist[stack[stack.length - 1]] >= cur) {
        const top = stack.pop()!, height = hist[top], left = stack.length ? stack[stack.length - 1] + 1 : 0, a = height * (x - left);
        if (a > area) { area = a; best = { x: left, y: y - height + 1, w: x - left, h: height }; }
      }
      stack.push(x);
    }
  }
  return best;
}

// The pipeline ------------------------------------------------------------------------------------
interface Work { g: Gray; gs: Gray; scale: number; pts: Pt[]; desc: Float32Array[] }
interface Link { a: number; b: number; H: Mat3; S: Mat3; ia: Pt[]; ib: Pt[]; inliers: number }

export function stitch(images: Raster[], o: StitchOptions = {}): StitchResult {
  const n = images.length, say = o.progress || (() => undefined), rnd = mulberry(o.seed ?? 7);
  if (n < 2) throw new Error('Choose at least two pictures');
  const side = o.workSide || 700;
  say('Finding features…');
  const work: Work[] = images.map((r) => {
    const scale = Math.min(1, side / Math.max(r.width, r.height)), g = grayAt(r, scale), gs = blurGray(g, 1.2);
    const f = describe(gs, harrisCorners(g, 500));
    return { g, gs, scale, pts: f.pts, desc: f.desc };
  });
  // Pairs.
  say('Matching pairs…');
  const links: Link[] = [];
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
    const m = matchFeatures(work[a].desc, work[b].desc); if (m.length < 12) continue;
    const pa = m.map(([i]) => work[a].pts[i]), pb = m.map(([, j]) => work[b].pts[j]);
    const rh = ransac(pa, pb, 'homography', 3, 1500, rnd); if (!rh) continue;
    if (rh.inliers.length < 15 || rh.inliers.length <= 8 + 0.3 * m.length) continue;
    const ia = rh.inliers.map((k) => pa[k]), ib = rh.inliers.map((k) => pb[k]);
    const S = similarityFrom(ia, ib) || I3;
    links.push({ a, b, H: rh.M, S, ia, ib, inliers: ia.length });
  }
  // Maximum spanning tree (Prim) over the largest connected group.
  const deg = new Array(n).fill(0); for (const l of links) { deg[l.a] += l.inliers; deg[l.b] += l.inliers; }
  const start = deg.indexOf(Math.max(...deg));
  const inTree = new Set<number>([start]), tree: Link[] = [];
  for (;;) { let pick: Link | null = null; for (const l of links) if (inTree.has(l.a) !== inTree.has(l.b) && (!pick || l.inliers > pick.inliers)) pick = l; if (!pick) break; tree.push(pick); inTree.add(inTree.has(pick.a) ? pick.b : pick.a); }
  if (inTree.size < 2) throw new Error('The pictures do not overlap enough to be joined (no pair shares enough detail)');
  const used = [...inTree].sort((x, y) => x - y), skipped = [...Array(n).keys()].filter((i) => !inTree.has(i));
  // The tree's center (smallest farthest distance) is the reference.
  const adj = new Map<number, { to: number; l: Link }[]>(); for (const i of used) adj.set(i, []);
  for (const l of tree) { adj.get(l.a)!.push({ to: l.b, l }); adj.get(l.b)!.push({ to: l.a, l }); }
  const depthFrom = (s: number) => { const d = new Map<number, number>([[s, 0]]), q = [s]; while (q.length) { const u = q.shift()!; for (const e of adj.get(u)!) if (!d.has(e.to)) { d.set(e.to, d.get(u)! + 1); q.push(e.to); } } return Math.max(...d.values()); };
  const ref = used.reduce((b, i) => (depthFrom(i) < depthFrom(b) ? i : b), used[0]);
  // Order of visiting, with each child's link to its parent.
  const order: { i: number; parent: number; l: Link | null }[] = [{ i: ref, parent: -1, l: null }];
  { const seen = new Set([ref]); for (let k = 0; k < order.length; k++) for (const e of adj.get(order[k].i)!) if (!seen.has(e.to)) { seen.add(e.to); order.push({ i: e.to, parent: order[k].i, l: e.l }); } }
  // child → parent transform for a link model (models map a → b).
  const toParent = (l: Link, child: number, M: Mat3): Mat3 => (l.a === child ? M : inv3(M)!);
  // Gains from the inlier points' brightness.
  const gains = new Array(n).fill(1);
  if (o.evenExposure !== false) {
    for (const s of order.slice(1)) {
      const l = s.l!, cPts = l.a === s.i ? l.ia : l.ib, pPts = l.a === s.i ? l.ib : l.ia;
      let sc_ = 0, sp = 0; for (let k = 0; k < cPts.length; k++) { sc_ += at(work[s.i].gs, cPts[k][0], cPts[k][1]); sp += at(work[s.parent].gs, pPts[k][0], pPts[k][1]); }
      gains[s.i] = gains[s.parent] * Math.min(2, Math.max(0.5, sc_ > 1e-6 ? sp / sc_ : 1));
    }
    const gm = Math.exp(used.reduce((s, i) => s + Math.log(gains[i]), 0) / used.length); for (const i of used) gains[i] /= gm;
  }
  // Planar transforms to the reference (working pixels of each picture → working pixels of the reference).
  const T: Mat3[] = new Array(n).fill(null), flat = o.projection === 'flat';
  T[ref] = I3; for (const s of order.slice(1)) T[s.i] = mul3(T[s.parent], toParent(s.l!, s.i, flat ? s.l!.S : s.l!.H));
  // Focal length (working pixels of the reference) from the homographies in centered coordinates.
  const fs: number[] = [];
  for (const l of tree) {
    const ca = tr(work[l.a].g.w / 2, work[l.a].g.h / 2), cb = tr(work[l.b].g.w / 2, work[l.b].g.h / 2);
    const Hc = mul3(inv3(cb)!, mul3(l.H, ca)), f = focalsFromHomography(Hc);
    if (f.f0 && f.f1) fs.push(Math.sqrt(f.f0 * f.f1));
  }
  const rw = work[ref].g.w, rh_ = work[ref].g.h;
  let focal = fs.length ? fs.sort((x, y) => x - y)[Math.floor(fs.length / 2)] : 0, guessed = false;
  if (!(focal > 0.2 * Math.max(rw, rh_) && focal < 20 * Math.max(rw, rh_))) {
    const f35 = o.focal35?.[ref] || o.focal35?.find((v) => v);
    focal = f35 ? (Math.max(rw, rh_) * f35) / 36 : 0.8 * Math.max(rw, rh_); guessed = !f35;
  }
  // Which projection.
  let proj: 'planar' | 'cylindrical' | 'flat' = flat ? 'flat' : o.projection === 'cylindrical' ? 'cylindrical' : 'planar';
  if (o.projection === 'auto' || !o.projection) {
    let lo = Infinity, hi = -Infinity, bad = false;
    for (const i of used) {
      const { w, h } = work[i].g;
      for (const [x, y] of [[0, 0], [w, 0], [w, h], [0, h], [w / 2, h / 2]] as Pt[]) { const p = mul3(T[i], I3); const q = apply3(p, x, y); const w3 = p[6] * x + p[7] * y + p[8]; if (w3 <= 0) bad = true; const ang = Math.atan2(q[0] - rw / 2, focal); lo = Math.min(lo, ang); hi = Math.max(hi, ang); }
    }
    // Without perspective in the matches (shifted scans, long lenses) the focal length is only a guess:
    // then the planar result is kept unless it degenerates.
    let spread = 0; if (guessed && !bad) { let X0p = Infinity, X1p = -Infinity, Y0p = Infinity, Y1p = -Infinity, area = 0; for (const i of used) { const { w, h } = work[i].g; area += w * h; for (const [x, y] of [[0, 0], [w, 0], [w, h], [0, h]] as Pt[]) { const q = apply3(T[i], x, y); X0p = Math.min(X0p, q[0]); X1p = Math.max(X1p, q[0]); Y0p = Math.min(Y0p, q[1]); Y1p = Math.max(Y1p, q[1]); } } spread = ((X1p - X0p) * (Y1p - Y0p)) / area; }
    proj = bad || (guessed ? spread > 6 : hi - lo > (100 * Math.PI) / 180) ? 'cylindrical' : 'planar';
  }
  // Placement in full-size pixels of the reference.
  const full = images[ref], k = 1 / work[ref].scale; // work → full (reference)
  type Map_ = (x: number, y: number) => Pt | null; // output (full reference space, before shifting) → source pixel
  const inverse: Map_[] = new Array(n).fill(null), bounds: { x0: number; y0: number; x1: number; y1: number }[] = new Array(n).fill(null);
  const offsets: [number, number][] = new Array(n).fill(null);
  if (proj === 'cylindrical') {
    // Translations on the cylinder, from the inlier points of the tree's links.
    const cyl = (i: number, p: Pt): Pt => toCyl(p[0] - work[i].g.w / 2, p[1] - work[i].g.h / 2, focal * (work[i].scale / work[ref].scale));
    const off: Pt[] = new Array(n).fill(null); off[ref] = [0, 0];
    for (const s of order.slice(1)) {
      const l = s.l!, cPts = (l.a === s.i ? l.ia : l.ib).map((p) => cyl(s.i, p)), pPts = (l.a === s.i ? l.ib : l.ia).map((p) => cyl(s.parent, p));
      const r = ransac(cPts, pPts, 'translation', 2.5, 300, rnd); const t = r ? r.M : translationFrom(cPts, pPts)!;
      off[s.i] = [off[s.parent][0] + t[2], off[s.parent][1] + t[5]];
    }
    const F = focal * k;
    for (const i of used) {
      const img = images[i], s = images[i].width / work[i].g.w, Fi = F * (s * work[i].scale) / (work[ref].scale * k) * 1; // same scale when sizes match
      const ox = off[i][0] * k, oy = off[i][1] * k, cx = img.width / 2, cy = img.height / 2;
      offsets[i] = [ox, oy];
      inverse[i] = (x, y) => { const p = fromCyl(x - ox, y - oy, Fi); if (!Number.isFinite(p[0]) || Math.abs(x - ox) >= (Math.PI / 2) * Fi) return null; return [p[0] + cx, p[1] + cy]; };
      const corners = [[0, 0], [img.width, 0], [img.width, img.height], [0, img.height], [cx, 0], [cx, img.height]].map(([x, y]) => { const c = toCyl(x - cx, y - cy, Fi); return [c[0] + ox, c[1] + oy]; });
      bounds[i] = { x0: Math.min(...corners.map((c) => c[0])), y0: Math.min(...corners.map((c) => c[1])), x1: Math.max(...corners.map((c) => c[0])), y1: Math.max(...corners.map((c) => c[1])) };
    }
  } else {
    for (const i of used) {
      const img = images[i], si = work[i].g.w / img.width;
      const M = mul3(sc(k), mul3(T[i], sc(si))); // full pixels of i → full pixels of the reference
      const Mi = inv3(M); if (!Mi) continue;
      inverse[i] = (x, y) => { const w3 = Mi[6] * x + Mi[7] * y + Mi[8]; if (w3 <= 1e-9) return null; return [(Mi[0] * x + Mi[1] * y + Mi[2]) / w3, (Mi[3] * x + Mi[4] * y + Mi[5]) / w3]; };
      const c = [[0, 0], [img.width, 0], [img.width, img.height], [0, img.height]].map(([x, y]) => apply3(M, x, y));
      bounds[i] = { x0: Math.min(...c.map((p) => p[0])), y0: Math.min(...c.map((p) => p[1])), x1: Math.max(...c.map((p) => p[0])), y1: Math.max(...c.map((p) => p[1])) };
      T[i] = M;
    }
  }
  const live = used.filter((i) => inverse[i]);
  let X0 = Math.min(...live.map((i) => bounds[i].x0)), Y0 = Math.min(...live.map((i) => bounds[i].y0)), X1 = Math.max(...live.map((i) => bounds[i].x1)), Y1 = Math.max(...live.map((i) => bounds[i].y1));
  const areaIn = live.reduce((s, i) => s + images[i].width * images[i].height, 0);
  if ((X1 - X0) * (Y1 - Y0) > 12 * areaIn) throw new Error(proj === 'planar' ? 'The planar result would be stretched too far: try the cylindrical projection' : 'The pictures could not be placed sensibly');
  // Output scale (cap on pixels).
  const maxPx = o.maxPixels || 40e6; let os = Math.min(1, Math.sqrt(maxPx / ((X1 - X0) * (Y1 - Y0))));
  const W = Math.max(1, Math.ceil((X1 - X0) * os)), H = Math.max(1, Math.ceil((Y1 - Y0) * os));
  // Render in strips.
  say('Blending…');
  const out = new Uint8ClampedArray(W * H * 4), mask = new Uint8Array(W * H), sharp = o.blend === 'sharp';
  const STRIP = 128, acc = new Float32Array(W * STRIP * 4);
  for (let sy = 0; sy < H; sy += STRIP) {
    const sh = Math.min(STRIP, H - sy); acc.fill(0, 0, W * sh * 4);
    for (const i of live) {
      const b = bounds[i], img = images[i], d = img.data, iw = img.width, ih = img.height, g = gains[i], half = Math.min(iw, ih) / 2, inv = inverse[i];
      const bx0 = Math.max(0, Math.floor((b.x0 - X0) * os)), bx1 = Math.min(W - 1, Math.ceil((b.x1 - X0) * os)), by0 = Math.max(sy, Math.floor((b.y0 - Y0) * os)), by1 = Math.min(sy + sh - 1, Math.ceil((b.y1 - Y0) * os));
      for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) {
        const p = inv((x + 0.5) / os + X0, (y + 0.5) / os + Y0); if (!p) continue; // pixel centers
        let px = p[0] - 0.5, py = p[1] - 0.5; if (px < -0.5 || py < -0.5 || px > iw - 0.5 || py > ih - 0.5) continue;
        px = Math.max(0, Math.min(iw - 1, px)); py = Math.max(0, Math.min(ih - 1, py));
        const x0 = Math.min(iw - 2, Math.floor(px)), y0 = Math.min(ih - 2, Math.floor(py)), fx = px - x0, fy = py - y0, j = (y0 * iw + x0) * 4;
        const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
        const alpha = (d[j + 3] * w00 + d[j + 7] * w10 + d[j + iw * 4 + 3] * w01 + d[j + iw * 4 + 7] * w11) / 255; if (alpha <= 0) continue;
        const edge = Math.min(px + 1, iw - px, py + 1, ih - py) / half; let wt = Math.min(1, edge) * alpha; if (sharp) wt = wt ** 8; wt = Math.max(wt, 1e-6);
        const a = ((y - sy) * W + x) * 4;
        for (let c = 0; c < 3; c++) acc[a + c] += wt * g * (d[j + c] * w00 + d[j + 4 + c] * w10 + d[j + iw * 4 + c] * w01 + d[j + iw * 4 + 4 + c] * w11);
        acc[a + 3] += wt;
      }
    }
    for (let y = 0; y < sh; y++) for (let x = 0; x < W; x++) { const a = (y * W + x) * 4, wsum = acc[a + 3]; if (!wsum) continue; const q = ((sy + y) * W + x) * 4; out[q] = acc[a] / wsum; out[q + 1] = acc[a + 1] / wsum; out[q + 2] = acc[a + 2] / wsum; out[q + 3] = 255; mask[(sy + y) * W + x] = 1; }
  }
  let raster: Raster = { width: W, height: H, data: out as Uint8ClampedArray<ArrayBuffer> }, cropped = false;
  if (o.crop !== false) {
    const r = largestRect(mask, W, H);
    if (r.w * r.h >= 0.2 * W * H && (r.w < W || r.h < H)) {
      const c = new Uint8ClampedArray(r.w * r.h * 4);
      for (let y = 0; y < r.h; y++) c.set(out.subarray(((r.y + y) * W + r.x) * 4, ((r.y + y) * W + r.x + r.w) * 4), y * r.w * 4);
      raster = { width: r.w, height: r.h, data: c as Uint8ClampedArray<ArrayBuffer> }; cropped = true;
      X0 += r.x / os; Y0 += r.y / os;
    }
  }
  void full;
  return { raster, used, skipped, projection: proj, focal: proj === 'cylindrical' ? focal * k : undefined, links: tree.map((l) => ({ a: l.a, b: l.b, inliers: l.inliers })), transforms: T.map((m) => m && mul3(sc(os), mul3(tr(-X0, -Y0), m))), offsets: proj === 'cylindrical' ? offsets.map((v) => v && [(v[0] - X0) * os, (v[1] - Y0) * os]) : undefined, gains, cropped };
}
