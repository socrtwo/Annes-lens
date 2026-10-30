import { describe, expect, it } from 'vitest';
import { parseTrack, locateAt, haversineKm, nearestPlace, parsePlacesCsv } from '../../src/meta/geo';
import { readRegions, writeRegions, type Region } from '../../src/meta/xmp';
import { PLACES } from '../../src/meta/places';

const GPX = `<?xml version="1.0"?><gpx><trk><trkseg>
<trkpt lat="51.5000" lon="-0.1000"><ele>10</ele><time>2026-06-01T10:00:00Z</time></trkpt>
<trkpt lat="51.6000" lon="-0.2000"><time>2026-06-01T10:10:00Z</time></trkpt>
<trkpt lat="51.7000" lon="-0.3000"><time>2026-06-01T10:20:00Z</time></trkpt>
</trkseg></trk></gpx>`;
const KML = `<kml><Document><Placemark><gx:Track>
<when>2026-06-01T10:00:00Z</when><gx:coord>-0.1 51.5 10</gx:coord>
<when>2026-06-01T10:10:00Z</when><gx:coord>-0.2 51.6 20</gx:coord>
</gx:Track></Placemark></Document></kml>`;

describe('track parsing and matching', () => {
  it('parses GPX trkpts in time order', () => {
    const t = parseTrack(GPX);
    expect(t.length).toBe(3);
    expect([t[0].lat, t[0].lon, t[0].alt]).toEqual([51.5, -0.1, 10]);
    expect(t[2].time).toBe(Date.parse('2026-06-01T10:20:00Z'));
  });
  it('parses KML gx:Track (lon lat alt order)', () => {
    const t = parseTrack(KML);
    expect(t.length).toBe(2);
    expect([t[0].lat, t[0].lon]).toEqual([51.5, -0.1]);
    expect([t[1].lat, t[1].lon, t[1].alt]).toEqual([51.6, -0.2, 20]);
  });
  it('interpolates between straddling points', () => {
    const t = parseTrack(GPX);
    const p = locateAt(t, Date.parse('2026-06-01T10:05:00Z'));
    expect(p).not.toBeNull();
    expect(p!.lat).toBeCloseTo(51.55, 3); expect(p!.lon).toBeCloseTo(-0.15, 3); expect(p!.alt).toBeUndefined();
  });
  it('snaps to the nearest end within the gap, or gives up beyond it', () => {
    const t = parseTrack(GPX);
    expect(locateAt(t, Date.parse('2026-06-01T09:30:00Z'), 3600)!.lat).toBe(51.5);
    expect(locateAt(t, Date.parse('2026-06-01T08:00:00Z'), 3600)).toBeNull();
    expect(locateAt([], Date.now())).toBeNull();
  });
  it('measures distance', () => { expect(haversineKm(51.5, -0.12, 48.85, 2.35)).toBeGreaterThan(330); expect(haversineKm(51.5, -0.12, 48.85, 2.35)).toBeLessThan(345); });
});

describe('gazetteer', () => {
  it('finds the nearest city and its country', () => {
    const r = nearestPlace(PLACES, 51.52, -0.1)!; expect(r.place.city).toBe('London'); expect(r.place.country).toBe('United Kingdom'); expect(r.km).toBeLessThan(5);
    expect(nearestPlace(PLACES, 40.72, -74.0)!.place.city).toBe('New York');
    expect(nearestPlace(PLACES, 35.68, 139.7)!.place.city).toBe('Tokyo');
  });
  it('resolves a remote coordinate to a country via the reference points', () => {
    const r = nearestPlace(PLACES, 64.0, -51.0); expect(r).not.toBeNull(); // mid-Atlantic/Greenland area → some country ref
    const au = nearestPlace(PLACES, -25.0, 134.0)!; expect(au.place.country).toBe('Australia');
  });
  it('parses an imported CSV in both column shapes', () => {
    expect(parsePlacesCsv('city,state,country,countryCode,lat,lon\nBath,Somerset,United Kingdom,GB,51.38,-2.36')).toEqual([{ city: 'Bath', state: 'Somerset', country: 'United Kingdom', countryCode: 'GB', lat: 51.38, lon: -2.36 }]);
    expect(parsePlacesCsv('# comment\nOrvieto,Italy,42.72,12.11')[0]).toMatchObject({ city: 'Orvieto', country: 'Italy', lat: 42.72, lon: 12.11 });
  });
});

describe('region tags round trip', () => {
  const regions: Region[] = [
    { name: 'Anne', type: 'Face', area: { x: 0.5, y: 0.4, w: 0.2, h: 0.25 }, personId: '@I12@', born: '1890', died: '1962' },
    { name: 'Rex', type: 'Pet', area: { x: 0.8, y: 0.7, w: 0.15, h: 0.15 } },
  ];
  it('writes MWG regions and reads them back with the person link', () => {
    const xml = writeRegions(null, regions, { w: 4000, h: 3000 });
    expect(xml).toMatch(/mwg-rs:Regions/); expect(xml).toMatch(/stArea:x="0.5"/); expect(xml).toMatch(/AppliedToDimensions stDim:w="4000"/);
    expect(xml).toMatch(/Iptc4xmpExt:PersonInImage/); expect(xml).toMatch(/<rdf:li>Anne<\/rdf:li>/);
    const doc = readRegions(xml);
    expect(doc.dims).toEqual({ w: 4000, h: 3000 });
    expect(doc.regions.length).toBe(2);
    expect(doc.regions[0]).toMatchObject({ name: 'Anne', type: 'Face', personId: '@I12@', born: '1890', died: '1962' });
    expect(doc.regions[0].area.x).toBeCloseTo(0.5, 5); expect(doc.regions[0].area.h).toBeCloseTo(0.25, 5);
    expect(doc.regions[1]).toMatchObject({ name: 'Rex', type: 'Pet' });
  });
  it('removes the region block and PersonInImage when empty, keeping other properties', () => {
    const xml = writeRegions('<?xpacket?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title><rdf:Alt><rdf:li xml:lang="x-default">Keep</rdf:li></rdf:Alt></dc:title></rdf:Description></rdf:RDF></x:xmpmeta>', regions, null);
    expect(xml).toMatch(/mwg-rs:Regions/);
    const cleared = writeRegions(xml, [], null);
    expect(cleared).not.toMatch(/mwg-rs:Regions/); expect(cleared).not.toMatch(/PersonInImage/); expect(cleared).toMatch(/Keep/);
  });
});
