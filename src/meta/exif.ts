/**
 * EXIF reader: the TIFF-structured block inside JPEG (APP1), PNG (eXIf), WebP (EXIF chunk), HEIF/AVIF
 * (Exif item) and TIFF files themselves. Produces named tags for IFD0, the Exif IFD and the GPS IFD, the
 * orientation, the date taken and decoded GPS coordinates. Maker notes are not decoded.
 */
import { readIfd, type IfdEntry } from '../codecs/tiff';

export interface ExifTag { tag: number; name: string; value: string; raw: number[] | string }
export interface ExifData {
  tags: ExifTag[];
  orientation: number;
  dateTaken?: string;
  make?: string;
  model?: string;
  lens?: string;
  exposure?: string;
  gps?: { lat: number; lon: number; alt?: number };
  /** Pixels per inch from XResolution/YResolution when the unit is inches or centimeters. */
  dpi?: [number, number];
  software?: string;
  description?: string;
  artist?: string;
  copyright?: string;
  userComment?: string;
}

const NAMES: Record<number, string> = {
  0x100: 'ImageWidth', 0x101: 'ImageHeight', 0x102: 'BitsPerSample', 0x103: 'Compression', 0x106: 'PhotometricInterpretation', 0x10e: 'ImageDescription', 0x10f: 'Make', 0x110: 'Model', 0x111: 'StripOffsets', 0x112: 'Orientation', 0x115: 'SamplesPerPixel', 0x11a: 'XResolution', 0x11b: 'YResolution', 0x11c: 'PlanarConfiguration', 0x128: 'ResolutionUnit', 0x131: 'Software', 0x132: 'DateTime', 0x13b: 'Artist', 0x13e: 'WhitePoint', 0x13f: 'PrimaryChromaticities', 0x211: 'YCbCrCoefficients', 0x213: 'YCbCrPositioning', 0x214: 'ReferenceBlackWhite', 0x8298: 'Copyright', 0x8769: 'ExifIFDPointer', 0x8825: 'GPSInfoIFDPointer', 0xa005: 'InteroperabilityIFDPointer',
  0x829a: 'ExposureTime', 0x829d: 'FNumber', 0x8822: 'ExposureProgram', 0x8824: 'SpectralSensitivity', 0x8827: 'ISOSpeedRatings', 0x8830: 'SensitivityType', 0x8832: 'RecommendedExposureIndex', 0x9000: 'ExifVersion', 0x9003: 'DateTimeOriginal', 0x9004: 'DateTimeDigitized', 0x9010: 'OffsetTime', 0x9011: 'OffsetTimeOriginal', 0x9101: 'ComponentsConfiguration', 0x9102: 'CompressedBitsPerPixel', 0x9201: 'ShutterSpeedValue', 0x9202: 'ApertureValue', 0x9203: 'BrightnessValue', 0x9204: 'ExposureBiasValue', 0x9205: 'MaxApertureValue', 0x9206: 'SubjectDistance', 0x9207: 'MeteringMode', 0x9208: 'LightSource', 0x9209: 'Flash', 0x920a: 'FocalLength', 0x9214: 'SubjectArea', 0x927c: 'MakerNote', 0x9286: 'UserComment', 0x9290: 'SubSecTime', 0x9291: 'SubSecTimeOriginal', 0x9292: 'SubSecTimeDigitized', 0xa000: 'FlashpixVersion', 0xa001: 'ColorSpace', 0xa002: 'PixelXDimension', 0xa003: 'PixelYDimension', 0xa004: 'RelatedSoundFile', 0xa20e: 'FocalPlaneXResolution', 0xa20f: 'FocalPlaneYResolution', 0xa210: 'FocalPlaneResolutionUnit', 0xa215: 'ExposureIndex', 0xa217: 'SensingMethod', 0xa300: 'FileSource', 0xa301: 'SceneType', 0xa302: 'CFAPattern', 0xa401: 'CustomRendered', 0xa402: 'ExposureMode', 0xa403: 'WhiteBalance', 0xa404: 'DigitalZoomRatio', 0xa405: 'FocalLengthIn35mmFilm', 0xa406: 'SceneCaptureType', 0xa407: 'GainControl', 0xa408: 'Contrast', 0xa409: 'Saturation', 0xa40a: 'Sharpness', 0xa40c: 'SubjectDistanceRange', 0xa420: 'ImageUniqueID', 0xa430: 'CameraOwnerName', 0xa431: 'BodySerialNumber', 0xa432: 'LensSpecification', 0xa433: 'LensMake', 0xa434: 'LensModel', 0xa435: 'LensSerialNumber', 0xa500: 'Gamma',
};
const GPS_NAMES: Record<number, string> = { 0: 'GPSVersionID', 1: 'GPSLatitudeRef', 2: 'GPSLatitude', 3: 'GPSLongitudeRef', 4: 'GPSLongitude', 5: 'GPSAltitudeRef', 6: 'GPSAltitude', 7: 'GPSTimeStamp', 8: 'GPSSatellites', 9: 'GPSStatus', 10: 'GPSMeasureMode', 11: 'GPSDOP', 12: 'GPSSpeedRef', 13: 'GPSSpeed', 16: 'GPSImgDirectionRef', 17: 'GPSImgDirection', 18: 'GPSMapDatum', 29: 'GPSDateStamp', 31: 'GPSHPositioningError' };

const ENUMS: Record<string, Record<number, string>> = {
  Orientation: { 1: 'Normal', 2: 'Mirrored', 3: 'Rotated 180°', 4: 'Flipped', 5: 'Mirrored and rotated 90° CCW', 6: 'Rotated 90° CW', 7: 'Mirrored and rotated 90° CW', 8: 'Rotated 90° CCW' },
  ResolutionUnit: { 1: 'none', 2: 'inch', 3: 'cm' },
  ExposureProgram: { 0: 'Not defined', 1: 'Manual', 2: 'Program', 3: 'Aperture priority', 4: 'Shutter priority', 5: 'Creative', 6: 'Action', 7: 'Portrait', 8: 'Landscape' },
  MeteringMode: { 0: 'Unknown', 1: 'Average', 2: 'Center-weighted', 3: 'Spot', 4: 'Multi-spot', 5: 'Pattern', 6: 'Partial', 255: 'Other' },
  LightSource: { 0: 'Unknown', 1: 'Daylight', 2: 'Fluorescent', 3: 'Tungsten', 4: 'Flash', 9: 'Fine weather', 10: 'Cloudy', 11: 'Shade', 17: 'Standard light A', 18: 'Standard light B', 19: 'Standard light C', 255: 'Other' },
  ColorSpace: { 1: 'sRGB', 2: 'Adobe RGB', 65535: 'Uncalibrated' },
  ExposureMode: { 0: 'Auto', 1: 'Manual', 2: 'Auto bracket' }, WhiteBalance: { 0: 'Auto', 1: 'Manual' },
  SceneCaptureType: { 0: 'Standard', 1: 'Landscape', 2: 'Portrait', 3: 'Night' }, Contrast: { 0: 'Normal', 1: 'Soft', 2: 'Hard' }, Saturation: { 0: 'Normal', 1: 'Low', 2: 'High' }, Sharpness: { 0: 'Normal', 1: 'Soft', 2: 'Hard' },
  SensingMethod: { 1: 'Not defined', 2: 'One-chip color area', 3: 'Two-chip color area', 4: 'Three-chip color area', 5: 'Color sequential area', 7: 'Trilinear', 8: 'Color sequential linear' },
  CustomRendered: { 0: 'Normal', 1: 'Custom' }, GainControl: { 0: 'None', 1: 'Low gain up', 2: 'High gain up', 3: 'Low gain down', 4: 'High gain down' },
  Compression: { 1: 'Uncompressed', 6: 'JPEG (thumbnail)', 7: 'JPEG' },
};

function flash(v: number): string {
  const parts = [v & 1 ? 'Fired' : 'Did not fire'];
  if ((v >> 3) & 3) parts.push(['', 'compulsory', 'suppressed', 'auto'][(v >> 3) & 3]);
  if (v & 0x40) parts.push('red-eye reduction');
  return parts.join(', ');
}

function textOf(e: IfdEntry): string {
  const bytes = e.values.map((v) => v & 255);
  const end = bytes.indexOf(0);
  try { return new TextDecoder('utf-8').decode(Uint8Array.from(end >= 0 ? bytes.slice(0, end) : bytes)).trim(); } catch { return ''; }
}

function format(name: string, e: IfdEntry): string {
  if (e.type === 2) return textOf(e);
  if (name === 'UserComment' && e.type === 7) {
    const b = Uint8Array.from(e.values.map((v) => v & 255));
    const code = String.fromCharCode(...b.subarray(0, 8)).replace(/\0/g, '');
    const body = b.subarray(8);
    if (code === 'ASCII' || code === '') return new TextDecoder('latin1').decode(body).replace(/\0+$/, '').trim();
    if (code === 'UNICODE') { try { return new TextDecoder('utf-16be').decode(body).replace(/\0+$/, '').trim(); } catch { /* */ } }
    return '';
  }
  if (e.type === 7 && name.endsWith('Version')) return String.fromCharCode(...e.values.map((v) => v & 255));
  if (e.type === 7 && name === 'MakerNote') return `${e.count} bytes`;
  if (e.type === 7) return e.count > 16 ? `${e.count} bytes` : e.values.map((v) => (v & 255).toString(16).padStart(2, '0')).join(' ');
  const v = e.values;
  if (ENUMS[name]) return ENUMS[name][v[0]] ?? String(v[0]);
  if (name === 'Flash') return flash(v[0]);
  if (name === 'ExposureTime') return v[0] >= 1 ? `${round(v[0])} s` : `1/${Math.round(1 / v[0])} s`;
  if (name === 'FNumber' || name === 'MaxApertureValue') return `f/${round(name === 'FNumber' ? v[0] : Math.pow(2, v[0] / 2))}`;
  if (name === 'ApertureValue') return `f/${round(Math.pow(2, v[0] / 2))}`;
  if (name === 'ShutterSpeedValue') { const t = Math.pow(2, -v[0]); return t >= 1 ? `${round(t)} s` : `1/${Math.round(1 / t)} s`; }
  if (name === 'FocalLength') return `${round(v[0])} mm`;
  if (name === 'FocalLengthIn35mmFilm') return `${v[0]} mm`;
  if (name === 'ExposureBiasValue') return `${v[0] > 0 ? '+' : ''}${round(v[0])} EV`;
  if (name === 'SubjectDistance') return v[0] ? `${round(v[0])} m` : 'unknown';
  if (name === 'DigitalZoomRatio') return v[0] ? `${round(v[0])}×` : 'none';
  if (name === 'LensSpecification') return v.length >= 4 ? `${round(v[0])}–${round(v[1])} mm f/${round(v[2])}–${round(v[3])}` : v.map(round).join(', ');
  if (name === 'GPSLatitude' || name === 'GPSLongitude') return v.length >= 3 ? `${v[0]}° ${v[1]}′ ${round(v[2])}″` : v.join(', ');
  if (name === 'GPSAltitude') return `${round(v[0])} m`;
  if (name === 'GPSTimeStamp') return v.map((x) => String(Math.floor(x)).padStart(2, '0')).join(':');
  if (name === 'GPSVersionID') return v.join('.');
  if (name === 'ISOSpeedRatings') return v.join(', ');
  return v.length > 8 ? `${v.slice(0, 8).map(round).join(', ')}… (${v.length} values)` : v.map(round).join(', ');
}
const round = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));

/** Parses a TIFF-structured EXIF block (starting at the byte-order mark). Returns null when it is not one. */
export function parseExifBlock(u8: Uint8Array): ExifData | null {
  if (u8.length < 8) return null;
  const le = u8[0] === 0x49 && u8[1] === 0x49;
  if (!le && !(u8[0] === 0x4d && u8[1] === 0x4d)) return null;
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (dv.getUint16(2, le) !== 42) return null;
  const ifd0 = dv.getUint32(4, le);
  const out: ExifData = { tags: [], orientation: 1 };
  const walk = (offset: number, names: Record<number, string>, prefix: string, depth = 0): Map<number, IfdEntry> => {
    if (!offset || offset >= u8.length || depth > 4) return new Map();
    const { tags } = readIfd(u8, offset, le);
    for (const e of tags.values()) {
      const name = names[e.tag] || `${prefix}0x${e.tag.toString(16)}`;
      if (e.tag === 0x8769 || e.tag === 0x8825 || e.tag === 0xa005) continue;
      const value = format(name, e);
      if (value) out.tags.push({ tag: e.tag, name, value, raw: e.type === 2 ? value : e.values });
    }
    return tags;
  };
  const t0 = walk(ifd0, NAMES, 'IFD0:');
  const exifPtr = t0.get(0x8769)?.values[0];
  const tExif = exifPtr ? walk(exifPtr, NAMES, 'Exif:', 1) : new Map<number, IfdEntry>();
  const gpsPtr = t0.get(0x8825)?.values[0];
  const tGps = gpsPtr ? walk(gpsPtr, GPS_NAMES, 'GPS:', 1) : new Map<number, IfdEntry>();
  const get = (m: Map<number, IfdEntry>, tag: number) => m.get(tag);
  out.orientation = get(t0, 0x112)?.values[0] || 1;
  if (out.orientation < 1 || out.orientation > 8) out.orientation = 1;
  const str = (m: Map<number, IfdEntry>, tag: number) => { const e = get(m, tag); return e ? textOf(e) : undefined; };
  out.make = str(t0, 0x10f); out.model = str(t0, 0x110); out.software = str(t0, 0x131); out.artist = str(t0, 0x13b); out.copyright = str(t0, 0x8298); out.description = str(t0, 0x10e);
  out.lens = str(tExif, 0xa434);
  out.dateTaken = str(tExif, 0x9003) || str(tExif, 0x9004) || str(t0, 0x132);
  const uc = get(tExif, 0x9286); if (uc) out.userComment = format('UserComment', uc) || undefined;
  const exp = get(tExif, 0x829a), fn = get(tExif, 0x829d), iso = get(tExif, 0x8827), fl = get(tExif, 0x920a);
  const bits: string[] = [];
  if (exp) bits.push(format('ExposureTime', exp));
  if (fn) bits.push(format('FNumber', fn));
  if (iso) bits.push(`ISO ${iso.values[0]}`);
  if (fl) bits.push(format('FocalLength', fl));
  if (bits.length) out.exposure = bits.join(', ');
  const unit = get(t0, 0x128)?.values[0] ?? 2;
  const xr = get(t0, 0x11a)?.values[0], yr = get(t0, 0x11b)?.values[0];
  if (xr && unit !== 1) { const y = yr || xr; out.dpi = unit === 3 ? [Math.round(xr * 2.54), Math.round(y * 2.54)] : [Math.round(xr), Math.round(y)]; }
  const lat = get(tGps, 2), lon = get(tGps, 4);
  if (lat && lon && lat.values.length >= 3 && lon.values.length >= 3) {
    const dms = (v: number[]) => v[0] + v[1] / 60 + v[2] / 3600;
    let la = dms(lat.values), lo = dms(lon.values);
    if ((str(tGps, 1) || 'N').toUpperCase().startsWith('S')) la = -la;
    if ((str(tGps, 3) || 'E').toUpperCase().startsWith('W')) lo = -lo;
    const alt = get(tGps, 6)?.values[0];
    out.gps = { lat: la, lon: lo, alt: alt !== undefined ? (get(tGps, 5)?.values[0] === 1 ? -alt : alt) : undefined };
  }
  return out;
}

/** Finds the EXIF block inside a container and parses it. */
export function readExif(u8: Uint8Array): ExifData | null {
  // JPEG: APP1 "Exif\0\0"
  if (u8[0] === 0xff && u8[1] === 0xd8) {
    let p = 2;
    while (p + 4 < u8.length && u8[p] === 0xff) {
      const marker = u8[p + 1];
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { p += 2; continue; }
      if (marker === 0xda || marker === 0xd9) break;
      const len = (u8[p + 2] << 8) | u8[p + 3];
      if (marker === 0xe1 && u8[p + 4] === 0x45 && u8[p + 5] === 0x78 && u8[p + 6] === 0x69 && u8[p + 7] === 0x66) return parseExifBlock(u8.subarray(p + 10, p + 2 + len));
      p += 2 + len;
    }
    return null;
  }
  // TIFF (and camera RAW files with a TIFF structure)
  if ((u8[0] === 0x49 && u8[1] === 0x49 && u8[2] === 42) || (u8[0] === 0x4d && u8[1] === 0x4d && u8[3] === 42)) return parseExifBlock(u8);
  // PNG: eXIf chunk
  if (u8[0] === 0x89 && u8[1] === 0x50) {
    let p = 8;
    while (p + 8 <= u8.length) {
      const len = (u8[p] << 24 | u8[p + 1] << 16 | u8[p + 2] << 8 | u8[p + 3]) >>> 0;
      const type = String.fromCharCode(u8[p + 4], u8[p + 5], u8[p + 6], u8[p + 7]);
      if (type === 'eXIf') return parseExifBlock(u8.subarray(p + 8, p + 8 + len));
      if (type === 'IEND') break;
      p += 12 + len;
    }
    return null;
  }
  // WebP: RIFF chunk "EXIF"
  if (u8[0] === 0x52 && u8[1] === 0x49 && u8[2] === 0x46 && u8[3] === 0x46 && u8[8] === 0x57 && u8[9] === 0x45) {
    let p = 12;
    while (p + 8 <= u8.length) {
      const type = String.fromCharCode(u8[p], u8[p + 1], u8[p + 2], u8[p + 3]);
      const len = u8[p + 4] | (u8[p + 5] << 8) | (u8[p + 6] << 16) | (u8[p + 7] << 24);
      if (type === 'EXIF') { let b = u8.subarray(p + 8, p + 8 + len); if (b[0] === 0x45 && b[1] === 0x78) b = b.subarray(6); return parseExifBlock(b); }
      p += 8 + len + (len & 1);
    }
    return null;
  }
  // ISOBMFF (HEIF/AVIF): the Exif item, found by scanning for the TIFF header after an "Exif" marker in the mdat.
  if (u8.length > 12 && u8[4] === 0x66 && u8[5] === 0x74 && u8[6] === 0x79 && u8[7] === 0x70) {
    const limit = Math.min(u8.length - 4, 4 << 20);
    for (let p = 0; p < limit; p++) {
      if (u8[p] === 0x45 && u8[p + 1] === 0x78 && u8[p + 2] === 0x69 && u8[p + 3] === 0x66 && u8[p + 4] === 0 && u8[p + 5] === 0) {
        const r = parseExifBlock(u8.subarray(p + 6));
        if (r && r.tags.length) return r;
      }
    }
  }
  return null;
}
