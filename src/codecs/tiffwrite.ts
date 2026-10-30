/**
 * A baseline TIFF writer: one IFD per page, 8-bit RGB or RGBA, uncompressed, one strip per 8 rows
 * (little-endian). Readable by every TIFF reader, including the app's own decoder.
 */
import type { Raster } from './raster';

export function encodeTiff(pages: { raster: Raster; alpha?: boolean; dpi?: number }[]): Uint8Array {
  const parts: { ifd: Uint8Array; data: Uint8Array }[] = [];
  let total = 8;
  const plans = pages.map((p) => {
    const { width: w, height: h, data } = p.raster;
    const spp = p.alpha ? 4 : 3;
    const pixels = new Uint8Array(w * h * spp);
    for (let i = 0, j = 0; i < data.length; i += 4, j += spp) { pixels[j] = data[i]; pixels[j + 1] = data[i + 1]; pixels[j + 2] = data[i + 2]; if (spp === 4) pixels[j + 3] = data[i + 3]; }
    const rowsPerStrip = Math.max(1, Math.min(h, Math.floor(8192 / Math.max(1, w * spp)) || 1));
    const strips = Math.ceil(h / rowsPerStrip);
    const entries: { tag: number; type: number; count: number; values: number[] }[] = [
      { tag: 256, type: 4, count: 1, values: [w] }, { tag: 257, type: 4, count: 1, values: [h] },
      { tag: 258, type: 3, count: spp, values: new Array(spp).fill(8) }, { tag: 259, type: 3, count: 1, values: [1] }, { tag: 262, type: 3, count: 1, values: [2] },
      { tag: 273, type: 4, count: strips, values: [] }, { tag: 277, type: 3, count: 1, values: [spp] }, { tag: 278, type: 4, count: 1, values: [rowsPerStrip] },
      { tag: 279, type: 4, count: strips, values: [] }, { tag: 282, type: 5, count: 1, values: [p.dpi || 72, 1] }, { tag: 283, type: 5, count: 1, values: [p.dpi || 72, 1] }, { tag: 284, type: 3, count: 1, values: [1] }, { tag: 296, type: 3, count: 1, values: [2] },
    ];
    if (spp === 4) entries.push({ tag: 338, type: 3, count: 1, values: [2] }); // unassociated alpha
    entries.sort((a, b) => a.tag - b.tag);
    return { w, h, spp, pixels, rowsPerStrip, strips, entries };
  });
  // Layout: for each page: IFD (2 + n*12 + 4) + extra values (strip arrays, rationals) then pixel data.
  const sizes: Record<number, number> = { 3: 2, 4: 4, 5: 8 };
  for (const pl of plans) {
    const n = pl.entries.length; const ifdLen = 2 + n * 12 + 4;
    let extra = 0; for (const e of pl.entries) { const sz = sizes[e.type] * (e.type === 5 ? 1 : e.count) * (e.type === 5 ? 1 : 1); if (e.type === 5 || sz > 4) extra += e.type === 5 ? 8 : sz; }
    const ifdAt = total, extraAt = ifdAt + ifdLen, dataAt = extraAt + extra;
    const ifd = new Uint8Array(ifdLen + extra); const dv = new DataView(ifd.buffer);
    dv.setUint16(0, n, true);
    let ex = 0;
    const stripOffsets: number[] = [], stripBytes: number[] = [];
    for (let s = 0; s < pl.strips; s++) { const rows = Math.min(pl.rowsPerStrip, pl.h - s * pl.rowsPerStrip); stripOffsets.push(dataAt + s * pl.rowsPerStrip * pl.w * pl.spp); stripBytes.push(rows * pl.w * pl.spp); }
    pl.entries.forEach((e, i) => {
      if (e.tag === 273) e.values = stripOffsets; if (e.tag === 279) e.values = stripBytes;
      const at = 2 + i * 12; dv.setUint16(at, e.tag, true); dv.setUint16(at + 2, e.type, true); dv.setUint32(at + 4, e.count, true);
      const write = (o: number) => { if (e.type === 5) { dv.setUint32(o, e.values[0], true); dv.setUint32(o + 4, e.values[1], true); } else e.values.forEach((v, k) => (e.type === 3 ? dv.setUint16(o + k * 2, v, true) : dv.setUint32(o + k * 4, v, true))); };
      const sz = e.type === 5 ? 8 : sizes[e.type] * e.count;
      if (sz <= 4) write(at + 8); else { dv.setUint32(at + 8, extraAt + ex, true); write(ifdLen + ex); ex += sz; }
    });
    const next = dataAt + pl.pixels.length; const pad = next & 1;
    parts.push({ ifd, data: pl.pixels });
    total = next + pad;
  }
  // Second pass: chain the IFDs.
  const out = new Uint8Array(total); const dv = new DataView(out.buffer);
  out.set([0x49, 0x49, 42, 0]); dv.setUint32(4, 8, true);
  let p = 8;
  parts.forEach((pt, i) => {
    const n = plans[i].entries.length, ifdLen = 2 + n * 12 + 4;
    out.set(pt.ifd, p); const dataAt = p + pt.ifd.length; out.set(pt.data, dataAt);
    const next = dataAt + pt.data.length + ((dataAt + pt.data.length) & 1);
    dv.setUint32(p + ifdLen - 4, i < parts.length - 1 ? next : 0, true);
    p = next;
  });
  return out;
}
