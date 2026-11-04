import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { decodeIff, decodeMacPaint, decodePcd, isIff, isPcd } from '../../src/codecs/retro';
import { decodePngTolerant } from '../../src/codecs/png';
import { sniff } from '../../src/codecs/registry';
import type { Raster } from '../../src/codecs/raster';

const fx = (n: string) => new Uint8Array(readFileSync(`tests/fixtures/retro/${n}`));
const ref = (n: string) => decodePngTolerant(fx(n)).pages[0].frames[0].raster;
function diff(a: Raster, b: Raster, alpha = true) {
  expect([a.width, a.height]).toEqual([b.width, b.height]);
  let max = 0; for (let i = 0; i < a.data.length; i++) if (alpha || (i & 3) !== 3) max = Math.max(max, Math.abs(a.data[i] - b.data[i]));
  return max;
}

describe('MacPaint (expected: ImageMagick\'s decoding)', () => {
  it('a plain MacPaint file, by its name', () => {
    expect(sniff(fx('paint.mac'), 'paint.mac')?.id).toBe('macpaint');
    const d = decodeMacPaint(fx('paint.mac'));
    expect(diff(d.pages[0].frames[0].raster, ref('paint.png'))).toBe(0);
    expect(d.pages[0].notes[0]).toMatch(/MacPaint document \(version 2\)/);
  });
  it('a MacBinary file, by its content', () => {
    expect(sniff(fx('paint-macbinary.bin'), 'x.bin')?.id).toBe('macpaint');
    const d = decodeMacPaint(fx('paint-macbinary.bin'));
    expect(diff(d.pages[0].frames[0].raster, ref('paint.png'))).toBe(0);
    expect(d.pages[0].notes[0]).toMatch(/MacBinary file "Family Tree"/);
  });
});

describe('Amiga IFF ILBM and PBM (files written from the EA IFF-85 and ILBM descriptions)', () => {
  for (const [file, png, note] of [['planes4.iff', 'planes4.png', /4 bitplanes, ByteRun1, palette of 16/], ['mask.iff', 'mask.png', /5 bitplanes, uncompressed/], ['transparent.iff', 'transparent.png', /3 bitplanes/],
    ['ehb.iff', 'ehb.png', /Extra Half-Brite/], ['ham6.iff', 'ham6.png', /HAM6/], ['ham8.iff', 'ham8.png', /HAM8/], ['deep24.iff', 'deep24.png', /24-bit deep ILBM/],
    ['chunky.lbm', 'chunky.png', /PBM \(Deluxe Paint II, chunky\)/], ['ocs.iff', 'ocs.png', /4-bit, widened/]] as const) it(file, () => {
    expect([isIff(fx(file)), sniff(fx(file), 'x')?.id]).toEqual([true, 'iff']);
    const d = decodeIff(fx(file));
    expect(diff(d.pages[0].frames[0].raster, ref(png)), file).toBe(0);
    expect(d.pages[0].notes[0]).toMatch(note);
  });
  it('alpha from a mask plane and from a transparent color', () => {
    expect([decodeIff(fx('mask.iff')).pages[0].hasAlpha, decodeIff(fx('transparent.iff')).pages[0].hasAlpha, decodeIff(fx('planes4.iff')).pages[0].hasAlpha]).toEqual([true, true, false]);
  });
  it('color cycling plays as an animation', () => {
    const p = decodeIff(fx('cycle.iff')).pages[0];
    expect(p.frames.length).toBe(8); expect(p.notes.join(' ')).toMatch(/color cycling: 1 range, played as an animation of 8 frames/);
    p.frames.forEach((f, k) => expect(diff(f.raster, ref(`cycle-${k}.png`)), `frame ${k}`).toBe(0));
    expect(p.frames[0].delay).toBe(33); // rate 8192: 30 steps a second
  });
  it('damaged files are reported', () => {
    const u = fx('planes4.iff'); const cut = u.slice(0, 40);
    expect(() => decodeIff(cut)).toThrow(/no BMHD or BODY/);
  });
});

describe('Kodak Photo CD (written by ImageMagick; expected: Pillow\'s decoding with Kodak\'s Photo YCC conversion)', () => {
  it('the Base image', () => {
    expect([isPcd(fx('photo.pcd')), sniff(fx('photo.pcd'), 'x')?.id]).toEqual([true, 'pcd']);
    const d = decodePcd(fx('photo.pcd'));
    // Pillow computes the same conversion in integer steps: at most 3 levels apart, two thirds of samples identical.
    expect(diff(d.pages[0].frames[0].raster, ref('photo.png'))).toBeLessThanOrEqual(3);
    let sum = 0; const a = d.pages[0].frames[0].raster.data, b = ref('photo.png').data;
    for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
    expect(sum / a.length).toBeLessThan(1);
  });
  it('the disc\'s orientation turns the picture as Pillow and ImageMagick do', () => {
    const base = decodePcd(fx('photo.pcd')).pages[0].frames[0].raster;
    const turned = (o: number) => { const u = fx('photo.pcd').slice(); u[0x0e02] = (u[0x0e02] & ~3) | o; return decodePcd(u).pages[0].frames[0].raster; };
    const ccw = turned(1), cw = turned(3), none = turned(2);
    expect([ccw.width, ccw.height, cw.width, cw.height, none.width]).toEqual([512, 768, 512, 768, 768]);
    const px = (r: Raster, x: number, y: number) => [...r.data.subarray((y * r.width + x) * 4, (y * r.width + x) * 4 + 3)];
    expect(px(ccw, 150, 767 - 200)).toEqual(px(base, 200, 150)); // counterclockwise: (x, y) → (y, W − 1 − x)
    expect(px(cw, 511 - 150, 200)).toEqual(px(base, 200, 150)); // clockwise: (x, y) → (H − 1 − y, x)
  });
});
