/**
 * Faces for Browse ▸ People, on the device.
 *
 * Detection: YuNet (OpenCV Zoo, MIT). The picture is scaled to fit 640 × 640 (the model's fixed
 * input), padded with black, given as BGR 0…255 like OpenCV's blobFromImage; the stride 8/16/32
 * heads are decoded as cv::FaceDetectorYN does (score √(cls · obj), box centre and log-size,
 * five landmarks), then non-maximum suppression.
 * Recognition: SFace (OpenCV Zoo, Apache-2.0). Each face is aligned to the 112 × 112 ArcFace
 * template by the least-squares similarity through its five landmarks (cv::FaceRecognizerSF::
 * alignCrop: warpAffine, bilinear, black border), given as RGB 0…255, and its 128 values are
 * normalized; faces of one person have cosine similarity above about 0.36.
 * Grouping: faces join the person whose average they resemble most, above a threshold, then
 * groups whose averages match are merged.
 */
import type { Raster } from '../codecs/raster';
import type { Backend } from '../ai/device';
import { resample } from './ops';

export interface Face { box: [number, number, number, number]; kps: number[]; score: number }
export const SFACE_THRESHOLD = 0.363;
export const TEMPLATE: [number, number][] = [[38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366], [41.5493, 92.3655], [70.7299, 92.2041]];
const SIDE = 640, STRIDES = [8, 16, 32];

const iou = (a: Face['box'], b: Face['box']) => {
  const x0 = Math.max(a[0], b[0]), y0 = Math.max(a[1], b[1]), x1 = Math.min(a[0] + a[2], b[0] + b[2]), y1 = Math.min(a[1] + a[3], b[1] + b[3]);
  const i = Math.max(0, x1 - x0) * Math.max(0, y1 - y0); return i / (a[2] * a[3] + b[2] * b[3] - i || 1);
};
/** Greedy non-maximum suppression, highest score first. */
export function nms(faces: Face[], thr = 0.3, topK = 5000): Face[] {
  const s = [...faces].sort((a, b) => b.score - a.score).slice(0, topK), keep: Face[] = [];
  for (const f of s) if (keep.every((k) => iou(k.box, f.box) <= thr)) keep.push(f);
  return keep;
}
/** Decodes YuNet's twelve outputs (by name) for an input of `w` × `h`. */
export function decodeYunet(out: Record<string, Float32Array>, w: number, h: number, scoreThr = 0.6): Face[] {
  const faces: Face[] = [];
  for (const st of STRIDES) {
    const cols = Math.floor(w / st), rows = Math.floor(h / st), cls = out[`cls_${st}`], obj = out[`obj_${st}`], bb = out[`bbox_${st}`], kp = out[`kps_${st}`];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const i = r * cols + c, cs = Math.min(1, Math.max(0, cls[i])), os = Math.min(1, Math.max(0, obj[i])), score = Math.sqrt(cs * os);
      if (score < scoreThr) continue;
      const cx = (c + bb[i * 4]) * st, cy = (r + bb[i * 4 + 1]) * st, bw = Math.exp(bb[i * 4 + 2]) * st, bh = Math.exp(bb[i * 4 + 3]) * st;
      const kps: number[] = []; for (let n = 0; n < 5; n++) kps.push((kp[i * 10 + 2 * n] + c) * st, (kp[i * 10 + 2 * n + 1] + r) * st);
      faces.push({ box: [cx - bw / 2, cy - bh / 2, bw, bh], kps, score });
    }
  }
  return faces;
}
/** Finds faces: boxes and landmarks in the picture's pixels. */
export async function detectFaces(b: Backend, bytes: () => Promise<ArrayBuffer>, r: Raster, o: { score?: number; nms?: number } = {}): Promise<Face[]> {
  const k = Math.min(SIDE / r.width, SIDE / r.height), w = Math.max(1, Math.round(r.width * k)), h = Math.max(1, Math.round(r.height * k));
  const small = w === r.width && h === r.height ? r : resample(r, w, h, 'lanczos3');
  const n = SIDE * SIDE, t = new Float32Array(3 * n), d = small.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const s = (y * w + x) * 4, i = y * SIDE + x; t[i] = d[s + 2]; t[n + i] = d[s + 1]; t[2 * n + i] = d[s]; } // BGR
  const outs = await b.infer('yunet', bytes, [{ data: t, dims: [1, 3, SIDE, SIDE] }]);
  const named: Record<string, Float32Array> = {}; for (const x of outs) named[x.name] = x.data;
  const sx = r.width / w, sy = r.height / h;
  return nms(decodeYunet(named, SIDE, SIDE, o.score ?? 0.6), o.nms ?? 0.3).map((f) => ({
    box: [f.box[0] * sx, f.box[1] * sy, f.box[2] * sx, f.box[3] * sy] as Face['box'], kps: f.kps.map((v, i) => v * (i % 2 ? sy : sx)), score: f.score,
  })).filter((f) => f.box[2] > 4 && f.box[3] > 4);
}
/** The similarity [a −b tx; b a ty] taking the landmarks to the template (least squares). */
export function similarityTo(src: number[], dst: [number, number][] = TEMPLATE): number[] {
  const n = dst.length; let mx = 0, my = 0, ux = 0, uy = 0;
  for (let i = 0; i < n; i++) { mx += src[2 * i]; my += src[2 * i + 1]; ux += dst[i][0]; uy += dst[i][1]; }
  mx /= n; my /= n; ux /= n; uy /= n;
  let sxx = 0, a = 0, b = 0;
  for (let i = 0; i < n; i++) { const x = src[2 * i] - mx, y = src[2 * i + 1] - my, X = dst[i][0] - ux, Y = dst[i][1] - uy; sxx += x * x + y * y; a += x * X + y * Y; b += x * Y - y * X; }
  a /= sxx; b /= sxx;
  return [a, -b, ux - (a * mx - b * my), b, a, uy - (b * mx + a * my)];
}
/** The 112 × 112 aligned face (warpAffine with bilinear sampling and a black border, pixel centres at integers). */
export function alignFace(r: Raster, kps: number[]): Raster {
  const [a, nb, tx, b, , ty] = similarityTo(kps), det = a * a + b * b;
  // Inverse of [a −b; b a] is [a b; −b a] / det.
  const out = new Uint8ClampedArray(112 * 112 * 4), W = r.width, H = r.height, d = r.data;
  for (let y = 0; y < 112; y++) for (let x = 0; x < 112; x++) {
    const X = x - tx, Y = y - ty, sx = (a * X + b * Y) / det, sy = (nb * X + a * Y) / det;
    const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0, o = (y * 112 + x) * 4;
    for (let c = 0; c < 3; c++) {
      const px = (xx: number, yy: number) => (xx < 0 || yy < 0 || xx >= W || yy >= H ? 0 : d[(yy * W + xx) * 4 + c]);
      out[o + c] = (px(x0, y0) * (1 - fx) + px(x0 + 1, y0) * fx) * (1 - fy) + (px(x0, y0 + 1) * (1 - fx) + px(x0 + 1, y0 + 1) * fx) * fy;
    }
    out[o + 3] = 255;
  }
  return { width: 112, height: 112, data: out as Uint8ClampedArray<ArrayBuffer> };
}
/** The face's normalized 128-value description. */
export async function embedFace(b: Backend, bytes: () => Promise<ArrayBuffer>, aligned: Raster, key = 'sface'): Promise<Float32Array> {
  const n = 112 * 112, t = new Float32Array(3 * n), d = aligned.data;
  for (let i = 0; i < n; i++) { t[i] = d[i * 4]; t[n + i] = d[i * 4 + 1]; t[2 * n + i] = d[i * 4 + 2]; } // RGB
  const [o] = await b.infer(key, bytes, [{ data: t, dims: [1, 3, 112, 112] }]);
  return normalize(o.data.slice(0, 128));
}
export function normalize(v: ArrayLike<number>): Float32Array { let s = 0; for (let i = 0; i < v.length; i++) s += v[i] * v[i]; s = Math.sqrt(s) || 1; return Float32Array.from(v, (x) => x / s); }
export const cosine = (a: ArrayLike<number>, b: ArrayLike<number>): number => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

/**
 * Groups face descriptions: each face joins the group whose (normalized) average it resembles most
 * when that is at least `thr`, else starts a group; then groups whose averages reach `thr` merge.
 * `fixed` assigns faces to known groups first (named people keep their faces). Returns a group index per face.
 */
export function groupFaces(embs: ArrayLike<number>[], thr = 0.42, fixed: (number | undefined)[] = []): number[] {
  const groups: { sum: Float32Array; n: number }[] = [], of = new Array<number>(embs.length).fill(-1);
  const mean = (g: { sum: Float32Array }) => normalize(g.sum);
  const add = (gi: number, i: number) => { const g = groups[gi]; for (let k = 0; k < g.sum.length; k++) g.sum[k] += embs[i][k]; g.n++; of[i] = gi; };
  const nGroups = Math.max(0, ...fixed.map((v) => (v === undefined ? -1 : v + 1)));
  for (let g = 0; g < nGroups; g++) groups.push({ sum: new Float32Array(embs[0]?.length || 128), n: 0 });
  embs.forEach((_, i) => { if (fixed[i] !== undefined) add(fixed[i]!, i); });
  for (let i = 0; i < embs.length; i++) {
    if (of[i] >= 0) continue;
    let best = -1, bs = thr;
    groups.forEach((g, gi) => { if (!g.n) return; const s = cosine(mean(g), embs[i]); if (s >= bs) { bs = s; best = gi; } });
    if (best < 0) { groups.push({ sum: new Float32Array(embs[i].length), n: 0 }); best = groups.length - 1; }
    add(best, i);
  }
  // Merge groups that match (named groups absorb unnamed ones; two named groups stay apart).
  const named = (gi: number) => gi < nGroups;
  for (let changed = true; changed;) {
    changed = false;
    for (let a = 0; a < groups.length && !changed; a++) for (let b = a + 1; b < groups.length && !changed; b++) {
      if (!groups[a].n || !groups[b].n || (named(a) && named(b))) continue;
      if (cosine(mean(groups[a]), mean(groups[b])) >= thr) {
        for (let k = 0; k < groups[a].sum.length; k++) groups[a].sum[k] += groups[b].sum[k];
        groups[a].n += groups[b].n; groups[b].n = 0; for (let i = 0; i < of.length; i++) if (of[i] === b) of[i] = a; changed = true;
      }
    }
  }
  // Renumber: named groups keep their numbers, the rest follow in order of first appearance.
  const map = new Map<number, number>(); for (let g = 0; g < nGroups; g++) map.set(g, g);
  return of.map((g) => { if (!map.has(g)) map.set(g, map.size); return map.get(g)!; });
}
