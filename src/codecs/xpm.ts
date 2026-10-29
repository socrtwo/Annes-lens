/**
 * X PixMap (XPM 2 and 3) and X BitMap (XBM): pictures stored as C source. XPM colors may be given as
 * #rgb hex, X11 color names or "None" (transparent); the c (color) key is preferred, then g, g4, m.
 */
import { makeRaster, type DecodeResult } from './raster';

export function isXpm(u8: Uint8Array): boolean {
  const head = latin1(u8, 0, 512);
  return /^\s*\/\*\s*XPM\s*\*\//.test(head) || /^\s*!\s*XPM2/.test(head) || (/static\s+(const\s+)?char\s*\*\s*\w+\s*\[\]\s*=\s*\{/.test(head) && /"\s*\d+\s+\d+\s+\d+\s+\d+/.test(head));
}
export function isXbm(u8: Uint8Array): boolean {
  const head = latin1(u8, 0, 512);
  return /#define\s+\w*width\s+\d+/.test(head) && /#define\s+\w*height\s+\d+/.test(head);
}
const latin1 = (u8: Uint8Array, s: number, n: number) => new TextDecoder('latin1').decode(u8.subarray(s, Math.min(u8.length, s + n)));

export function decodeXbm(u8: Uint8Array): DecodeResult {
  const text = latin1(u8, 0, u8.length);
  const w = +(text.match(/#define\s+\w*width\s+(\d+)/)?.[1] || 0), h = +(text.match(/#define\s+\w*height\s+(\d+)/)?.[1] || 0);
  if (!w || !h || w * h > 80_000_000) throw new Error('Not an XBM file');
  const xhot = text.match(/#define\s+\w*x_hot\s+(\d+)/)?.[1], yhot = text.match(/#define\s+\w*y_hot\s+(\d+)/)?.[1];
  const body = text.slice(text.indexOf('{', text.search(/_bits\s*\[\]/)) + 1);
  const bytes = body.match(/0[xX][0-9a-fA-F]+|\d+/g)?.map((s) => parseInt(s) & 255) || [];
  const stride = Math.ceil(w / 8);
  const out = makeRaster(w, h);
  const d = out.data;
  const warnings: string[] = [];
  if (bytes.length < stride * h) warnings.push(`Only ${bytes.length} of ${stride * h} bytes present; the rest is left white`);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const b = bytes[y * stride + (x >> 3)] ?? 0;
    const v = (b >> (x & 7)) & 1 ? 0 : 255; // LSB first; 1 = foreground (black)
    const o = (y * w + x) * 4; d[o] = d[o + 1] = d[o + 2] = v; d[o + 3] = 255;
  }
  const info: Record<string, string> = {};
  if (xhot !== undefined) info.Hotspot = `${xhot}, ${yhot}`;
  return { pages: [{ width: w, height: h, frames: [{ raster: out, delay: 0 }], loops: 0, bitDepth: 1, hasAlpha: false, notes: ['X bitmap (C source)'] }], info, warnings };
}

export function decodeXpm(u8: Uint8Array): DecodeResult {
  const text = latin1(u8, 0, u8.length);
  const warnings: string[] = [];
  let lines: string[];
  if (/^\s*!\s*XPM2/.test(text)) lines = text.split(/\r?\n/).slice(1).filter((l) => l.trim().length);
  else {
    // XPM3: the strings of the C array, in order; comments may sit between them.
    const stripped = text.replace(/\/\*[\s\S]*?\*\//g, '');
    const m = stripped.match(/"((?:[^"\\]|\\.)*)"/g);
    if (!m) throw new Error('Not an XPM file');
    lines = m.map((s) => s.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\'));
  }
  const hdr = lines[0].trim().split(/\s+/).map(Number);
  const [w, h, ncolors, cpp] = hdr;
  if (!w || !h || !ncolors || !cpp || w * h > 80_000_000) throw new Error('Bad XPM header');
  const info: Record<string, string> = {};
  if (hdr.length >= 6 && Number.isFinite(hdr[4])) info.Hotspot = `${hdr[4]}, ${hdr[5]}`;
  const colors = new Map<string, [number, number, number, number]>();
  for (let i = 1; i <= ncolors && i < lines.length; i++) {
    const line = lines[i];
    const chars = line.slice(0, cpp);
    const rest = line.slice(cpp).trim().split(/\s+/);
    let best: string | null = null, bestRank = 9;
    for (let k = 0; k + 1 < rest.length; k += 2) {
      const key = rest[k], rank = { c: 0, g: 1, g4: 2, m: 3, s: 9 }[key] ?? 9;
      let val = rest[k + 1];
      // Color values may contain spaces ("Navy Blue"): take words until the next key.
      let j = k + 2;
      while (j < rest.length && !['c', 'g', 'g4', 'm', 's'].includes(rest[j])) { val += ' ' + rest[j]; j++; }
      k = j - 2;
      if (rank < bestRank) { best = val; bestRank = rank; }
    }
    colors.set(chars, parseColor(best || 'None', warnings));
  }
  const out = makeRaster(w, h);
  const d = out.data;
  let hasAlpha = false;
  for (let y = 0; y < h; y++) {
    const row = lines[1 + ncolors + y];
    if (row === undefined) { warnings.push(`Only ${y} of ${h} rows present`); break; }
    for (let x = 0; x < w; x++) {
      const c = colors.get(row.slice(x * cpp, x * cpp + cpp)) || [0, 0, 0, 0];
      const o = (y * w + x) * 4; d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = c[3];
      if (c[3] !== 255) hasAlpha = true;
    }
  }
  return { pages: [{ width: w, height: h, frames: [{ raster: out, delay: 0 }], loops: 0, bitDepth: ncolors <= 2 ? 1 : ncolors <= 16 ? 4 : ncolors <= 256 ? 8 : 24, paletteSize: ncolors, hasAlpha, notes: [`X pixmap, ${ncolors} colors, ${cpp} char${cpp > 1 ? 's' : ''} per pixel`] }], info, warnings };
}

const X11: Record<string, number> = {
  black: 0x000000, white: 0xffffff, red: 0xff0000, green: 0x00ff00, blue: 0x0000ff, yellow: 0xffff00, cyan: 0x00ffff, magenta: 0xff00ff, gray: 0xbebebe, grey: 0xbebebe,
  orange: 0xffa500, pink: 0xffc0cb, purple: 0xa020f0, brown: 0xa52a2a, navy: 0x000080, navyblue: 0x000080, maroon: 0xb03060, olive: 0x808000, teal: 0x008080, silver: 0xc0c0c0, gold: 0xffd700,
  darkgray: 0xa9a9a9, darkgrey: 0xa9a9a9, lightgray: 0xd3d3d3, lightgrey: 0xd3d3d3, dimgray: 0x696969, dimgrey: 0x696969, darkgreen: 0x006400, darkblue: 0x00008b, darkred: 0x8b0000, lightblue: 0xadd8e6, lightgreen: 0x90ee90,
  khaki: 0xf0e68c, beige: 0xf5f5dc, ivory: 0xfffff0, tan: 0xd2b48c, salmon: 0xfa8072, coral: 0xff7f50, tomato: 0xff6347, violet: 0xee82ee, indigo: 0x4b0082, turquoise: 0x40e0d0, aquamarine: 0x7fffd4, chocolate: 0xd2691e,
  firebrick: 0xb22222, forestgreen: 0x228b22, limegreen: 0x32cd32, seagreen: 0x2e8b57, skyblue: 0x87ceeb, steelblue: 0x4682b4, royalblue: 0x4169e1, slategray: 0x708090, slategrey: 0x708090, wheat: 0xf5deb3, snow: 0xfffafa, linen: 0xfaf0e6,
  lavender: 0xe6e6fa, plum: 0xdda0dd, orchid: 0xda70d6, sienna: 0xa0522d, peru: 0xcd853f, goldenrod: 0xdaa520, crimson: 0xdc143c, bisque: 0xffe4c4, honeydew: 0xf0fff0, mintcream: 0xf5fffa, azure: 0xf0ffff, aliceblue: 0xf0f8ff,
};

function parseColor(s: string, warnings: string[]): [number, number, number, number] {
  const v = s.trim();
  if (/^none$/i.test(v)) return [0, 0, 0, 0];
  const hex = v.match(/^#([0-9a-f]+)$/i)?.[1];
  if (hex) {
    const n = hex.length / 3;
    if (Number.isInteger(n) && n >= 1 && n <= 4) {
      const ch = (i: number) => { const part = hex.slice(i * n, i * n + n); return Math.round((parseInt(part, 16) * 255) / (16 ** n - 1)); };
      return [ch(0), ch(1), ch(2), 255];
    }
  }
  const pct = v.match(/^%(\d+)$/)?.[1]; // XPM extension: gray percent
  if (pct) { const g = Math.round((255 * +pct) / 100); return [g, g, g, 255]; }
  const key = v.toLowerCase().replace(/\s+/g, '');
  const gm = key.match(/^gr[ae]y(\d{1,3})$/);
  if (gm) { const g = Math.round((255 * +gm[1]) / 100); return [g, g, g, 255]; }
  const stripped = key.replace(/\d+$/, '');
  const c = X11[key] ?? X11[stripped];
  if (c !== undefined) return [c >> 16, (c >> 8) & 255, c & 255, 255];
  if (!warnings.some((w) => w.includes(v))) warnings.push(`Unknown color name "${v}" shown as gray`);
  return [128, 128, 128, 255];
}
