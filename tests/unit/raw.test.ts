import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { readDng, isDng } from '../../src/raw/dng';
import { develop, whiteXY, cctOf, encodeTrc, orientRaster } from '../../src/raw/develop';
import { decodeLjpeg } from '../../src/raw/ljpeg';
import { decodePngTolerant } from '../../src/codecs/png';

const fx = (n: string) => new Uint8Array(readFileSync(`tests/fixtures/raw/${n}`));
const ref = (n: string) => { const d = decodePngTolerant(fx(n)); const f = d.pages[0].frames[0]; return { w: f.raster.width, h: f.raster.height, data: f.raster.data }; };
const cfaRef = (n: string) => { const b = fx(n); return new Uint16Array(b.buffer, b.byteOffset, b.byteLength / 2); };

describe('DNG reading', () => {
  it('reads uncompressed, lossless-JPEG and packed raw data exactly as LibRaw does', () => {
    for (const [name, pattern, black, white, orient] of [['synth', [0, 1, 1, 2], [512, 514, 510, 512], 15000, 1], ['synth-lj92', [1, 0, 2, 1], [256, 256, 256, 256], 4095, 6], ['synth-packed', [2, 1, 1, 0], [128, 128, 128, 128], 4000, 1]] as const) {
      const bytes = fx(`${name}.dng`); expect(isDng(bytes)).toBe(true);
      const r = readDng(bytes);
      expect([r.width, r.height, r.samples, r.cfa, [...r.black], r.white[0], r.orientation]).toEqual([192, 128, 1, pattern, black, white, orient]);
      const want = cfaRef(`${name}.cfa.bin`);
      let same = 0; for (let i = 0; i < want.length; i++) if (want[i] === r.data[i]) same++;
      expect(same).toBe(want.length);
      expect(r.asShotNeutral!.map((v) => +v.toFixed(3))).toEqual([0.389, 1, 0.721]);
    }
  });
  it('decodes lossless JPEG with each predictor, one or two components and a point transform', () => {
    // A small encoder: all 17 difference categories get 5-bit codes.
    const encode = (data: number[], w: number, h: number, comps: number, pred: number, prec: number, pt = 0): Uint8Array => {
      const out: number[] = [0xff, 0xd8];
      out.push(0xff, 0xc4, 0, 2 + 17 + 17, 0x00, 0, 0, 0, 0, 17, ...new Array(11).fill(0), ...Array.from({ length: 17 }, (_, i) => i));
      out.push(0xff, 0xc3, 0, 8 + 3 * comps, prec, h >> 8, h & 255, w >> 8, w & 255, comps); for (let c = 0; c < comps; c++) out.push(c + 1, 0x11, 0);
      out.push(0xff, 0xda, 0, 6 + 2 * comps, comps); for (let c = 0; c < comps; c++) out.push(c + 1, 0); out.push(pred, 0, pt);
      let acc = 0, n = 0; const body: number[] = [];
      const put = (v: number, k: number) => { for (let i = k - 1; i >= 0; i--) { acc = (acc << 1) | ((v >> i) & 1); if (++n === 8) { body.push(acc); if (acc === 0xff) body.push(0); acc = 0; n = 0; } } };
      const sv = data.map((v) => v >> pt), row = w * comps;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < comps; c++) {
        const i = y * row + x * comps + c; let p: number;
        if (!y && !x) p = 1 << (prec - pt - 1); else if (!y) p = sv[i - comps]; else if (!x) p = sv[i - row];
        else { const A = sv[i - comps], B = sv[i - row], C = sv[i - row - comps]; p = [0, A, B, C, A + B - C, A + ((B - C) >> 1), B + ((A - C) >> 1), (A + B) >> 1][pred]; }
        let d = ((sv[i] - p) % 65536 + 65536 + 32768) % 65536 - 32768; const cat = d === 0 ? 0 : d === -32768 ? 16 : Math.floor(Math.log2(Math.abs(d))) + 1;
        put(cat, 5); if (cat && cat < 16) put(d > 0 ? d : d - 1, cat);
      }
      if (n) put((1 << (8 - n)) - 1, 8 - n);
      return new Uint8Array([...out, ...body, 0xff, 0xd9]);
    };
    let s = 11; const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
    for (const comps of [1, 2]) for (let pred = 1; pred <= 7; pred++) {
      const w = 9, h = 5, prec = 14, data = Array.from({ length: w * h * comps }, (_, i) => Math.floor(2000 + 6000 * Math.sin(i / 3) ** 2 + rnd() * 900));
      const f = decodeLjpeg(encode(data, w, h, comps, pred, prec));
      expect([f.width, f.height, f.comps, f.precision]).toEqual([w, h, comps, prec]);
      expect([...f.data], `predictor ${pred}, ${comps} component(s)`).toEqual(data);
    }
    const pt = decodeLjpeg(encode([400, 804, 1200, 4], 2, 2, 1, 1, 12, 2));
    expect([...pt.data]).toEqual([400, 804, 1200, 4]);
  });
});

describe('Develop RAW', () => {
  const compare = (a: Uint8ClampedArray, w: number, h: number, b: { w: number; h: number; data: Uint8ClampedArray }, border = 3) => {
    expect([w, h]).toEqual([b.w, b.h]);
    let sum = 0, max = 0, n = 0;
    for (let y = border; y < h - border; y++) for (let x = border; x < w - border; x++) for (let c = 0; c < 3; c++) { const i = (y * w + x) * 4 + c, d = Math.abs(a[i] - b.data[i]); sum += d; max = Math.max(max, d); n++; }
    return { mean: sum / n, max };
  };
  it('matches LibRaw: bilinear, camera white balance, clipped highlights, sRGB', () => {
    for (const name of ['synth', 'synth-lj92', 'synth-packed']) {
      const d = develop(fx(`${name}.dng`), { demosaic: 'bilinear', highlights: 'clip', wb: 'asShot', space: 'srgb', orient: false });
      const r = compare(d.raster.data, d.raster.width, d.raster.height, ref(`${name}.srgb.png`));
      expect(r.mean, name).toBeLessThan(0.6); expect(r.max, name).toBeLessThanOrEqual(3);
      expect(d.multipliers.map((v) => +v.toFixed(3))).toEqual([2.574, 1, 1.388]);
    }
  });
  it('orients, half-sizes, and rebuilds blown highlights as white', () => {
    const lj = develop(fx('synth-lj92.dng'), { demosaic: 'half' });
    expect([lj.raster.width, lj.raster.height]).toEqual([64, 96]); // half size, turned for Orientation 6
    const clip = develop(fx('synth.dng'), { demosaic: 'high', highlights: 'clip' }), rec = develop(fx('synth.dng'), { demosaic: 'high', highlights: 'recover' });
    const at = (d: typeof clip, x: number, y: number) => [...d.raster.data.subarray((y * d.raster.width + x) * 4, (y * d.raster.width + x) * 4 + 3)];
    const blown = at(rec, 170, 100), blownClip = at(clip, 170, 100);
    expect(Math.min(...blown)).toBeGreaterThanOrEqual(245); expect(Math.max(...blownClip) - Math.min(...blownClip)).toBeLessThan(40);
    // Away from the highlight, the gradient-corrected demosaic stays close to bilinear.
    const bil = develop(fx('synth.dng'), { demosaic: 'bilinear', highlights: 'clip' });
    const r = compare(clip.raster.data, 192, 128, { w: 192, h: 128, data: bil.raster.data }, 4);
    expect(r.mean).toBeLessThan(4);
  });
  it('white balance by temperature and output spaces', () => {
    const d = develop(fx('synth.dng'), { wb: 'asShot' });
    expect(Math.abs(d.temp - 6504)).toBeLessThan(150); // the scene's white is D65
    expect(Math.abs(d.tint)).toBeLessThan(6);
    const warm = develop(fx('synth.dng'), { wb: 'custom', temp: 3200, tint: 0 }), cool = develop(fx('synth.dng'), { wb: 'custom', temp: 9000 });
    const mean = (x: typeof d, c: number) => { let s = 0; for (let i = c; i < x.raster.data.length; i += 4) s += x.raster.data[i]; return s / (x.raster.data.length / 4); };
    // Telling the camera the light was warm makes the picture bluer, and cool makes it warmer.
    expect(mean(warm, 2) - mean(warm, 0)).toBeGreaterThan(mean(d, 2) - mean(d, 0) + 10);
    expect(mean(cool, 0) - mean(cool, 2)).toBeGreaterThan(mean(d, 0) - mean(d, 2) + 5);
    const pp = develop(fx('synth.dng'), { space: 'prophoto' });
    expect(new TextDecoder().decode(pp.icc.subarray(36, 40))).toBe('acsp');
    expect(mean(pp, 1)).not.toBe(mean(d, 1));
    const auto = develop(fx('synth.dng'), { wb: 'auto' }); expect(auto.neutral[1]).toBe(1);
  });
  it('has the helpers right', () => {
    const [x, y] = whiteXY(6504); expect(x).toBeCloseTo(0.3127, 3); expect(y).toBeCloseTo(0.329, 3);
    expect(Math.abs(cctOf(0.3127, 0.329) - 6504)).toBeLessThan(30);
    expect(Math.abs(cctOf(...whiteXY(2856)) - 2856)).toBeLessThan(20);
    const s = encodeTrc({ g: 2.4, a: 1 / 1.055, b: 0.055 / 1.055, c: 1 / 12.92, d: 0.04045 });
    expect(s(0.0031308 * 0.5)).toBeCloseTo(0.0031308 * 0.5 * 12.92, 6); expect(s(0.214)).toBeCloseTo(0.5, 2);
    const r = { width: 2, height: 1, data: new Uint8ClampedArray([1, 0, 0, 255, 2, 0, 0, 255]) as Uint8ClampedArray<ArrayBuffer> };
    const o = orientRaster(r, 6); expect([o.width, o.height, o.data[0], o.data[4]]).toEqual([1, 2, 1, 2]);
    const o8 = orientRaster(r, 8); expect([o8.data[0], o8.data[4]]).toEqual([2, 1]);
  });
});
