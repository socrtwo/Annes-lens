/**
 * Pixel operations on rasters (RGBA bytes), independent of the DOM so they can be tested: resampling
 * with the common kernels, crop and canvas size, grayscale, negative, thresholds (fixed and Otsu),
 * color reduction with dithering, channel swaps and views, flattening, transparent and replaced colors,
 * and border detection for Auto Crop.
 */
import { makeRaster, type Raster } from '../codecs/raster';
import { medianCut, mapToPalette, type Palette } from '../codecs/palette';

export interface Rect { x: number; y: number; w: number; h: number }

export function clampRect(r: Rect, w: number, h: number): Rect | null {
  const x = Math.max(0, Math.min(w, Math.round(r.x))), y = Math.max(0, Math.min(h, Math.round(r.y)));
  const x2 = Math.max(0, Math.min(w, Math.round(r.x + r.w))), y2 = Math.max(0, Math.min(h, Math.round(r.y + r.h)));
  return x2 > x && y2 > y ? { x, y, w: x2 - x, h: y2 - y } : null;
}

export function crop(src: Raster, r: Rect): Raster {
  const out = makeRaster(r.w, r.h);
  for (let y = 0; y < r.h; y++) out.data.set(src.data.subarray(((r.y + y) * src.width + r.x) * 4, ((r.y + y) * src.width + r.x + r.w) * 4), y * r.w * 4);
  return out;
}

/** A new canvas of w × h with the source placed at (ox, oy) over the background (RGBA). */
export function canvasSize(src: Raster, w: number, h: number, ox: number, oy: number, bg: [number, number, number, number]): Raster {
  const out = makeRaster(w, h);
  const d = out.data;
  for (let i = 0; i < d.length; i += 4) { d[i] = bg[0]; d[i + 1] = bg[1]; d[i + 2] = bg[2]; d[i + 3] = bg[3]; }
  const x0 = Math.max(0, ox), y0 = Math.max(0, oy), x1 = Math.min(w, ox + src.width), y1 = Math.min(h, oy + src.height);
  for (let y = y0; y < y1; y++) d.set(src.data.subarray(((y - oy) * src.width + (x0 - ox)) * 4, ((y - oy) * src.width + (x1 - ox)) * 4), (y * w + x0) * 4);
  return out;
}

// ------------------------------------------------------------------------------------------
// Resampling

export type Kernel = 'nearest' | 'bilinear' | 'bicubic' | 'mitchell' | 'catmullrom' | 'lanczos2' | 'lanczos3' | 'bspline' | 'box';

const sinc = (x: number) => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));
function cubic(b: number, c: number): (x: number) => number {
  return (x) => {
    x = Math.abs(x);
    if (x < 1) return ((12 - 9 * b - 6 * c) * x * x * x + (-18 + 12 * b + 6 * c) * x * x + (6 - 2 * b)) / 6;
    if (x < 2) return ((-b - 6 * c) * x * x * x + (6 * b + 30 * c) * x * x + (-12 * b - 48 * c) * x + (8 * b + 24 * c)) / 6;
    return 0;
  };
}
export const KERNELS: Record<Kernel, { label: string; radius: number; f: (x: number) => number }> = {
  nearest: { label: 'Nearest neighbor (pixel art, exact)', radius: 0.5, f: (x) => (Math.abs(x) <= 0.5 ? 1 : 0) },
  box: { label: 'Box (average)', radius: 0.5, f: (x) => (Math.abs(x) <= 0.5 ? 1 : 0) },
  bilinear: { label: 'Bilinear (triangle)', radius: 1, f: (x) => Math.max(0, 1 - Math.abs(x)) },
  bicubic: { label: 'Bicubic (Keys, a = −0.5)', radius: 2, f: cubic(0, 0.5) },
  mitchell: { label: 'Mitchell–Netravali', radius: 2, f: cubic(1 / 3, 1 / 3) },
  catmullrom: { label: 'Catmull-Rom', radius: 2, f: cubic(0, 0.5) },
  bspline: { label: 'B-spline (soft)', radius: 2, f: cubic(1, 0) },
  lanczos2: { label: 'Lanczos 2', radius: 2, f: (x) => (Math.abs(x) < 2 ? sinc(x) * sinc(x / 2) : 0) },
  lanczos3: { label: 'Lanczos 3 (sharp)', radius: 3, f: (x) => (Math.abs(x) < 3 ? sinc(x) * sinc(x / 3) : 0) },
};

/** Separable resampling; when shrinking, the kernel is widened by the scale factor (proper antialiasing). Optionally in linear light. */
export function resample(src: Raster, dw: number, dh: number, kernel: Kernel = 'lanczos3', linear = false): Raster {
  dw = Math.max(1, Math.round(dw)); dh = Math.max(1, Math.round(dh));
  const k = KERNELS[kernel];
  const toLin = new Float32Array(256), fromLin = (v: number) => { v = Math.max(0, Math.min(1, v)); return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055; };
  for (let i = 0; i < 256; i++) { const s = i / 255; toLin[i] = s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); }
  const pass = (input: Float32Array, iw: number, ih: number, ow: number, horizontal: boolean): Float32Array => {
    const scale = horizontal ? ow / iw : ow / ih;
    const support = kernel === 'nearest' ? 0.5 : scale < 1 ? k.radius / scale : k.radius;
    const n = horizontal ? iw : ih, m = ow;
    const weights: { start: number; w: Float32Array }[] = [];
    for (let o = 0; o < m; o++) {
      const center = (o + 0.5) / scale - 0.5;
      const start = Math.max(0, Math.floor(center - support)), end = Math.min(n - 1, Math.ceil(center + support));
      const w = new Float32Array(end - start + 1);
      let sum = 0;
      for (let i = start; i <= end; i++) { const x = (i - center) * (scale < 1 && kernel !== 'nearest' ? scale : 1); const v = kernel === 'nearest' ? (i === Math.min(n - 1, Math.max(0, Math.round(center))) ? 1 : 0) : k.f(x); w[i - start] = v; sum += v; }
      if (sum) for (let i = 0; i < w.length; i++) w[i] /= sum;
      weights.push({ start, w });
    }
    const outW = horizontal ? ow : iw, outH = horizontal ? ih : ow;
    const out = new Float32Array(outW * outH * 4);
    for (let y = 0; y < outH; y++) for (let x = 0; x < outW; x++) {
      const { start, w } = weights[horizontal ? x : y];
      let r = 0, g = 0, b = 0, a = 0;
      for (let i = 0; i < w.length; i++) {
        const wi = w[i]; if (!wi) continue;
        const si = horizontal ? (y * iw + start + i) * 4 : ((start + i) * iw + x) * 4;
        const al = input[si + 3] * wi;
        r += input[si] * al; g += input[si + 1] * al; b += input[si + 2] * al; a += al;
      }
      const o = (y * outW + x) * 4;
      if (a > 1e-6) { out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a; } out[o + 3] = a;
    }
    return out;
  };
  const sw = src.width, sh = src.height;
  const f = new Float32Array(sw * sh * 4);
  for (let i = 0; i < f.length; i += 4) { f[i] = linear ? toLin[src.data[i]] : src.data[i] / 255; f[i + 1] = linear ? toLin[src.data[i + 1]] : src.data[i + 1] / 255; f[i + 2] = linear ? toLin[src.data[i + 2]] : src.data[i + 2] / 255; f[i + 3] = src.data[i + 3] / 255; }
  const h1 = pass(f, sw, sh, dw, true);
  const v1 = pass(h1, dw, sh, dh, false);
  const out = makeRaster(dw, dh);
  for (let i = 0; i < out.data.length; i += 4) {
    out.data[i] = Math.round(255 * (linear ? fromLin(v1[i]) : Math.max(0, Math.min(1, v1[i]))));
    out.data[i + 1] = Math.round(255 * (linear ? fromLin(v1[i + 1]) : Math.max(0, Math.min(1, v1[i + 1]))));
    out.data[i + 2] = Math.round(255 * (linear ? fromLin(v1[i + 2]) : Math.max(0, Math.min(1, v1[i + 2]))));
    out.data[i + 3] = Math.round(255 * Math.max(0, Math.min(1, v1[i + 3])));
  }
  return out;
}

// ------------------------------------------------------------------------------------------
// Color

const lum = (r: number, g: number, b: number) => Math.round(0.299 * r + 0.587 * g + 0.114 * b);

export function grayscale(src: Raster): Raster {
  const out = makeRaster(src.width, src.height); out.data.set(src.data);
  const d = out.data;
  for (let i = 0; i < d.length; i += 4) { const l = lum(d[i], d[i + 1], d[i + 2]); d[i] = d[i + 1] = d[i + 2] = l; }
  return out;
}

export function negative(src: Raster, channels: [boolean, boolean, boolean] = [true, true, true]): Raster {
  const out = makeRaster(src.width, src.height); out.data.set(src.data);
  const d = out.data;
  for (let i = 0; i < d.length; i += 4) { if (channels[0]) d[i] = 255 - d[i]; if (channels[1]) d[i + 1] = 255 - d[i + 1]; if (channels[2]) d[i + 2] = 255 - d[i + 2]; }
  return out;
}

/** Otsu's threshold on the luminance histogram: the last luminance that still counts as background (pixels above it are white). */
export function otsu(src: Raster): number {
  const hist = new Uint32Array(256);
  let n = 0;
  for (let i = 0; i < src.data.length; i += 4) { if (src.data[i + 3] < 128) continue; hist[lum(src.data[i], src.data[i + 1], src.data[i + 2])]++; n++; }
  let sum = 0; for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, best = 0, bestT = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue;
    const wF = n - wB; if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > best) { best = v; bestT = t; }
  }
  return bestT;
}

export function threshold(src: Raster, t: number): Raster {
  const out = makeRaster(src.width, src.height); out.data.set(src.data);
  const d = out.data;
  for (let i = 0; i < d.length; i += 4) { const v = lum(d[i], d[i + 1], d[i + 2]) > t ? 255 : 0; d[i] = d[i + 1] = d[i + 2] = v; }
  return out;
}

/** Adaptive threshold: each pixel against the mean of its (2r+1)² neighborhood minus an offset. */
export function adaptiveThreshold(src: Raster, radius = 15, offset = 8): Raster {
  const w = src.width, h = src.height;
  const L = new Uint8Array(w * h);
  for (let i = 0, o = 0; i < src.data.length; i += 4, o++) L[o] = lum(src.data[i], src.data[i + 1], src.data[i + 2]);
  // Integral image.
  const S = new Float64Array((w + 1) * (h + 1));
  for (let y = 1; y <= h; y++) { let row = 0; for (let x = 1; x <= w; x++) { row += L[(y - 1) * w + x - 1]; S[y * (w + 1) + x] = S[(y - 1) * (w + 1) + x] + row; } }
  const out = makeRaster(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = Math.max(0, x - radius), y0 = Math.max(0, y - radius), x1 = Math.min(w, x + radius + 1), y1 = Math.min(h, y + radius + 1);
    const mean = (S[y1 * (w + 1) + x1] - S[y0 * (w + 1) + x1] - S[y1 * (w + 1) + x0] + S[y0 * (w + 1) + x0]) / ((x1 - x0) * (y1 - y0));
    const v = L[y * w + x] >= mean - offset ? 255 : 0;
    const o = (y * w + x) * 4; out.data[o] = out.data[o + 1] = out.data[o + 2] = v; out.data[o + 3] = src.data[o + 3];
  }
  return out;
}

export type Dither = 'none' | 'floyd' | 'atkinson' | 'ordered';
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** Reduces to a palette (given, or median cut of `colors` entries) with the chosen dithering. Alpha is kept. */
export function reduceColors(src: Raster, colors: number, dither: Dither = 'floyd', palette?: Palette): { raster: Raster; palette: Palette } {
  const pal = palette || medianCut(src.data, colors);
  const w = src.width, h = src.height;
  const out = makeRaster(w, h);
  const cols = pal.colors;
  const nearest = (r: number, g: number, b: number) => { let best = 0, bd = Infinity; for (let k = 0; k < cols.length; k++) { const dr = cols[k][0] - r, dg = cols[k][1] - g, db = cols[k][2] - b; const d = dr * dr * 2 + dg * dg * 4 + db * db * 3; if (d < bd) { bd = d; best = k; } } return cols[best]; };
  if (dither === 'none') {
    const idx = mapToPalette(src.data, pal);
    for (let i = 0, o = 0; i < src.data.length; i += 4, o++) { const c = cols[idx[o]] || [0, 0, 0]; out.data[i] = c[0]; out.data[i + 1] = c[1]; out.data[i + 2] = c[2]; out.data[i + 3] = src.data[i + 3]; }
    return { raster: out, palette: pal };
  }
  if (dither === 'ordered') {
    const amp = Math.max(4, 128 / Math.max(2, Math.cbrt(cols.length)));
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, t = (BAYER[(y & 3) * 4 + (x & 3)] / 16 - 0.5) * amp;
      const c = nearest(src.data[i] + t, src.data[i + 1] + t, src.data[i + 2] + t);
      out.data[i] = c[0]; out.data[i + 1] = c[1]; out.data[i + 2] = c[2]; out.data[i + 3] = src.data[i + 3];
    }
    return { raster: out, palette: pal };
  }
  // Error diffusion (Floyd–Steinberg or Atkinson).
  const err = new Float32Array(w * h * 3);
  const spread = (x: number, y: number, er: number, eg: number, eb: number, f: number) => { if (x < 0 || x >= w || y >= h) return; const o = (y * w + x) * 3; err[o] += er * f; err[o + 1] += eg * f; err[o + 2] += eb * f; };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, e = (y * w + x) * 3;
    const r = src.data[i] + err[e], g = src.data[i + 1] + err[e + 1], b = src.data[i + 2] + err[e + 2];
    const c = nearest(r, g, b);
    out.data[i] = c[0]; out.data[i + 1] = c[1]; out.data[i + 2] = c[2]; out.data[i + 3] = src.data[i + 3];
    const er = r - c[0], eg = g - c[1], eb = b - c[2];
    if (dither === 'floyd') { spread(x + 1, y, er, eg, eb, 7 / 16); spread(x - 1, y + 1, er, eg, eb, 3 / 16); spread(x, y + 1, er, eg, eb, 5 / 16); spread(x + 1, y + 1, er, eg, eb, 1 / 16); }
    else { const f = 1 / 8; spread(x + 1, y, er, eg, eb, f); spread(x + 2, y, er, eg, eb, f); spread(x - 1, y + 1, er, eg, eb, f); spread(x, y + 1, er, eg, eb, f); spread(x + 1, y + 1, er, eg, eb, f); spread(x, y + 2, er, eg, eb, f); }
  }
  return { raster: out, palette: pal };
}

export type ChannelOrder = 'rgb' | 'bgr' | 'rbg' | 'grb' | 'gbr' | 'brg';
export function swapChannels(src: Raster, order: ChannelOrder): Raster {
  const idx = { r: 0, g: 1, b: 2 } as const;
  const map = [...order].map((c) => idx[c as 'r' | 'g' | 'b']);
  const out = makeRaster(src.width, src.height);
  const d = out.data, s = src.data;
  for (let i = 0; i < d.length; i += 4) { d[i] = s[i + map[0]]; d[i + 1] = s[i + map[1]]; d[i + 2] = s[i + map[2]]; d[i + 3] = s[i + 3]; }
  return out;
}

export type Channel = 'red' | 'green' | 'blue' | 'alpha' | 'luminance';
export function showChannel(src: Raster, ch: Channel): Raster {
  const out = makeRaster(src.width, src.height);
  const d = out.data, s = src.data;
  for (let i = 0; i < d.length; i += 4) { const v = ch === 'red' ? s[i] : ch === 'green' ? s[i + 1] : ch === 'blue' ? s[i + 2] : ch === 'alpha' ? s[i + 3] : lum(s[i], s[i + 1], s[i + 2]); d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
  return out;
}

export function flatten(src: Raster, bg: [number, number, number]): Raster {
  const out = makeRaster(src.width, src.height);
  const d = out.data, s = src.data;
  for (let i = 0; i < d.length; i += 4) { const a = s[i + 3] / 255; d[i] = Math.round(s[i] * a + bg[0] * (1 - a)); d[i + 1] = Math.round(s[i + 1] * a + bg[1] * (1 - a)); d[i + 2] = Math.round(s[i + 2] * a + bg[2] * (1 - a)); d[i + 3] = 255; }
  return out;
}

/** Pixels within `tolerance` (0–255, per channel max difference) of the color become transparent (or `to` when given). */
export function replaceColor(src: Raster, from: [number, number, number], tolerance: number, to: [number, number, number, number] | null): Raster {
  const out = makeRaster(src.width, src.height); out.data.set(src.data);
  const d = out.data;
  for (let i = 0; i < d.length; i += 4) {
    if (Math.abs(d[i] - from[0]) <= tolerance && Math.abs(d[i + 1] - from[1]) <= tolerance && Math.abs(d[i + 2] - from[2]) <= tolerance) {
      if (to) { d[i] = to[0]; d[i + 1] = to[1]; d[i + 2] = to[2]; d[i + 3] = to[3]; } else d[i + 3] = 0;
    }
  }
  return out;
}

/** The rectangle that remains after trimming borders of (nearly) one color; null when nothing would be trimmed. */
export function autoCropRect(src: Raster, tolerance = 16): Rect | null {
  const w = src.width, h = src.height, d = src.data;
  const ref = [d[0], d[1], d[2], d[3]];
  const same = (i: number) => (ref[3] < 128 && d[i + 3] < 128) || (Math.abs(d[i] - ref[0]) <= tolerance && Math.abs(d[i + 1] - ref[1]) <= tolerance && Math.abs(d[i + 2] - ref[2]) <= tolerance && Math.abs(d[i + 3] - ref[3]) <= tolerance);
  const rowUniform = (y: number) => { for (let x = 0; x < w; x++) if (!same((y * w + x) * 4)) return false; return true; };
  const colUniform = (x: number, y0: number, y1: number) => { for (let y = y0; y < y1; y++) if (!same((y * w + x) * 4)) return false; return true; };
  let top = 0, bottom = h, left = 0, right = w;
  while (top < bottom && rowUniform(top)) top++;
  if (top === bottom) return null;
  while (bottom > top && rowUniform(bottom - 1)) bottom--;
  while (left < right && colUniform(left, top, bottom)) left++;
  while (right > left && colUniform(right - 1, top, bottom)) right--;
  if (top === 0 && left === 0 && bottom === h && right === w) return null;
  return { x: left, y: top, w: right - left, h: bottom - top };
}

export const hexToRgb = (hex: string): [number, number, number] => { const m = String(hex).match(/^#?([0-9a-f]{6})$/i); const v = m ? parseInt(m[1], 16) : 0xffffff; return [v >> 16, (v >> 8) & 255, v & 255]; };
