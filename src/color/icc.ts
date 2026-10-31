/**
 * ICC profiles: reading (v2 and v4: matrix-shaper RGB, gray, and the LUT-based A2B/B2A tags of
 * printer and other device profiles: lut8, lut16, lutAtoB, lutBtoA) and writing (v4
 * matrix-shaper RGB and gray profiles for the built-in working spaces).
 */
export type Mat3 = [number, number, number, number, number, number, number, number, number];
export type Curve = (x: number) => number;
export interface Lut {
  /** Device or PCS input and output channel counts. */
  inCh: number; outCh: number;
  /** lut16 (mft2) uses the legacy 16-bit Lab encoding (0xFF00 = L* 100); the others use the v4 one. */
  legacyLab: boolean;
  /** Applied in order, each optional: input curves, matrix (3x3 + offset), CLUT, output curves (and, for lutAtoB/BtoA, an extra curve set). */
  stages: ({ kind: 'curves'; curves: Curve[] } | { kind: 'matrix'; m: number[]; off: number[] } | { kind: 'clut'; grid: number[]; data: Float32Array })[];
}
export interface IccProfile {
  bytes: Uint8Array; version: string; deviceClass: string; colorSpace: string; pcs: string; intent: number;
  description: string; whitePoint: [number, number, number];
  /** Matrix-shaper: the D50 PCS matrix (columns are rXYZ, gXYZ, bXYZ) and the curves. */
  matrix?: Mat3; trc?: Curve[];
  /** Gray: the kTRC curve. */
  grayTrc?: Curve;
  a2b: Record<number, Lut>; b2a: Record<number, Lut>;
}

const u32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const u16 = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const s15 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) / 65536;
const sig = (b: Uint8Array, o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

/** curv / para curves as functions on 0..1. */
function readCurve(b: Uint8Array, o: number): { f: Curve; size: number } {
  const t = sig(b, o);
  if (t === 'curv') {
    const n = u32(b, o + 8);
    if (n === 0) return { f: (x) => x, size: 12 };
    if (n === 1) { const g = u16(b, o + 12) / 256; return { f: (x) => Math.pow(Math.max(0, x), g), size: 14 }; }
    const tab = new Float32Array(n); for (let i = 0; i < n; i++) tab[i] = u16(b, o + 12 + i * 2) / 65535;
    return { f: (x) => { const p = Math.max(0, Math.min(1, x)) * (n - 1), i = Math.min(n - 2, Math.floor(p)), f = p - i; return tab[i] + (tab[i + 1] - tab[i]) * f; }, size: 12 + 2 * n };
  }
  if (t === 'para') {
    const fn = u16(b, o + 8), np = [1, 3, 4, 5, 7][fn] || 1, P = Array.from({ length: np }, (_, i) => s15(b, o + 12 + i * 4));
    const [g, a = 1, bb = 0, c = 0, d = 0, e = 0, f = 0] = P;
    const pw = (v: number) => (v > 0 ? Math.pow(v, g) : 0);
    const fns: Curve[] = [
      (x) => pw(x),
      (x) => (x >= -bb / a ? pw(a * x + bb) : 0),
      (x) => (x >= -bb / a ? pw(a * x + bb) + c : c),
      (x) => (x >= d ? pw(a * x + bb) : c * x),
      (x) => (x >= d ? pw(a * x + bb) + e : c * x + f),
    ];
    return { f: fns[fn] || fns[0], size: 12 + np * 4 };
  }
  throw new Error(`Unsupported curve type ${t}`);
}

function readXYZ(b: Uint8Array, o: number): [number, number, number] { return [s15(b, o + 8), s15(b, o + 12), s15(b, o + 16)]; }

function readText(b: Uint8Array, o: number, size: number): string {
  const t = sig(b, o);
  if (t === 'desc') { const n = u32(b, o + 8); let s = ''; for (let i = 0; i < n - 1 && i < size; i++) s += String.fromCharCode(b[o + 12 + i]); return s; }
  if (t === 'mluc') { const n = u32(b, o + 8), rec = u32(b, o + 12); if (!n) return ''; const len = u32(b, o + 16 + 4), off = u32(b, o + 16 + 8); let s = ''; for (let i = 0; i < len; i += 2) s += String.fromCharCode(u16(b, o + off + i)); void rec; return s; }
  if (t === 'text') { let s = ''; for (let i = o + 8; i < o + size && b[i]; i++) s += String.fromCharCode(b[i]); return s; }
  return '';
}

function readLut(b: Uint8Array, o: number): Lut {
  const t = sig(b, o);
  if (t === 'mft1' || t === 'mft2') {
    const i = b[o + 8], out = b[o + 9], g = b[o + 10], wide = t === 'mft2';
    const m = Array.from({ length: 9 }, (_, k) => s15(b, o + 12 + k * 4));
    let p = o + 48;
    const nIn = wide ? u16(b, p) : 256, nOut = wide ? u16(b, p + 2) : 256; if (wide) p += 4;
    const rd = (q: number) => (wide ? u16(b, q) / 65535 : b[q] / 255), step = wide ? 2 : 1;
    const table = (n: number) => { const tab = new Float32Array(n); for (let k = 0; k < n; k++) { tab[k] = rd(p); p += step; } return (x: number) => { const q = Math.max(0, Math.min(1, x)) * (n - 1), k = Math.min(n - 2, Math.floor(q)); return tab[k] + (tab[k + 1] - tab[k]) * (q - k); }; };
    const inC: Curve[] = []; for (let k = 0; k < i; k++) inC.push(table(nIn));
    const cells = Math.pow(g, i) * out, data = new Float32Array(cells); for (let k = 0; k < cells; k++) { data[k] = rd(p); p += step; }
    const outC: Curve[] = []; for (let k = 0; k < out; k++) outC.push(table(nOut));
    const isIdentity = m.every((v, k) => Math.abs(v - (k % 4 === 0 ? 1 : 0)) < 1e-6);
    const stages: Lut['stages'] = [];
    if (i === 3 && !isIdentity) stages.push({ kind: 'matrix', m, off: [0, 0, 0] });
    stages.push({ kind: 'curves', curves: inC }, { kind: 'clut', grid: new Array(i).fill(g), data }, { kind: 'curves', curves: outC });
    return { inCh: i, outCh: out, legacyLab: wide, stages };
  }
  if (t === 'mAB ' || t === 'mBA ') {
    const i = b[o + 8], out = b[o + 9];
    const [oB, oM, oMat, oC, oA] = [12, 16, 20, 24, 28].map((k) => u32(b, o + k));
    const curves = (at: number, n: number): Curve[] => { const cs: Curve[] = []; let q = o + at; for (let k = 0; k < n; k++) { const c = readCurve(b, q); cs.push(c.f); q += (c.size + 3) & ~3; } return cs; };
    const mat = (at: number) => ({ kind: 'matrix' as const, m: Array.from({ length: 9 }, (_, k) => s15(b, o + at + k * 4)), off: Array.from({ length: 3 }, (_, k) => s15(b, o + at + 36 + k * 4)) });
    const clut = (at: number, inN: number, outN: number) => { const grid = Array.from({ length: inN }, (_, k) => b[o + at + k]), prec = b[o + at + 16], n = grid.reduce((s, x) => s * x, 1) * outN, data = new Float32Array(n), q0 = o + at + 20; for (let k = 0; k < n; k++) data[k] = prec === 1 ? b[q0 + k] / 255 : u16(b, q0 + k * 2) / 65535; return { kind: 'clut' as const, grid, data }; };
    const stages: Lut['stages'] = [];
    if (t === 'mAB ') { // A curves, CLUT, M curves, matrix, B curves
      if (oA) stages.push({ kind: 'curves', curves: curves(oA, i) }); if (oC) stages.push(clut(oC, i, out));
      if (oM) stages.push({ kind: 'curves', curves: curves(oM, out) }); if (oMat) stages.push(mat(oMat)); stages.push({ kind: 'curves', curves: curves(oB, out) });
    } else { // B curves, matrix, M curves, CLUT, A curves
      stages.push({ kind: 'curves', curves: curves(oB, i) }); if (oMat) stages.push(mat(oMat)); if (oM) stages.push({ kind: 'curves', curves: curves(oM, i) });
      if (oC) stages.push(clut(oC, i, out)); if (oA) stages.push({ kind: 'curves', curves: curves(oA, out) });
    }
    return { inCh: i, outCh: out, legacyLab: false, stages };
  }
  throw new Error(`Unsupported LUT type ${t}`);
}

/** Multilinear interpolation in a CLUT (inputs 0..1). */
export function clutLookup(grid: number[], data: Float32Array, outCh: number, input: ArrayLike<number>, out: Float64Array): void {
  const n = grid.length; const base: number[] = [], frac: number[] = [], stride: number[] = new Array(n);
  let s = outCh; for (let k = n - 1; k >= 0; k--) { stride[k] = s; s *= grid[k]; }
  for (let k = 0; k < n; k++) { const p = Math.max(0, Math.min(1, input[k])) * (grid[k] - 1), i = Math.min(grid[k] - 2, Math.floor(p)); base.push(Math.max(0, i)); frac.push(grid[k] > 1 ? p - Math.max(0, i) : 0); }
  for (let c = 0; c < outCh; c++) out[c] = 0;
  for (let corner = 0; corner < 1 << n; corner++) {
    let w = 1, idx = 0;
    for (let k = 0; k < n; k++) { const bit = (corner >> k) & 1; w *= bit ? frac[k] : 1 - frac[k]; idx += (base[k] + (grid[k] > 1 ? bit : 0)) * stride[k]; }
    if (w) for (let c = 0; c < outCh; c++) out[c] += w * data[idx + c];
  }
}
/** Runs a LUT on one color (values 0..1 in the tag's own encoding). */
export function evalLut(l: Lut, input: number[]): number[] {
  let v = input.slice(); const tmp = new Float64Array(16);
  for (const st of l.stages) {
    if (st.kind === 'curves') v = v.map((x, k) => (st.curves[k] ? st.curves[k](x) : x));
    else if (st.kind === 'matrix') { const m = st.m; v = [m[0] * v[0] + m[1] * v[1] + m[2] * v[2] + st.off[0], m[3] * v[0] + m[4] * v[1] + m[5] * v[2] + st.off[1], m[6] * v[0] + m[7] * v[1] + m[8] * v[2] + st.off[2]]; }
    else { const outN = st.data.length / st.grid.reduce((s, x) => s * x, 1); clutLookup(st.grid, st.data, outN, v, tmp); v = Array.from(tmp.subarray(0, outN)); }
  }
  return v;
}

export function parseIcc(bytes: Uint8Array): IccProfile {
  const b = bytes;
  if (b.length < 132 || sig(b, 36) !== 'acsp') throw new Error('Not an ICC profile');
  const verMajor = b[8], verMinor = b[9] >> 4;
  const p: IccProfile = { bytes, version: `${verMajor}.${verMinor}`, deviceClass: sig(b, 12), colorSpace: sig(b, 16).trim(), pcs: sig(b, 20).trim(), intent: u32(b, 64), description: '', whitePoint: [0.9642, 1, 0.8249], a2b: {}, b2a: {} };
  const n = u32(b, 128); const tags = new Map<string, { off: number; size: number }>();
  for (let i = 0; i < n; i++) { const o = 132 + i * 12; tags.set(sig(b, o), { off: u32(b, o + 4), size: u32(b, o + 8) }); }
  const tag = (s: string) => tags.get(s);
  const d = tag('desc'); if (d) p.description = readText(b, d.off, d.size);
  const w = tag('wtpt'); if (w) p.whitePoint = readXYZ(b, w.off);
  const r = tag('rXYZ'), g = tag('gXYZ'), bl = tag('bXYZ');
  if (r && g && bl) { const R = readXYZ(b, r.off), G = readXYZ(b, g.off), B = readXYZ(b, bl.off); p.matrix = [R[0], G[0], B[0], R[1], G[1], B[1], R[2], G[2], B[2]]; }
  const rt = tag('rTRC'), gt = tag('gTRC'), bt = tag('bTRC');
  if (rt && gt && bt) p.trc = [readCurve(b, rt.off).f, readCurve(b, gt.off).f, readCurve(b, bt.off).f];
  const k = tag('kTRC'); if (k) p.grayTrc = readCurve(b, k.off).f;
  for (let i = 0; i < 3; i++) { const a = tag(`A2B${i}`); if (a) try { p.a2b[i] = readLut(b, a.off); } catch { /* unsupported tag type */ } const z = tag(`B2A${i}`); if (z) try { p.b2a[i] = readLut(b, z.off); } catch { /* */ } }
  return p;
}

// Writing ----------------------------------------------------------------------------------------

export interface Para { g: number; a?: number; b?: number; c?: number; d?: number }
class W { parts: number[] = []; get len() { return this.parts.length; } u8(v: number) { this.parts.push(v & 255); } u16(v: number) { this.u8(v >> 8); this.u8(v); } u32(v: number) { this.u16((v >>> 16) & 0xffff); this.u16(v & 0xffff); } s15(v: number) { this.u32(Math.round(v * 65536) | 0); } str(s: string) { for (const ch of s) this.u8(ch.charCodeAt(0)); } pad() { while (this.len % 4) this.u8(0); } }
const xyzTag = (v: number[]) => { const w = new W(); w.str('XYZ '); w.u32(0); for (const x of v) w.s15(x); return w.parts; };
const paraTag = (p: Para) => { const w = new W(); w.str('para'); w.u32(0); const full = p.d !== undefined; w.u16(full ? 3 : 0); w.u16(0); w.s15(p.g); if (full) { w.s15(p.a ?? 1); w.s15(p.b ?? 0); w.s15(p.c ?? 0); w.s15(p.d ?? 0); } return w.parts; };
const curvTag = (t: ArrayLike<number>) => { const w = new W(); w.str('curv'); w.u32(0); w.u32(t.length); for (let i = 0; i < t.length; i++) w.u16(Math.round(Math.max(0, Math.min(1, t[i])) * 65535)); return w.parts; };
const trcTag = (t: Para | ArrayLike<number>) => ('g' in t ? paraTag(t as Para) : curvTag(t as ArrayLike<number>));
const mlucTag = (s: string) => { const w = new W(); w.str('mluc'); w.u32(0); w.u32(1); w.u32(12); w.str('en'); w.str('US'); w.u32(s.length * 2); w.u32(28); for (const ch of s) w.u16(ch.charCodeAt(0)); return w.parts; };
const sf32Tag = (m: number[]) => { const w = new W(); w.str('sf32'); w.u32(0); for (const x of m) w.s15(x); return w.parts; };

/** A v4 display profile: an RGB matrix-shaper (`matrix` columns are the D50 primaries) or, with `gray`, a gray profile. */
export function writeIcc(o: { description: string; copyright?: string; matrix?: Mat3; trc: Para | ArrayLike<number>; gray?: boolean; chad?: Mat3 }): Uint8Array {
  const tags: [string, number[]][] = [['desc', mlucTag(o.description)], ['cprt', mlucTag(o.copyright || 'No copyright; use freely')], ['wtpt', xyzTag([0.9642, 1, 0.82491])]];
  if (o.chad) tags.push(['chad', sf32Tag(o.chad)]);
  if (o.gray) tags.push(['kTRC', trcTag(o.trc)]);
  else { const m = o.matrix!; tags.push(['rXYZ', xyzTag([m[0], m[3], m[6]])], ['gXYZ', xyzTag([m[1], m[4], m[7]])], ['bXYZ', xyzTag([m[2], m[5], m[8]])], ['rTRC', trcTag(o.trc)], ['gTRC', trcTag(o.trc)], ['bTRC', trcTag(o.trc)]); }
  // Tag data after the header (128) and the tag table; identical curves share one copy.
  const table = 4 + tags.length * 12; let off = 128 + table; const placed: { sig: string; off: number; size: number }[] = []; const body: number[] = []; const seen = new Map<string, { off: number; size: number }>();
  for (const [s, data] of tags) {
    const key = data.join(','), hit = s.endsWith('TRC') ? seen.get(key) : undefined;
    if (hit) { placed.push({ sig: s, ...hit }); continue; }
    const at = off; body.push(...data); off += data.length; while (off % 4) { body.push(0); off++; }
    const entry = { off: at, size: data.length }; placed.push({ sig: s, ...entry }); if (s.endsWith('TRC')) seen.set(key, entry);
  }
  const w = new W();
  w.u32(off); w.str('lcms'); w.u32(0x04300000); w.str('mntr'); w.str(o.gray ? 'GRAY' : 'RGB '); w.str('XYZ ');
  const now = new Date(); for (const v of [now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate(), now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds()]) w.u16(v);
  w.str('acsp'); w.u32(0); w.u32(0); w.u32(0); w.u32(0); w.u32(0); w.u32(0); w.u32(0); w.s15(0.9642); w.s15(1); w.s15(0.82491); w.u32(0);
  for (let i = 0; i < 16; i++) w.u8(0); for (let i = 0; i < 28; i++) w.u8(0);
  w.u32(placed.length); for (const t of placed) { w.str(t.sig); w.u32(t.off); w.u32(t.size); }
  const out = new Uint8Array(off); out.set(w.parts, 0); out.set(body, 128 + table);
  return out;
}
