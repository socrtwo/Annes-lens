/**
 * Markup Board: annotations kept beside the picture (not in its pixels) until Flatten Markup draws
 * them in: arrows, lines, rectangles, ellipses, highlighter strokes, text, numbered steps and
 * callouts. One drawing routine renders them on the viewer (scaled) and into the pixels (1:1).
 */
import type { Picture } from '../picture/model';
import type { Raster } from '../codecs/raster';
import { arrowHead, type Pt } from './engine';

export type MarkupKind = 'arrow' | 'line' | 'rect' | 'ellipse' | 'highlight' | 'text' | 'step' | 'callout';
export interface MarkupItem { id: number; kind: MarkupKind; pts: Pt[]; color: string; width: number; text?: string; n?: number; fill?: boolean; size?: number }
interface Board { items: MarkupItem[]; undo: MarkupItem[][]; next: number }

const boards = new WeakMap<Picture, Board>();
export function boardOf(p: Picture): Board { let b = boards.get(p); if (!b) { b = { items: [], undo: [], next: 1 }; boards.set(p, b); } return b; }
export const itemsOf = (p: Picture | null | undefined): MarkupItem[] => (p ? boards.get(p)?.items || [] : []);
const clone = (items: MarkupItem[]) => items.map((i) => ({ ...i, pts: i.pts.map((q) => [q[0], q[1]] as Pt) }));
/** Records the board before a change (for Undo Markup). */
export function snapshot(p: Picture): void { const b = boardOf(p); b.undo.push(clone(b.items)); if (b.undo.length > 100) b.undo.shift(); }
export function undoMarkup(p: Picture): boolean { const b = boardOf(p); const prev = b.undo.pop(); if (!prev) return false; b.items = prev; return true; }
export function addItem(p: Picture, item: Omit<MarkupItem, 'id'>): MarkupItem { const b = boardOf(p); snapshot(p); const it = { ...item, id: b.next++ }; b.items.push(it); return it; }
export function removeItem(p: Picture, id: number): boolean { const b = boardOf(p); const i = b.items.findIndex((x) => x.id === id); if (i < 0) return false; snapshot(p); b.items.splice(i, 1); return true; }
export function clearBoard(p: Picture): void { const b = boardOf(p); if (b.items.length) snapshot(p); b.items = []; }
export const nextStep = (p: Picture): number => itemsOf(p).filter((i) => i.kind === 'step').reduce((m, i) => Math.max(m, i.n || 0), 0) + 1;
export function moveItem(it: MarkupItem, dx: number, dy: number): void { it.pts = it.pts.map(([x, y]) => [x + dx, y + dy] as Pt); }

const fontPx = (it: MarkupItem) => it.size || Math.max(14, it.width * 6);
/** The box an item covers (picture pixels), for hit-testing and the selection frame. */
export function itemBox(it: MarkupItem, measure?: (text: string, px: number) => number): { x: number; y: number; w: number; h: number } {
  const xs = it.pts.map((p) => p[0]), ys = it.pts.map((p) => p[1]);
  let x0 = Math.min(...xs), y0 = Math.min(...ys), x1 = Math.max(...xs), y1 = Math.max(...ys);
  if (it.kind === 'step') { const r = stepRadius(it); x0 = it.pts[0][0] - r; y0 = it.pts[0][1] - r; x1 = it.pts[0][0] + r; y1 = it.pts[0][1] + r; }
  if (it.kind === 'text' || it.kind === 'callout') {
    const f = fontPx(it), lines = (it.text || '').split('\n'), tw = Math.max(...lines.map((l) => (measure ? measure(l, f) : l.length * f * 0.55))), th = lines.length * f * 1.25;
    const at = it.kind === 'callout' ? it.pts[1] || it.pts[0] : it.pts[0], pad = it.kind === 'callout' ? f * 0.4 : 0;
    x0 = Math.min(x0, at[0] - pad); y0 = Math.min(y0, at[1] - pad); x1 = Math.max(x1, at[0] + tw + pad); y1 = Math.max(y1, at[1] + th + pad);
  }
  const m = it.kind === 'highlight' ? it.width * 1.5 : it.width;
  return { x: x0 - m, y: y0 - m, w: x1 - x0 + 2 * m, h: y1 - y0 + 2 * m };
}
const stepRadius = (it: MarkupItem) => Math.max(12, it.width * 4);
const segDist = (p: Pt, a: Pt, b: Pt) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy; const t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)) : 0; return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); };
/** The topmost item at a point (picture pixels), within `tol`. */
export function hitTest(items: MarkupItem[], x: number, y: number, tol: number, measure?: (t: string, px: number) => number): MarkupItem | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i], p: Pt = [x, y], t = tol + it.width / 2;
    if (it.kind === 'line' || it.kind === 'arrow') { if (segDist(p, it.pts[0], it.pts[1]) <= t) return it; continue; }
    if (it.kind === 'highlight') { for (let k = 1; k < it.pts.length; k++) if (segDist(p, it.pts[k - 1], it.pts[k]) <= t + it.width) return it; continue; }
    if (it.kind === 'rect' && !it.fill) { const [a, b] = it.pts, x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]); const edges: [Pt, Pt][] = [[[x0, y0], [x1, y0]], [[x1, y0], [x1, y1]], [[x1, y1], [x0, y1]], [[x0, y1], [x0, y0]]]; if (edges.some(([u, v]) => segDist(p, u, v) <= t)) return it; continue; }
    if (it.kind === 'ellipse' && !it.fill) { const [a, b] = it.pts, cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2, rx = Math.abs(b[0] - a[0]) / 2 || 1, ry = Math.abs(b[1] - a[1]) / 2 || 1; const d = Math.hypot((x - cx) / rx, (y - cy) / ry); if (Math.abs(d - 1) * Math.min(rx, ry) <= t) return it; continue; }
    const bx = itemBox(it, measure); if (x >= bx.x - tol && y >= bx.y - tol && x <= bx.x + bx.w + tol && y <= bx.y + bx.h + tol) return it;
  }
  return null;
}

/** Draws items; `k` and (ox, oy) map picture pixels to the context (k = 1, 0, 0 for flattening). */
export function drawMarkup(ctx: CanvasRenderingContext2D, items: MarkupItem[], tf: { k: number; ox: number; oy: number }, selected = 0): void {
  const P = (q: Pt): Pt => [tf.ox + q[0] * tf.k, tf.oy + q[1] * tf.k];
  for (const it of items) {
    ctx.save();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.strokeStyle = it.color; ctx.fillStyle = it.color; ctx.lineWidth = Math.max(1, it.width * tf.k);
    const [a, b] = it.pts.map(P);
    if (it.kind === 'line' || it.kind === 'arrow') {
      ctx.beginPath(); ctx.moveTo(a[0], a[1]);
      if (it.kind === 'arrow') { const head = arrowHead(a, b, it.width * tf.k), base: Pt = [(head[1][0] + head[2][0]) / 2, (head[1][1] + head[2][1]) / 2]; ctx.lineTo(base[0], base[1]); ctx.stroke(); ctx.beginPath(); head.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]))); ctx.closePath(); ctx.fill(); }
      else { ctx.lineTo(b[0], b[1]); ctx.stroke(); }
    } else if (it.kind === 'rect' || it.kind === 'ellipse') {
      ctx.beginPath();
      if (it.kind === 'rect') ctx.rect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
      else ctx.ellipse((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.abs(b[0] - a[0]) / 2, Math.abs(b[1] - a[1]) / 2, 0, 0, Math.PI * 2);
      if (it.fill) { ctx.globalAlpha = 0.35; ctx.fill(); ctx.globalAlpha = 1; } ctx.stroke();
    } else if (it.kind === 'highlight') {
      ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = 0.45; ctx.lineWidth = Math.max(2, it.width * 3 * tf.k); ctx.lineCap = 'butt';
      ctx.beginPath(); it.pts.map(P).forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]))); ctx.stroke();
    } else if (it.kind === 'step') {
      const r = stepRadius(it) * tf.k; ctx.beginPath(); ctx.arc(a[0], a[1], r, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = Math.max(1, r * 0.12); ctx.strokeStyle = '#ffffff'; ctx.stroke();
      ctx.fillStyle = '#ffffff'; ctx.font = `bold ${Math.round(r * 1.1)}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(it.n || 1), a[0], a[1] + r * 0.05);
    } else if (it.kind === 'text' || it.kind === 'callout') {
      const f = fontPx(it) * tf.k, lines = (it.text || '').split('\n'); ctx.font = `bold ${Math.round(f)}px sans-serif`; ctx.textBaseline = 'top';
      const at = it.kind === 'callout' ? b || a : a, tw = Math.max(1, ...lines.map((l) => ctx.measureText(l).width)), th = lines.length * f * 1.25;
      if (it.kind === 'callout') {
        const pad = f * 0.4, bx = at[0] - pad, by = at[1] - pad, bw = tw + 2 * pad, bh = th + 2 * pad;
        const cx = Math.max(bx, Math.min(bx + bw, a[0])), cy = Math.max(by, Math.min(by + bh, a[1]));
        ctx.lineWidth = Math.max(1, it.width * tf.k); ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(a[0], a[1]); ctx.stroke();
        ctx.fillStyle = '#ffffff'; ctx.fillRect(bx, by, bw, bh); ctx.strokeRect(bx, by, bw, bh); ctx.fillStyle = it.color;
      } else { ctx.lineWidth = Math.max(2, f * 0.12); ctx.strokeStyle = 'rgba(255,255,255,0.9)'; lines.forEach((l, i) => ctx.strokeText(l, at[0], at[1] + i * f * 1.25)); }
      lines.forEach((l, i) => ctx.fillText(l, at[0], at[1] + i * f * 1.25));
    }
    ctx.restore();
    if (it.id === selected) {
      const bx = itemBox(it, (t, px) => { ctx.save(); ctx.font = `bold ${Math.round(px)}px sans-serif`; const w = ctx.measureText(t).width; ctx.restore(); return w; });
      ctx.save(); ctx.setLineDash([5, 4]); ctx.strokeStyle = '#00a2ff'; ctx.lineWidth = 1.5; ctx.strokeRect(tf.ox + bx.x * tf.k - 3, tf.oy + bx.y * tf.k - 3, bx.w * tf.k + 6, bx.h * tf.k + 6); ctx.restore();
    }
  }
}

/** The raster with the items drawn into it. */
export function flatten(r: Raster, items: MarkupItem[]): Raster {
  const c = document.createElement('canvas'); c.width = r.width; c.height = r.height;
  const x = c.getContext('2d', { willReadFrequently: true })!;
  x.putImageData(new ImageData(r.data.slice(), r.width, r.height), 0, 0);
  drawMarkup(x, items, { k: 1, ox: 0, oy: 0 });
  const id = x.getImageData(0, 0, r.width, r.height);
  return { width: r.width, height: r.height, data: id.data as Uint8ClampedArray<ArrayBuffer> };
}
