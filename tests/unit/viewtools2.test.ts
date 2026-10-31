import { describe, expect, it } from 'vitest';
import { dist, pathLength, polygonArea, segmentAngle, vertexAngle, formatLength, formatArea, scaleFrom, scaleFromDpi, readout } from '../../src/picture/measure';
import { navigatorRect } from '../../src/ui/overlays';
import { originalName, originalNames, isOriginalName, dirOf } from '../../src/picture/keepOriginal';

describe('measure', () => {
  it('measures lengths, paths and areas', () => {
    expect(dist([0, 0], [3, 4])).toBe(5);
    expect(pathLength([[0, 0], [3, 4], [3, 10]])).toBe(11);
    expect(pathLength([[0, 0], [10, 0], [10, 10], [0, 10]], true)).toBe(40);
    expect(polygonArea([[0, 0], [10, 0], [10, 10], [0, 10]])).toBe(100);
    expect(polygonArea([[0, 0], [0, 10], [10, 10], [10, 0]])).toBe(100); // either winding
    expect(polygonArea([[0, 0], [4, 0], [0, 3]])).toBe(6);
  });
  it('gives angles with 0° to the right and counterclockwise positive (y down on screen)', () => {
    expect(segmentAngle([0, 0], [10, 0])).toBe(0);
    expect(segmentAngle([0, 0], [0, -10])).toBe(90);
    expect(segmentAngle([0, 0], [0, 10])).toBe(-90);
    expect(segmentAngle([0, 0], [-10, 0])).toBe(180);
    expect(vertexAngle([10, 0], [0, 0], [0, 10])).toBeCloseTo(90, 9);
    expect(vertexAngle([10, 0], [0, 0], [-10, 0])).toBeCloseTo(180, 9);
  });
  it('converts with a scale from a known length or from the DPI', () => {
    const s = scaleFrom(200, 5, 'cm')!; expect(s.perPx).toBe(0.025);
    expect(formatLength(400, s)).toBe('10 cm (400 px)');
    expect(formatArea(400 * 400, s)).toBe('100 cm² (160000 px²)');
    expect(formatLength(12.5, null)).toBe('12.5 px');
    expect(scaleFrom(0, 5, 'cm')).toBeNull(); expect(scaleFrom(10, 5, '  ')!.unit).toBe('units');
    const d = scaleFromDpi(300, 'in')!; expect(formatLength(600, d)).toBe('2 in (600 px)');
    expect(scaleFromDpi(254, 'mm')!.perPx).toBeCloseTo(0.1, 12);
  });
  it('reads out a line, an open path and a closed shape', () => {
    expect(readout([[0, 0]], false, null)[0]).toMatch(/next point/);
    expect(readout([[0, 0], [30, -40]], false, null)).toEqual(['Distance 50 px', 'Angle 53.13°']);
    expect(readout([[0, 0], [10, 0], [10, 10]], false, null)).toEqual(['Path 20 px', 'Last segment 10 px, angle at the bend 90°']);
    expect(readout([[0, 0], [10, 0], [10, 10], [0, 10]], true, scaleFrom(10, 1, 'm'))).toEqual(['Perimeter 4 m (40 px)', 'Area 1 m² (100 px²)']);
  });
});

describe('navigator geometry', () => {
  it('fits the whole picture into the corner box', () => {
    const n = navigatorRect(1200, 800, 4000, 2000);
    expect(n.k).toBeCloseTo(180 / 4000, 9); expect([n.w, n.h]).toEqual([180, 90]); expect([n.x, n.y]).toEqual([1200 - 180 - 12, 800 - 90 - 12]);
    const p = navigatorRect(1200, 800, 1000, 3000); expect([p.w, p.h]).toEqual([60, 180]);
  });
});

describe('kept originals', () => {
  it('names the kept original and recognizes both conventions', () => {
    expect(originalName('Grandma 1926.jpg')).toBe('Grandma 1926 (original).jpg');
    expect(originalName('scan')).toBe('scan (original)');
    expect(originalNames('a.b.png')).toEqual(['a.b (original).png', 'a.b.original.png']);
    expect(isOriginalName('x (original).tif')).toBe(true); expect(isOriginalName('x.original.jpg')).toBe(true); expect(isOriginalName('original.jpg')).toBe(false);
  });
  it('finds the folder of an entry', () => {
    expect(dirOf({ name: 'a.jpg', uri: 'file:///home/p/a.jpg', read: async () => new ArrayBuffer(0) }, null)).toBe('file:///home/p');
    expect(dirOf({ name: 'a.jpg', uri: null, read: async () => new ArrayBuffer(0) }, 'fsadir:7')).toBe('fsadir:7');
    expect(dirOf({ name: 'a.jpg', uri: 'content://x/a.jpg', read: async () => new ArrayBuffer(0) }, null)).toBeNull();
  });
});
