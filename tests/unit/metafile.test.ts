import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { isEmf, isWmf, renderEmf, renderWmf } from '../../src/codecs/metafile';
import { sniff } from '../../src/codecs/registry';

// jsdom has no 2D canvas, so the interpreter draws into a recording context: every fill, stroke, text and
// bitmap is logged with its style, clip count and the bounding box of what was drawn, in canvas pixels.
type Box = [number, number, number, number];
interface Op { op: string; style?: string; box?: Box; clips: number; dash?: number[]; width?: number; text?: string; font?: string; pixels?: number[]; rule?: string; transform?: number[] }

class RecPath {
  pts: [number, number][] = [];
  moveTo(x: number, y: number) { this.pts.push([x, y]); }
  lineTo(x: number, y: number) { this.pts.push([x, y]); }
  bezierCurveTo(_a: number, _b: number, _c: number, _d: number, x: number, y: number) { this.pts.push([_a, _b], [_c, _d], [x, y]); }
  rect(x: number, y: number, w: number, h: number) { this.pts.push([x, y], [x + w, y + h]); }
  closePath() { /* nothing to record */ }
  addPath(p: RecPath) { this.pts.push(...p.pts); }
  box(): Box { const xs = this.pts.map((p) => p[0]), ys = this.pts.map((p) => p[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; }
}
class RecImageData { data: Uint8ClampedArray; constructor(public width: number, public height: number) { this.data = new Uint8ClampedArray(width * height * 4); } }

class RecCtx {
  ops: Op[] = []; stack: number[] = []; clips = 0; image: RecImageData | null = null;
  fillStyle: any = '#000'; strokeStyle: any = '#000'; lineWidth = 1; dash: number[] = []; font = ''; t = [1, 0, 0, 1, 0, 0];
  lineCap = ''; lineJoin = ''; textBaseline = ''; textAlign = ''; globalCompositeOperation = ''; globalAlpha = 1; imageSmoothingQuality = '';
  constructor(public canvas: HTMLCanvasElement) {}
  private style(s: any) { return typeof s === 'string' ? s : s?.kind ?? String(s); }
  save() { this.stack.push(this.clips); }
  restore() { this.clips = this.stack.pop() ?? 0; this.t = [1, 0, 0, 1, 0, 0]; }
  clip() { this.clips++; }
  fill(p: RecPath, rule?: string) { this.ops.push({ op: 'fill', style: this.style(this.fillStyle), box: p.box(), clips: this.clips, rule }); }
  stroke(p: RecPath) { this.ops.push({ op: 'stroke', style: this.style(this.strokeStyle), box: p.box(), clips: this.clips, dash: [...this.dash], width: this.lineWidth }); }
  fillRect(x: number, y: number, w: number, h: number) { (this.canvas as any).__rects = ((this.canvas as any).__rects || 0) + 1; this.ops.push({ op: 'fillRect', style: this.style(this.fillStyle), box: [x, y, x + w, y + h], clips: this.clips, transform: [...this.t] }); }
  fillText(text: string, x: number, y: number) { this.ops.push({ op: 'text', text, font: this.font, style: this.style(this.fillStyle), box: [x, y, x, y], clips: this.clips, transform: [...this.t] }); }
  measureText(s: string) { return { width: s.length * 8 }; }
  setLineDash(d: number[]) { this.dash = d; }
  translate(x: number, y: number) { this.t = [this.t[0], this.t[1], this.t[2], this.t[3], this.t[4] + x, this.t[5] + y]; }
  rotate(a: number) { const [c, s] = [Math.cos(a), Math.sin(a)], [m0, m1, m2, m3] = this.t; this.t = [m0 * c + m2 * s, m1 * c + m3 * s, -m0 * s + m2 * c, -m1 * s + m3 * c, this.t[4], this.t[5]]; }
  setTransform(...m: number[]) { this.t = m; }
  createPattern(c: HTMLCanvasElement) { return { kind: `pattern ${c.width}×${c.height}` }; }
  putImageData(img: RecImageData) { this.image = img; }
  drawImage(img: HTMLCanvasElement, ...a: number[]) {
    const [dx, dy, dw, dh] = a.slice(-4), t = this.t, pt = (x: number, y: number) => [t[0] * x + t[2] * y + t[4], t[1] * x + t[3] * y + t[5]];
    const p0 = pt(dx, dy), p1 = pt(dx + dw, dy + dh), src = ((img.getContext('2d') as unknown) as RecCtx).image;
    this.ops.push({ op: 'image', box: [Math.min(p0[0], p1[0]), Math.min(p0[1], p1[1]), Math.max(p0[0], p1[0]), Math.max(p0[1], p1[1])], clips: this.clips, pixels: src ? [...src.data] : [] });
  }
}

beforeAll(() => {
  const ctxs = new WeakMap<HTMLCanvasElement, RecCtx>();
  (HTMLCanvasElement.prototype as any).getContext = function (this: HTMLCanvasElement) { let c = ctxs.get(this); if (!c) { c = new RecCtx(this); ctxs.set(this, c); } return c; };
  (globalThis as any).Path2D = RecPath;
  (globalThis as any).ImageData = RecImageData;
});

const fx = (n: string) => new Uint8Array(readFileSync(`tests/fixtures/metafile/${n}`));
const ops = (c: HTMLCanvasElement) => ((c.getContext('2d') as unknown) as RecCtx).ops;
const near = (a: number[], b: number[], t = 1.5) => a.every((v, i) => Math.abs(v - b[i]) <= t);

describe('Windows Metafile (WMF)', () => {
  it('is recognized, placeable or not', () => {
    const u = fx('shapes.wmf');
    expect([isWmf(u), isEmf(u), isWmf(fx('drawing.wmf')), isWmf(fx('shapes.emf'))]).toEqual([true, false, true, false]);
    expect(isWmf(u.subarray(22))).toBe(true); // the standard header alone
    expect(sniff(u, 'x.bin')?.id).toBe('wmf');
  });
  it('maps the placeable frame to 96 dpi and draws each shape where GDI puts it', async () => {
    const r = await renderWmf(fx('shapes.wmf'));
    expect([r.canvas.width, r.canvas.height]).toEqual([192, 144]); // 2880 × 2160 units at 1440 per inch
    expect(r.notes[0]).toMatch(/placeable/);
    expect(r.warnings).toEqual([]);
    const o = ops(r.canvas), k = 96 / 1440, px = (b: number[]) => b.map((v) => v * k);
    const fills = o.filter((x) => x.op === 'fill'), strokes = o.filter((x) => x.op === 'stroke');
    // Rectangle (red), ellipse (blue), polygon (green cross hatch as an 8 × 8 pattern), pie (blue).
    expect(fills[0].style).toBe('rgb(208,48,48)'); expect(near(fills[0].box!, px([200, 200, 1200, 1000]))).toBe(true);
    expect(fills[1].style).toBe('rgb(48,96,208)'); expect(near(fills[1].box!, px([1500, 200, 2700, 1000]))).toBe(true);
    expect(fills[2].style).toBe('pattern 8×8'); expect(near(fills[2].box!, px([200, 1200, 1200, 2000]))).toBe(true);
    expect(fills[2].rule).toBe('evenodd');
    // The null-brush round rectangle is outlined only, so the pie is the fourth fill.
    expect(fills).toHaveLength(4);
    expect(fills[3].style).toBe('rgb(48,96,208)');
    expect(fills[3].box![0]).toBeCloseTo(2000 * k, 0); expect(fills[3].box![2]).toBeCloseTo(2800 * k, 0);
    // Pens: 40 units black, scaled; the purple pen dashed.
    expect(strokes[0].width).toBeCloseTo(40 * k, 3);
    const dashed = strokes.find((s) => s.style === 'rgb(120,0,160)')!;
    expect(dashed.dash!.length).toBe(2);
    expect(near(dashed.box!, px([2100, 1300, 2600, 1950]))).toBe(true);
    // Text: Arial bold, 200 units, at its baseline.
    const t = o.find((x) => x.op === 'text')!;
    expect(t.text).toBe('Anne'); expect(t.font).toMatch(/^700 13\.3\d*px "Arial"/);
    expect(near(t.transform!.slice(4), px([1500, 2050]))).toBe(true);
    // The 4 × 4 DIB, bottom-up rows, stretched over 400 × 400 units.
    const im = o.find((x) => x.op === 'image')!;
    expect(near(im.box!, px([1400, 1150, 1800, 1550]))).toBe(true);
    expect(im.pixels!.slice(0, 8)).toEqual([0, 0, 128, 255, 255, 0, 128, 255]); // (0,0) and (1,0) of the picture
  });
  it('sizes a WMF without a placeable header from its window', async () => {
    const r = await renderWmf(fx('shapes.wmf').slice(22));
    expect([r.canvas.width, r.canvas.height]).toEqual([192, 144]);
    expect(r.notes[0]).not.toMatch(/placeable/);
  });
  it('a LibreOffice export draws without warnings', async () => {
    const r = await renderWmf(fx('drawing.wmf'));
    expect([r.canvas.width, r.canvas.height]).toEqual([373, 273]);
    expect(ops(r.canvas).length).toBeGreaterThan(5);
  });
  it('reports a truncated file', async () => {
    const r = await renderWmf(fx('shapes.wmf').slice(0, 400));
    expect(r.warnings.join(' ')).toMatch(/ends early/);
  });
});

describe('Enhanced Metafile (EMF)', () => {
  it('is recognized', () => {
    expect([isEmf(fx('shapes.emf')), isEmf(fx('drawing.emf')), isEmf(fx('shapes.wmf'))]).toEqual([true, true, false]);
    expect(sniff(fx('shapes.emf'), 'x.bin')?.id).toBe('emf');
  });
  it('gzipped .emz and .wmz are told apart by name', () => {
    const z = new Uint8Array(gzipSync(fx('shapes.emf')));
    expect([sniff(z, 'clip.emz')?.id, sniff(new Uint8Array(gzipSync(fx('shapes.wmf'))), 'clip.wmz')?.id]).toEqual(['emf', 'wmf']);
  });
  it('mapping mode, Save/RestoreDC, world transform, path, clip, text and bitmap', async () => {
    const r = await renderEmf(fx('shapes.emf'));
    expect([r.canvas.width, r.canvas.height]).toEqual([192, 144]); // 50.8 × 38.1 mm at 96 dpi
    expect(r.notes[0]).toMatch(/50\.8 × 38\.1 mm/);
    expect(r.warnings).toEqual([]);
    const o = ops(r.canvas), k = 0.1; // the window is 1920 × 1440 over a 192 × 144 viewport
    const fills = o.filter((x) => x.op === 'fill'), strokes = o.filter((x) => x.op === 'stroke');
    expect(fills[0].style).toBe('rgb(208,48,48)'); expect(near(fills[0].box!, [10, 10, 70, 60])).toBe(true);
    expect(strokes[0].width).toBeCloseTo(30 * k, 2);
    // The NULL_BRUSH ellipse inside SaveDC: stroked with the 1-pixel cosmetic black pen, not filled.
    const ell = strokes[1]; expect([ell.style, ell.width]).toEqual(['#000', 1]); expect(near(ell.box!, [80, 10, 180, 60])).toBe(true);
    // After RestoreDC the rotated square uses its own blue brush and the restored 30-unit pen.
    const sq = fills[1]; expect(sq.style).toBe('rgb(48,96,208)');
    const half = (Math.cos(Math.PI / 6) + Math.sin(Math.PI / 6)) * 20; // a 40 × 40 square turned 30°
    expect(near(sq.box!, [135 - half, 105 - half, 135 + half, 105 + half], 1)).toBe(true);
    expect(strokes[2].width).toBeCloseTo(3, 2);
    // The Bézier lens path, stroked and filled.
    const lens = fills[2]; expect(lens.style).toBe('rgb(40,160,80)'); expect(near(lens.box!, [15, 75, 85, 145], 0.5)).toBe(true);
    // The orange ellipse under IntersectClipRect, with NULL_PEN.
    const orange = fills[3]; expect([orange.style, orange.clips]).toEqual(['rgb(240,170,20)', 1]);
    expect(o.filter((x) => x.op === 'stroke' && x.style === 'rgb(240,170,20)')).toHaveLength(0);
    // Text with a 20° escapement, at (950, 600).
    const t = o.find((x) => x.op === 'text')!;
    expect(t.text).toBe('Lens'); expect(near(t.transform!.slice(4), [95, 60])).toBe(true);
    expect(Math.atan2(t.transform![1], t.transform![0]) * 180 / Math.PI).toBeCloseTo(-20, 3);
    // The 4 × 2 top-down 32-bit bitmap (fourth bytes all 255) over 300 × 150 units.
    const im = o.find((x) => x.op === 'image')!;
    expect(near(im.box!, [150, 15, 180, 30])).toBe(true);
    expect(im.pixels!.slice(0, 8)).toEqual([255, 255, 0, 255, 0, 255, 255, 255]);
    // The clip ended with RestoreDC: the text is not clipped.
    expect(t.clips).toBe(0);
  });
  it('a LibreOffice export draws without warnings', async () => {
    const r = await renderEmf(fx('drawing.emf'));
    expect([r.canvas.width, r.canvas.height]).toEqual([373, 273]);
    expect(r.warnings).toEqual([]);
  });
  it('limits the canvas to maxSide', async () => {
    const r = await renderEmf(fx('drawing.emf'), { maxSide: 100 });
    expect(Math.max(r.canvas.width, r.canvas.height)).toBe(100);
  });
});
