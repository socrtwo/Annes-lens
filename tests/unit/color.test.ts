import { describe, expect, it, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseIcc, writeIcc } from '../../src/color/icc';
import { SPACES, spaceIcc, spaceProfile, isSrgb, D50 } from '../../src/color/spaces';
import { makeTransform, colorFn, makeProof, xyzToLab, labToXyz } from '../../src/color/transform';
import { docProfile, embeddedIcc, iccForSave, grayAsRgb, keepEmbedded } from '../../src/color/embedded';
import { colorStep, cmState } from '../../src/color/display';
import { pngIcc, injectPngIcc } from '../../src/meta/metaWrite';

// LittleCMS 2 reference conversions made by scripts/gen-color-fixtures.py (Pillow ImageCms).
const F = 'tests/fixtures/color/';
const ref = JSON.parse(readFileSync(F + 'lcms-reference.json', 'utf8'));
const P = (n: string) => parseIcc(new Uint8Array(readFileSync(F + n + '.icc')));
const S: number[][] = ref.samples;
const rgba = (cols: number[][]) => { const d = new Uint8ClampedArray(cols.length * 4); cols.forEach((c, i) => d.set([c[0], c[1] ?? c[0], c[2] ?? c[0], 255], i * 4)); return d; };
const maxDiff = (got: number[][], exp: number[][]) => Math.max(...got.map((g, i) => Math.max(...g.map((v, c) => Math.abs(v - exp[i][c])))));
const run = (fn: (d: Uint8ClampedArray) => void, cols: number[][], gray = false) => { const d = rgba(cols); fn(d); return cols.map((_, i) => (gray ? [d[i * 4]] : [d[i * 4], d[i * 4 + 1], d[i * 4 + 2]])); };
const float = (fn: (v: number[]) => number[], cols: number[][]) => cols.map((c) => fn(c.map((v) => v / 255)).map((v) => Math.round(v * 255)));
afterEach(() => { cmState.managed = true; cmState.proof = null; });

describe('ICC profiles', () => {
  it('writes v4 profiles that parse back with the published colorants', () => {
    const s = spaceProfile('srgb');
    expect(s.version).toBe('4.3'); expect(s.colorSpace).toBe('RGB'); expect(s.pcs).toBe('XYZ'); expect(s.description).toBe('sRGB IEC61966-2.1');
    // Red colorant of sRGB adapted to D50 (Bradford): 0.4361, 0.2225, 0.0139.
    expect(s.matrix![0]).toBeCloseTo(0.4361, 3); expect(s.matrix![3]).toBeCloseTo(0.2225, 3); expect(s.matrix![6]).toBeCloseTo(0.0139, 3);
    for (const sp of SPACES.filter((x) => !x.gray)) { const m = spaceProfile(sp.id).matrix!; for (let r = 0; r < 3; r++) expect(m[r * 3] + m[r * 3 + 1] + m[r * 3 + 2]).toBeCloseTo(D50[r], 3); }
    expect(spaceProfile('gray22').colorSpace).toBe('GRAY'); expect(spaceProfile('gray22').grayTrc!(0.5)).toBeCloseTo(Math.pow(0.5, 2.2), 4);
    expect(spaceProfile('srgb').trc![0](0.5)).toBeCloseTo(0.214, 3); expect(spaceProfile('prophoto').trc![0](0.01)).toBeCloseTo(0.01 / 16, 5);
  });
  it('reads the v2 lut16 printer profile with its paper white', () => {
    const p = P('press-cmyk');
    expect(p.version).toBe('2.1'); expect(p.colorSpace).toBe('CMYK'); expect(p.pcs).toBe('Lab'); expect(p.deviceClass).toBe('prtr');
    expect(p.description).toMatch(/test press/); expect(p.whitePoint[2]).toBeCloseTo(0.77, 3);
    expect(p.a2b[0].inCh).toBe(4); expect(p.b2a[1].outCh).toBe(4); expect(p.a2b[0].legacyLab).toBe(true);
  });
  it('knows sRGB when it sees it and refuses CMYK as a picture profile', () => {
    expect(isSrgb(P('srgb'))).toBe(true); expect(isSrgb(P('p3'))).toBe(false); expect(isSrgb(P('srgb-linear'))).toBe(false);
    expect(docProfile(spaceIcc('p3'))).not.toBeNull(); expect(docProfile(new Uint8Array(readFileSync(F + 'press-cmyk.icc')))).toBeNull(); expect(docProfile(new Uint8Array(200))).toBeNull();
  });
  it('Lab and XYZ round-trip', () => { for (const lab of [[50, 20, -30], [90, -5, 70], [5, 1, 1]]) labToXyz(lab).forEach(() => undefined), expect(xyzToLab(labToXyz(lab)).map((v) => +v.toFixed(6))).toEqual(lab.map((v) => +v.toFixed(6))); });
});

describe('Conversions match LittleCMS', () => {
  for (const [k, exp] of Object.entries(ref.convert) as [string, number[][]][]) {
    it(`${k} within one level`, () => {
      const [a, b] = k.split('>'), src = P(a === 'builtin-srgb' ? 'srgb' : a), dst = P(b);
      expect(maxDiff(run(makeTransform(src, dst), S, dst.colorSpace === 'GRAY'), exp)).toBeLessThanOrEqual(1);
      expect(maxDiff(float(colorFn(src, dst), S).map((v) => (dst.colorSpace === 'GRAY' ? [v[0]] : v)), exp)).toBeLessThanOrEqual(1);
    });
  }
  it('printer profile, both directions, relative / perceptual / absolute, with and without BPC', () => {
    const press = P('press-cmyk'), srgb = P('srgb');
    expect(maxDiff(float(colorFn(srgb, press, { intent: 1 }), S), ref.press['srgb>press:relative'])).toBeLessThanOrEqual(6);
    expect(maxDiff(float(colorFn(srgb, press, { intent: 0 }), S), ref.press['srgb>press:perceptual'])).toBeLessThanOrEqual(6);
    expect(maxDiff(float(colorFn(srgb, press, { intent: 1, bpc: true }), S), ref.press['srgb>press:relative+bpc'])).toBeLessThanOrEqual(6);
    const cmyk: number[][] = ref.press['srgb>press:relative'];
    expect(maxDiff(float(colorFn(press, srgb, { intent: 1 }), cmyk), ref.press['press>srgb:relative'])).toBeLessThanOrEqual(1);
    expect(maxDiff(float(colorFn(press, srgb, { intent: 3 }), cmyk), ref.press['press>srgb:absolute'])).toBeLessThanOrEqual(1);
    // BPC really moves the shadows: sRGB black lands on more ink without it.
    const k0 = colorFn(srgb, press)([0, 0, 0]), k1 = colorFn(srgb, press, { bpc: true })([0, 0, 0]);
    expect(Math.abs(k0[3] - k1[3]) + Math.abs(k0[0] - k1[0])).toBeGreaterThan(0.02);
  });
  it('refuses to put pixels into CMYK', () => { expect(() => makeTransform(P('srgb'), P('press-cmyk'))).toThrow(/RGB or gray/); });
  it('the gray stand-in profile keeps R = G = B values exact', () => {
    const g = P('gray22'), rgb = parseIcc(grayAsRgb(g));
    expect(rgb.colorSpace).toBe('RGB');
    const grays = Array.from({ length: 18 }, (_, i) => [i * 15, i * 15, i * 15]);
    expect(maxDiff(run(makeTransform(rgb, g), grays, true), grays.map((v) => [v[0]]))).toBeLessThanOrEqual(1);
    expect(maxDiff(run(makeTransform(g, rgb), grays.map((v) => [v[0]])), grays)).toBeLessThanOrEqual(1);
  });
  it('table tone curves survive writing', () => {
    const t = Array.from({ length: 256 }, (_, i) => Math.pow(i / 255, 1.7));
    const p = parseIcc(writeIcc({ description: 'table', matrix: spaceProfile('srgb').matrix!, trc: t }));
    expect(p.trc![1](0.6)).toBeCloseTo(Math.pow(0.6, 1.7), 3);
  });
});

describe('Soft proof and the display step', () => {
  it('display step turns P3 values back into the sRGB colors they came from', () => {
    const exp: number[][] = ref.convert['srgb>p3'];
    cmState.managed = true;
    const st = colorStep({ icc: spaceIcc('p3') } as any)!;
    expect(st).not.toBeNull();
    // Two 8-bit roundings (sRGB → P3 by LittleCMS, back here) cost up to 3 levels in the steepest spots.
    expect(maxDiff(run(st.fn, exp), S)).toBeLessThanOrEqual(3);
    expect(colorStep({ icc: spaceIcc('srgb') } as any)).toBeNull();
    expect(colorStep({} as any)).toBeNull();
    cmState.managed = false; expect(colorStep({ icc: spaceIcc('p3') } as any)).toBeNull();
  });
  it('proofs to gray and warns about out-of-gamut colors on the press', () => {
    cmState.proof = { icc: spaceIcc('gray22'), name: 'g', intent: 1, bpc: false, paperWhite: false, gamutWarning: false };
    const g = run(colorStep(null)!.fn, [[200, 40, 90]])[0]; expect(g[0]).toBe(g[1]); expect(g[1]).toBe(g[2]);
    const press = P('press-cmyk'), srgb = P('srgb');
    const warn = makeProof(srgb, press, srgb, { gamutWarning: [255, 0, 255] });
    const [blue, gray, skin] = run(warn, [[0, 0, 255], [128, 128, 128], [200, 160, 140]]);
    expect(blue).toEqual([255, 0, 255]); expect(gray).not.toEqual([255, 0, 255]); expect(skin).not.toEqual([255, 0, 255]);
    expect(Math.abs(gray[0] - 128)).toBeLessThanOrEqual(2); // mid gray prints as itself
    // Without the warning the blue is muted (the press has 80% of sRGB's chroma) and black is lifted.
    const plain = makeProof(srgb, press, srgb, {});
    const [b2, k2] = run(plain, [[0, 0, 255], [0, 0, 0]]); expect(b2[2]).toBeLessThan(250); expect(b2[0]).toBeGreaterThan(5); expect(k2[0]).toBeGreaterThan(20);
    // LittleCMS soft-proofing transforms (proof intent relative, and absolute = paper simulation).
    expect(maxDiff(run(plain, S), ref.proof.relative)).toBeLessThanOrEqual(3);
    expect(maxDiff(run(makeProof(srgb, press, srgb, { paperWhite: true }), S), ref.proof.paper)).toBeLessThanOrEqual(3);
  });
});

describe('Profiles in files', () => {
  const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAMSURBVHicYxBQMAAAAKQAYTRmfXIAAAAASUVORK5CYII='), (c) => c.charCodeAt(0));
  const types = (png: Uint8Array) => { const out: string[] = []; let p = 8; while (p + 12 <= png.length) { const len = new DataView(png.buffer, png.byteOffset).getUint32(p); out.push(String.fromCharCode(...png.subarray(p + 4, p + 8))); p += 12 + len; } return out; };
  it('PNG iCCP round-trips and replaces sRGB and gAMA', async () => {
    expect(await pngIcc(PNG)).toBeNull();
    const icc = spaceIcc('adobergb'), out = await injectPngIcc(PNG, icc, 'Adobe RGB (1998) compatible');
    expect(types(out)).toEqual(['IHDR', 'iCCP', 'IDAT', 'IEND']);
    expect([...(await pngIcc(out))!]).toEqual([...icc]);
    expect([...(await embeddedIcc(out, 'png'))!]).toEqual([...icc]);
    expect((await keepEmbedded(out, 'png'))?.profile.description).toBe('Adobe RGB (1998) compatible');
    expect(await keepEmbedded(await injectPngIcc(PNG, spaceIcc('srgb')), 'png')).toBeNull();
  });
  it('finds the profile in JPEG APP2 and in TIFF tag 34675', async () => {
    const icc = spaceIcc('p3'), body = new Uint8Array([...'ICC_PROFILE\0'].map((c) => c.charCodeAt(0)).concat([1, 1], [...icc]));
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe2, (body.length + 2) >> 8, (body.length + 2) & 255, ...body, 0xff, 0xd9]);
    expect([...(await embeddedIcc(jpeg, 'jpeg'))!]).toEqual([...icc]);
    const n = icc.length, tiff = new Uint8Array(8 + 2 + 12 + 4 + n), dv = new DataView(tiff.buffer);
    tiff.set([0x49, 0x49, 42, 0]); dv.setUint32(4, 8, true); dv.setUint16(8, 1, true); dv.setUint16(10, 34675, true); dv.setUint16(12, 7, true); dv.setUint32(14, n, true); dv.setUint32(18, 26, true); tiff.set(icc, 26);
    expect([...(await embeddedIcc(tiff, 'tiff'))!]).toEqual([...icc]);
  });
  it('chooses the profile a save carries', () => {
    const srgb = spaceIcc('srgb'), p3 = spaceIcc('p3');
    expect(iccForSave(p3, srgb)).toBe(p3);
    expect(iccForSave(undefined, srgb)).toBe(srgb);
    expect(iccForSave(undefined, p3)).toBeUndefined(); // the platform turned those values into sRGB
    expect(iccForSave(undefined, undefined)).toBeUndefined();
    expect(parseIcc(iccForSave(spaceIcc('gray22'), undefined)!).colorSpace).toBe('RGB');
  });
});
