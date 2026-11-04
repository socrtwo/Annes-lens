/**
 * FITS (Flexible Image Transport System, the astronomy format; .fits, .fit, .fts), read by the app's own code from
 * the FITS standard: the primary array and every IMAGE extension as pages, with NAXIS = 2 pictures and NAXIS = 3
 * cubes (each plane a page); BITPIX 8, 16, 32, 64, −32 and −64, BZERO and BSCALE, BLANK (undefined pixels, left
 * transparent), the first stored row at the bottom as astronomy displays it. Values are stretched linearly between
 * the 0.5th and 99.5th percentiles for display (DATAMIN/DATAMAX are not used, as they are often wrong); the real
 * values are available to tools through fitsData. Tables are skipped; tile-compressed images (ZIMAGE) are reported.
 * Gzip-compressed files (.fits.gz) are inflated first.
 */
import { makeRaster, type DecodeResult, type DecodedPage } from './raster';
import { inflate } from './inflate';

export const isFits = (u8: Uint8Array): boolean => u8.length >= 2880 && String.fromCharCode(...u8.subarray(0, 9)) === 'SIMPLE  =';
export const isGzipFits = (u8: Uint8Array, name: string): boolean => u8.length > 10 && u8[0] === 0x1f && u8[1] === 0x8b && /\.(fits?|fts)\.gz$/i.test(name);

export interface FitsHdu { cards: Map<string, string>; comments: string[]; dataStart: number; dataLength: number; bitpix: number; axes: number[]; kind: 'image' | 'table' | 'compressed' | 'empty' }
export interface FitsPlane { hdu: number; plane: number; width: number; height: number; values: Float64Array; blank: Uint8Array | null }

const text = (u8: Uint8Array, o: number, n: number) => String.fromCharCode(...u8.subarray(o, o + n));
/** A card's value as the standard writes it: a quoted string, a logical, or a number. */
function cardValue(raw: string): string {
  const s = raw.trimStart();
  if (s.startsWith("'")) { let i = 1, out = ''; while (i < s.length) { if (s[i] === "'") { if (s[i + 1] === "'") { out += "'"; i += 2; continue; } break; } out += s[i++]; } return out.trimEnd(); }
  const slash = s.indexOf('/');
  return (slash >= 0 ? s.slice(0, slash) : s).trim();
}

/** The header/data units of a file: their cards, data position and kind. */
export function fitsHdus(u8: Uint8Array): FitsHdu[] {
  const out: FitsHdu[] = [];
  let p = 0;
  while (p + 2880 <= u8.length) {
    const cards = new Map<string, string>(), comments: string[] = [];
    let q = p, ended = false;
    while (q + 80 <= u8.length) {
      const card = text(u8, q, 80), key = card.slice(0, 8).trim();
      q += 80;
      if (key === 'END') { ended = true; break; }
      if (key === 'COMMENT' || key === 'HISTORY') { comments.push(`${key}: ${card.slice(8).trim()}`); continue; }
      if (card.slice(8, 10) === '= ' && key) cards.set(key, cardValue(card.slice(10)));
      else if (key && !cards.has(key) && card.slice(8).trim()) comments.push(card.trim());
    }
    if (!ended) break;
    const dataStart = Math.ceil(q / 2880) * 2880;
    const bitpix = +(cards.get('BITPIX') || 0), naxis = +(cards.get('NAXIS') || 0), axes: number[] = [];
    for (let i = 1; i <= naxis; i++) axes.push(+(cards.get(`NAXIS${i}`) || 0));
    const gcount = +(cards.get('GCOUNT') || 1), pcount = +(cards.get('PCOUNT') || 0);
    const elements = axes.length ? axes.reduce((a, b) => a * b, 1) : 0;
    const dataLength = Math.ceil((Math.abs(bitpix) / 8 * (elements + pcount) * gcount) / 2880) * 2880;
    const xt = (cards.get('XTENSION') || '').trim().toUpperCase();
    const kind: FitsHdu['kind'] = cards.get('ZIMAGE') === 'T' ? 'compressed' : xt === 'BINTABLE' || xt === 'TABLE' || xt === 'A3DTABLE' ? 'table' : !elements ? 'empty' : 'image';
    out.push({ cards, comments, dataStart, dataLength, bitpix, axes, kind });
    p = dataStart + dataLength;
    if (!dataLength && !out[0].cards.has('EXTEND') && out.length === 1 && kind === 'empty' && p + 2880 > u8.length) break;
  }
  return out;
}

/** The planes of the image HDUs: values with BZERO/BSCALE applied, rows as stored (the first row is the bottom). */
export function fitsData(u8: Uint8Array, o: { maxPixels?: number; maxPlanes?: number } = {}): { planes: FitsPlane[]; hdus: FitsHdu[]; warnings: string[] } {
  const hdus = fitsHdus(u8), planes: FitsPlane[] = [], warnings: string[] = [];
  const maxPixels = o.maxPixels ?? 200e6, maxPlanes = o.maxPlanes ?? 200;
  let budget = maxPixels;
  hdus.forEach((h, hi) => {
    if (h.kind === 'compressed') { warnings.push(`HDU ${hi + 1}: a tile-compressed image (${h.cards.get('ZCMPTYPE') || 'ZIMAGE'}) is not read yet`); return; }
    if (h.kind !== 'image') return;
    const [w, hgt] = h.axes, depth = h.axes.slice(2).reduce((a, b) => a * b, 1) || 1;
    if (!(w > 0 && hgt > 0) || ![8, 16, 32, 64, -32, -64].includes(h.bitpix)) { warnings.push(`HDU ${hi + 1}: BITPIX ${h.bitpix} or axes ${h.axes.join(' × ')} are not supported`); return; }
    const bzero = +(h.cards.get('BZERO') || 0), bscale = +(h.cards.get('BSCALE') || 1), blankCard = h.cards.get('BLANK'), blank = blankCard !== undefined && h.bitpix > 0 ? +blankCard : null;
    const bytes = Math.abs(h.bitpix) / 8, per = w * hgt, dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    for (let z = 0; z < depth && planes.length < maxPlanes; z++) {
      if (per > budget) { warnings.push(`HDU ${hi + 1}: plane ${z + 1} and the rest are left out (too many pixels)`); break; }
      budget -= per;
      const values = new Float64Array(per), mask = blank !== null ? new Uint8Array(per) : null;
      const base = h.dataStart + z * per * bytes;
      if (base + per * bytes > u8.length) { warnings.push(`HDU ${hi + 1}: the data is cut short`); if (base >= u8.length) break; }
      for (let i = 0; i < per; i++) {
        const at = base + i * bytes;
        if (at + bytes > u8.length) { values[i] = NaN; continue; }
        let v: number;
        switch (h.bitpix) {
          case 8: v = u8[at]; break;
          case 16: v = dv.getInt16(at); break;
          case 32: v = dv.getInt32(at); break;
          case 64: v = Number(dv.getBigInt64(at)); break;
          case -32: v = dv.getFloat32(at); break;
          default: v = dv.getFloat64(at);
        }
        if (mask && v === blank) { mask[i] = 1; values[i] = NaN; continue; }
        values[i] = bzero + bscale * v;
      }
      planes.push({ hdu: hi, plane: z, width: w, height: hgt, values, blank: mask });
    }
  });
  return { planes, hdus, warnings };
}

const INFO_KEYS: [string, string][] = [['OBJECT', 'object'], ['TELESCOP', 'telescope'], ['INSTRUME', 'instrument'], ['OBSERVER', 'observer'], ['DATE-OBS', 'observed'], ['EXPTIME', 'exposure (s)'], ['FILTER', 'filter'], ['BUNIT', 'unit'], ['ORIGIN', 'origin'], ['DATE', 'written'], ['CTYPE1', 'axis 1'], ['CTYPE2', 'axis 2'], ['RA', 'RA'], ['DEC', 'Dec'], ['EQUINOX', 'equinox']];

export function decodeFits(input: Uint8Array, name = ''): DecodeResult {
  let u8 = input;
  if (isGzipFits(u8, name)) u8 = inflate(u8).data;
  if (!isFits(u8)) throw new Error('This is not a FITS file (no SIMPLE card)');
  const { planes, hdus, warnings } = fitsData(u8);
  if (!planes.length) throw new Error(`This FITS file holds no image${hdus.some((h) => h.kind === 'table') ? ' (tables only)' : ''}${warnings.length ? ` (${warnings.join('; ')})` : ''}`);
  const pages: DecodedPage[] = [];
  for (const pl of planes) {
    const { width: w, height: h, values } = pl, hdu = hdus[pl.hdu];
    // The stretch: the 0.5th and 99.5th percentiles of the finite values (sampled when large).
    const finite: number[] = [];
    const step = Math.max(1, Math.floor(values.length / 200000));
    for (let i = 0; i < values.length; i += step) if (Number.isFinite(values[i])) finite.push(values[i]);
    finite.sort((a, b) => a - b);
    let lo = finite.length ? finite[Math.floor(finite.length * 0.005)] : 0, hi = finite.length ? finite[Math.min(finite.length - 1, Math.floor(finite.length * 0.995))] : 1;
    if (!(hi > lo)) { lo = finite.length ? finite[0] : 0; hi = finite.length ? finite[finite.length - 1] : 1; if (!(hi > lo)) hi = lo + 1; }
    const r = makeRaster(w, h), d = r.data;
    let transparent = false;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const v = values[y * w + x], o = ((h - 1 - y) * w + x) * 4; // the first stored row at the bottom
      if (!Number.isFinite(v)) { d[o + 3] = 0; transparent = true; continue; }
      const g = Math.round(Math.max(0, Math.min(1, (v - lo) / (hi - lo))) * 255);
      d[o] = d[o + 1] = d[o + 2] = g; d[o + 3] = 255;
    }
    const depth = hdu.axes.slice(2).reduce((a, b) => a * b, 1) || 1;
    const kind = `${Math.abs(hdu.bitpix)}-bit ${hdu.bitpix < 0 ? 'floating-point' : 'integer'}`;
    const bunit = hdu.cards.get('BUNIT');
    const notes = [`FITS ${pl.hdu === 0 ? 'primary image' : `image extension ${pl.hdu}${hdu.cards.get('EXTNAME') ? ` "${hdu.cards.get('EXTNAME')}"` : ''}`}${depth > 1 ? `, plane ${pl.plane + 1} of ${depth}` : ''}, ${kind}${hdu.cards.has('BZERO') || hdu.cards.has('BSCALE') ? ' (BZERO/BSCALE applied)' : ''}`,
      `shown stretched linearly from ${fmt(lo)} to ${fmt(hi)}${bunit ? ` ${bunit}` : ''} (the 0.5th and 99.5th percentiles); the first stored row is at the bottom`];
    if (pl.blank) notes.push('undefined (BLANK) pixels are transparent');
    pages.push({ width: w, height: h, frames: [{ raster: r, delay: 0 }], loops: 0, bitDepth: Math.abs(hdu.bitpix), hasAlpha: transparent, notes });
  }
  const info: Record<string, string> = { HDUs: String(hdus.length), planes: String(planes.length) };
  const primary = hdus[planes[0].hdu].cards;
  for (const [k, label] of INFO_KEYS) { const v = primary.get(k) ?? hdus[0].cards.get(k); if (v !== undefined && v !== '') info[label] = v; }
  const comments = hdus[planes[0].hdu].comments.filter((c) => c.startsWith('COMMENT')).map((c) => c.slice(9).trim()).filter(Boolean);
  if (comments.length) info.comments = comments.slice(0, 20).join(' | ');
  return { pages, info, warnings };
}
const fmt = (v: number) => (Math.abs(v) >= 1e5 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toExponential(3) : +v.toFixed(3) + '');
