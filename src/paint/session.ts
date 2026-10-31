/**
 * The paint pane's state and the stroke in progress. A stroke works on a copy of the current
 * frame shown in place of the picture while the pointer is down; on release it becomes one
 * undoable edit (only the current frame changes). Painting stays inside the selection when there
 * is one. The Markup Board's tools create and move annotations instead of pixels.
 */
import type { App, PictureTab } from '../app';
import type { Raster } from '../codecs/raster';
import { frameRaster, editRaster } from '../picture/edit';
import { openDialog, toast, confirmDialog } from '../ui/dialog';
import { rng } from '../picture/effects';
import { paintHooks } from './hooks';
import * as E from './engine';
import * as M from './markup';

export type PaintTool = 'brush' | 'pencil' | 'line' | 'arrow' | 'rect' | 'ellipse' | 'text' | 'eraser' | 'fill' | 'spray' | 'clone' | 'heal' | 'redEye' | 'colorReplace' | 'colorPicker';
export type MarkupTool = 'select' | M.MarkupKind;
export const PAINT_TOOLS: { id: PaintTool; label: string; icon: string }[] = [
  { id: 'brush', label: 'Brush', icon: 'brush' }, { id: 'pencil', label: 'Pencil', icon: 'edit' }, { id: 'line', label: 'Line', icon: 'horizontal_rule' }, { id: 'arrow', label: 'Arrow', icon: 'arrow_right_alt' },
  { id: 'rect', label: 'Rectangle', icon: 'crop_square' }, { id: 'ellipse', label: 'Ellipse', icon: 'circle' }, { id: 'text', label: 'Text', icon: 'title' }, { id: 'eraser', label: 'Eraser', icon: 'ink_eraser' },
  { id: 'fill', label: 'Flood Fill', icon: 'format_color_fill' }, { id: 'spray', label: 'Spray', icon: 'grain' }, { id: 'clone', label: 'Clone Stamp', icon: 'approval' }, { id: 'heal', label: 'Healing Brush', icon: 'healing' },
  { id: 'redEye', label: 'Red-Eye Brush', icon: 'remove_red_eye' }, { id: 'colorReplace', label: 'Color Replacer', icon: 'format_paint' }, { id: 'colorPicker', label: 'Color Picker', icon: 'colorize' },
];
export const MARKUP_TOOLS: { id: MarkupTool; label: string; icon: string }[] = [
  { id: 'select', label: 'Select and Move', icon: 'near_me' }, { id: 'arrow', label: 'Arrow', icon: 'arrow_right_alt' }, { id: 'line', label: 'Line', icon: 'horizontal_rule' }, { id: 'rect', label: 'Rectangle', icon: 'crop_square' },
  { id: 'ellipse', label: 'Ellipse', icon: 'circle' }, { id: 'highlight', label: 'Highlighter', icon: 'ink_highlighter' }, { id: 'text', label: 'Text', icon: 'title' }, { id: 'step', label: 'Numbered Step', icon: 'looks_one' }, { id: 'callout', label: 'Callout', icon: 'chat_bubble' },
];

export const paint = {
  open: false, mode: 'paint' as 'paint' | 'markup', tool: 'brush' as PaintTool, markupTool: 'arrow' as MarkupTool,
  color: '#d02020', color2: '#ffffff', size: 12, opacity: 100, hardness: 70, fillShapes: false, tolerance: 32, contiguous: true, eraseToTransparent: true,
  textSize: 36, markupColor: '#e02020', markupWidth: 4, markupFill: false, selected: 0,
  cloneSource: null as E.Pt | null, cloneOffset: null as E.Pt | null, settingSource: false,
  onChange: () => undefined as void,
};
const changed = () => paint.onChange();

interface Stroke { tab: PictureTab; tool: PaintTool; base: Raster; work: Raster; img: ImageData; display: HTMLCanvasElement; ctx: CanvasRenderingContext2D; baseCanvas: HTMLCanvasElement | null; pts: E.Pt[]; cov: E.Coverage; rand: () => number; clip: { x: number; y: number; w: number; h: number } | null; frame: number; dirty: boolean; target?: [number, number, number] }
let stroke: Stroke | null = null;
interface MarkupDrag { tab: PictureTab; item: M.MarkupItem; start: E.Pt; last: E.Pt; creating: boolean }
let mdrag: MarkupDrag | null = null;
let appRef: App | null = null;
export const bindApp = (app: App): void => { appRef = app; };

const PIXEL: PaintTool[] = ['brush', 'pencil', 'eraser', 'spray', 'clone', 'heal', 'redEye', 'colorReplace'];
const SHAPES: PaintTool[] = ['line', 'arrow', 'rect', 'ellipse'];
const radius = () => Math.max(0.5, paint.size / 2);

function begin(tab: PictureTab, tool: PaintTool): Stroke {
  const p = tab.picture!, f = p.currentFrame, base = frameRaster(f);
  const display = document.createElement('canvas'); display.width = base.width; display.height = base.height;
  const ctx = display.getContext('2d', { willReadFrequently: true })!;
  const img = new ImageData(base.data.slice(), base.width, base.height); ctx.putImageData(img, 0, 0);
  const work: Raster = { width: base.width, height: base.height, data: img.data as Uint8ClampedArray<ArrayBuffer> };
  let baseCanvas: HTMLCanvasElement | null = null;
  if (SHAPES.includes(tool)) { baseCanvas = document.createElement('canvas'); baseCanvas.width = base.width; baseCanvas.height = base.height; baseCanvas.getContext('2d')!.putImageData(new ImageData(base.data.slice(), base.width, base.height), 0, 0); }
  const s = tab.selection;
  return { tab, tool, base, work, img, display, ctx, baseCanvas, pts: [], cov: E.newCoverage(base.width, base.height), rand: rng(Date.now() & 0xffff), clip: s ? { ...s } : null, frame: p.frame, dirty: false };
}

/** Applies dabs from the last point to `q` for the pixel tools; puts the touched area on the display. */
function pixelSegment(s: Stroke, q: E.Pt): void {
  const prev = s.pts[s.pts.length - 1]; s.pts.push(q);
  const R = radius(), hard = paint.hardness / 100, op = paint.opacity / 100;
  const dabs = prev ? E.dabsAlong([prev, q], Math.max(1, R / 3)).slice(1) : [q];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const grow = (x: number, y: number, r: number) => { x0 = Math.min(x0, x - r); y0 = Math.min(y0, y - r); x1 = Math.max(x1, x + r); y1 = Math.max(y1, y + r); };
  if (s.tool === 'pencil') { const a = prev || q; E.pencilLine(s.work, a, q, paint.size, E.hexRgba(paint.color), s.clip); grow(a[0], a[1], paint.size); grow(q[0], q[1], paint.size); }
  for (const [cx, cy] of s.tool === 'pencil' ? [] : dabs) {
    if (s.tool === 'brush' || s.tool === 'eraser') {
      const col = s.tool === 'eraser' ? (paint.eraseToTransparent ? null : E.hexRgba(paint.color2)) : E.hexRgba(paint.color);
      brushDab(s, cx, cy, R, hard, op, col);
    } else if (s.tool === 'spray') E.sprayDab(s.work, cx, cy, R * 2, E.hexRgba(paint.color), op, Math.max(4, Math.round(R)), s.rand, s.clip);
    else if (s.tool === 'clone' || s.tool === 'heal') { const off = paint.cloneOffset!; (s.tool === 'clone' ? E.cloneDab : E.healDab)(s.work, s.base, s.cov, cx, cy, off[0], off[1], R, hard, op, s.clip); }
    else if (s.tool === 'redEye') E.redEyeDab(s.work, s.base, s.cov, cx, cy, R, hard, s.clip);
    else if (s.tool === 'colorReplace') E.colorReplaceDab(s.work, s.base, s.cov, cx, cy, R, hard, s.target!, E.hexRgba(paint.color).slice(0, 3) as [number, number, number], paint.tolerance, s.clip);
    grow(cx, cy, s.tool === 'spray' ? R * 2 : R);
  }
  if (x1 < x0) return;
  const dx = Math.max(0, Math.floor(x0) - 1), dy = Math.max(0, Math.floor(y0) - 1), dw = Math.min(s.work.width, Math.ceil(x1) + 2) - dx, dh = Math.min(s.work.height, Math.ceil(y1) + 2) - dy;
  if (dw > 0 && dh > 0) s.ctx.putImageData(s.img, 0, 0, dx, dy, dw, dh);
  s.dirty = true;
}
/** Brush and eraser: each pixel takes the stroke's strongest coverage (no build-up where dabs overlap). */
function brushDab(s: Stroke, cx: number, cy: number, R: number, hard: number, op: number, col: E.RGBA | null): void {
  const w = s.work.width, clip = s.clip;
  const xa = Math.max(0, Math.floor(cx - R), clip ? clip.x : 0), ya = Math.max(0, Math.floor(cy - R), clip ? clip.y : 0);
  const xb = Math.min(w - 1, Math.ceil(cx + R), clip ? clip.x + clip.w - 1 : w), yb = Math.min(s.work.height - 1, Math.ceil(cy + R), clip ? clip.y + clip.h - 1 : s.work.height);
  for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) {
    const a = E.dabAlpha(Math.hypot(x + 0.5 - cx, y + 0.5 - cy), R, hard) * op, i = y * w + x;
    if (a <= s.cov.done[i]) continue; s.cov.done[i] = a;
    const o = i * 4, b = s.base.data;
    if (!col) { s.work.data[o + 3] = Math.round(b[o + 3] * (1 - a)); continue; }
    for (let c = 0; c < 3; c++) s.work.data[o + c] = b[o + c] + (col[c] - b[o + c]) * a;
    s.work.data[o + 3] = Math.round(b[o + 3] + (255 - b[o + 3]) * a);
  }
}
function shapeDraw(s: Stroke, a: E.Pt, b: E.Pt): void {
  const x = s.ctx; x.save(); x.clearRect(0, 0, s.display.width, s.display.height); x.drawImage(s.baseCanvas!, 0, 0);
  if (s.clip) { x.beginPath(); x.rect(s.clip.x, s.clip.y, s.clip.w, s.clip.h); x.clip(); }
  x.globalAlpha = paint.opacity / 100; x.strokeStyle = paint.color; x.fillStyle = paint.color; x.lineWidth = Math.max(1, paint.size); x.lineCap = 'round'; x.lineJoin = 'round';
  x.beginPath();
  if (s.tool === 'line') { x.moveTo(a[0], a[1]); x.lineTo(b[0], b[1]); x.stroke(); }
  else if (s.tool === 'arrow') { const h = E.arrowHead(a, b, paint.size), m: E.Pt = [(h[1][0] + h[2][0]) / 2, (h[1][1] + h[2][1]) / 2]; x.moveTo(a[0], a[1]); x.lineTo(m[0], m[1]); x.stroke(); x.beginPath(); h.forEach((q, i) => (i ? x.lineTo(q[0], q[1]) : x.moveTo(q[0], q[1]))); x.closePath(); x.fill(); }
  else { if (s.tool === 'rect') x.rect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])); else x.ellipse((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.abs(b[0] - a[0]) / 2, Math.abs(b[1] - a[1]) / 2, 0, 0, Math.PI * 2); if (paint.fillShapes) x.fill(); x.stroke(); }
  x.restore(); s.dirty = true;
}

const LABELS: Record<PaintTool, string> = Object.fromEntries(PAINT_TOOLS.map((t) => [t.id, t.label])) as Record<PaintTool, string>;
/** Ends the stroke: the working copy becomes the current frame, as one undoable step. */
function commit(s: Stroke): void {
  if (!s.dirty) { stroke = null; s.tab.ui.draw(); return; }
  let out: Raster;
  if (SHAPES.includes(s.tool) || s.tool === 'text') { const id = s.ctx.getImageData(0, 0, s.display.width, s.display.height); out = { width: id.width, height: id.height, data: id.data as Uint8ClampedArray<ArrayBuffer> }; }
  else out = { width: s.work.width, height: s.work.height, data: s.work.data.slice() as Uint8ClampedArray<ArrayBuffer> };
  const mask = s.tab.selectionMask;
  if (mask && mask.length === out.width * out.height) for (let i = 0; i < mask.length; i++) if (!mask[i]) out.data.set(s.base.data.subarray(i * 4, i * 4 + 4), i * 4);
  const alpha = s.tool === 'eraser' && paint.eraseToTransparent;
  stroke = null;
  editRaster(appRef!, LABELS[s.tool], (r, i) => (i === s.frame ? out : r), { keepSelection: true, patch: alpha ? { hasAlpha: true } : undefined });
}

async function textAt(tab: PictureTab, q: E.Pt): Promise<void> {
  const v = await openDialog({ title: 'Text', ok: 'Place', fields: [
    { key: 'text', label: 'Text', type: 'textarea', rows: 3, value: '', autofocus: true },
    { key: 'size', label: 'Size (px)', type: 'number', min: 4, max: 2000, value: paint.textSize, half: true },
    { key: 'font', label: 'Font', type: 'combo', options: ['sans-serif', 'serif', 'monospace', 'Georgia', 'Arial', 'Times New Roman'], value: 'sans-serif', half: true },
    { key: 'bold', label: 'Bold', type: 'checkbox', value: false, half: true }, { key: 'outline', label: 'Light outline', type: 'checkbox', value: false, half: true },
  ] });
  if (!v || !String(v.text).trim() || !tab.picture) return;
  paint.textSize = +v.size || paint.textSize; changed();
  const s = begin(tab, 'text'), x = s.ctx, size = paint.textSize;
  x.save(); if (s.clip) { x.beginPath(); x.rect(s.clip.x, s.clip.y, s.clip.w, s.clip.h); x.clip(); }
  x.globalAlpha = paint.opacity / 100; x.font = `${v.bold ? 'bold ' : ''}${size}px ${/\s/.test(v.font) ? `"${v.font}"` : v.font}`; x.textBaseline = 'top'; x.fillStyle = paint.color;
  String(v.text).split('\n').forEach((l, i) => { if (v.outline) { x.lineWidth = Math.max(2, size / 10); x.strokeStyle = '#ffffff'; x.lineJoin = 'round'; x.strokeText(l, q[0], q[1] + i * size * 1.2); } x.fillText(l, q[0], q[1] + i * size * 1.2); });
  x.restore(); s.dirty = true; commit(s);
}

// Markup ---------------------------------------------------------------------------------------

const measureText = (t: string, px: number) => { const c = document.createElement('canvas').getContext('2d')!; c.font = `bold ${Math.round(px)}px sans-serif`; return c.measureText(t).width; };
async function markupText(initial = ''): Promise<string | null> {
  const v = await openDialog({ title: 'Markup Text', ok: 'OK', fields: [{ key: 't', label: 'Text', type: 'textarea', rows: 3, value: initial, autofocus: true }] });
  return v ? String(v.t || '').trim() || null : null;
}
export async function editSelectedText(app: App): Promise<void> {
  const p = app.picture; if (!p) return;
  const it = M.itemsOf(p).find((i) => i.id === paint.selected);
  if (!it || (it.kind !== 'text' && it.kind !== 'callout')) { toast('Select a text or a callout first.'); return; }
  const t = await markupText(it.text || ''); if (t === null) return;
  M.snapshot(p); it.text = t; app.viewer.draw(); changed();
}

function markupDown(tab: PictureTab, q: E.Pt): void {
  const p = tab.picture!; const tool = paint.markupTool;
  if (tool === 'select') {
    const hit = M.hitTest(M.itemsOf(p), q[0], q[1], 6 / tab.ui.zoom, measureText);
    paint.selected = hit ? hit.id : 0; changed();
    if (hit) { M.snapshot(p); mdrag = { tab, item: hit, start: q, last: q, creating: false }; }
    tab.ui.draw(); return;
  }
  if (tool === 'step') { const it = M.addItem(p, { kind: 'step', pts: [q], color: paint.markupColor, width: paint.markupWidth, n: M.nextStep(p) }); paint.selected = it.id; changed(); tab.ui.draw(); return; }
  if (tool === 'text') { void markupText().then((t) => { if (!t) return; const it = M.addItem(p, { kind: 'text', pts: [q], color: paint.markupColor, width: paint.markupWidth, text: t }); paint.selected = it.id; changed(); tab.ui.draw(); }); return; }
  const it = M.addItem(p, { kind: tool, pts: tool === 'highlight' ? [q] : [q, q], color: tool === 'highlight' ? (paint.markupColor === '#e02020' ? '#ffe000' : paint.markupColor) : paint.markupColor, width: paint.markupWidth, fill: paint.markupFill });
  paint.selected = it.id; mdrag = { tab, item: it, start: q, last: q, creating: true }; changed();
}
function markupMove(q: E.Pt): void {
  const d = mdrag!; const it = d.item;
  if (!d.creating) { M.moveItem(it, q[0] - d.last[0], q[1] - d.last[1]); d.last = q; d.tab.ui.draw(); return; }
  if (it.kind === 'highlight') { const l = it.pts[it.pts.length - 1]; if (Math.hypot(q[0] - l[0], q[1] - l[1]) * d.tab.ui.zoom > 2) it.pts.push(q); } else it.pts[1] = q;
  d.tab.ui.draw();
}
async function markupUp(): Promise<void> {
  const d = mdrag!; mdrag = null; const p = d.tab.picture!; const it = d.item;
  if (!d.creating) { d.tab.ui.draw(); return; }
  const span = Math.hypot(it.pts[it.pts.length - 1][0] - it.pts[0][0], it.pts[it.pts.length - 1][1] - it.pts[0][1]) * d.tab.ui.zoom;
  if (span < 4 && it.kind !== 'callout') { M.undoMarkup(p); paint.selected = 0; changed(); d.tab.ui.draw(); return; }
  if (it.kind === 'callout') {
    if (span < 4) it.pts[1] = [it.pts[0][0] + 40 / d.tab.ui.zoom, it.pts[0][1] - 40 / d.tab.ui.zoom];
    const t = await markupText(); if (!t) { M.undoMarkup(p); paint.selected = 0; changed(); d.tab.ui.draw(); return; }
    it.text = t;
  }
  d.tab.ui.draw(); changed();
}
export function deleteSelected(app: App): boolean { const p = app.picture; if (!p || !paint.selected) return false; const ok = M.removeItem(p, paint.selected); paint.selected = 0; app.viewer.draw(); changed(); return ok; }
export function flattenMarkup(app: App): boolean {
  const p = app.picture; if (!p) return false; const items = M.itemsOf(p); if (!items.length) return false;
  const snapshot = items.map((i) => ({ ...i, pts: i.pts.map((q) => [q[0], q[1]] as E.Pt) }));
  M.clearBoard(p); paint.selected = 0;
  editRaster(app, 'Flatten Markup', (r, i) => (i === p.frame ? M.flatten(r, snapshot) : r), { keepSelection: true });
  changed(); return true;
}

// Hooks -----------------------------------------------------------------------------------------

paintHooks.active = (tab) => paint.open && !!tab.picture;
paintHooks.override = (tab) => (stroke && stroke.tab === tab ? stroke.display : null);
paintHooks.cursor = () => (paint.open ? (paint.mode === 'markup' && paint.markupTool === 'select' ? 'default' : 'crosshair') : '');
paintHooks.down = (tab, x, y, e) => {
  const p = tab.picture!; const q: E.Pt = [x, y];
  if (paint.mode === 'markup') { markupDown(tab, q); return; }
  const tool = paint.tool;
  if (tool === 'colorPicker') {
    const r = frameRaster(p.currentFrame), ix = Math.max(0, Math.min(r.width - 1, Math.floor(x))), iy = Math.max(0, Math.min(r.height - 1, Math.floor(y)));
    const hex = E.rgbaHex(r.data.subarray((iy * r.width + ix) * 4)); if (e.shiftKey) paint.color2 = hex; else paint.color = hex; changed();
    toast(`${e.shiftKey ? 'Secondary' : 'Color'} ${hex}`); return;
  }
  if ((tool === 'clone' || tool === 'heal') && (e.altKey || paint.settingSource)) { paint.cloneSource = q; paint.cloneOffset = null; paint.settingSource = false; changed(); toast('Source set. Now paint where it should be copied.'); tab.ui.draw(); return; }
  if ((tool === 'clone' || tool === 'heal') && !paint.cloneSource) { toast('Set the source first: Alt+click (or "Set source" in the pane), then paint.'); return; }
  if (tool === 'fill') {
    const r = frameRaster(p.currentFrame); const res = E.floodFill(r, Math.floor(x), Math.floor(y), E.hexRgba(paint.color), paint.tolerance, paint.contiguous, paint.opacity / 100);
    const mask = tab.selectionMask, s = tab.selection; const out = res.raster;
    if (s) for (let yy = 0; yy < r.height; yy++) for (let xx = 0; xx < r.width; xx++) { const i = yy * r.width + xx; const inside = xx >= s.x && yy >= s.y && xx < s.x + s.w && yy < s.y + s.h && (!mask || mask[i]); if (!inside) out.data.set(r.data.subarray(i * 4, i * 4 + 4), i * 4); }
    const frame = p.frame; editRaster(appRef!, 'Flood Fill', (rr, i) => (i === frame ? out : rr), { keepSelection: true }); return;
  }
  if (tool === 'text') { void textAt(tab, q); return; }
  stroke = begin(tab, tool);
  if (tool === 'clone' || tool === 'heal') { if (!paint.cloneOffset) paint.cloneOffset = [paint.cloneSource![0] - x, paint.cloneSource![1] - y]; }
  if (tool === 'colorReplace') { const b = stroke.base, ix = Math.max(0, Math.min(b.width - 1, Math.floor(x))), iy = Math.max(0, Math.min(b.height - 1, Math.floor(y))), o = (iy * b.width + ix) * 4; stroke.target = [b.data[o], b.data[o + 1], b.data[o + 2]]; }
  if (PIXEL.includes(tool)) pixelSegment(stroke, q); else stroke.pts = [q];
  tab.ui.draw();
};
paintHooks.move = (tab, x, y) => {
  const q: E.Pt = [x, y];
  if (mdrag && mdrag.tab === tab) { markupMove(q); return; }
  if (!stroke || stroke.tab !== tab) return;
  if (PIXEL.includes(stroke.tool)) pixelSegment(stroke, q); else if (SHAPES.includes(stroke.tool)) shapeDraw(stroke, stroke.pts[0], q);
  tab.ui.draw();
};
paintHooks.up = (tab) => {
  if (mdrag && mdrag.tab === tab) { void markupUp(); return; }
  if (stroke && stroke.tab === tab) commit(stroke);
};
paintHooks.overlay = (ctx, v, r, pointer) => {
  const p = v.picture; if (!p) return;
  const items = M.itemsOf(p);
  if (items.length) M.drawMarkup(ctx, items, { k: v.zoom, ox: r.x, oy: r.y }, paint.open && paint.mode === 'markup' ? paint.selected : 0);
  if (!paint.open || paint.mode !== 'paint' || !pointer) return;
  const t = paint.tool;
  if (['brush', 'eraser', 'spray', 'clone', 'heal', 'redEye', 'colorReplace', 'pencil'].includes(t)) {
    const rad = (t === 'spray' ? paint.size : paint.size / 2) * v.zoom;
    ctx.save(); ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(pointer.x, pointer.y, Math.max(2, rad), 0, Math.PI * 2); ctx.stroke(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke(); ctx.restore();
  }
  if ((t === 'clone' || t === 'heal') && paint.cloneSource) {
    const q = paint.cloneOffset && stroke ? [stroke.pts[stroke.pts.length - 1][0] + paint.cloneOffset[0], stroke.pts[stroke.pts.length - 1][1] + paint.cloneOffset[1]] : paint.cloneOffset ? [(pointer.x - r.x) / v.zoom + paint.cloneOffset[0], (pointer.y - r.y) / v.zoom + paint.cloneOffset[1]] : paint.cloneSource;
    const sx = r.x + q[0] * v.zoom, sy = r.y + q[1] * v.zoom;
    ctx.save(); ctx.strokeStyle = '#00e0ff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(sx - 8, sy); ctx.lineTo(sx + 8, sy); ctx.moveTo(sx, sy - 8); ctx.lineTo(sx, sy + 8); ctx.stroke(); ctx.restore();
  }
};
paintHooks.beforeSave = async (app, tab) => {
  const p = tab.picture; if (!p || !M.itemsOf(p).length) return true;
  const yes = await confirmDialog('Markup not flattened', `${M.itemsOf(p).length} markup item${M.itemsOf(p).length === 1 ? '' : 's'} are drawn over the picture but not in it. Flatten them into the picture before saving? (Choose Save Without Markup to keep them editable here; they are not saved in the file.)`, 'Flatten and Save', 'Save Without Markup');
  if (yes) flattenMarkup(app);
  return true;
};
