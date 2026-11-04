import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { decodeFlic, isFlic } from '../../src/codecs/flic';
import { decodePngTolerant } from '../../src/codecs/png';
import { sniff } from '../../src/codecs/registry';

const fx = (n: string) => new Uint8Array(readFileSync(`tests/fixtures/flic/${n}`));
const ref = (n: string) => decodePngTolerant(fx(n)).pages[0].frames[0].raster;
function same(a: { width: number; height: number; data: Uint8ClampedArray }, b: { width: number; height: number; data: Uint8ClampedArray }): number {
  expect([a.width, a.height]).toEqual([b.width, b.height]);
  let bad = 0; for (let i = 0; i < a.data.length; i += 4) if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2]) bad++;
  return bad;
}

describe('Autodesk FLI and FLC', () => {
  it('is recognized by content', () => { expect(isFlic(fx('anim.fli')) && isFlic(fx('anim.flc'))).toBe(true); expect(sniff(fx('anim.flc'), 'x')?.id).toBe('flic'); });
  it('FLI: 64-color palette, BYTE_RUN, LC deltas, BLACK, COPY; frame times in 1/70 s', () => {
    const d = decodeFlic(fx('anim.fli')), p = d.pages[0];
    expect(p.frames.length).toBe(6); expect(d.warnings).toEqual([]);
    for (let n = 0; n < 6; n++) expect(same(p.frames[n].raster, ref(`anim-${n}.png`)), `frame ${n}`).toBe(0);
    expect(p.frames[0].delay).toBe(71); // 5 / 70 s
  });
  it('FLC: SS2 deltas with line skips and an odd width\'s last byte; a palette change', () => {
    const d = decodeFlic(fx('anim.flc')), p = d.pages[0];
    expect([p.width, p.height, p.frames.length]).toEqual([95, 64, 5]); expect(d.warnings).toEqual([]);
    for (let n = 0; n < 5; n++) expect(same(p.frames[n].raster, ref(`flc-${n}.png`)), `frame ${n}`).toBe(0);
    expect(p.frames[0].delay).toBe(80); expect(p.notes[0]).toMatch(/FLC \(Animator Pro\), animation of 5 frames/);
  });
  it('a 6-byte BLACK chunk, and a file cut short', () => {
    const w = 4, h = 2, hd = new Uint8Array(128), dv = new DataView(hd.buffer);
    dv.setUint16(4, 0xaf11, true); dv.setUint16(6, 2, true); dv.setUint16(8, w, true); dv.setUint16(10, h, true); dv.setUint16(12, 8, true); dv.setUint16(16, 7, true);
    const chunk = (t: number, data: number[]) => [...new Uint8Array(new Uint32Array([6 + data.length]).buffer), t & 255, t >> 8, ...data];
    const frame = (cs: number[][]) => { const body = cs.flat(); return [...new Uint8Array(new Uint32Array([16 + body.length]).buffer), 0xfa, 0xf1, cs.length, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...body]; };
    const f1 = frame([chunk(4, [1, 0, 0, 2, 0, 0, 0, 255, 255, 255]), chunk(16, new Array(w * h).fill(1))]), f2 = frame([chunk(13, [])]);
    const file = new Uint8Array([...hd, ...f1, ...f2]);
    const d = decodeFlic(file), fr = d.pages[0].frames;
    expect([fr.length, [...fr[0].raster.data.slice(0, 4)], [...fr[1].raster.data.slice(0, 4)]]).toEqual([2, [255, 255, 255, 255], [0, 0, 0, 255]]);
    const cut = decodeFlic(file.subarray(0, 128 + f1.length + 3));
    expect(cut.pages[0].frames.length).toBe(1); expect(cut.warnings[0]).toMatch(/1 of 2 frames are shown/);
  });
});
