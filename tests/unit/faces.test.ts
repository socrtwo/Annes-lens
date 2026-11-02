import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { decodePngTolerant } from '../../src/codecs/png';
import { alignFace, similarityTo, decodeYunet, nms, groupFaces, cosine, normalize, TEMPLATE, SFACE_THRESHOLD, type Face } from '../../src/picture/faces';

const ref = JSON.parse(readFileSync('tests/fixtures/people/opencv-reference.json', 'utf8')) as { faces: { file: string; box: number[]; kps: number[]; score: number; feat: number[] }[]; alignOffsets: [number, number][] };
const png = (n: string) => { const f = decodePngTolerant(new Uint8Array(readFileSync(`tests/fixtures/people/${n}`))).pages[0].frames[0]; return f.raster; };

describe('faces: alignment', () => {
  it('aligns to the ArcFace template like cv::FaceRecognizerSF::alignCrop', () => {
    for (const k of [0, 1]) {
      const [ox, oy] = ref.alignOffsets[k], kps = ref.faces[k].kps.map((v, i) => v - (i % 2 ? oy : ox));
      const ours = alignFace(png(`align-src-${k}.png`), kps), cv = png(`align-${k}.png`);
      let sum = 0, max = 0, n = 0;
      for (let i = 0; i < ours.data.length; i += 4) for (let c = 0; c < 3; c++) {
        // OpenCV writes BGR crops; the PNG reader gives them back as RGB of the BGR file, i.e. the same picture.
        const d = Math.abs(ours.data[i + c] - cv.data[i + c]); sum += d; max = Math.max(max, d); n++;
      }
      expect(sum / n, `face ${k}`).toBeLessThan(0.6); expect(max, `face ${k}`).toBeLessThanOrEqual(3);
    }
  });
  it('fits an exact similarity', () => {
    const a = 1.7, b = -0.3, src = TEMPLATE.flatMap(([x, y]) => { const det = a * a + b * b; const X = x - 5, Y = y + 9; return [(a * X + b * Y) / det, (-b * X + a * Y) / det]; });
    const m = similarityTo(src);
    for (let i = 0; i < 5; i++) { expect(m[0] * src[2 * i] + m[1] * src[2 * i + 1] + m[2]).toBeCloseTo(TEMPLATE[i][0], 6); expect(m[3] * src[2 * i] + m[4] * src[2 * i + 1] + m[5]).toBeCloseTo(TEMPLATE[i][1], 6); }
  });
});

describe('faces: detection output', () => {
  it('decodes YuNet heads and suppresses overlaps', () => {
    const w = 64, h = 64, out: Record<string, Float32Array> = {};
    for (const st of [8, 16, 32]) { const n = (w / st) * (h / st); out[`cls_${st}`] = new Float32Array(n); out[`obj_${st}`] = new Float32Array(n); out[`bbox_${st}`] = new Float32Array(n * 4); out[`kps_${st}`] = new Float32Array(n * 10); }
    // One face at stride 8, cell (row 2, col 3): centre offset (0.5, 0.5), size e^1.5 · 8.
    const i = 2 * 8 + 3; out.cls_8[i] = 0.9; out.obj_8[i] = 0.81; out.bbox_8.set([0.5, 0.5, 1.5, 1.5], i * 4); out.kps_8.set([0, 0, 1, 0, 0.5, 0.5, 0, 1, 1, 1], i * 10);
    // A weaker duplicate next to it and a sub-threshold cell.
    out.cls_8[i + 1] = 0.8; out.obj_8[i + 1] = 0.7; out.bbox_8.set([-0.5, 0.5, 1.5, 1.5], (i + 1) * 4);
    out.cls_16[0] = 0.3; out.obj_16[0] = 0.3;
    const f = decodeYunet(out, w, h);
    expect(f.length).toBe(2);
    expect(f[0].score).toBeCloseTo(Math.sqrt(0.9 * 0.81), 6);
    const s = 8 * Math.exp(1.5); expect(f[0].box.map((v) => +v.toFixed(3))).toEqual([3.5 * 8 - s / 2, 2.5 * 8 - s / 2, s, s].map((v) => +v.toFixed(3)));
    expect(f[0].kps.slice(0, 4)).toEqual([24, 16, 32, 16]);
    const kept = nms(f); expect(kept.length).toBe(1); expect(kept[0]).toBe(f[0]);
    const apart: Face[] = [{ box: [0, 0, 10, 10], kps: [], score: 0.7 }, { box: [20, 0, 10, 10], kps: [], score: 0.9 }];
    expect(nms(apart).map((x) => x.score)).toEqual([0.9, 0.7]);
  });
});

describe('faces: grouping', () => {
  const embs = ref.faces.map((f) => normalize(f.feat)), files = ref.faces.map((f) => f.file);
  it('groups OpenCV\'s SFace descriptions of the portraits by person', () => {
    // Faces: biden, both-2009 (Obama, Biden), both-2012 (Obama, Biden), harris, obama.
    expect(files).toEqual(['biden.jpg', 'both-2009.jpg', 'both-2009.jpg', 'both-2012.jpg', 'both-2012.jpg', 'harris.jpg', 'obama.jpg']);
    const g = groupFaces(embs, 0.42);
    expect(g).toEqual([0, 1, 0, 1, 0, 2, 1]);
    expect(cosine(embs[0], embs[2])).toBeGreaterThan(SFACE_THRESHOLD); expect(cosine(embs[0], embs[5])).toBeLessThan(SFACE_THRESHOLD);
  });
  it('keeps named people and adds to them', () => {
    // Obama's 2012 face is already named (person 0); Harris named as person 1.
    const fixed: (number | undefined)[] = [undefined, undefined, undefined, 0, undefined, 1, undefined];
    const g = groupFaces(embs, 0.42, fixed);
    expect(g).toEqual([2, 0, 2, 0, 2, 1, 0]);
  });
});

describe('people: names into pictures', () => {
  it('writes named faces as MWG face regions, replacing a face region already at that place', async () => {
    const { withFaceRegions } = await import('../../src/picture/people');
    const { readRegions, writeRegions } = await import('../../src/meta/xmp');
    const f = { id: 'a', key: 'k', file: 'x.jpg', box: [100, 50, 80, 100] as [number, number, number, number], kps: [], score: 0.9, emb: new Float32Array(128), thumb: '', w: 400, h: 300, person: 'p1' };
    const p = { id: 'p1', name: 'Anne Example', born: '1901', externalId: '@I7@' };
    const old = writeRegions(null, [{ name: 'Old name', type: 'Face', area: { x: 0.35, y: 1 / 3, w: 0.2, h: 1 / 3 } }, { name: 'The dog', type: 'Pet', area: { x: 0.8, y: 0.8, w: 0.1, h: 0.1 } }], { w: 400, h: 300 });
    const doc = readRegions(withFaceRegions(old, [{ f, p }]));
    expect(doc.regions.map((r) => r.name).sort()).toEqual(['Anne Example', 'The dog']);
    const r = doc.regions.find((x) => x.name === 'Anne Example')!;
    expect([r.type, +r.area.x.toFixed(3), +r.area.y.toFixed(3), +r.area.w.toFixed(3), +r.area.h.toFixed(3), r.born, r.personId]).toEqual(['Face', 0.35, 0.333, 0.2, 0.333, '1901', '@I7@']);
    expect(doc.dims).toEqual({ w: 400, h: 300 });
  });
});
