/**
 * Raster-to-vector tracing for Trace to Vector and Generate Vector. Pixel-boundary contours are
 * extracted exactly (every boundary edge between an inside and an outside pixel, linked into closed
 * loops; diagonal touches join, so thin diagonal strokes stay connected), simplified with
 * Ramer-Douglas-Peucker, and written as SVG paths: straight where a corner is sharp, quadratic
 * curves elsewhere. Line art traces one mask (Otsu or a set threshold); color mode quantizes to a
 * palette and traces each color's mask, largest first. Holes come out as separate loops and are
 * kept by the even-odd fill rule.
 */
import type { Raster } from '../codecs/raster';
import { medianCut, mapToPalette } from '../codecs/palette';
import { otsu } from './ops';

export type Pt = [number, number];

/** Closed loops (pixel-corner coordinates) around the pixels where `mask[i]` is nonzero. */
export function traceMask(mask: Uint8Array, w: number, h: number): Pt[][] {
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] !== 0;
  // Directed boundary edges, inside pixel on the right (y down): key "x,y" -> list of [toX, toY, dir].
  const out = new Map<number, number[]>();
  const W1 = w + 1;
  const add = (x0: number, y0: number, x1: number, y1: number) => { const k = y0 * W1 + x0; const l = out.get(k); const v = y1 * W1 + x1; if (l) l.push(v); else out.set(k, [v]); };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!mask[y * w + x]) continue;
    if (!inside(x, y - 1)) add(x, y, x + 1, y);
    if (!inside(x + 1, y)) add(x + 1, y, x + 1, y + 1);
    if (!inside(x, y + 1)) add(x + 1, y + 1, x, y + 1);
    if (!inside(x - 1, y)) add(x, y + 1, x, y);
  }
  const loops: Pt[][] = [];
  const take = (from: number, dx: number, dy: number): number | undefined => {
    const l = out.get(from); if (!l || !l.length) return undefined;
    if (l.length === 1) { const v = l.pop()!; out.delete(from); return v; }
    // Saddle: prefer the left turn relative to the incoming direction (joins diagonal neighbours).
    const fx = from % W1, fy = (from - fx) / W1;
    let pick = 0;
    for (let i = 0; i < l.length; i++) { const tx = l[i] % W1, ty = (l[i] - tx) / W1; const ox = tx - fx, oy = ty - fy; if (dx * oy - dy * ox < 0) { pick = i; break; } }
    const v = l.splice(pick, 1)[0]; if (!l.length) out.delete(from); return v;
  };
  for (const start of [...out.keys()]) {
    while (out.get(start)?.length) {
      const loop: Pt[] = [];
      let cur = start, dx = 0, dy = 0;
      for (let guard = 0; guard < 4 * (w + 1) * (h + 1) + 8; guard++) {
        const cx = cur % W1, cy = (cur - cx) / W1;
        loop.push([cx, cy]);
        const next = take(cur, dx, dy); if (next === undefined) break;
        const nx = next % W1, ny = (next - nx) / W1; dx = nx - cx; dy = ny - cy; cur = next;
        if (cur === start && !out.get(start)?.length) break;
        if (cur === start) { /* a loop closed at a saddle start; continue to finish this loop */ break; }
      }
      if (loop.length >= 3) loops.push(collinear(loop));
    }
  }
  return loops;
}

/** Drops the middle points of straight runs. */
function collinear(p: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < p.length; i++) {
    const a = p[(i - 1 + p.length) % p.length], b = p[i], c = p[(i + 1) % p.length];
    if ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) !== 0) out.push(b);
  }
  return out.length >= 3 ? out : p;
}

/** Signed area (shoelace); the sum over a mask's loops equals its pixel count. */
export function area(p: Pt[]): number { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; }

function rdp(p: Pt[], eps: number): Pt[] {
  if (p.length < 3) return p;
  const [ax, ay] = p[0], [bx, by] = p[p.length - 1];
  const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
  let best = 0, bi = 0;
  for (let i = 1; i < p.length - 1; i++) { const d = len === 1 && dx === 0 && dy === 0 ? Math.hypot(p[i][0] - ax, p[i][1] - ay) : Math.abs(dy * p[i][0] - dx * p[i][1] + bx * ay - by * ax) / len; if (d > best) { best = d; bi = i; } }
  if (best <= eps) return [p[0], p[p.length - 1]];
  const l = rdp(p.slice(0, bi + 1), eps), r = rdp(p.slice(bi), eps);
  return [...l.slice(0, -1), ...r];
}
/** Ramer-Douglas-Peucker on a closed loop (split at the point farthest from the first). */
export function simplify(p: Pt[], eps: number): Pt[] {
  if (eps <= 0 || p.length < 5) return p;
  let far = 0, fd = -1; for (let i = 1; i < p.length; i++) { const d = Math.hypot(p[i][0] - p[0][0], p[i][1] - p[0][1]); if (d > fd) { fd = d; far = i; } }
  const a = rdp(p.slice(0, far + 1), eps), b = rdp([...p.slice(far), p[0]], eps);
  const out = [...a.slice(0, -1), ...b.slice(0, -1)];
  return out.length >= 3 ? out : p;
}

const n = (v: number) => (Math.round(v * 100) / 100).toString();
/** SVG path data for a closed loop: lines at corners sharper than `cornerDeg`, quadratic curves elsewhere. */
export function pathData(p: Pt[], smooth: boolean, cornerDeg = 70): string {
  if (!smooth || p.length < 4) return `M${p.map((q) => `${n(q[0])} ${n(q[1])}`).join('L')}Z`;
  const L = p.length, mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const sharp = p.map((b, i) => { const a = p[(i - 1 + L) % L], c = p[(i + 1) % L]; const v1 = [b[0] - a[0], b[1] - a[1]], v2 = [c[0] - b[0], c[1] - b[1]]; const cos = (v1[0] * v2[0] + v1[1] * v2[1]) / ((Math.hypot(v1[0], v1[1]) * Math.hypot(v2[0], v2[1])) || 1); return Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI > cornerDeg; });
  const m0 = mid(p[L - 1], p[0]);
  let d = `M${n(m0[0])} ${n(m0[1])}`;
  for (let i = 0; i < L; i++) { const b = p[i], m = mid(b, p[(i + 1) % L]); d += sharp[i] ? `L${n(b[0])} ${n(b[1])}L${n(m[0])} ${n(m[1])}` : `Q${n(b[0])} ${n(b[1])} ${n(m[0])} ${n(m[1])}`; }
  return d + 'Z';
}

export interface TraceOptions {
  mode: 'bw' | 'color';
  /** Color mode: palette size (2–64). */
  colors?: number;
  /** Line art: luminance threshold 0–255 (at or below is dark, as in Threshold), or -1 for Otsu. */
  threshold?: number;
  /** Line art: trace the light pixels instead of the dark ones. */
  invert?: boolean;
  /** Line art: fill color. */
  fill?: string;
  /** Simplification tolerance in pixels (0 = exact pixel edges). */
  tolerance?: number;
  smooth?: boolean;
  /** Loops smaller than this many square pixels are dropped (speckles). */
  minArea?: number;
  /** Color mode: a same-color stroke this wide hides hairline gaps between neighbouring shapes. */
  gapStroke?: number;
  /** A background rectangle color ('' = transparent). */
  background?: string;
  /** Extra markup inside the svg element (metadata). */
  extra?: string;
}
const hex = (c: [number, number, number]) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
const lumOf = (d: Uint8ClampedArray, i: number) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

function shapes(mask: Uint8Array, w: number, h: number, o: TraceOptions): { d: string; area: number } | null {
  const loops = traceMask(mask, w, h).filter((l) => Math.abs(area(l)) >= (o.minArea ?? 0));
  if (!loops.length) return null;
  const tol = o.tolerance ?? 1;
  const d = loops.map((l) => pathData(tol > 0 ? simplify(l, tol) : l, o.smooth ?? true)).join('');
  return { d, area: Math.abs(loops.reduce((s, l) => s + area(l), 0)) };
}

/** Traces a raster to an SVG document. */
export function traceToSvg(src: Raster, o: TraceOptions): { svg: string; paths: number; colors: string[] } {
  const w = src.width, h = src.height, d = src.data, N = w * h;
  const parts: { fill: string; d: string; area: number }[] = [];
  if (o.mode === 'bw') {
    const t = (o.threshold ?? -1) < 0 ? otsu(src) : o.threshold!;
    const mask = new Uint8Array(N);
    for (let i = 0; i < N; i++) { if (d[i * 4 + 3] < 128) continue; const dark = lumOf(d, i * 4) <= t; mask[i] = (o.invert ? !dark : dark) ? 1 : 0; }
    const s = shapes(mask, w, h, o); if (s) parts.push({ fill: o.fill || '#000000', ...s });
  } else {
    const k = Math.max(2, Math.min(64, Math.round(o.colors ?? 8)));
    const pal = medianCut(d, k);
    const idx = mapToPalette(d, pal, 255);
    pal.colors.forEach((c, ci) => {
      const mask = new Uint8Array(N); let any = false;
      for (let i = 0; i < N; i++) if (idx[i] === ci) { mask[i] = 1; any = true; }
      if (!any) return;
      const s = shapes(mask, w, h, o); if (s) parts.push({ fill: hex(c), ...s });
    });
    parts.sort((a, b) => b.area - a.area);
  }
  const stroke = o.mode === 'color' ? (o.gapStroke ?? 0.8) : 0;
  const body = parts.map((p) => `<path fill="${p.fill}"${stroke > 0 ? ` stroke="${p.fill}" stroke-width="${stroke}" stroke-linejoin="round"` : ''} fill-rule="evenodd" d="${p.d}"/>`).join('\n');
  const bg = o.background ? `<rect width="${w}" height="${h}" fill="${o.background}"/>\n` : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">\n${o.extra || ''}${bg}${body}\n</svg>\n`;
  return { svg, paths: parts.length, colors: parts.map((p) => p.fill) };
}
