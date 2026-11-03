import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { decodeJxl, decodeAvif, setModernModules, jxlTicksPerSecond } from '../../src/codecs/modern';
import { decodePngTolerant } from '../../src/codecs/png';
import { sniff } from '../../src/codecs/registry';

// jxl-oxide and libavif (jSquash) from node_modules, initialized from their WebAssembly bytes.
beforeAll(async () => {
  const root = process.cwd() + '/node_modules/', jp = root + 'jxl-oxide-wasm/jxl_oxide_wasm.js', ap = root + '@jsquash/avif/decode.js'; // by file (package exports hide them)
  const jxl: any = await import(/* @vite-ignore */ jp);
  jxl.initSync({ module: readFileSync('node_modules/jxl-oxide-wasm/jxl_oxide_wasm_bg.wasm') });
  const avif: any = await import(/* @vite-ignore */ ap);
  await avif.init(new WebAssembly.Module(readFileSync('node_modules/@jsquash/avif/codec/dec/avif_dec.wasm')));
  setModernModules({ jxl, avif });
});
const fx = (n: string) => new Uint8Array(readFileSync(`tests/fixtures/modern/${n}`));
const ref = (n: string) => decodePngTolerant(fx(n)).pages[0].frames[0].raster;
function diff(a: { width: number; height: number; data: Uint8ClampedArray }, b: { width: number; height: number; data: Uint8ClampedArray }) {
  expect([a.width, a.height]).toEqual([b.width, b.height]);
  let max = 0; for (let i = 0; i < a.data.length; i++) max = Math.max(max, Math.abs(a.data[i] - b.data[i]));
  return max;
}

describe('JPEG XL (jxl-oxide; files from libjxl)', () => {
  it('is recognized, codestream and container', () => {
    expect([sniff(fx('lossless.jxl'), 'x')?.id, sniff(fx('recompressed.jxl'), 'x')?.id]).toEqual(['jxl', 'jxl']);
  });
  it('lossless RGB and alpha are exact', async () => {
    const a = await decodeJxl(fx('lossless.jxl')); expect(diff(a.pages[0].frames[0].raster, ref('rgb.png'))).toBe(0);
    const b = await decodeJxl(fx('alpha.jxl')); expect(diff(b.pages[0].frames[0].raster, ref('rgba.png'))).toBe(0); expect(b.pages[0].hasAlpha).toBe(true);
  });
  it('16-bit gray', async () => {
    const d = await decodeJxl(fx('gray16.jxl')); expect(diff(d.pages[0].frames[0].raster, ref('gray16.png'))).toBeLessThanOrEqual(1);
  });
  it('lossy (VarDCT) agrees with libjxl', async () => {
    const d = await decodeJxl(fx('lossy.jxl')); expect(diff(d.pages[0].frames[0].raster, ref('lossy-jxl.png'))).toBeLessThanOrEqual(2);
  });
  it('an animation: every frame', async () => {
    const d = await decodeJxl(fx('anim.jxl')), p = d.pages[0];
    expect(p.frames.length).toBe(3); expect(p.notes[0]).toMatch(/animation of 3 frames/);
    p.frames.forEach((f, k) => expect(diff(f.raster, ref(`anim-${k}.png`)), `frame ${k}`).toBe(0));
    // libjxl (through imagecodecs) writes 10 ticks per second and one tick per frame: 100 ms each.
    expect([jxlTicksPerSecond(fx('anim.jxl')), p.frames.map((f) => f.delay)]).toEqual([[10, 1], [100, 100, 100]]);
    expect(jxlTicksPerSecond(fx('lossless.jxl'))).toBeNull();
  });
  it('a recompressed JPEG in a container, with XMP', async () => {
    const d = await decodeJxl(fx('recompressed.jxl'));
    expect(diff(d.pages[0].frames[0].raster, ref('recompressed.png'))).toBeLessThanOrEqual(2);
    expect(d.pages[0].notes[0]).toMatch(/JPEG XL file; a recompressed JPEG/); expect(d.info.XMP).toMatch(/Recompressed JPEG/);
  });
  it('damaged data is reported', async () => {
    await expect(decodeJxl(fx('lossy.jxl').slice(0, 8))).rejects.toThrow(/JPEG XL/);
  });
});

describe('AVIF (libavif with libaom; files from libavif)', () => {
  it('lossy, alpha and 10-bit agree with libavif', async () => {
    const a = await decodeAvif(fx('lossy.avif')); expect(diff(a.pages[0].frames[0].raster, ref('lossy-avif.png'))).toBeLessThanOrEqual(2);
    const b = await decodeAvif(fx('alpha.avif')); expect(diff(b.pages[0].frames[0].raster, ref('alpha-avif.png'))).toBeLessThanOrEqual(2); expect(b.pages[0].hasAlpha).toBe(true);
    const c = await decodeAvif(fx('deep.avif')); expect(diff(c.pages[0].frames[0].raster, ref('deep-avif.png'))).toBeLessThanOrEqual(2);
  });
  it('an image sequence shows its first frame and says so', async () => {
    const d = await decodeAvif(fx('anim.avif'));
    expect(diff(d.pages[0].frames[0].raster, ref('anim-avif-0.png'))).toBeLessThanOrEqual(3);
    expect(d.warnings[0]).toMatch(/first frame/);
  });
  it('damaged data is reported', async () => {
    await expect(decodeAvif(fx('lossy.avif').slice(0, 100))).rejects.toThrow(/AVIF/);
  });
});
