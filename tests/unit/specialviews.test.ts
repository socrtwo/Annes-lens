import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderStereo, splitSideBySide, mpoPair } from '../../src/picture/stereo';
import { rayToUV, renderSphere, looksEquirect } from '../../src/picture/sphere';
import { findMotionClip } from '../../src/picture/motionPhoto';
import { spreadsFor } from '../../src/commands/specialViews';
import type { Raster } from '../../src/codecs/raster';

const ras = (w: number, h: number, f: (x: number, y: number) => [number, number, number, number]): Raster => { const d = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.set(f(x, y), (y * w + x) * 4); return { width: w, height: h, data: d as Uint8ClampedArray<ArrayBuffer> }; };
const px = (r: Raster, x: number, y: number) => [...r.data.subarray((y * r.width + x) * 4, (y * r.width + x) * 4 + 3)];
const enc = (s: string) => new TextEncoder().encode(s);
const cat = (...a: Uint8Array[]) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
const mp4 = (n = 64) => { const b = new Uint8Array(n); b.set([0, 0, 0, 24]); b.set(enc('ftypisom'), 4); return b; };

describe('stereo', () => {
  const L = ras(10, 4, (x) => (x < 5 ? [255, 255, 255, 255] : [0, 0, 0, 255])), R = ras(10, 4, (x) => (x >= 3 && x < 8 ? [255, 255, 255, 255] : [0, 0, 0, 255]));
  it('makes a gray anaglyph: left in red, right in green and blue', () => {
    const a = renderStereo(L, R, 'gray');
    expect(px(a, 1, 1)).toEqual([255, 0, 0]); expect(px(a, 4, 1)).toEqual([255, 255, 255]); expect(px(a, 6, 1)).toEqual([0, 255, 255]); expect(px(a, 9, 1)).toEqual([0, 0, 0]);
    expect(px(renderStereo(L, R, 'gray', true), 1, 1)).toEqual([0, 255, 255]); // swapped: the red channel now shows the right view (dark here), cyan the left (white)
  });
  it('places eyes for cross-eye and parallel viewing', () => {
    const c = renderStereo(L, R, 'crossEye'), p = renderStereo(L, R, 'parallel');
    expect([c.width, c.height]).toEqual([20, 4]); expect(px(c, 1, 0)).toEqual([0, 0, 0]); expect(px(c, 11, 0)).toEqual([255, 255, 255]); // right | left
    expect(px(p, 1, 0)).toEqual([255, 255, 255]); expect(px(p, 11, 0)).toEqual([0, 0, 0]); // left | right
  });
  it('keeps a color picture in color with the Dubois matrices', () => { const g = ras(4, 4, () => [128, 128, 128, 255]); const d = renderStereo(g, g, 'dubois'); expect(px(d, 0, 0).every((v) => v > 100 && v < 200)).toBe(true); });
  it('splits a side-by-side picture', () => { const s = splitSideBySide(ras(10, 2, (x) => [x * 10, 0, 0, 255])); expect([s.left.width, px(s.left, 0, 0)[0], px(s.right, 0, 0)[0]]).toEqual([5, 0, 50]); });
  it('finds the two views of an MPO (two same-size JPEGs, in order), ignoring a lone JPEG', () => {
    const j = new Uint8Array(readFileSync('tests/fixtures/meta/tagged.jpg'));
    const pair = mpoPair(cat(j, j)); expect(pair).not.toBeNull(); expect(pair!.left.length).toBe(j.length); expect(pair!.right[0]).toBe(0xff); expect(pair!.right.length).toBe(j.length);
    expect(mpoPair(j)).toBeNull();
  });
});

describe('360° view', () => {
  it('looks at the middle of the panorama at yaw 0, turns right with yaw, up with pitch', () => {
    const c = rayToUV(49.5, 49.5, 100, 100, 0, 0, 90, 4000, 2000); expect(c[0]).toBeCloseTo(2000, 6); expect(c[1]).toBeCloseTo(1000, 6);
    expect(rayToUV(49.5, 49.5, 100, 100, 90, 0, 90, 4000, 2000)[0]).toBeCloseTo(3000, 6);
    expect(rayToUV(49.5, 49.5, 100, 100, 0, 45, 90, 4000, 2000)[1]).toBeCloseTo(500, 6);
    expect(rayToUV(49.5, 49.5, 100, 100, 180, 0, 90, 4000, 2000)[0] % 4000).toBeCloseTo(0, 6);
  });
  it('samples the band the view faces, wrapping round', () => {
    const bands: [number, number, number, number][] = [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255], [255, 255, 0, 255]];
    const pano = ras(400, 200, (x) => bands[Math.floor(x / 100)]);
    const at = (yaw: number) => { const o = renderSphere(pano, 21, 21, yaw, 0, 30); return [...o.subarray((10 * 21 + 10) * 4, (10 * 21 + 10) * 4 + 3)]; };
    expect(at(45)).toEqual([0, 0, 255]); expect(at(-135)).toEqual([255, 0, 0]); expect(at(135)).toEqual([255, 255, 0]); expect(at(-45)).toEqual([0, 255, 0]);
    expect(looksEquirect(8000, 4000)).toBe(true); expect(looksEquirect(4000, 3000)).toBe(false); expect(looksEquirect(5000, 3000, '<GPano:ProjectionType>equirectangular</GPano:ProjectionType>')).toBe(true);
  });
});

describe('motion photos', () => {
  const jpeg = new Uint8Array(readFileSync('tests/fixtures/meta/tagged.jpg'));
  it('finds the clip from Google\'s directory length', () => {
    const clip = mp4(100), head = cat(Uint8Array.from([0xff, 0xd8]), enc(`<Container:Item Item:Mime="image/jpeg"/><Container:Item Item:Mime="video/mp4" Item:Length="100"/>`), new Uint8Array(50));
    const f = findMotionClip(cat(head, clip)); expect(f).toMatchObject({ length: 100, mime: 'video/mp4', how: 'Google motion photo' }); expect(f!.offset).toBe(head.length);
  });
  it('finds the clip from the older MicroVideoOffset, after a Samsung marker, or appended', () => {
    const clip = mp4(80);
    expect(findMotionClip(cat(Uint8Array.from([0xff, 0xd8]), enc('GCamera:MicroVideoOffset="80"'), new Uint8Array(20), clip))).toMatchObject({ length: 80, how: 'Google motion photo' });
    expect(findMotionClip(cat(Uint8Array.from([0xff, 0xd8]), new Uint8Array(30), enc('MotionPhoto_Data'), clip))).toMatchObject({ length: 80, how: 'Samsung motion photo' });
    const appended = findMotionClip(cat(jpeg, clip)); expect(appended).toMatchObject({ offset: jpeg.length, length: 80, how: 'video after the picture' });
    const qt = mp4(40); qt.set(enc('qt  '), 8); expect(findMotionClip(cat(jpeg, qt))!.mime).toBe('video/quicktime');
    expect(findMotionClip(jpeg)).toBeNull(); expect(findMotionClip(enc('not a jpeg at all'))).toBeNull();
  });
});

describe('two-page spreads', () => {
  it('pairs pages, with the first page alone as a cover', () => {
    expect(spreadsFor(5, true)).toEqual([[0], [1, 2], [3, 4]]); expect(spreadsFor(5, false)).toEqual([[0, 1], [2, 3], [4]]);
    expect(spreadsFor(1, true)).toEqual([[0]]); expect(spreadsFor(0, true)).toEqual([]);
  });
});
