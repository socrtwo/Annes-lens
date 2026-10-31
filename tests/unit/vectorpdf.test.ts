import { describe, expect, it } from 'vitest';
import { rgbToLab, deltaE, colorShare, averageColor } from '../../src/picture/colorSearch';
import { placeInset, connectors } from '../../src/picture/callout';
import { makePdf } from '../../src/codecs/pdfwrite';
import { pdfPageSize } from '../../src/commands/vectorPdf';
import type { Raster } from '../../src/codecs/raster';

const ras = (w: number, h: number, f: (x: number, y: number) => [number, number, number, number]): Raster => { const d = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.set(f(x, y), (y * w + x) * 4); return { width: w, height: h, data: d as Uint8ClampedArray<ArrayBuffer> }; };

describe('color search', () => {
  it('converts sRGB to L*a*b* (white, black, red reference values)', () => {
    const w = rgbToLab(255, 255, 255); expect(w[0]).toBeCloseTo(100, 1); expect(Math.abs(w[1])).toBeLessThan(0.1);
    expect(rgbToLab(0, 0, 0)[0]).toBeCloseTo(0, 5);
    const r = rgbToLab(255, 0, 0); expect(r[0]).toBeCloseTo(53.24, 0); expect(r[1]).toBeCloseTo(80.09, 0); expect(r[2]).toBeCloseTo(67.2, 0);
  });
  it('measures the share of pixels near a color, ignoring transparent ones', () => {
    const r = ras(10, 10, (x, y) => (y < 3 ? [200, 30, 30, 255] : y < 5 ? [0, 0, 0, 0] : [30, 30, 200, 255]));
    expect(colorShare(r, [210, 25, 25], 15)).toBeCloseTo(30 / 80, 5);
    expect(colorShare(r, [0, 200, 0], 15)).toBe(0);
    expect(deltaE(rgbToLab(200, 30, 30), rgbToLab(30, 30, 200))).toBeGreaterThan(100);
  });
  it('averages a rectangle', () => { const r = ras(4, 2, (x) => (x < 2 ? [100, 0, 0, 255] : [200, 0, 0, 255])); expect(averageColor(r, { x: 0, y: 0, w: 4, h: 2 })).toEqual([150, 0, 0]); });
});

describe('magnifier callout geometry', () => {
  it('puts the inset in the free corner farthest from the area and caps its size', () => {
    const { inset, zoom } = placeInset(1000, 800, { x: 50, y: 50, w: 100, h: 80 }, { zoom: 3, position: 'auto', margin: 10, maxShare: 0.45 });
    expect(zoom).toBe(3); expect(inset).toEqual({ x: 1000 - 300 - 10, y: 800 - 240 - 10, w: 300, h: 240 });
    const capped = placeInset(1000, 800, { x: 400, y: 300, w: 300, h: 200 }, { zoom: 4, position: 'tl', margin: 0, maxShare: 0.45 });
    expect(capped.zoom).toBeCloseTo(1.5, 5); expect(capped.inset).toEqual({ x: 0, y: 0, w: 450, h: 300 });
  });
  it('draws the two outer connector lines', () => {
    const lines = connectors({ x: 50, y: 50, w: 100, h: 80 }, { x: 690, y: 550, w: 300, h: 240 });
    expect(lines.length).toBe(2);
    // For an inset down and to the right, the tangents run from the top-right and bottom-left corners.
    expect(lines.map((l) => l[0])).toEqual([[150, 50], [50, 130]]);
  });
});

describe('PDF pages', () => {
  it('sizes pages by paper, orientation and the picture', () => {
    expect(pdfPageSize('a4', 'auto', 400, 300, 300).map(Math.round)).toEqual([842, 595]);
    expect(pdfPageSize('a4', 'auto', 300, 400, 300).map(Math.round)).toEqual([595, 842]);
    expect(pdfPageSize('letter', 'portrait', 400, 300, 300)).toEqual([612, 792]);
    expect(pdfPageSize('picture', 'auto', 600, 300, 150)).toEqual([288, 144]);
  });
  it('clips cover and actual-size placements and not the contained one', () => {
    const img = new Uint8Array(4 * 2 * 3), page = (fit: 'contain' | 'cover' | 'actual') => ({ image: img, raw: true, width: 4, height: 2, pageWidth: 100, pageHeight: 100, margin: 10, fit, dpi: 72 });
    const txt = new TextDecoder('latin1').decode(makePdf([page('contain'), page('cover'), page('actual')]));
    const streams = [...txt.matchAll(/stream\n(q [^\n]*Do Q)/g)].map((m) => m[1]);
    expect(streams.length).toBe(3);
    expect(streams[0]).not.toContain(' re W n'); expect(streams[1]).toContain('10.00 10.00 80.00 80.00 re W n'); expect(streams[2]).toContain(' re W n');
    expect(streams[1]).toMatch(/q 10\.00 10\.00 80\.00 80\.00 re W n 160\.00 0 0 80\.00/); // cover: 2:1 scaled to the full height
    expect(streams[2]).toMatch(/4\.00 0 0 2\.00 48\.00 49\.00 cm/); // actual at 72 dpi: 1 pt per pixel, centered
  });
});
