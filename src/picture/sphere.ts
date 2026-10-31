/**
 * 360° View: a perspective window into an equirectangular panorama (photo spheres, 2:1). Yaw 0
 * looks at the middle of the panorama, positive yaw turns right and positive pitch looks up; the
 * field of view is horizontal.
 */
import type { Raster } from '../codecs/raster';

/** The panorama pixel (u, v) seen along the view ray through output pixel (i, j). */
export function rayToUV(i: number, j: number, w: number, h: number, yawDeg: number, pitchDeg: number, fovDeg: number, W: number, H: number): [number, number] {
  const t = Math.tan((fovDeg * Math.PI) / 360);
  const x = (2 * (i + 0.5) / w - 1) * t, y = (1 - 2 * (j + 0.5) / h) * t * (h / w), z = 1;
  const p = (pitchDeg * Math.PI) / 180, yw = (yawDeg * Math.PI) / 180;
  const y1 = y * Math.cos(p) + z * Math.sin(p), z1 = -y * Math.sin(p) + z * Math.cos(p);
  const x2 = x * Math.cos(yw) + z1 * Math.sin(yw), z2 = -x * Math.sin(yw) + z1 * Math.cos(yw);
  const len = Math.hypot(x2, y1, z2), lon = Math.atan2(x2, z2), lat = Math.asin(Math.max(-1, Math.min(1, y1 / len)));
  return [(lon / (2 * Math.PI) + 0.5) * W, (0.5 - lat / Math.PI) * H];
}

/** Renders the view (nearest-neighbour sampling, wrapping around in longitude). */
export function renderSphere(src: Raster, w: number, h: number, yaw: number, pitch: number, fov: number, out?: Uint8ClampedArray): Uint8ClampedArray {
  const W = src.width, H = src.height, d = src.data, o = out && out.length === w * h * 4 ? out : new Uint8ClampedArray(w * h * 4);
  const t = Math.tan((fov * Math.PI) / 360), p = (pitch * Math.PI) / 180, yw = (yaw * Math.PI) / 180, cp = Math.cos(p), sp = Math.sin(p), cy = Math.cos(yw), sy = Math.sin(yw);
  for (let j = 0; j < h; j++) {
    const y = (1 - 2 * (j + 0.5) / h) * t * (h / w);
    for (let i = 0; i < w; i++) {
      const x = (2 * (i + 0.5) / w - 1) * t;
      const y1 = y * cp + sp, z1 = -y * sp + cp, x2 = x * cy + z1 * sy, z2 = -x * sy + z1 * cy;
      const len = Math.hypot(x2, y1, z2), lon = Math.atan2(x2, z2), lat = Math.asin(y1 / len);
      let u = Math.floor((lon / (2 * Math.PI) + 0.5) * W); u = ((u % W) + W) % W;
      const v = Math.min(H - 1, Math.max(0, Math.floor((0.5 - lat / Math.PI) * H)));
      const si = (v * W + u) * 4, di = (j * w + i) * 4;
      o[di] = d[si]; o[di + 1] = d[si + 1]; o[di + 2] = d[si + 2]; o[di + 3] = 255;
    }
  }
  return o;
}
/** True when the picture looks like a full equirectangular panorama (2:1, or marked so in XMP). */
export const looksEquirect = (w: number, h: number, xmp?: string | null): boolean => Math.abs(w / h - 2) < 0.04 || /ProjectionType["'>=\s]*equirectangular/i.test(xmp || '');
