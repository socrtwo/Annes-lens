/**
 * Samples from a DCT JPEG at any precision (8 or 12 bits; baseline, extended sequential and progressive Huffman),
 * for the 12-bit JPEGs inside DICOM files, which the platform and pdf.js decode only at 8 bits. The entropy decoding
 * is shared with the lossless-transform module (readJpegCoefficients); here the coefficients are dequantized, put
 * through a floating-point inverse DCT and level-shifted. No color conversion and no chroma interpolation: components
 * with lower sampling are replicated.
 */
import { readJpegCoefficients, ZIGZAG } from './jpegLossless';

export interface DctFrame { width: number; height: number; comps: number; precision: number; data: Uint16Array; warnings: string[] }

let cosTable: Float64Array | null = null;
function cosines(): Float64Array {
  if (cosTable) return cosTable;
  const t = new Float64Array(64);
  for (let x = 0; x < 8; x++) for (let u = 0; u < 8; u++) t[x * 8 + u] = (u === 0 ? Math.SQRT1_2 : 1) * Math.cos(((2 * x + 1) * u * Math.PI) / 16) / 2;
  return (cosTable = t);
}

export function decodeDctSamples(u8: Uint8Array): DctFrame {
  const f = readJpegCoefficients(u8);
  if (f.arithmetic) throw new Error('Arithmetic-coded JPEG is not supported');
  const { width, height, precision } = f, comps = f.components.length;
  const max = (1 << precision) - 1, shift = 1 << (precision - 1), t = cosines();
  const hmax = Math.max(...f.components.map((c) => c.h)), vmax = Math.max(...f.components.map((c) => c.v));
  const out = new Uint16Array(width * height * comps);
  const tmp = new Float64Array(64), deq = new Float64Array(64);
  f.components.forEach((c, ci) => {
    const qt = f.qt[c.tq];
    if (!qt) throw new Error(`JPEG quantization table ${c.tq} is missing`);
    const q = new Float64Array(64);
    for (let k = 0; k < 64; k++) q[ZIGZAG[k]] = qt[k];
    const pw = c.blocksPerLine * 8, ph = c.blocksPerColumn * 8, plane = new Uint16Array(pw * ph);
    for (let by = 0; by < c.blocksPerColumn; by++) for (let bx = 0; bx < c.blocksPerLine; bx++) {
      const off = (by * c.blocksPerLine + bx) * 64;
      for (let k = 0; k < 64; k++) deq[k] = c.coefs[off + k] * q[k];
      // Rows: tmp[v][x] = Σu deq[v][u] c(x,u); then columns.
      for (let v = 0; v < 8; v++) for (let x = 0; x < 8; x++) { let s = 0; for (let u = 0; u < 8; u++) s += deq[v * 8 + u] * t[x * 8 + u]; tmp[v * 8 + x] = s; }
      for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) {
        let s = 0; for (let v = 0; v < 8; v++) s += tmp[v * 8 + x] * t[y * 8 + v];
        const val = Math.round(s) + shift;
        plane[(by * 8 + y) * pw + bx * 8 + x] = val < 0 ? 0 : val > max ? max : val;
      }
    }
    const sx = hmax / c.h, sy = vmax / c.v;
    for (let y = 0; y < height; y++) { const py = Math.min(ph - 1, Math.floor(y / sy)); for (let x = 0; x < width; x++) out[(y * width + x) * comps + ci] = plane[py * pw + Math.min(pw - 1, Math.floor(x / sx))]; }
  });
  return { width, height, comps, precision, data: out, warnings: f.warnings };
}
