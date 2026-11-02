/** Browse ▸ Map: the geotagged pictures of the folder or the catalog on a map. */
import { def } from './registry';
import type { App } from '../app';
import { Folder, type Entry } from '../picture/folder';
import { openDialog, toast, type DialogControl } from '../ui/dialog';
import { h } from '../ui/dom';
import { entryInfo, forgetInfo } from '../picture/folderInfo';
import { catalogEntries, listCatFolders } from '../picture/catalog';
import { MapView, OSM_TILES, type MapPoint, type Basemap } from '../ui/mapView';
import type { Cluster } from '../geo/slippy';

export type MapSource = 'folder' | 'catalog';
/** The open map, for tests. */
export const mapState = { view: null as MapView | null };

/** The pictures with a location (EXIF GPS or an XMP location), in folder order. */
export async function gatherPoints(app: App, source: MapSource): Promise<{ entries: Entry[]; points: MapPoint[] }> {
  const entries = source === 'catalog' ? (await catalogEntries()).entries : app.folder.entries;
  const points: MapPoint[] = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (i && i % 50 === 0) toast(`Reading locations: ${i} of ${entries.length}…`, { ms: 800 });
    let info = await entryInfo(app, e);
    if (info.hasGps && info.lat === undefined) { forgetInfo(e); info = await entryInfo(app, e); } // cataloged before locations were kept
    const { lat, lon } = info;
    if (lat === undefined || lon === undefined || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) continue;
    points.push({ id: i, name: e.name, lat, lon });
  }
  return { entries, points };
}

const placeName = (pts: MapPoint[]) => { const la = pts.reduce((s, p) => s + p.lat, 0) / pts.length, lo = pts.reduce((s, p) => s + p.lon, 0) / pts.length; return `${Math.abs(la).toFixed(3)}°${la < 0 ? 'S' : 'N'} ${Math.abs(lo).toFixed(3)}°${lo < 0 ? 'W' : 'E'}`; };

/** Opens one picture: in the folder when the map shows the folder, else among the given points. */
async function openPoint(app: App, source: MapSource, entries: Entry[], among: MapPoint[], p: MapPoint): Promise<void> {
  if (source === 'folder' && app.folder.entries[p.id] === entries[p.id]) { if (app.folder.select(p.id)) await app.tab.show(); return; }
  await openPoints(app, entries, among, p);
}
/** Shows points as a folder (Map: n pictures near …). */
async function openPoints(app: App, entries: Entry[], pts: MapPoint[], first?: MapPoint): Promise<void> {
  if (!pts.length) { toast('No pictures in view.'); return; }
  const f = new Folder(pts.map((p) => entries[p.id]), `Map: ${pts.length} picture${pts.length === 1 ? '' : 's'} near ${placeName(pts)}`);
  await app.openFolder(f, Math.max(0, first ? pts.indexOf(first) : 0));
  if (!first && !app.tab.thumbs.open) app.tab.thumbs.show('grid');
}

def([
  {
    id: 'browse.map', icon: 'map', noRecord: true, tip: 'The pictures with a location on a map (OpenStreetMap online; an offline outline without a network)',
    run: async (app, arg?: { source?: MapSource; quiet?: boolean }) => {
      const hasCatalog = (await listCatFolders()).length > 0;
      let source: MapSource = arg?.source || (app.folder.length ? 'folder' : hasCatalog ? 'catalog' : 'folder');
      let { entries, points } = await gatherPoints(app, source);
      if (arg?.quiet) return { source, total: entries.length, points: points.map((p) => ({ name: p.name, lat: p.lat, lon: p.lon })) };
      if (!points.length && source === 'folder' && hasCatalog && !arg?.source) { source = 'catalog'; ({ entries, points } = await gatherPoints(app, source)); }

      const map = new MapView(); mapState.view = map;
      const tiles = app.prefs.mapTiles || { basemap: 'osm', template: '' };
      map.setBasemap(tiles.basemap, tiles.template);
      const status = h('div', { class: 'qn-map-status', 'aria-live': 'polite' });
      const cur = app.picture ? app.folder.entries.indexOf(app.picture.entry) : -1;
      const setActive = () => { map.active = source === 'folder' ? cur : -1; };
      map.onMove = () => { status.textContent = points.length ? `${points.length} of ${entries.length} picture${entries.length === 1 ? '' : 's'} have a location · ${map.visible().length} in view · zoom ${Math.round(map.view.z)}` : `None of the ${entries.length} pictures has a location. Add one with Metadata ▸ Set Location or Geotag from GPX.`; };
      let ctlRef: DialogControl | null = null;
      map.onPick = (c: Cluster<MapPoint>) => {
        const lat0 = Math.min(...c.items.map((p) => p.lat)), lat1 = Math.max(...c.items.map((p) => p.lat)), lon0 = Math.min(...c.items.map((p) => p.lon)), lon1 = Math.max(...c.items.map((p) => p.lon));
        const spread = lat1 - lat0 > 1e-6 || lon1 - lon0 > 1e-6;
        if (c.items.length > 1 && spread && map.view.z < 18) { const before = map.view.z; map.fit(c.items); if (map.view.z > before) return; }
        ctlRef?.close(null);
        if (c.items.length === 1) void openPoint(app, source, entries, map.visible(), c.items[0]);
        else void openPoints(app, entries, c.items);
      };
      setActive(); map.setPoints(points);
      const box = h('div', { class: 'qn-map-box' }, map.el, status);
      await openDialog({
        title: 'Map', full: true, ok: 'Close', cancel: false, content: box,
        help: 'Click a picture\'s marker to open it; a number is a group, which zooms in (or opens the group when its pictures share one spot). Online maps send the area you look at to the tile server.',
        fields: [
          { key: 'source', label: 'Pictures', type: 'select', value: source, half: true, options: [{ value: 'folder', label: `This folder (${app.folder.name || 'none'})` }, ...(hasCatalog ? [{ value: 'catalog', label: 'The catalog' }] : [])] },
          { key: 'basemap', label: 'Map', type: 'select', value: tiles.basemap, half: true, options: [{ value: 'osm', label: 'OpenStreetMap (online)' }, { value: 'offline', label: 'Offline outline (countries)' }, { value: 'custom', label: 'Another tile server…' }] },
          { key: 'template', label: 'Tile address ({z}, {x}, {y}; {s} for a, b, c)', type: 'text', value: tiles.template, placeholder: 'https://tiles.example.org/{z}/{x}/{y}.png', visibleIf: (v) => v.basemap === 'custom' },
        ],
        buttons: [
          { label: 'Fit All', onClick: () => map.fit() },
          { label: 'Show in View as Folder', onClick: (_v, ctl) => { const vis = map.visible(); ctl.close(null); void openPoints(app, entries, vis); } },
        ],
        onOpen: (ctl) => { ctlRef = ctl; requestAnimationFrame(() => { map.fit(); map.el.focus(); }); },
        onChange: async (v, _ctl, key) => {
          if (key === 'basemap' || key === 'template') {
            const b = v.basemap as Basemap, t = String(v.template || '').trim();
            if (b === 'custom' && !/^https?:\/\/.+\{z\}.*\{x\}.*\{-?y\}/.test(t)) return;
            app.prefs.mapTiles = { basemap: b, template: b === 'custom' ? t : tiles.template }; app.savePrefs();
            map.setBasemap(b, b === 'custom' ? t : OSM_TILES);
          } else if (key === 'source') {
            source = v.source as MapSource; ({ entries, points } = await gatherPoints(app, source)); setActive(); map.setPoints(points);
          }
        },
      });
      map.destroy(); mapState.view = null;
    },
  },
]);
