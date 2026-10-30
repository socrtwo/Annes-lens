/**
 * Adjustments on rasters (no DOM): tone (brightness, contrast, gamma, exposure, levels, auto levels and
 * contrast, equalize, normalize, shadows/highlights, vignette), color (saturation, vibrance, hue,
 * balance, white balance, tint, posterize, channel mixers, faded-color restoration) and detail
 * (Gaussian and box blur, unsharp mask, despeckle, noise reduction, red-eye).
 */
import { makeRaster, type Raster } from '../codecs/raster';

const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);
const copy = (r: Raster): Raster => { const o = makeRaster(r.width, r.height); o.data.set(r.data); return o; };
const lumOf = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

/** Applies a per-channel lookup table (three 256-entry arrays). */
export function applyLut(src: Raster, lr: Uint8ClampedArray | number[], lg = lr, lb = lr): Raster {
  const out = copy(src); const d = out.data;
  for (let i = 0; i < d.length; i += 4) { d[i] = lr[d[i]]; d[i + 1] = lg[d[i + 1]]; d[i + 2] = lb[d[i + 2]]; }
  return out;
}

export interface ColorCorrection { brightness?: number; contrast?: number; gamma?: number; saturation?: number; red?: number; green?: number; blue?: number; exposure?: number }

/** IrfanView-style color corrections: brightness −255…255, contrast −127…127, gamma 0.01–6.99, saturation −255…255, channel balance −255…255, exposure in EV. */
export function colorCorrect(src: Raster, c: ColorCorrection): Raster {
  const b = c.brightness || 0, con = c.contrast || 0, g = c.gamma || 1, ev = c.exposure || 0;
  const f = (259 * (con + 255)) / (255 * (259 - con));
  const lut = (shift: number) => { const t = new Uint8ClampedArray(256); for (let i = 0; i < 256; i++) { let v = i * Math.pow(2, ev); v = f * (v - 128) + 128 + b + shift; v = 255 * Math.pow(Math.max(0, Math.min(1, v / 255)), 1 / g); t[i] = clamp(Math.round(v)); } return t; };
  let out = applyLut(src, lut(c.red || 0), lut(c.green || 0), lut(c.blue || 0));
  if (c.saturation) out = saturate(out, c.saturation / 255);
  return out;
}

/** Saturation: −1 = gray, 0 = unchanged, +1 = doubled. */
export function saturate(src: Raster, amount: number): Raster {
  const out = copy(src); const d = out.data; const k = 1 + amount;
  for (let i = 0; i < d.length; i += 4) { const l = lumOf(d[i], d[i + 1], d[i + 2]); d[i] = clamp(l + (d[i] - l) * k); d[i + 1] = clamp(l + (d[i + 1] - l) * k); d[i + 2] = clamp(l + (d[i + 2] - l) * k); }
  return out;
}

/** Vibrance: boosts the less saturated colors more; skin tones (orange hues) are protected. */
export function vibrance(src: Raster, amount: number): Raster {
  const out = copy(src); const d = out.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx ? (mx - mn) / mx : 0;
    const skin = r > g && g > b && r - b < 120 && r - b > 20 ? 0.4 : 1;
    const k = 1 + amount * (1 - sat) * skin;
    const l = lumOf(r, g, b);
    d[i] = clamp(l + (r - l) * k); d[i + 1] = clamp(l + (g - l) * k); d[i + 2] = clamp(l + (b - l) * k);
  }
  return out;
}

export function levels(src: Raster, o: { inBlack?: number; inWhite?: number; gamma?: number; outBlack?: number; outWhite?: number; channel?: 'all' | 'r' | 'g' | 'b' }): Raster {
  const ib = o.inBlack ?? 0, iw = o.inWhite ?? 255, g = o.gamma ?? 1, ob = o.outBlack ?? 0, ow = o.outWhite ?? 255;
  const t = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) { let v = (i - ib) / Math.max(1, iw - ib); v = Math.pow(Math.max(0, Math.min(1, v)), 1 / g); t[i] = clamp(Math.round(ob + v * (ow - ob))); }
  const id = new Uint8ClampedArray(256); for (let i = 0; i < 256; i++) id[i] = i;
  const ch = o.channel || 'all';
  return applyLut(src, ch === 'all' || ch === 'r' ? t : id, ch === 'all' || ch === 'g' ? t : id, ch === 'all' || ch === 'b' ? t : id);
}

function percentiles(src: Raster, lo: number, hi: number, channel: 0 | 1 | 2 | 3): [number, number] {
  const hist = new Uint32Array(256); let n = 0;
  for (let i = 0; i < src.data.length; i += 4) { if (src.data[i + 3] < 128) continue; hist[channel === 3 ? Math.round(lumOf(src.data[i], src.data[i + 1], src.data[i + 2])) : src.data[i + channel]]++; n++; }
  let acc = 0, a = 0, b = 255;
  for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= n * lo) { a = i; break; } }
  acc = 0;
  for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc >= n * (1 - hi)) { b = i; break; } }
  return [a, Math.max(a + 1, b)];
}

/** Stretches each channel so its 0.5% and 99.5% percentiles reach black and white. */
export function autoLevels(src: Raster, clip = 0.005): Raster {
  const luts = [0, 1, 2].map((c) => { const [a, b] = percentiles(src, clip, 1 - clip, c as 0 | 1 | 2); const t = new Uint8ClampedArray(256); for (let i = 0; i < 256; i++) t[i] = clamp(Math.round(((i - a) * 255) / (b - a))); return t; });
  return applyLut(src, luts[0], luts[1], luts[2]);
}

/** Stretches luminance only (colors keep their balance). */
export function autoContrast(src: Raster, clip = 0.005): Raster {
  const [a, b] = percentiles(src, clip, 1 - clip, 3);
  const t = new Uint8ClampedArray(256); for (let i = 0; i < 256; i++) t[i] = clamp(Math.round(((i - a) * 255) / (b - a)));
  return applyLut(src, t);
}

/** Gray-world white balance: scales channels so their means match. */
export function autoColor(src: Raster, strength = 1): Raster {
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < src.data.length; i += 4) { if (src.data[i + 3] < 128) continue; r += src.data[i]; g += src.data[i + 1]; b += src.data[i + 2]; n++; }
  if (!n) return copy(src);
  const mean = (r + g + b) / (3 * n);
  const k = [mean / (r / n || 1), mean / (g / n || 1), mean / (b / n || 1)].map((v) => 1 + (v - 1) * strength);
  const t = (f: number) => { const l = new Uint8ClampedArray(256); for (let i = 0; i < 256; i++) l[i] = clamp(Math.round(i * f)); return l; };
  return applyLut(src, t(k[0]), t(k[1]), t(k[2]));
}

/** White balance by temperature (−100 cool … +100 warm) and tint (−100 green … +100 magenta), or from a neutral reference color. */
export function whiteBalance(src: Raster, o: { temperature?: number; tint?: number; neutral?: [number, number, number] }): Raster {
  let kr = 1, kg = 1, kb = 1;
  if (o.neutral) { const m = (o.neutral[0] + o.neutral[1] + o.neutral[2]) / 3; kr = m / (o.neutral[0] || 1); kg = m / (o.neutral[1] || 1); kb = m / (o.neutral[2] || 1); }
  const t = (o.temperature || 0) / 100, ti = (o.tint || 0) / 100;
  kr *= 1 + 0.3 * t; kb *= 1 - 0.3 * t; kg *= 1 - 0.2 * ti;
  const lut = (f: number) => { const l = new Uint8ClampedArray(256); for (let i = 0; i < 256; i++) l[i] = clamp(Math.round(i * f)); return l; };
  return applyLut(src, lut(kr), lut(kg), lut(kb));
}

/** Histogram equalization of luminance (colors scaled with it). */
export function equalize(src: Raster): Raster {
  const hist = new Uint32Array(256); let n = 0;
  for (let i = 0; i < src.data.length; i += 4) { hist[Math.round(lumOf(src.data[i], src.data[i + 1], src.data[i + 2]))]++; n++; }
  const cdf = new Float32Array(256); let acc = 0; for (let i = 0; i < 256; i++) { acc += hist[i]; cdf[i] = acc / n; }
  const out = copy(src); const d = out.data;
  for (let i = 0; i < d.length; i += 4) { const l = Math.round(lumOf(d[i], d[i + 1], d[i + 2])); const k = l ? (255 * cdf[l]) / l : 1; d[i] = clamp(d[i] * k); d[i + 1] = clamp(d[i + 1] * k); d[i + 2] = clamp(d[i + 2] * k); }
  return out;
}

export function hsl(src: Raster, o: { hue?: number; saturation?: number; lightness?: number }): Raster {
  const out = copy(src); const d = out.data;
  const hs = (o.hue || 0) / 360, ss = (o.saturation || 0) / 100, ls = (o.lightness || 0) / 100;
  for (let i = 0; i < d.length; i += 4) {
    let [h, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
    h = (h + hs + 1) % 1; s = Math.max(0, Math.min(1, s * (1 + ss))); l = ls >= 0 ? l + (1 - l) * ls : l * (1 + ls);
    const [r, g, b] = hslToRgb(h, s, l); d[i] = r; d[i + 1] = g; d[i + 2] = b;
  }
  return out;
}
export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const dd = mx - mn, s = l > 0.5 ? dd / (2 - mx - mn) : dd / (mx + mn);
  const h = mx === r ? ((g - b) / dd + (g < b ? 6 : 0)) / 6 : mx === g ? ((b - r) / dd + 2) / 6 : ((r - g) / dd + 4) / 6;
  return [h, s, l];
}
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (!s) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t: number) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [Math.round(f(h + 1 / 3) * 255), Math.round(f(h) * 255), Math.round(f(h - 1 / 3) * 255)];
}

/** Tint: blends toward a color by luminance (sepia with [112, 66, 20] at strength 1). */
export function tint(src: Raster, color: [number, number, number], strength: number): Raster {
  const out = copy(src); const d = out.data;
  for (let i = 0; i < d.length; i += 4) { const l = lumOf(d[i], d[i + 1], d[i + 2]) / 255; const tr = color[0] * l * 2, tg = color[1] * l * 2, tb = color[2] * l * 2; d[i] = clamp(d[i] * (1 - strength) + Math.min(255, tr) * strength); d[i + 1] = clamp(d[i + 1] * (1 - strength) + Math.min(255, tg) * strength); d[i + 2] = clamp(d[i + 2] * (1 - strength) + Math.min(255, tb) * strength); }
  return out;
}

export function posterize(src: Raster, levelsPerChannel: number): Raster {
  const n = Math.max(2, Math.min(256, Math.round(levelsPerChannel)));
  const t = new Uint8ClampedArray(256); for (let i = 0; i < 256; i++) t[i] = Math.round(Math.round((i / 255) * (n - 1)) * (255 / (n - 1)));
  return applyLut(src, t);
}

/** Color balance: shifts per tonal range (values −100…100 per channel for shadows, midtones, highlights). */
export function colorBalance(src: Raster, o: { shadows?: [number, number, number]; midtones?: [number, number, number]; highlights?: [number, number, number] }): Raster {
  const out = copy(src); const d = out.data;
  const s = o.shadows || [0, 0, 0], m = o.midtones || [0, 0, 0], hh = o.highlights || [0, 0, 0];
  for (let i = 0; i < d.length; i += 4) {
    const l = lumOf(d[i], d[i + 1], d[i + 2]) / 255;
    const ws = Math.max(0, 1 - l * 2), wh = Math.max(0, l * 2 - 1), wm = 1 - ws - wh;
    for (let c = 0; c < 3; c++) d[i + c] = clamp(d[i + c] + (s[c] * ws + m[c] * wm + hh[c] * wh) * 1.28);
  }
  return out;
}

/** Channel mixer: each output channel as a weighted sum of the inputs (percent). `mono` sends the red row to all three. */
export function channelMixer(src: Raster, rows: [number, number, number][], mono = false): Raster {
  const out = copy(src); const d = out.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const v = rows.map((w) => clamp((w[0] * r + w[1] * g + w[2] * b) / 100));
    if (mono) d[i] = d[i + 1] = d[i + 2] = v[0]; else { d[i] = v[0]; d[i + 1] = v[1]; d[i + 2] = v[2]; }
  }
  return out;
}

/** Faded prints and slides: each channel stretched to full range (dye fade is mostly a per-channel loss), then a mild gray-world correction. */
export function restoreFaded(src: Raster): Raster { return autoColor(autoLevels(src, 0.002), 0.6); }

/** Separable Gaussian blur. */
export function gaussianBlur(src: Raster, radius: number): Raster {
  const sigma = Math.max(0.1, radius / 2);
  const size = Math.max(1, Math.ceil(sigma * 3));
  const k = new Float32Array(size * 2 + 1); let sum = 0;
  for (let i = -size; i <= size; i++) { k[i + size] = Math.exp(-(i * i) / (2 * sigma * sigma)); sum += k[i + size]; }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  return convolve1d(convolve1d(src, k, true), k, false);
}
export function boxBlur(src: Raster, radius: number): Raster {
  const size = Math.max(1, Math.round(radius));
  const k = new Float32Array(size * 2 + 1).fill(1 / (size * 2 + 1));
  return convolve1d(convolve1d(src, k, true), k, false);
}
function convolve1d(src: Raster, k: Float32Array, horizontal: boolean): Raster {
  const w = src.width, h = src.height, half = (k.length - 1) / 2;
  const out = makeRaster(w, h); const s = src.data, d = out.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let i = -half; i <= half; i++) {
      const xx = horizontal ? Math.min(w - 1, Math.max(0, x + i)) : x, yy = horizontal ? y : Math.min(h - 1, Math.max(0, y + i));
      const o = (yy * w + xx) * 4, wt = k[i + half];
      r += s[o] * wt; g += s[o + 1] * wt; b += s[o + 2] * wt; a += s[o + 3] * wt;
    }
    const o = (y * w + x) * 4; d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = a;
  }
  return out;
}

/** Unsharp mask: amount in percent, radius in pixels, threshold 0–255. */
export function unsharpMask(src: Raster, amount: number, radius: number, threshold = 0): Raster {
  const blurred = gaussianBlur(src, radius);
  const out = copy(src); const d = out.data, s = src.data, bl = blurred.data, k = amount / 100;
  for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) { const diff = s[i + c] - bl[i + c]; if (Math.abs(diff) >= threshold) d[i + c] = clamp(s[i + c] + diff * k); }
  return out;
}
export const sharpen = (src: Raster, strength = 1): Raster => unsharpMask(src, 60 * strength, 1, 2);

/** 3×3 median of each channel (speckles and salt-and-pepper noise). */
export function despeckle(src: Raster, radius = 1): Raster {
  const w = src.width, h = src.height, out = makeRaster(w, h), s = src.data, d = out.data;
  const win: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4;
    for (let c = 0; c < 3; c++) {
      win.length = 0;
      for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) { const xx = Math.min(w - 1, Math.max(0, x + dx)), yy = Math.min(h - 1, Math.max(0, y + dy)); win.push(s[(yy * w + xx) * 4 + c]); }
      win.sort((p, q) => p - q);
      d[o + c] = win[win.length >> 1];
    }
    d[o + 3] = s[o + 3];
  }
  return out;
}

/** Noise reduction: a bilateral filter (spatial radius, range strength 0–100). */
export function denoise(src: Raster, radius = 2, strength = 30): Raster {
  const w = src.width, h = src.height, out = makeRaster(w, h), s = src.data, d = out.data;
  const sr = Math.max(1, strength) * 1.5, sw = new Float32Array(2 * radius + 1); for (let i = -radius; i <= radius; i++) sw[i + radius] = Math.exp(-(i * i) / (2 * radius * radius));
  const rw = new Float32Array(256); for (let i = 0; i < 256; i++) rw[i] = Math.exp(-(i * i) / (2 * sr * sr));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4;
    for (let c = 0; c < 3; c++) {
      let sum = 0, wsum = 0; const v = s[o + c];
      for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) { const xx = Math.min(w - 1, Math.max(0, x + dx)), yy = Math.min(h - 1, Math.max(0, y + dy)); const u = s[(yy * w + xx) * 4 + c]; const wt = sw[dx + radius] * sw[dy + radius] * rw[Math.abs(u - v)]; sum += u * wt; wsum += wt; }
      d[o + c] = clamp(Math.round(sum / wsum));
    }
    d[o + 3] = s[o + 3];
  }
  return out;
}

/** Red-eye: pixels whose red clearly dominates get their red pulled down to the green/blue level. */
export function redEye(src: Raster, strength = 1): Raster {
  const out = copy(src); const d = out.data;
  for (let i = 0; i < d.length; i += 4) { const r = d[i], g = d[i + 1], b = d[i + 2]; if (r > 60 && r > 1.5 * Math.max(g, b)) { const t = Math.round((g + b) / 2); d[i] = clamp(r + (t - r) * strength); } }
  return out;
}

/** Shadows and highlights: lifts dark areas and tames bright ones by a blurred luminance mask (amounts 0–100). */
export function shadowsHighlights(src: Raster, shadows: number, highlights: number, radius = 20): Raster {
  const mask = gaussianBlur(src, radius);
  const out = copy(src); const d = out.data, m = mask.data;
  const sa = shadows / 100, ha = highlights / 100;
  for (let i = 0; i < d.length; i += 4) {
    const l = lumOf(m[i], m[i + 1], m[i + 2]) / 255;
    const k = 1 + sa * (1 - l) * (1 - l) * 1.5 - ha * l * l * 0.6;
    d[i] = clamp(d[i] * k); d[i + 1] = clamp(d[i + 1] * k); d[i + 2] = clamp(d[i + 2] * k);
  }
  return out;
}

export function vignette(src: Raster, amount: number, radius = 0.75, color: [number, number, number] = [0, 0, 0]): Raster {
  const out = copy(src); const d = out.data; const w = src.width, h = src.height, cx = w / 2, cy = h / 2, rr = Math.hypot(cx, cy);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dist = Math.hypot(x - cx, y - cy) / rr;
    const t = Math.max(0, Math.min(1, (dist - radius) / (1 - radius + 0.001))) * (amount / 100);
    const o = (y * w + x) * 4; d[o] = clamp(d[o] * (1 - t) + color[0] * t); d[o + 1] = clamp(d[o + 1] * (1 - t) + color[1] * t); d[o + 2] = clamp(d[o + 2] * (1 - t) + color[2] * t);
  }
  return out;
}

/** Dehaze: a dark-channel-prior approximation with a global atmospheric light. */
export function dehaze(src: Raster, amount: number): Raster {
  const w = src.width, h = src.height, s = src.data;
  const dark = makeRaster(w, h);
  for (let i = 0; i < s.length; i += 4) { const v = Math.min(s[i], s[i + 1], s[i + 2]); dark.data[i] = dark.data[i + 1] = dark.data[i + 2] = v; dark.data[i + 3] = 255; }
  const dc = boxBlur(dark, 7);
  let air = 0; for (let i = 0; i < dc.data.length; i += 4) if (dc.data[i] > air) air = dc.data[i];
  air = Math.max(air, 200);
  const out = copy(src); const d = out.data, k = amount / 100;
  for (let i = 0; i < d.length; i += 4) { const t = Math.max(0.1, 1 - k * 0.95 * (dc.data[i] / air)); for (let c = 0; c < 3; c++) d[i + c] = clamp((s[i + c] - air) / t + air); }
  return out;
}

/** Clarity: local contrast in the midtones (unsharp mask with a large radius, protected extremes). */
export function clarity(src: Raster, amount: number): Raster {
  const blurred = gaussianBlur(src, 12);
  const out = copy(src); const d = out.data, s = src.data, bl = blurred.data, k = amount / 100;
  for (let i = 0; i < d.length; i += 4) { const l = lumOf(s[i], s[i + 1], s[i + 2]) / 255; const prot = 1 - Math.pow(Math.abs(l - 0.5) * 2, 2); for (let c = 0; c < 3; c++) d[i + c] = clamp(s[i + c] + (s[i + c] - bl[i + c]) * k * prot); }
  return out;
}

/** Auto-adjust: levels, a touch of saturation; One-Click Enhance adds gentle sharpening. */
export const autoAdjust = (src: Raster): Raster => saturate(autoLevels(src), 0.1);
export const enhance = (src: Raster): Raster => unsharpMask(saturate(autoLevels(src), 0.12), 40, 1, 2);
