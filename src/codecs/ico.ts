/**
 * Windows icons and cursors (ICO, CUR): every size in the file becomes a page, largest first. Entries are
 * DIBs (decoded here) or PNGs (decoded by the platform, so the page is returned as bytes to decode later).
 */
import { decodeDib } from './bmp';
import type { DecodedPage } from './raster';

export function isIco(u8: Uint8Array): boolean {
  if (u8.length < 6) return false;
  const reserved = u8[0] | (u8[1] << 8), type = u8[2] | (u8[3] << 8), count = u8[4] | (u8[5] << 8);
  if (reserved !== 0 || (type !== 1 && type !== 2) || count === 0 || count > 1024) return false;
  if (u8.length < 6 + count * 16) return false;
  const off = u8[18] | (u8[19] << 8) | (u8[20] << 16) | (u8[21] << 24);
  return off >= 6 + count * 16 && off < u8.length;
}

export interface IcoEntry { width: number; height: number; colors: number; planes: number; bitCount: number; bytes: Uint8Array; png: boolean; hotspot?: [number, number] }

export function readIco(u8: Uint8Array): { cursor: boolean; entries: IcoEntry[] } {
  const type = u8[2] | (u8[3] << 8), count = u8[4] | (u8[5] << 8);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const entries: IcoEntry[] = [];
  for (let i = 0; i < count; i++) {
    const e = 6 + i * 16;
    const size = dv.getUint32(e + 8, true), off = dv.getUint32(e + 12, true);
    if (off + size > u8.length || size < 8) continue;
    const bytes = u8.subarray(off, off + size);
    const png = bytes[0] === 0x89 && bytes[1] === 0x50;
    entries.push({ width: u8[e] || 256, height: u8[e + 1] || 256, colors: u8[e + 2], planes: dv.getUint16(e + 4, true), bitCount: dv.getUint16(e + 6, true), bytes, png, hotspot: type === 2 ? [dv.getUint16(e + 4, true), dv.getUint16(e + 6, true)] : undefined });
  }
  entries.sort((a, b) => b.width * b.height - a.width * a.height || b.bitCount - a.bitCount);
  return { cursor: type === 2, entries };
}

/** Pages for the DIB entries; PNG entries are returned separately for the platform decoder. */
export function decodeIcoDibs(entries: IcoEntry[]): { pages: (DecodedPage | null)[]; warnings: string[] } {
  const warnings: string[] = [];
  const pages = entries.map((e, i) => {
    if (e.png) return null;
    try {
      const r = decodeDib(e.bytes, null, true);
      return { width: r.raster.width, height: r.raster.height, frames: [{ raster: r.raster, delay: 0 }], loops: 0, bitDepth: r.bpp, paletteSize: r.palette || undefined, hasAlpha: r.hasAlpha, notes: [...r.notes, e.hotspot ? `hotspot ${e.hotspot[0]},${e.hotspot[1]}` : ''].filter(Boolean) } as DecodedPage;
    } catch (err: any) {
      warnings.push(`Icon ${i + 1} (${e.width}×${e.height}): ${err?.message || err}`);
      return null;
    }
  });
  return { pages, warnings };
}
