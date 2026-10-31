/**
 * Paint tools: the pixel operations behind each tool, on plain RGBA buffers so they are testable
 * without a canvas. A "dab" is one stamp of a round brush; strokes are dabs spaced along the path.
 * Tools that read the picture (clone, heal, red-eye, color replacer) read from the stroke's starting
 * pixels and touch each pixel once per stroke (a coverage map), so going over a spot twice does not
 * smear or compound the effect.
 */
import type { Raster } from '../codecs/raster';
import { wandMask } from '../picture/mask';

export type RGBA = [number, number, number, number];
export type Pt = [number, number];

/** Brush falloff: 1 inside the hard core, easing to 0 at the edge. `hardness` 0..1. */
export function dabAlpha(d: number, radius: number, hardness: number): number {
  if (d >= radius) return 0;
  const core = radius * Math.max(0, Math.min(1, hardness));
  if (d <= core) return 1;
  const t = (d - core) / Math.max(1e-6, radius - core);
  return 0.5 * (1 + Math.cos(Math.PI * t));
}

/** Dab centers along a path, at most `spacing` apart (always including the first point). */
export function dabsAlong(pts: Pt[], spacing: number): Pt[] {
  if (!pts.length) return [];
  const out: Pt[] = [pts[0]]; let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; const len = Math.hypot(x1 - x0, y1 - y0);
    if (!len) continue;
    let t = spacing - carry;
    while (t <= len) { out.push([x0 + (x1 - x0) * (t / len), y0 + (y1 - y0) * (t / len)]); t += spacing; }
    carry = len - (t - spacing);
  }
  return out;
}

/** Iterates the pixels a dab covers, inside the raster and the optional clip rectangle. */
function forDab(r: Raster, cx: number, cy: number, radius: number, hardness: number, clip: { x: number; y: number; w: number; h: number } | null, fn: (i: number, a: number) => void): void {
  const x0 = Math.max(0, Math.floor(cx - radius), clip ? clip.x : 0), y0 = Math.max(0, Math.floor(cy - radius), clip ? clip.y : 0);
  const x1 = Math.min(r.width - 1, Math.ceil(cx + radius), clip ? clip.x + clip.w - 1 : r.width), y1 = Math.min(r.height - 1, Math.ceil(cy + radius), clip ? clip.y + clip.h - 1 : r.height);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const a = dabAlpha(Math.hypot(x + 0.5 - cx, y + 0.5 - cy), radius, hardness); if (a > 0) fn(y * r.width + x, a); }
}

export interface Coverage { done: Float32Array }
export const newCoverage = (w: number, h: number): Coverage => ({ done: new Float32Array(w * h) });

/** Clone stamp: copies from `base` at an offset, each pixel up to the dab's strength once per stroke. */
export function cloneDab(work: Raster, base: Raster, cov: Coverage, cx: number, cy: number, dx: number, dy: number, radius: number, hardness: number, opacity: number, clip: Rect | null = null): void {
  forDab(work, cx, cy, radius, hardness, clip, (i, a0) => {
    const a = a0 * opacity; if (a <= cov.done[i]) return;
    const x = i % work.width, y = (i - x) / work.width, sx = Math.round(x + dx), sy = Math.round(y + dy);
    if (sx < 0 || sy < 0 || sx >= base.width || sy >= base.height) return;
    const s = (sy * base.width + sx) * 4, o = i * 4;
    for (let c = 0; c < 4; c++) work.data[o + c] = base.data[o + c] + (base.data[s + c] - base.data[o + c]) * a;
    cov.done[i] = a;
  });
}
type Rect = { x: number; y: number; w: number; h: number };

/** Mean color of a disc in a raster. */
export function discMean(r: Raster, cx: number, cy: number, radius: number): [number, number, number] {
  let s0 = 0, s1 = 0, s2 = 0, n = 0;
  forDab(r, cx, cy, radius, 1, null, (i) => { s0 += r.data[i * 4]; s1 += r.data[i * 4 + 1]; s2 += r.data[i * 4 + 2]; n++; });
  return n ? [s0 / n, s1 / n, s2 / n] : [0, 0, 0];
}
/** Healing brush: the source's texture with the target's tone (the mean difference added back). */
export function healDab(work: Raster, base: Raster, cov: Coverage, cx: number, cy: number, dx: number, dy: number, radius: number, hardness: number, opacity: number, clip: Rect | null = null): void {
  const tgt = discMean(base, cx, cy, radius * 1.5), src = discMean(base, cx + dx, cy + dy, radius * 1.5);
  const shift = [tgt[0] - src[0], tgt[1] - src[1], tgt[2] - src[2]];
  forDab(work, cx, cy, radius, hardness, clip, (i, a0) => {
    const a = a0 * opacity; if (a <= cov.done[i]) return;
    const x = i % work.width, y = (i - x) / work.width, sx = Math.round(x + dx), sy = Math.round(y + dy);
    if (sx < 0 || sy < 0 || sx >= base.width || sy >= base.height) return;
    const s = (sy * base.width + sx) * 4, o = i * 4;
    for (let c = 0; c < 3; c++) { const v = base.data[s + c] + shift[c]; work.data[o + c] = base.data[o + c] + (v - base.data[o + c]) * a; }
    cov.done[i] = a;
  });
}

/** Red-eye: where red clearly dominates, red drops to the green-blue mean (luminance kept closer). */
export function redEyePixel(r: number, g: number, b: number): [number, number, number] {
  const gb = (g + b) / 2;
  if (r < 50 || r < 1.5 * Math.max(g, b)) return [r, g, b];
  return [Math.round(gb), g, b];
}
export function redEyeDab(work: Raster, base: Raster, cov: Coverage, cx: number, cy: number, radius: number, hardness: number, clip: Rect | null = null): void {
  forDab(work, cx, cy, radius, hardness, clip, (i, a) => {
    if (a <= cov.done[i]) return;
    const o = i * 4, [nr] = redEyePixel(base.data[o], base.data[o + 1], base.data[o + 2]);
    work.data[o] = base.data[o] + (nr - base.data[o]) * a; cov.done[i] = a;
  });
}

/** Color replacer: pixels near `target` take `to`'s color at their own lightness. */
export function replacePixel(p: [number, number, number], target: [number, number, number], to: [number, number, number], tolerance: number): [number, number, number] | null {
  const d = Math.max(Math.abs(p[0] - target[0]), Math.abs(p[1] - target[1]), Math.abs(p[2] - target[2]));
  if (d > tolerance) return null;
  const lum = (c: number[]) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
  const k = lum(p) / Math.max(1, lum(to));
  return [Math.min(255, to[0] * k), Math.min(255, to[1] * k), Math.min(255, to[2] * k)].map(Math.round) as [number, number, number];
}
export function colorReplaceDab(work: Raster, base: Raster, cov: Coverage, cx: number, cy: number, radius: number, hardness: number, target: [number, number, number], to: [number, number, number], tolerance: number, clip: Rect | null = null): void {
  forDab(work, cx, cy, radius, hardness, clip, (i, a) => {
    if (a <= cov.done[i]) return;
    const o = i * 4, n = replacePixel([base.data[o], base.data[o + 1], base.data[o + 2]], target, to, tolerance);
    if (!n) return;
    for (let c = 0; c < 3; c++) work.data[o + c] = base.data[o + c] + (n[c] - base.data[o + c]) * a;
    cov.done[i] = a;
  });
}

/** Spray: `count` dots of the color scattered in the disc (denser toward the middle). */
export function sprayDab(work: Raster, cx: number, cy: number, radius: number, color: RGBA, opacity: number, count: number, rand: () => number, clip: Rect | null = null): void {
  for (let k = 0; k < count; k++) {
    const ang = rand() * Math.PI * 2, rr = radius * Math.sqrt(rand()) * (0.6 + 0.4 * rand());
    const x = Math.floor(cx + Math.cos(ang) * rr), y = Math.floor(cy + Math.sin(ang) * rr);
    if (x < 0 || y < 0 || x >= work.width || y >= work.height) continue;
    if (clip && (x < clip.x || y < clip.y || x >= clip.x + clip.w || y >= clip.y + clip.h)) continue;
    const o = (y * work.width + x) * 4, a = opacity * (color[3] / 255);
    for (let c = 0; c < 3; c++) work.data[o + c] = work.data[o + c] + (color[c] - work.data[o + c]) * a;
    work.data[o + 3] = Math.max(work.data[o + 3], Math.round(255 * a + work.data[o + 3] * (1 - a)));
  }
}

/** Pencil: a hard square tip along a Bresenham line (no anti-aliasing). */
export function pencilLine(work: Raster, a: Pt, b: Pt, size: number, color: RGBA, clip: Rect | null = null): void {
  let x0 = Math.floor(a[0]), y0 = Math.floor(a[1]); const x1 = Math.floor(b[0]), y1 = Math.floor(b[1]);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1; let err = dx + dy;
  const half = Math.floor((Math.max(1, Math.round(size)) - 1) / 2), full = Math.max(1, Math.round(size));
  const plot = (px: number, py: number) => {
    for (let yy = py - half; yy < py - half + full; yy++) for (let xx = px - half; xx < px - half + full; xx++) {
      if (xx < 0 || yy < 0 || xx >= work.width || yy >= work.height) continue;
      if (clip && (xx < clip.x || yy < clip.y || xx >= clip.x + clip.w || yy >= clip.y + clip.h)) continue;
      work.data.set(color, (yy * work.width + xx) * 4);
    }
  };
  for (;;) { plot(x0, y0); if (x0 === x1 && y0 === y1) break; const e2 = 2 * err; if (e2 >= dy) { err += dy; x0 += sx; } if (e2 <= dx) { err += dx; y0 += sy; } }
}

/** Flood fill: the contiguous (or every) area within `tolerance` of the clicked color, painted at `opacity`. */
export function floodFill(src: Raster, x: number, y: number, color: RGBA, tolerance: number, contiguous: boolean, opacity = 1): { raster: Raster; filled: number } {
  const m = wandMask(src, x, y, tolerance, contiguous);
  const out = { width: src.width, height: src.height, data: src.data.slice() as Uint8ClampedArray<ArrayBuffer> };
  let n = 0; const a = opacity * (color[3] / 255);
  for (let i = 0; i < m.length; i++) if (m[i]) { n++; const o = i * 4; for (let c = 0; c < 3; c++) out.data[o + c] = src.data[o + c] + (color[c] - src.data[o + c]) * a; out.data[o + 3] = Math.round(src.data[o + 3] + (255 - src.data[o + 3]) * a); }
  return { raster: out, filled: n };
}

/** The filled head of an arrow ending at `tip`, sized from the line width. */
export function arrowHead(from: Pt, tip: Pt, width: number): Pt[] {
  const ang = Math.atan2(tip[1] - from[1], tip[0] - from[0]), len = Math.max(8, width * 4), spread = Math.PI / 7;
  return [tip, [tip[0] - len * Math.cos(ang - spread), tip[1] - len * Math.sin(ang - spread)], [tip[0] - len * Math.cos(ang + spread), tip[1] - len * Math.sin(ang + spread)]];
}

export const hexRgba = (hex: string, alpha = 255): RGBA => { const m = String(hex).match(/^#?([0-9a-f]{6})$/i); const v = m ? parseInt(m[1], 16) : 0; return [(v >> 16) & 255, (v >> 8) & 255, v & 255, alpha]; };
export const rgbaHex = (c: ArrayLike<number>): string => '#' + [c[0], c[1], c[2]].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
