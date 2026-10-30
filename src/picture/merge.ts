/**
 * Merging several pictures of the same scene: exposure fusion (Mertens, Kautz and Van Reeth:
 * per-pixel weights from contrast, saturation and well-exposedness, blended through a Laplacian
 * pyramid so no tone-mapping artifacts appear) and focus stacking (the sharpest source per pixel
 * by local Laplacian energy, with a smoothed selection map).
 */
import { makeRaster, type Raster } from '../codecs/raster';
import { gaussianBlur } from './adjust';

const lum = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

/** Half-size (box) copy. */
function down(src: Raster): Raster { const w = Math.max(1, src.width >> 1), h = Math.max(1, src.height >> 1), out = makeRaster(w, h), s = src.data, d = out.data, W = src.width; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const x0 = Math.min(W - 1, x * 2), y0 = Math.min(src.height - 1, y * 2), x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(src.height - 1, y0 + 1); const o = (y * w + x) * 4; for (let c = 0; c < 4; c++) d[o + c] = (s[(y0 * W + x0) * 4 + c] + s[(y0 * W + x1) * 4 + c] + s[(y1 * W + x0) * 4 + c] + s[(y1 * W + x1) * 4 + c]) / 4; } return out; }
/** Bilinear upsample to w×h (float arrays, 4 channels). */
function up(src: Float32Array, sw: number, sh: number, w: number, h: number): Float32Array { const out = new Float32Array(w * h * 4); for (let y = 0; y < h; y++) { const fy = Math.min(sh - 1, (y + 0.5) * sh / h - 0.5), y0 = Math.max(0, Math.floor(fy)), y1 = Math.min(sh - 1, y0 + 1), ty = Math.max(0, fy - y0); for (let x = 0; x < w; x++) { const fx = Math.min(sw - 1, (x + 0.5) * sw / w - 0.5), x0 = Math.max(0, Math.floor(fx)), x1 = Math.min(sw - 1, x0 + 1), tx = Math.max(0, fx - x0); const o = (y * w + x) * 4; for (let c = 0; c < 4; c++) out[o + c] = (src[(y0 * sw + x0) * 4 + c] * (1 - tx) + src[(y0 * sw + x1) * 4 + c] * tx) * (1 - ty) + (src[(y1 * sw + x0) * 4 + c] * (1 - tx) + src[(y1 * sw + x1) * 4 + c] * tx) * ty; } } return out; }
const toF = (r: Raster) => Float32Array.from(r.data);

/** Per-pixel fusion weights (contrast^wc · saturation^ws · exposedness^we), normalized across the inputs. */
export function fusionWeights(inputs: Raster[], wc = 1, ws = 1, we = 1, sigma = 0.2): Float32Array[] {
  const w = inputs[0].width, h = inputs[0].height, n = w * h;
  const weights = inputs.map((r) => {
    const out = new Float32Array(n), d = r.data, g = new Float32Array(n);
    for (let i = 0, j = 0; j < n; i += 4, j++) g[j] = lum(d[i], d[i + 1], d[i + 2]) / 255;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const j = y * w + x, i = j * 4;
      const l = x > 0 ? g[j - 1] : g[j], rr = x < w - 1 ? g[j + 1] : g[j], u = y > 0 ? g[j - w] : g[j], dn = y < h - 1 ? g[j + w] : g[j];
      const contrast = Math.abs(4 * g[j] - l - rr - u - dn) + 1e-3;
      const R = d[i] / 255, G = d[i + 1] / 255, B = d[i + 2] / 255, mean = (R + G + B) / 3, sat = Math.sqrt(((R - mean) ** 2 + (G - mean) ** 2 + (B - mean) ** 2) / 3) + 1e-3;
      const expo = Math.exp(-((R - 0.5) ** 2) / (2 * sigma * sigma)) * Math.exp(-((G - 0.5) ** 2) / (2 * sigma * sigma)) * Math.exp(-((B - 0.5) ** 2) / (2 * sigma * sigma)) + 1e-4;
      out[j] = Math.pow(contrast, wc) * Math.pow(sat, ws) * Math.pow(expo, we);
    }
    return out;
  });
  for (let j = 0; j < n; j++) { let s = 0; for (const wt of weights) s += wt[j]; for (const wt of weights) wt[j] /= s || 1; }
  return weights;
}

/** Exposure fusion of same-size pictures (dark to bright, any order); `levels` pyramid levels. */
export function exposureFusion(inputs: Raster[], opts: { contrast?: number; saturation?: number; exposedness?: number; levels?: number } = {}): Raster {
  if (inputs.length === 1) return inputs[0];
  const w = inputs[0].width, h = inputs[0].height;
  const weights = fusionWeights(inputs, opts.contrast ?? 1, opts.saturation ?? 1, opts.exposedness ?? 1);
  const levels = Math.max(1, Math.min(opts.levels ?? 6, Math.floor(Math.log2(Math.min(w, h))) - 1));
  // Gaussian pyramids of the weights (as 4-channel float arrays for the shared up/down code) and Laplacian pyramids of the inputs.
  const weightRaster = (wt: Float32Array) => { const r = makeRaster(w, h); for (let j = 0; j < wt.length; j++) { const v = wt[j] * 255; r.data[j * 4] = v; r.data[j * 4 + 1] = v; r.data[j * 4 + 2] = v; r.data[j * 4 + 3] = 255; } return r; };
  const gauss = (r: Raster) => { const g: Raster[] = [r]; for (let l = 1; l < levels; l++) g.push(down(gaussianBlur(g[l - 1], 1))); return g; };
  const blended: Float32Array[] = []; const sizes: [number, number][] = [];
  for (let k = 0; k < inputs.length; k++) {
    const G = gauss(inputs[k]), WG = gauss(weightRaster(weights[k]));
    for (let l = 0; l < levels; l++) {
      const cur = toF(G[l]); const lw = G[l].width, lh = G[l].height;
      let lap: Float32Array;
      if (l < levels - 1) { const upper = up(toF(G[l + 1]), G[l + 1].width, G[l + 1].height, lw, lh); lap = cur.map((v, i) => v - upper[i]); } else lap = cur;
      const wg = WG[l].data;
      if (!blended[l]) { blended[l] = new Float32Array(lap.length); sizes[l] = [lw, lh]; }
      const b = blended[l]; for (let i = 0; i < lap.length; i += 4) { const wt = wg[i] / 255; b[i] += lap[i] * wt; b[i + 1] += lap[i + 1] * wt; b[i + 2] += lap[i + 2] * wt; b[i + 3] = 255; }
    }
  }
  // Collapse.
  let acc = blended[levels - 1];
  for (let l = levels - 2; l >= 0; l--) { const [lw, lh] = sizes[l]; const u = up(acc, sizes[l + 1][0], sizes[l + 1][1], lw, lh); acc = blended[l].map((v, i) => v + u[i]); }
  const out = makeRaster(w, h); for (let i = 0; i < acc.length; i++) out.data[i] = i % 4 === 3 ? 255 : Math.max(0, Math.min(255, acc[i]));
  return out;
}

/** Focus stack: per pixel the input with the highest smoothed Laplacian energy; `radius` smooths the choice map. */
export function focusStack(inputs: Raster[], radius = 4): { raster: Raster; map: Uint8Array } {
  if (inputs.length === 1) return { raster: inputs[0], map: new Uint8Array(inputs[0].width * inputs[0].height) };
  const w = inputs[0].width, h = inputs[0].height, n = w * h;
  const energy = inputs.map((r) => {
    const d = r.data, g = new Float32Array(n), e = makeRaster(w, h);
    for (let i = 0, j = 0; j < n; i += 4, j++) g[j] = lum(d[i], d[i + 1], d[i + 2]);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const j = y * w + x; const l = x > 0 ? g[j - 1] : g[j], rr = x < w - 1 ? g[j + 1] : g[j], u = y > 0 ? g[j - w] : g[j], dn = y < h - 1 ? g[j + w] : g[j]; const v = Math.min(255, Math.abs(4 * g[j] - l - rr - u - dn)); e.data[j * 4] = v; e.data[j * 4 + 1] = v; e.data[j * 4 + 2] = v; e.data[j * 4 + 3] = 255; }
    return gaussianBlur(e, radius).data;
  });
  const map = new Uint8Array(n);
  for (let j = 0; j < n; j++) { let best = 0, bv = -1; for (let k = 0; k < inputs.length; k++) { const v = energy[k][j * 4]; if (v > bv) { bv = v; best = k; } } map[j] = best; }
  // Smooth the choice by majority in a window to avoid speckle, then composite.
  const r = Math.max(1, radius >> 1), sm = new Uint8Array(n), counts = new Uint16Array(inputs.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { counts.fill(0); for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const xx = Math.min(w - 1, Math.max(0, x + dx)), yy = Math.min(h - 1, Math.max(0, y + dy)); counts[map[yy * w + xx]]++; } let best = 0; for (let k = 1; k < inputs.length; k++) if (counts[k] > counts[best]) best = k; sm[y * w + x] = best; }
  const out = makeRaster(w, h);
  for (let j = 0; j < n; j++) { const src = inputs[sm[j]].data; out.data.set(src.subarray(j * 4, j * 4 + 4), j * 4); }
  return { raster: out, map: sm };
}
