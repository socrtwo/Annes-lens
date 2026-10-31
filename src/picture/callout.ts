/**
 * Magnifier Callout: an enlarged inset of a region, placed in a corner away from it, with a frame
 * and the two outer connector lines between the region and the inset.
 */
import type { Raster } from '../codecs/raster';

export interface Rect { x: number; y: number; w: number; h: number }
export interface CalloutOptions { zoom: number; position: 'auto' | 'tl' | 'tr' | 'bl' | 'br'; shape: 'rect' | 'circle'; border: number; color: string; connector: boolean; shadow: boolean; pixelated: boolean; margin: number; maxShare: number }

const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const corners = (r: Rect): [number, number][] => [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]];

/** Where the inset goes and how large it is. */
export function placeInset(W: number, H: number, sel: Rect, o: Pick<CalloutOptions, 'zoom' | 'position' | 'margin' | 'maxShare'>): { inset: Rect; zoom: number } {
  let zoom = o.zoom;
  const maxW = W * o.maxShare, maxH = H * o.maxShare;
  zoom = Math.min(zoom, maxW / sel.w, maxH / sel.h);
  const iw = Math.max(1, Math.round(sel.w * zoom)), ih = Math.max(1, Math.round(sel.h * zoom)), m = o.margin;
  const at: Record<string, Rect> = { tl: { x: m, y: m, w: iw, h: ih }, tr: { x: W - iw - m, y: m, w: iw, h: ih }, bl: { x: m, y: H - ih - m, w: iw, h: ih }, br: { x: W - iw - m, y: H - ih - m, w: iw, h: ih } };
  if (o.position !== 'auto') return { inset: at[o.position], zoom };
  const cx = sel.x + sel.w / 2, cy = sel.y + sel.h / 2;
  const ranked = Object.values(at).map((r) => ({ r, free: !overlap(r, sel), d: Math.hypot(r.x + r.w / 2 - cx, r.y + r.h / 2 - cy) })).sort((a, b) => Number(b.free) - Number(a.free) || b.d - a.d);
  return { inset: ranked[0].r, zoom };
}

/** The connector lines: corresponding corners whose line leaves both rectangles on one side. */
export function connectors(a: Rect, b: Rect): [[number, number], [number, number]][] {
  const ca = corners(a), cb = corners(b), pts = [...ca, ...cb], out: [[number, number], [number, number]][] = [];
  for (let i = 0; i < 4; i++) {
    const [x0, y0] = ca[i], [x1, y1] = cb[i];
    if (x0 === x1 && y0 === y1) continue;
    let pos = 0, neg = 0;
    for (const [px, py] of pts) { const s = (x1 - x0) * (py - y0) - (y1 - y0) * (px - x0); if (s > 1e-9) pos++; else if (s < -1e-9) neg++; }
    if (!pos || !neg) out.push([ca[i], cb[i]]);
  }
  return out;
}

/** Draws the callout onto a copy of `src`. */
export function drawCallout(src: Raster, sel: Rect, o: CalloutOptions): { raster: Raster; inset: Rect; zoom: number } {
  const W = src.width, H = src.height;
  const { inset, zoom } = placeInset(W, H, sel, o);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d', { willReadFrequently: true })!;
  x.putImageData(new ImageData(src.data.slice(), W, H), 0, 0);
  const orig = document.createElement('canvas'); orig.width = W; orig.height = H; orig.getContext('2d')!.putImageData(new ImageData(src.data.slice(), W, H), 0, 0);
  const bw = Math.max(0, o.border);
  x.lineJoin = 'round'; x.strokeStyle = o.color;
  if (o.connector && bw > 0) { x.lineWidth = Math.max(1, bw * 0.6); for (const [p, q] of connectors(sel, inset)) { x.beginPath(); x.moveTo(p[0], p[1]); x.lineTo(q[0], q[1]); x.stroke(); } }
  const shapePath = (r: Rect) => { x.beginPath(); if (o.shape === 'circle') x.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2); else x.rect(r.x, r.y, r.w, r.h); };
  if (bw > 0) { x.lineWidth = Math.max(1, bw * 0.6); shapePath(sel); x.stroke(); }
  x.save();
  if (o.shadow) { x.shadowColor = 'rgba(0,0,0,0.45)'; x.shadowBlur = Math.max(4, bw * 3); x.shadowOffsetX = x.shadowOffsetY = Math.max(2, bw); shapePath(inset); x.fillStyle = o.color; x.fill(); }
  x.restore();
  x.save(); shapePath(inset); x.clip();
  x.imageSmoothingEnabled = !o.pixelated; (x as any).imageSmoothingQuality = 'high';
  x.drawImage(orig, sel.x, sel.y, sel.w, sel.h, inset.x, inset.y, inset.w, inset.h);
  x.restore();
  if (bw > 0) { x.lineWidth = bw; shapePath(inset); x.stroke(); }
  const id = x.getImageData(0, 0, W, H);
  return { raster: { width: W, height: H, data: id.data as Uint8ClampedArray<ArrayBuffer> }, inset, zoom };
}
