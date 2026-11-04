import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { isClp, clpPicture, decodeDdb } from '../../src/codecs/clipboard';
import { decodeBmp } from '../../src/codecs/bmp';
import { decodePngTolerant } from '../../src/codecs/png';

const fx = (n: string) => new Uint8Array(readFileSync(`tests/fixtures/clipboard/${n}`));
const ref = (n: string) => decodePngTolerant(fx(n)).pages[0].frames[0].raster;
function maxDiff(a: { width: number; height: number; data: Uint8ClampedArray }, b: { width: number; height: number; data: Uint8ClampedArray }) {
  expect([a.width, a.height]).toEqual([b.width, b.height]);
  let m = 0; for (let i = 0; i < a.data.length; i += 4) for (let c = 0; c < 3; c++) m = Math.max(m, Math.abs(a.data[i + c] - b.data[i + c])); return m;
}

describe('Windows clipboard files', () => {
  it('Windows 3.x and NT directories', () => {
    expect(['dib31.clp', 'dib8nt.clp', 'ddb31.clp', 'wmf31.clp', 'emfnt.clp'].map((n) => isClp(fx(n)))).toEqual([true, true, true, true, true]);
    const a = clpPicture(fx('dib31.clp')); expect([a.nt, a.entries.map((e) => e.name)]).toEqual([false, ['text', 'DIB']]);
    const b = clpPicture(fx('emfnt.clp')); expect([b.nt, b.picture?.kind, b.entries.map((e) => e.name)]).toEqual([true, 'emf', ['enhanced metafile', 'text']]);
  });
  it('a DIB is shown as a BMP (24 bits, and 8 bits with its palette)', () => {
    const a = clpPicture(fx('dib31.clp')).picture!; expect(a.kind).toBe('bmp');
    expect(maxDiff(decodeBmp((a as any).bytes).pages[0].frames[0].raster, ref('dib.png'))).toBe(0);
    const b = clpPicture(fx('dib8nt.clp')).picture!;
    expect(maxDiff(decodeBmp((b as any).bytes).pages[0].frames[0].raster, ref('dib8.png'))).toBe(0);
  });
  it('a device-dependent bitmap', () => {
    const c = clpPicture(fx('ddb31.clp')); expect(c.picture?.kind).toBe('ddb');
    expect(maxDiff(decodeDdb(c.picture!.entry.data, c.nt).pages[0].frames[0].raster, ref('ddb.png'))).toBe(0);
  });
  it('a metafile picture becomes a placeable WMF of the same size as the original', () => {
    const w = clpPicture(fx('wmf31.clp')).picture as { kind: string; bytes: Uint8Array };
    const orig = new Uint8Array(readFileSync('tests/fixtures/metafile/shapes.wmf'));
    expect(w.kind).toBe('wmf');
    const dv = (u: Uint8Array) => new DataView(u.buffer, u.byteOffset, u.byteLength);
    const size = (u: Uint8Array) => { const d = dv(u); return [(d.getInt16(10, true) - d.getInt16(6, true)) / d.getUint16(14, true), (d.getInt16(12, true) - d.getInt16(8, true)) / d.getUint16(14, true)]; };
    const [a, b] = [size(w.bytes), size(orig)];
    expect(Math.abs(a[0] - b[0]) * 96).toBeLessThan(0.5); expect(Math.abs(a[1] - b[1]) * 96).toBeLessThan(0.5); // the same size in pixels
    expect([...w.bytes.subarray(22)]).toEqual([...orig.subarray(22)]);
  });
});
