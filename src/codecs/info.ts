/**
 * Container details the platform decoder does not report: JPEG frame type, components and JFIF density,
 * PNG color type, bit depth, pHYs and animation, WebP features. Used for the Information dialog and to
 * know when a platform-decoded file is animated.
 */
export interface ContainerInfo {
  width?: number;
  height?: number;
  bitDepth?: number;
  hasAlpha?: boolean;
  dpi?: [number, number];
  animated?: boolean;
  frames?: number;
  loops?: number;
  paletteSize?: number;
  notes: string[];
  info: Record<string, string>;
  warnings: string[];
}

export function jpegInfo(u8: Uint8Array): ContainerInfo {
  const r: ContainerInfo = { notes: [], info: {}, warnings: [] };
  let p = 2;
  const segments: string[] = [];
  let dqtTables = 0;
  while (p + 4 <= u8.length) {
    if (u8[p] !== 0xff) { r.warnings.push(`Unexpected data at ${p}`); break; }
    const m = u8[p + 1];
    if (m === 0xff) { p++; continue; }
    if (m === 0xd9) break;
    if (m === 0xda) { segments.push('SOS'); break; }
    if (m >= 0xd0 && m <= 0xd7 || m === 0x01 || m === 0xd8) { p += 2; continue; }
    const len = (u8[p + 2] << 8) | u8[p + 3];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      const kinds: Record<number, string> = { 0xc0: 'baseline', 0xc1: 'extended sequential', 0xc2: 'progressive', 0xc3: 'lossless', 0xc5: 'differential sequential', 0xc6: 'differential progressive', 0xc7: 'differential lossless', 0xc9: 'arithmetic sequential', 0xca: 'arithmetic progressive', 0xcb: 'arithmetic lossless' };
      const precision = u8[p + 4];
      r.height = (u8[p + 5] << 8) | u8[p + 6]; r.width = (u8[p + 7] << 8) | u8[p + 8];
      const nc = u8[p + 9];
      r.bitDepth = precision * nc;
      r.notes.push(kinds[m] || `SOF${m - 0xc0}`, nc === 1 ? 'grayscale' : nc === 3 ? 'YCbCr/RGB' : nc === 4 ? 'CMYK/YCCK' : `${nc} components`);
      if (nc === 3) {
        const h0 = u8[p + 11] >> 4, v0 = u8[p + 11] & 15;
        const sub = h0 === 1 && v0 === 1 ? '4:4:4' : h0 === 2 && v0 === 1 ? '4:2:2' : h0 === 2 && v0 === 2 ? '4:2:0' : h0 === 1 && v0 === 2 ? '4:4:0' : `${h0}x${v0}`;
        r.info.subsampling = sub;
      }
      r.info.precision = `${precision} bits per sample`;
    } else if (m === 0xe0 && u8[p + 4] === 0x4a && u8[p + 5] === 0x46) {
      const units = u8[p + 11], xd = (u8[p + 12] << 8) | u8[p + 13], yd = (u8[p + 14] << 8) | u8[p + 15];
      r.info.jfif = `${u8[p + 9]}.${String(u8[p + 10]).padStart(2, '0')}`;
      if (units === 1 && xd && yd) r.dpi = [xd, yd]; else if (units === 2 && xd && yd) r.dpi = [Math.round(xd * 2.54), Math.round(yd * 2.54)];
      else if (xd && yd) r.info.aspect = `${xd}:${yd}`;
    } else if (m === 0xe1) {
      const sig = String.fromCharCode(...u8.subarray(p + 4, p + 10));
      if (sig.startsWith('Exif')) segments.push('EXIF'); else if (sig.startsWith('http:/')) { segments.push('XMP'); r.info.xmp = 'yes'; }
    } else if (m === 0xe2 && String.fromCharCode(...u8.subarray(p + 4, p + 15)) === 'ICC_PROFILE') { r.info.icc = 'embedded'; segments.push('ICC'); }
    else if (m === 0xed) { r.info.iptc = 'yes (Photoshop IRB)'; segments.push('IPTC'); }
    else if (m === 0xee && String.fromCharCode(...u8.subarray(p + 4, p + 9)) === 'Adobe') { r.info.adobe = `transform ${u8[p + 15]}`; }
    else if (m === 0xfe) { r.info.comment = new TextDecoder('latin1').decode(u8.subarray(p + 4, p + 2 + len)).trim(); }
    else if (m === 0xdb) { dqtTables++; const q = estimateQuality(u8.subarray(p + 4, p + 2 + len)); if (q !== null && r.info.quality === undefined) r.info.quality = `about ${q} (from the quantization table)`; }
    p += 2 + len;
  }
  if (segments.length) r.info.segments = segments.join(', ');
  if (!r.width) r.warnings.push('No frame header found');
  return r;
}

/** IJG-style quality estimate from the luminance quantization table (precision 8 or 16). */
function estimateQuality(dqt: Uint8Array): number | null {
  const pq = dqt[0] >> 4, tq = dqt[0] & 15;
  if (tq !== 0) return null;
  const std = [16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99];
  const zigzag = [0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63];
  let sum = 0;
  for (let i = 0; i < 64; i++) { const v = pq ? (dqt[1 + i * 2] << 8) | dqt[2 + i * 2] : dqt[1 + i]; sum += (v * 100) / std[zigzag[i]]; }
  const scale = sum / 64;
  const q = scale <= 100 ? Math.round((200 - scale) / 2) : Math.round(5000 / scale);
  return Math.max(1, Math.min(100, q));
}

export function pngInfo(u8: Uint8Array): ContainerInfo {
  const r: ContainerInfo = { notes: [], info: {}, warnings: [] };
  let p = 8;
  const chunks: string[] = [];
  let frames = 0;
  while (p + 8 <= u8.length) {
    const len = (u8[p] << 24 | u8[p + 1] << 16 | u8[p + 2] << 8 | u8[p + 3]) >>> 0;
    const type = String.fromCharCode(u8[p + 4], u8[p + 5], u8[p + 6], u8[p + 7]);
    const d = p + 8;
    if (type === 'IHDR') {
      r.width = (u8[d] << 24 | u8[d + 1] << 16 | u8[d + 2] << 8 | u8[d + 3]) >>> 0; r.height = (u8[d + 4] << 24 | u8[d + 5] << 16 | u8[d + 6] << 8 | u8[d + 7]) >>> 0;
      const depth = u8[d + 8], ct = u8[d + 9];
      const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ct] || 1;
      r.bitDepth = depth * channels;
      r.hasAlpha = ct === 4 || ct === 6;
      r.notes.push({ 0: 'grayscale', 2: 'RGB', 3: 'palette', 4: 'grayscale + alpha', 6: 'RGBA' }[ct] || `color type ${ct}`, `${depth} bits per channel`, u8[d + 12] ? 'interlaced (Adam7)' : '');
    } else if (type === 'PLTE') r.paletteSize = len / 3;
    else if (type === 'tRNS') r.hasAlpha = true;
    else if (type === 'pHYs') { const x = (u8[d] << 24 | u8[d + 1] << 16 | u8[d + 2] << 8 | u8[d + 3]) >>> 0, y = (u8[d + 4] << 24 | u8[d + 5] << 16 | u8[d + 6] << 8 | u8[d + 7]) >>> 0; if (u8[d + 8] === 1 && x && y) r.dpi = [Math.round(x * 0.0254), Math.round(y * 0.0254)]; }
    else if (type === 'acTL') { frames = (u8[d] << 24 | u8[d + 1] << 16 | u8[d + 2] << 8 | u8[d + 3]) >>> 0; r.loops = (u8[d + 4] << 24 | u8[d + 5] << 16 | u8[d + 6] << 8 | u8[d + 7]) >>> 0; r.animated = frames > 1; r.frames = frames; }
    else if (type === 'gAMA') r.info.gamma = String(((u8[d] << 24 | u8[d + 1] << 16 | u8[d + 2] << 8 | u8[d + 3]) >>> 0) / 100000);
    else if (type === 'sRGB') r.info.colorSpace = 'sRGB';
    else if (type === 'iCCP') { const end = u8.indexOf(0, d); r.info.icc = new TextDecoder('latin1').decode(u8.subarray(d, end)); }
    else if (type === 'cICP') r.info.colorSpace = `CICP ${u8[d]}/${u8[d + 1]}/${u8[d + 2]}`;
    else if (type === 'tEXt' || type === 'iTXt' || type === 'zTXt') { const end = u8.indexOf(0, d); const key = new TextDecoder('latin1').decode(u8.subarray(d, end)); if (type === 'tEXt') r.info[key] = new TextDecoder('latin1').decode(u8.subarray(end + 1, d + len)).slice(0, 2000); else r.info[key] = type === 'iTXt' ? new TextDecoder('utf-8').decode(u8.subarray(end + 1, d + len)).replace(/^[\s\S]{0,2}[^\0]*\0[^\0]*\0/, '').slice(0, 2000) : '(compressed text)'; }
    else if (type === 'eXIf') r.info.exif = 'yes';
    else if (type === 'IEND') { chunks.push(type); break; }
    chunks.push(type);
    p += 12 + len;
  }
  if (!chunks.includes('IEND')) r.warnings.push('The file ends before the IEND chunk (truncated)');
  r.notes = r.notes.filter(Boolean);
  r.info.chunks = [...new Set(chunks)].join(', ');
  return r;
}

export function webpInfo(u8: Uint8Array): ContainerInfo {
  const r: ContainerInfo = { notes: [], info: {}, warnings: [] };
  let p = 12;
  const chunks: string[] = [];
  let frames = 0;
  while (p + 8 <= u8.length) {
    const type = String.fromCharCode(u8[p], u8[p + 1], u8[p + 2], u8[p + 3]);
    const len = u8[p + 4] | (u8[p + 5] << 8) | (u8[p + 6] << 16) | (u8[p + 7] << 24);
    const d = p + 8;
    if (type === 'VP8X') { const f = u8[d]; r.hasAlpha = !!(f & 0x10); r.animated = !!(f & 2); r.width = 1 + (u8[d + 4] | u8[d + 5] << 8 | u8[d + 6] << 16); r.height = 1 + (u8[d + 7] | u8[d + 8] << 8 | u8[d + 9] << 16); if (f & 0x20) r.info.icc = 'embedded'; if (f & 8) r.info.exif = 'yes'; if (f & 4) r.info.xmp = 'yes'; }
    else if (type === 'VP8 ') { r.notes.push('lossy (VP8)'); if (!r.width) { r.width = (u8[d + 6] | u8[d + 7] << 8) & 0x3fff; r.height = (u8[d + 8] | u8[d + 9] << 8) & 0x3fff; } }
    else if (type === 'VP8L') { r.notes.push('lossless (VP8L)'); const b = u8[d + 1] | u8[d + 2] << 8 | u8[d + 3] << 16 | u8[d + 4] << 24; if (!r.width) { r.width = (b & 0x3fff) + 1; r.height = ((b >> 14) & 0x3fff) + 1; } if ((b >> 28) & 1) r.hasAlpha = true; }
    else if (type === 'ANIM') { r.loops = u8[d + 4] | (u8[d + 5] << 8); }
    else if (type === 'ANMF') frames++;
    else if (type === 'ALPH') r.hasAlpha = true;
    chunks.push(type.trim());
    p += 8 + len + (len & 1);
  }
  if (frames) { r.frames = frames; r.animated = frames > 1; r.notes.push(`${frames} frames`); }
  r.bitDepth = r.hasAlpha ? 32 : 24;
  r.info.chunks = [...new Set(chunks)].join(', ');
  return r;
}
