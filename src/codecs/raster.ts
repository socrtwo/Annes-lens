/** A decoded frame as plain RGBA bytes (what the app's own decoders produce; works without a DOM). */
export interface Raster {
  width: number;
  height: number;
  /** RGBA, row-major, not premultiplied. */
  data: Uint8ClampedArray<ArrayBuffer>;
}

export function makeRaster(width: number, height: number): Raster {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

export interface DecodedPage {
  width: number;
  height: number;
  frames: { raster: Raster; delay: number }[];
  loops: number;
  bitDepth: number;
  paletteSize?: number;
  hasAlpha: boolean;
  dpi?: [number, number];
  notes: string[];
}

export interface DecodeResult {
  pages: DecodedPage[];
  info: Record<string, string>;
  warnings: string[];
}

/** Reads a 4-byte big-endian tag as ASCII. */
export const ascii = (u8: Uint8Array, o: number, n: number): string => String.fromCharCode(...u8.subarray(o, o + n));
