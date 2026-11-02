import { describe, it, expect } from 'vitest';
import { project, unproject, toScreen, fitView, tilesFor, tileUrl, cluster, zoomAt, normalize, topoRings, worldSize, type Topology } from '../../src/geo/slippy';

describe('map math', () => {
  it('projects to Web Mercator and back', () => {
    expect(project({ lat: 0, lon: 0 }, 0)).toEqual({ x: 128, y: 128 });
    const p = project({ lat: 51.5074, lon: -0.1278 }, 10);
    // OpenStreetMap's tile for London at zoom 10 is 511/340.
    expect([Math.floor(p.x / 256), Math.floor(p.y / 256)]).toEqual([511, 340]);
    const back = unproject(p.x, p.y, 10);
    expect(back.lat).toBeCloseTo(51.5074, 6); expect(back.lon).toBeCloseTo(-0.1278, 6);
    expect(project({ lat: 89.9, lon: 180 }, 1).y).toBeCloseTo(0, 3); // clamped to the map's edge
  });
  it('fits a view to points, across the date line too', () => {
    const v = fitView([{ lat: 48.8566, lon: 2.3522 }, { lat: 40.7128, lon: -74.006 }], 800, 500);
    const a = toScreen({ lat: 48.8566, lon: 2.3522 }, v, 800, 500), b = toScreen({ lat: 40.7128, lon: -74.006 }, v, 800, 500);
    for (const s of [a, b]) { expect(s.x).toBeGreaterThanOrEqual(40); expect(s.x).toBeLessThanOrEqual(760); expect(s.y).toBeGreaterThanOrEqual(40); expect(s.y).toBeLessThanOrEqual(460); }
    expect(v.z).toBe(3);
    const pacific = fitView([{ lat: -17.7, lon: 178.0 }, { lat: -14.3, lon: -170.7 }], 800, 500); // Fiji and American Samoa
    expect(pacific.z).toBeGreaterThanOrEqual(4);
    const f = toScreen({ lat: -17.7, lon: 178 }, pacific, 800, 500), s = toScreen({ lat: -14.3, lon: -170.7 }, pacific, 800, 500);
    expect(f.x).toBeLessThan(s.x); expect(s.x - f.x).toBeLessThan(760);
    expect(fitView([{ lat: 10, lon: 10 }], 800, 500, 16).z).toBe(16);
    expect(fitView([], 800, 500).z).toBe(1);
  });
  it('lists the tiles of a view, wrapping east and west', () => {
    const t = tilesFor({ z: 1, cx: 256, cy: 256 }, 1024, 512);
    expect(t.length).toBe(8); // two rows, four columns (the world twice)
    expect(new Set(t.map((x) => `${x.x}/${x.y}`))).toEqual(new Set(['0/0', '1/0', '0/1', '1/1']));
    const half = tilesFor({ z: 2.5, cx: 0.5 * worldSize(2.5), cy: 0.5 * worldSize(2.5) }, 300, 300);
    expect(half.every((x) => x.z === 3 && Math.abs(x.size - 256 * 2 ** -0.5) < 1e-9)).toBe(true);
    expect(tileUrl('https://{s}.tile.example/{z}/{x}/{y}.png', { z: 3, x: 4, y: 2 })).toBe('https://a.tile.example/3/4/2.png');
    expect(tileUrl('https://t.example/{z}/{x}/{-y}.png', { z: 3, x: 4, y: 2 })).toBe('https://t.example/3/4/5.png');
  });
  it('groups nearby markers and keeps the point under the cursor when zooming', () => {
    const pts = [{ lat: 48.8566, lon: 2.3522, id: 1 }, { lat: 48.857, lon: 2.353, id: 2 }, { lat: 40.7128, lon: -74.006, id: 3 }];
    const v = fitView(pts, 800, 500);
    const c = cluster(pts, v, 800, 500);
    expect(c.map((x) => x.items.length).sort()).toEqual([1, 2]);
    const near = { z: 17, ...(({ x, y }) => ({ cx: x, cy: y }))(project({ lat: 48.8568, lon: 2.3526 }, 17)) };
    expect(cluster(pts, near, 800, 500).length).toBe(2); // New York is off screen; the Paris pair splits
    const z2 = zoomAt(v, 2, 100, 100, 800, 500);
    const before = unproject(v.cx + 100 - 400, v.cy + 100 - 250, v.z), after = unproject(z2.cx + 100 - 400, z2.cy + 100 - 250, z2.z);
    expect(after.lat).toBeCloseTo(before.lat, 8); expect(after.lon).toBeCloseTo(before.lon, 8);
    expect(normalize({ z: 0, cx: 300, cy: -50 }, 400).cy).toBe(128);
    expect(normalize({ z: 1, cx: -10, cy: 256 }, 400).cx).toBe(502);
  });
  it('decodes TopoJSON arcs (quantized, delta-encoded, reversed)', () => {
    const topo: Topology = { type: 'Topology', transform: { scale: [1, 1], translate: [-10, -10] }, arcs: [[[0, 0], [10, 0], [0, 10]], [[10, 10], [-10, 0], [0, -10]]], objects: { land: { type: 'GeometryCollection', geometries: [{ type: 'Polygon', arcs: [[0, 1]] }, { type: 'MultiPolygon', arcs: [[[~1]]] }] } } };
    const r = topoRings(topo, 'land');
    expect(r[0][0]).toEqual([[-10, -10], [0, -10], [0, 0], [-10, 0], [-10, -10]]);
    expect(r[1][0]).toEqual([[-10, -10], [-10, 0], [0, 0]]);
  });
});
