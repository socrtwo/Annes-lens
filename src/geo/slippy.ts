/**
 * Web Mercator map math for Browse ▸ Map: world pixels at a zoom level (256 · 2^z wide), the tiles
 * a view needs, fitting a view to points, clustering markers on screen, tile addresses, and
 * TopoJSON decoding for the offline outline (Natural Earth, via world-atlas). Pure functions.
 */
export const TILE = 256;
export const MAX_LAT = 85.05112878;
export interface LatLon { lat: number; lon: number }
export interface View { z: number; cx: number; cy: number } // center in world pixels at zoom z (may be fractional)

const clampLat = (lat: number) => Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
export const worldSize = (z: number) => TILE * 2 ** z;
/** Latitude and longitude to world pixels at zoom z. */
export function project(p: LatLon, z: number): { x: number; y: number } {
  const s = worldSize(z), r = (clampLat(p.lat) * Math.PI) / 180;
  return { x: ((p.lon + 180) / 360) * s, y: ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * s };
}
/** World pixels at zoom z back to latitude and longitude. */
export function unproject(x: number, y: number, z: number): LatLon {
  const s = worldSize(z), n = Math.PI - (2 * Math.PI * y) / s;
  return { lat: (180 / Math.PI) * Math.atan(Math.sinh(n)), lon: (x / s) * 360 - 180 };
}
/** Screen position (pixels from the top left of a w × h view) of a point. */
export function toScreen(p: LatLon, v: View, w: number, h: number): { x: number; y: number } {
  const q = project(p, v.z), s = worldSize(v.z);
  let dx = q.x - v.cx; if (dx > s / 2) dx -= s; else if (dx < -s / 2) dx += s; // the nearest copy of the world
  return { x: w / 2 + dx, y: h / 2 + (q.y - v.cy) };
}
export function fromScreen(x: number, y: number, v: View, w: number, h: number): LatLon {
  return unproject(v.cx + x - w / 2, v.cy + y - h / 2, v.z);
}
/** Keeps the view's center on the map vertically and wraps it horizontally. */
export function normalize(v: View, h: number, minZ = 0, maxZ = 19): View {
  const z = Math.max(minZ, Math.min(maxZ, v.z)), s = worldSize(z);
  const cx = ((v.cx % s) + s) % s, half = Math.min(h / 2, s / 2);
  return { z, cx, cy: Math.max(half, Math.min(s - half, v.cy)) };
}
/** Zooms by `dz` keeping the point under (x, y) still. */
export function zoomAt(v: View, dz: number, x: number, y: number, w: number, h: number, maxZ = 19): View {
  const z = Math.max(0, Math.min(maxZ, v.z + dz)), k = 2 ** (z - v.z);
  const wx = v.cx + x - w / 2, wy = v.cy + y - h / 2;
  return { z, cx: wx * k - (x - w / 2), cy: wy * k - (y - h / 2) };
}
/** The view that shows every point with a margin (whole zoom levels, at most `maxZ`). */
export function fitView(points: LatLon[], w: number, h: number, maxZ = 16, pad = 40): View {
  if (!points.length) return { z: 1, cx: worldSize(1) / 2, cy: worldSize(1) / 2 };
  const lats = points.map((p) => clampLat(p.lat));
  // Longitudes: the smallest arc that covers them all (a group across the date line stays together).
  const lons = points.map((p) => ((p.lon + 540) % 360) - 180).sort((a, b) => a - b);
  let gap = 360 - (lons[lons.length - 1] - lons[0]), west = lons[0], east = lons[lons.length - 1];
  for (let i = 1; i < lons.length; i++) if (lons[i] - lons[i - 1] > gap) { gap = lons[i] - lons[i - 1]; west = lons[i]; east = lons[i - 1] + 360; }
  const south = Math.min(...lats), north = Math.max(...lats);
  let z = maxZ;
  for (; z > 0; z--) {
    const a = project({ lat: north, lon: west }, z), b = project({ lat: south, lon: west }, z), span = ((east - west) / 360) * worldSize(z);
    if (span <= w - 2 * pad && b.y - a.y <= h - 2 * pad) break;
  }
  const a = project({ lat: north, lon: west }, z), b = project({ lat: south, lon: west }, z);
  return normalize({ z, cx: a.x + (((east - west) / 360) * worldSize(z)) / 2, cy: (a.y + b.y) / 2 }, h);
}
export interface TileRef { z: number; x: number; y: number; left: number; top: number; size: number }
/** The tiles that cover a w × h view (wrapping east and west), with where to draw them. */
export function tilesFor(v: View, w: number, h: number): TileRef[] {
  const z = Math.max(0, Math.round(v.z)), k = 2 ** (v.z - z), size = TILE * k, n = 2 ** z;
  const left0 = w / 2 - v.cx, top0 = h / 2 - v.cy; // where world pixel 0,0 is on screen
  const x0 = Math.floor(-left0 / size), x1 = Math.ceil((w - left0) / size) - 1, y0 = Math.max(0, Math.floor(-top0 / size)), y1 = Math.min(n - 1, Math.ceil((h - top0) / size) - 1);
  const out: TileRef[] = [];
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) out.push({ z, x: ((tx % n) + n) % n, y: ty, left: left0 + tx * size, top: top0 + ty * size, size });
  return out;
}
/** Fills a tile address template: {z} {x} {y}, {s} (a, b or c), {r} (empty), and {-y} (TMS rows). */
export function tileUrl(template: string, t: { z: number; x: number; y: number }): string {
  return template.replace(/\{z\}/g, String(t.z)).replace(/\{x\}/g, String(t.x)).replace(/\{-y\}/g, String(2 ** t.z - 1 - t.y)).replace(/\{y\}/g, String(t.y)).replace(/\{s\}/g, 'abc'[(t.x + t.y) % 3]).replace(/\{r\}/g, '');
}
export interface Cluster<T> { x: number; y: number; items: T[]; lat: number; lon: number }
/** Groups points closer than `radius` screen pixels (greedy, in input order). */
export function cluster<T extends LatLon>(points: T[], v: View, w: number, h: number, radius = 28): Cluster<T>[] {
  const out: Cluster<T>[] = [], margin = radius * 2;
  for (const p of points) {
    const s = toScreen(p, v, w, h);
    if (s.x < -margin || s.y < -margin || s.x > w + margin || s.y > h + margin) continue;
    let best: Cluster<T> | null = null, bd = radius * radius;
    for (const c of out) { const d = (c.x - s.x) ** 2 + (c.y - s.y) ** 2; if (d <= bd) { bd = d; best = c; } }
    if (best) { const n = best.items.length; best.items.push(p); best.x = (best.x * n + s.x) / (n + 1); best.y = (best.y * n + s.y) / (n + 1); best.lat = (best.lat * n + p.lat) / (n + 1); best.lon = (best.lon * n + p.lon) / (n + 1); }
    else out.push({ x: s.x, y: s.y, items: [p], lat: p.lat, lon: p.lon });
  }
  return out;
}

/** TopoJSON to polygons: for each geometry, its rings as [lon, lat] lists. */
export interface Topology { type: 'Topology'; transform?: { scale: [number, number]; translate: [number, number] }; arcs: number[][][]; objects: Record<string, { type: string; geometries: { type: string; arcs: any; properties?: Record<string, unknown> }[] }> }
export function topoRings(topo: Topology, object: string): number[][][][] {
  const t = topo.transform;
  const arcs = topo.arcs.map((arc) => { let x = 0, y = 0; return arc.map((p) => { if (t) { x += p[0]; y += p[1]; return [x * t.scale[0] + t.translate[0], y * t.scale[1] + t.translate[1]]; } return [p[0], p[1]]; }); });
  const ring = (ids: number[]) => { const out: number[][] = []; for (const i of ids) { const a = i < 0 ? [...arcs[~i]].reverse() : arcs[i]; for (let k = out.length ? 1 : 0; k < a.length; k++) out.push(a[k]); } return out; };
  const polys: number[][][][] = [];
  for (const g of topo.objects[object].geometries) {
    if (g.type === 'Polygon') polys.push((g.arcs as number[][]).map(ring));
    else if (g.type === 'MultiPolygon') for (const p of g.arcs as number[][][]) polys.push(p.map(ring));
  }
  return polys;
}
