/**
 * Encapsulated PostScript: the preview only (Anne's Lens does not interpret PostScript). DOS EPS binary
 * files carry a TIFF or WMF preview at an offset in their header; plain EPS files may embed a
 * %%BeginPreview hex bitmap (1-bit, or 8-bit gray in some writers). Also Adobe Illustrator .ai files
 * saved with a preview. Returns the preview bytes for the ordinary decoders, or a raster.
 */
import { makeRaster, type DecodeResult } from './raster';

export function isEps(u8: Uint8Array): boolean {
  if (u8.length < 30) return false;
  if (u8[0] === 0xc5 && u8[1] === 0xd0 && u8[2] === 0xd3 && u8[3] === 0xc6) return true;
  const head = String.fromCharCode(...u8.subarray(0, Math.min(u8.length, 64)));
  return /^%!PS-Adobe-[\d.]+ EPSF/.test(head) || /^%!PS-Adobe/.test(head);
}

export interface EpsPreview { kind: 'tiff' | 'wmf' | 'raster' | 'none'; bytes?: Uint8Array; raster?: DecodeResult; info: Record<string, string>; warnings: string[] }

export function epsPreview(u8: Uint8Array): EpsPreview {
  const info: Record<string, string> = {};
  const warnings: string[] = [];
  let ps = u8;
  if (u8[0] === 0xc5 && u8[1] === 0xd0) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const psAt = dv.getUint32(4, true), psLen = dv.getUint32(8, true), wmfAt = dv.getUint32(12, true), wmfLen = dv.getUint32(16, true), tifAt = dv.getUint32(20, true), tifLen = dv.getUint32(24, true);
    info.container = 'DOS EPS binary';
    if (psAt && psLen) ps = u8.subarray(psAt, Math.min(u8.length, psAt + psLen));
    if (tifAt && tifLen && tifAt + 8 <= u8.length) { info.preview = 'TIFF'; return { kind: 'tiff', bytes: u8.subarray(tifAt, Math.min(u8.length, tifAt + tifLen)), info: { ...info, ...header(ps) }, warnings }; }
    if (wmfAt && wmfLen && wmfAt + 8 <= u8.length) { info.preview = 'WMF (not rendered yet)'; return { kind: 'wmf', bytes: u8.subarray(wmfAt, Math.min(u8.length, wmfAt + wmfLen)), info: { ...info, ...header(ps) }, warnings }; }
  }
  Object.assign(info, header(ps));
  const text = new TextDecoder('latin1').decode(ps.subarray(0, Math.min(ps.length, 4 << 20)));
  const m = text.match(/%%BeginPreview:\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\r?\n([\s\S]*?)%%EndPreview/);
  if (m) {
    const w = +m[1], h = +m[2], depth = +m[3];
    const hex = m[5].replace(/^%/gm, '').replace(/[^0-9a-fA-F]/g, '');
    const bytes = new Uint8Array(hex.length >> 1);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    if (w > 0 && h > 0 && w * h < 80_000_000 && (depth === 1 || depth === 8)) {
      const out = makeRaster(w, h);
      const d = out.data;
      const stride = depth === 1 ? Math.ceil(w / 8) : w;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        let v: number;
        if (depth === 1) { const b = bytes[y * stride + (x >> 3)]; v = b === undefined ? 255 : (b >> (7 - (x & 7))) & 1 ? 0 : 255; }
        else { const b = bytes[y * stride + x]; v = b === undefined ? 255 : 255 - b; }
        d[o] = d[o + 1] = d[o + 2] = v; d[o + 3] = 255;
      }
      if (bytes.length < stride * h) warnings.push('The preview bitmap is shorter than its size says');
      info.preview = `%%BeginPreview ${depth}-bit bitmap`;
      return { kind: 'raster', raster: { pages: [{ width: w, height: h, frames: [{ raster: out, delay: 0 }], loops: 0, bitDepth: depth, hasAlpha: false, notes: [`EPS preview bitmap, ${depth} bit`] }], info, warnings }, info, warnings };
    }
    warnings.push(`Unsupported preview depth ${depth}`);
  }
  return { kind: 'none', info, warnings };
}

function header(ps: Uint8Array): Record<string, string> {
  const text = new TextDecoder('latin1').decode(ps.subarray(0, Math.min(ps.length, 8192)));
  const out: Record<string, string> = {};
  const grab = (key: string, name: string) => { const m = text.match(new RegExp(`^%%${key}:\\s*(.+)$`, 'm')); if (m) out[name] = m[1].trim(); };
  grab('Title', 'Title'); grab('Creator', 'Creator'); grab('CreationDate', 'Created'); grab('BoundingBox', 'Bounding box (points)'); grab('LanguageLevel', 'PostScript level');
  const first = text.match(/^%!PS-Adobe-[\d.]+( EPSF-[\d.]+)?/)?.[0];
  if (first) out.Header = first;
  return out;
}
