/**
 * Measure: distances, angles and areas between points placed on a picture, in pixels or in a real
 * unit once a scale is set from a known length (a map's scale bar, a ruler in a document scan, a
 * specimen card). Angles follow the screen's y-down axis turned to the usual convention: 0° points
 * right and positive angles go counterclockwise.
 */
export type P = [number, number];
export interface Scale { perPx: number; unit: string }

export const dist = (a: P, b: P): number => Math.hypot(b[0] - a[0], b[1] - a[1]);
export function pathLength(pts: P[], closed = false): number {
  let s = 0; for (let i = 1; i < pts.length; i++) s += dist(pts[i - 1], pts[i]);
  if (closed && pts.length > 2) s += dist(pts[pts.length - 1], pts[0]);
  return s;
}
/** Shoelace area (always positive). */
export function polygonArea(pts: P[]): number { let s = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; s += a[0] * b[1] - b[0] * a[1]; } return Math.abs(s) / 2; }
/** Direction of the segment a→b in degrees, −180..180, 0 = right, counterclockwise positive. */
export const segmentAngle = (a: P, b: P): number => { const v = Math.atan2(a[1] - b[1], b[0] - a[0]) * 180 / Math.PI; return v === 0 ? 0 : v; };
/** The angle at vertex b between b→a and b→c, 0..180. */
export function vertexAngle(a: P, b: P, c: P): number {
  const u = [a[0] - b[0], a[1] - b[1]], v = [c[0] - b[0], c[1] - b[1]];
  const cos = (u[0] * v[0] + u[1] * v[1]) / ((Math.hypot(u[0], u[1]) * Math.hypot(v[0], v[1])) || 1);
  return Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI;
}
const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(1) : Math.abs(v) >= 10 ? v.toFixed(2) : v.toFixed(3)).replace(/\.?0+$/, '');
export const formatLength = (px: number, s: Scale | null): string => (s ? `${fmt(px * s.perPx)} ${s.unit} (${fmt(px)} px)` : `${fmt(px)} px`);
export const formatArea = (px2: number, s: Scale | null): string => (s ? `${fmt(px2 * s.perPx * s.perPx)} ${s.unit}² (${fmt(px2)} px²)` : `${fmt(px2)} px²`);
/** A scale from a measured length in pixels that is `known` units long. */
export const scaleFrom = (px: number, known: number, unit: string): Scale | null => (px > 0 && known > 0 ? { perPx: known / px, unit: unit.trim() || 'units' } : null);
/** A scale from the picture's DPI (inches or centimeters). */
export const scaleFromDpi = (dpi: number, unit: 'in' | 'cm' | 'mm'): Scale | null => (dpi > 0 ? { perPx: (unit === 'in' ? 1 : unit === 'cm' ? 2.54 : 25.4) / dpi, unit } : null);

/** The lines the readout shows for a set of points. */
export function readout(pts: P[], closed: boolean, s: Scale | null): string[] {
  if (pts.length < 2) return pts.length ? ['Click the next point; double-click to close a shape.'] : [];
  const out: string[] = [];
  if (pts.length === 2) { out.push(`Distance ${formatLength(dist(pts[0], pts[1]), s)}`); out.push(`Angle ${fmt(segmentAngle(pts[0], pts[1]))}°`); return out; }
  out.push(`${closed ? 'Perimeter' : 'Path'} ${formatLength(pathLength(pts, closed), s)}`);
  const n = pts.length;
  out.push(closed ? `Area ${formatArea(polygonArea(pts), s)}` : `Last segment ${formatLength(dist(pts[n - 2], pts[n - 1]), s)}, angle at the bend ${fmt(vertexAngle(pts[n - 3], pts[n - 2], pts[n - 1]))}°`);
  return out;
}
