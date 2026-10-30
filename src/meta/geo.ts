/**
 * Geotagging from a GPS track (GPX or KML) and offline place-name lookup. Pure functions over
 * text and coordinates, tested without a network. The place table is a compact gazetteer of
 * countries and major cities (src/meta/places.ts); the user can import a larger CSV.
 */
export interface TrackPoint { time: number; lat: number; lon: number; alt?: number }

/** Parses a GPX or KML document into time-ordered track points (those that carry a timestamp). */
export function parseTrack(text: string): TrackPoint[] {
  const pts: TrackPoint[] = [];
  // GPX: <trkpt lat="…" lon="…"><time>ISO</time></trkpt> (also <rtept>, <wpt>).
  for (const m of text.matchAll(/<(?:trkpt|rtept|wpt)\b[^>]*\blat="([-\d.]+)"[^>]*\blon="([-\d.]+)"[^>]*>([\s\S]*?)<\/(?:trkpt|rtept|wpt)>/gi)) {
    const t = m[3].match(/<time>([^<]+)<\/time>/i); const alt = m[3].match(/<ele>([-\d.]+)<\/ele>/i);
    if (t) { const time = Date.parse(t[1]); if (Number.isFinite(time)) pts.push({ time, lat: +m[1], lon: +m[2], alt: alt ? +alt[1] : undefined }); }
  }
  // KML: <gx:Track> with interleaved <when> and <gx:coord>lon lat alt</gx:coord>.
  for (const track of text.matchAll(/<gx:Track>([\s\S]*?)<\/gx:Track>/gi)) {
    const whens = [...track[1].matchAll(/<when>([^<]+)<\/when>/gi)].map((w) => Date.parse(w[1]));
    const coords = [...track[1].matchAll(/<gx:coord>\s*([-\d.]+)\s+([-\d.]+)(?:\s+([-\d.]+))?\s*<\/gx:coord>/gi)];
    for (let i = 0; i < Math.min(whens.length, coords.length); i++) if (Number.isFinite(whens[i])) pts.push({ time: whens[i], lat: +coords[i][2], lon: +coords[i][1], alt: coords[i][3] ? +coords[i][3] : undefined });
  }
  pts.sort((a, b) => a.time - b.time);
  return pts;
}

/** The track position at `time` (ms): interpolated between the straddling points, or the nearest within `maxGapSec`. */
export function locateAt(track: TrackPoint[], time: number, maxGapSec = 3600): TrackPoint | null {
  if (!track.length || !Number.isFinite(time)) return null;
  let lo = 0, hi = track.length - 1;
  if (time <= track[0].time) return (track[0].time - time) / 1000 <= maxGapSec ? track[0] : null;
  if (time >= track[hi].time) return (time - track[hi].time) / 1000 <= maxGapSec ? track[hi] : null;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (track[mid].time <= time) lo = mid; else hi = mid; }
  const a = track[lo], b = track[hi];
  const gap = Math.min(time - a.time, b.time - time) / 1000;
  if (gap > maxGapSec && (b.time - a.time) / 1000 > maxGapSec * 2) return null;
  const f = (time - a.time) / (b.time - a.time || 1);
  return { time, lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f, alt: a.alt !== undefined && b.alt !== undefined ? a.alt + (b.alt - a.alt) * f : undefined };
}

export const haversineKm = (aLat: number, aLon: number, bLat: number, bLon: number): number => {
  const R = 6371, toRad = Math.PI / 180;
  const dLat = (bLat - aLat) * toRad, dLon = (bLon - aLon) * toRad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * toRad) * Math.cos(bLat * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
};

export interface Place { city: string; state?: string; country: string; countryCode: string; lat: number; lon: number }
/** The nearest place to a coordinate, with the distance in km. `extra` is an imported table searched first. */
export function nearestPlace(places: Place[], lat: number, lon: number): { place: Place; km: number } | null {
  let best: Place | null = null, bestKm = Infinity;
  for (const p of places) { const km = haversineKm(lat, lon, p.lat, p.lon); if (km < bestKm) { bestKm = km; best = p; } }
  return best ? { place: best, km: bestKm } : null;
}

/** Parses a place CSV (city,state,country,countryCode,lat,lon or city,country,lat,lon) the user imports. */
export function parsePlacesCsv(text: string): Place[] {
  const out: Place[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || /^#/.test(line) || /^city\s*,/i.test(line)) continue;
    const f = line.split(',').map((s) => s.trim().replace(/^"|"$/g, ''));
    if (f.length >= 6) { const lat = +f[4], lon = +f[5]; if (Number.isFinite(lat) && Number.isFinite(lon)) out.push({ city: f[0], state: f[1] || undefined, country: f[2], countryCode: f[3], lat, lon }); }
    else if (f.length >= 4) { const lat = +f[2], lon = +f[3]; if (Number.isFinite(lat) && Number.isFinite(lon)) out.push({ city: f[0], country: f[1], countryCode: '', lat, lon }); }
  }
  return out;
}
