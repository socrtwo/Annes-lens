/**
 * Family-history metadata: Region Tags (named faces, pets and objects in the MWG region format),
 * Link Person (ties a region to a person record with dates and an external id), Geotag from GPS
 * Track (GPX/KML with a time offset) and Look Up Place Names (offline gazetteer, importable).
 */
import { def } from './registry';
import type { App } from '../app';
import { openDialog, confirmDialog, toast, type DialogControl } from '../ui/dialog';
import { h } from '../ui/dom';
import type { Entry } from '../picture/folder';
import { readMeta, patchXmp, metaTargets, forTargets } from '../picture/metadata';
import { readRegions, writeRegions, type Region } from '../meta/xmp';
import { parseTrack, locateAt, nearestPlace, parsePlacesCsv, type TrackPoint, type Place } from '../meta/geo';
import { PLACES } from '../meta/places';
import { readExif } from '../meta/exif';
import { openDocuments } from '../platform/native';
import { entryInfo } from '../picture/folderInfo';
import { inputsOf } from './batch';

const canEdit = (app: App) => !!app.picture && !!app.picture.entry;
const scopeNote = (app: App) => { const n = metaTargets(app).length; return n > 1 ? `Writes to the ${n} marked pictures.` : ''; };
const pct = (v: number) => Math.round(v * 1000) / 10;
const TYPES = ['Face', 'Pet', 'Object', 'Focus', 'BarCode'];

async function regionsOf(app: App, e: Entry): Promise<{ regions: Region[]; dims: { w: number; h: number } | null }> {
  const view = await readMeta(app, e);
  const doc = readRegions(view?.embedded || view?.sidecar || null);
  return { regions: doc.regions, dims: doc.dims };
}
function curDims(app: App): { w: number; h: number } | null { const p = app.picture; return p ? { w: p.width, h: p.height } : null; }
/** The current selection as a normalized MWG area (center + size), or a default central box. */
function selectionArea(app: App): { x: number; y: number; w: number; h: number } {
  const t = app.tab, p = t.picture;
  if (t.selection && p) { const s = t.selection; return { x: (s.x + s.w / 2) / p.width, y: (s.y + s.h / 2) / p.height, w: s.w / p.width, h: s.h / p.height }; }
  return { x: 0.5, y: 0.45, w: 0.3, h: 0.35 };
}

async function editRegion(app: App, regions: Region[], index: number): Promise<Region[] | null> {
  const r = index >= 0 ? regions[index] : { name: '', type: 'Face', area: selectionArea(app) } as Region;
  const v = await openDialog({ title: index >= 0 ? 'Edit Region' : 'Add Region', ok: 'OK', fields: [
    { key: 'name', label: 'Name', type: 'text', value: r.name, autofocus: true },
    { key: 'type', label: 'Type', type: 'combo', options: TYPES, value: r.type || 'Face', half: true },
    { key: 'fromSel', label: 'Area from the current selection', type: 'checkbox', value: index < 0 && !!app.tab.selection, half: true, visibleIf: () => !!app.tab.selection },
    { key: 'x', label: 'Center X (%)', type: 'number', min: 0, max: 100, step: 0.1, value: pct(r.area.x), half: true },
    { key: 'y', label: 'Center Y (%)', type: 'number', min: 0, max: 100, step: 0.1, value: pct(r.area.y), half: true },
    { key: 'w', label: 'Width (%)', type: 'number', min: 0, max: 100, step: 0.1, value: pct(r.area.w), half: true },
    { key: 'hh', label: 'Height (%)', type: 'number', min: 0, max: 100, step: 0.1, value: pct(r.area.h), half: true },
  ] });
  if (!v) return null;
  const area = v.fromSel ? selectionArea(app) : { x: +v.x / 100, y: +v.y / 100, w: +v.w / 100, h: +v.hh / 100 };
  const next: Region = { ...r, name: String(v.name).trim(), type: String(v.type).trim() || 'Face', area };
  const out = [...regions]; if (index >= 0) out[index] = next; else out.push(next);
  return out;
}

async function regionsDialog(app: App): Promise<void> {
  if (!app.picture) return;
  const got = await regionsOf(app, app.picture.entry);
  await regionsDialog2(app, got.regions, got.dims || curDims(app));
}
async function regionsDialog2(app: App, regions: Region[], dims: { w: number; h: number } | null): Promise<void> {
  const rows = regions.length ? regions.map((r, i) => h('div', { class: 'qn-ai-model' },
    h('span', null, h('b', null, r.name || '(unnamed)'), ` — ${r.type} · at ${pct(r.area.x)},${pct(r.area.y)} size ${pct(r.area.w)}×${pct(r.area.h)}%`, (r.personId || r.born || r.died) ? h('span', { class: 'qn-ai-label' }, h('br'), `linked: ${[r.personId && `id ${r.personId}`, [r.born, r.died].filter(Boolean).join('–')].filter(Boolean).join(' · ')}`) : ''),
    h('span', null,
      h('button', { class: 'ql-btn', type: 'button', onclick: async () => { const next = await editRegion(app, regions, i); if (next) regionsDialog2(app, next, dims); } }, 'Edit'),
      ' ', h('button', { class: 'ql-btn', type: 'button', onclick: () => regionsDialog2(app, regions.filter((_x, j) => j !== i), dims) }, 'Remove'))))
    : [h('p', { class: 'ql-help' }, 'No regions yet. Add one; its area starts from the current selection when you have one.')];
  const content = h('div', null, ...rows);
  await openDialog({ title: 'Region Tags', content, ok: false, cancel: 'Cancel', wide: true, help: scopeNote(app) || 'Named areas in the standard MWG region format, read by Lightroom, digiKam and others.', buttons: [
    { label: 'Add region…', onClick: async (_v, ctl) => { const next = await editRegion(app, regions, -1); if (next) { ctl.close(); regionsDialog2(app, next, dims); } } },
    { label: 'Link a person…', onClick: async (_v, ctl) => { if (!regions.length) { toast('Add a region first.'); return; } ctl.close(); const next = await linkPersonTo(app, regions); regionsDialog2(app, next || regions, dims); } },
    { label: 'Save', primary: true, onClick: async (_v, ctl) => { ctl.close(); await forTargets(app, 'Regions saved', (e) => patchXmp(app, e, (xml) => writeRegions(xml, regions, dims))); } },
  ] });
}

async function linkPersonTo(app: App, regions: Region[]): Promise<Region[] | null> {
  const people = app.prefs.people;
  const v = await openDialog({ title: 'Link Person', ok: 'Link', wide: true, help: 'Ties a region to a person record. The name, dates and id are written onto the region and the name into PersonInImage.', fields: [
    { key: 'region', label: 'Region', type: 'select', options: regions.map((r, i) => ({ value: String(i), label: `${r.name || '(unnamed)'} — ${r.type}` })), value: '0' },
    { key: 'person', label: 'Person', type: 'select', options: [{ value: '', label: 'New person (fill in below)' }, ...people.map((p, i) => ({ value: String(i), label: `${p.name}${p.born || p.died ? ` (${[p.born, p.died].filter(Boolean).join('–')})` : ''}` }))], value: '' },
    { key: 'name', label: 'Name', type: 'text', value: '' },
    { key: 'born', label: 'Born', type: 'text', value: '', half: true, placeholder: 'YYYY or a date' },
    { key: 'died', label: 'Died', type: 'text', value: '', half: true },
    { key: 'externalId', label: 'Record id (GEDCOM xref or FamilySearch id)', type: 'text', value: '', placeholder: '@I123@ or LZDP-V9V' },
    { key: 'save', label: 'Also save this person to the roster for reuse', type: 'checkbox', value: true },
  ], onChange: (x, ctl, key) => { if (key !== 'person') return; const p = people[+x.person]; if (!p) { ctl.set('name', ''); ctl.set('born', ''); ctl.set('died', ''); ctl.set('externalId', ''); return; } ctl.set('name', p.name); ctl.set('born', p.born); ctl.set('died', p.died); ctl.set('externalId', p.externalId); }, validate: (x) => (!String(x.name).trim() ? 'Enter the person\'s name' : null) });
  if (!v) return null;
  const i = +v.region; if (!(i >= 0 && i < regions.length)) return null;
  const name = String(v.name).trim(), born = String(v.born).trim(), died = String(v.died).trim(), externalId = String(v.externalId).trim();
  if (v.save && name) { const roster = app.prefs.people.filter((p) => p.name !== name || p.externalId !== externalId); roster.push({ name, born, died, externalId }); app.prefs.people = roster.slice(0, 2000); app.savePrefs(); }
  const out = [...regions]; out[i] = { ...out[i], name, born: born || undefined, died: died || undefined, personId: externalId || undefined };
  toast(`${name} linked to the region "${out[i].name}". Save to write it.`);
  return out;
}

async function geotagGpx(app: App): Promise<void> {
  const [file] = await openDocuments('.gpx,.kml,.xml,application/gpx+xml,application/vnd.google-earth.kml+xml', ['.gpx', '.kml', '.xml'], false);
  if (!file) return;
  const track = parseTrack(new TextDecoder().decode(new Uint8Array(file.data)));
  if (!track.length) { toast('No timestamped points found in that track. GPX needs <trkpt> with <time>; KML needs a <gx:Track>.'); return; }
  const span = (t: TrackPoint[]) => `${new Date(t[0].time).toISOString().slice(0, 16).replace('T', ' ')} to ${new Date(t[t.length - 1].time).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
  const { entries, marked } = inputsOf(app);
  const v = await openDialog({ title: 'Geotag from GPS Track', ok: 'Geotag', wide: true, help: `${track.length} points, ${span(track)}. Each picture's capture time (EXIF) is matched to the track.`, fields: [
    { key: 'i', type: 'info', html: `<p>Writing to <b>${marked ? `the ${entries.length} marked pictures` : `the folder (${entries.length} pictures)`}</b>. The camera clock is often off from GPS time; set the offset below (camera minus GPS).</p>` },
    { key: 'offset', label: 'Camera clock offset (minutes, + if the camera is ahead)', type: 'number', value: 0, step: 1, half: true },
    { key: 'tz', label: 'Camera time zone vs UTC (hours; EXIF has no zone)', type: 'number', value: 0, step: 0.5, min: -14, max: 14, half: true },
    { key: 'maxGap', label: 'Largest gap to a track point (minutes)', type: 'number', value: 60, min: 1, max: 1440, half: true },
    { key: 'skip', label: 'Skip pictures that already have a location', type: 'checkbox', value: true, half: true },
  ] });
  if (!v) return;
  const offMs = (+v.offset || 0) * 60000 + (+v.tz || 0) * 3600000, maxGap = (+v.maxGap || 60) * 60;
  let done = 0, noTime = 0, noMatch = 0, skipped = 0;
  for (const e of entries) {
    try {
      const info = await entryInfo(app, e);
      if (!info.exifDate || !info.date) { noTime++; continue; }
      if (v.skip) { const m = await readMeta(app, e); if (m?.props.lat !== undefined) { skipped++; continue; } }
      const captureUtc = info.date.getTime() - offMs; // EXIF local - (camera offset incl. tz) = UTC
      const p = locateAt(track, captureUtc, maxGap);
      if (!p) { noMatch++; continue; }
      await patchXmp(app, e, { lat: p.lat, lon: p.lon });
      done++;
    } catch { noMatch++; }
  }
  toast(`Geotagged ${done} picture${done === 1 ? '' : 's'}${skipped ? `, ${skipped} already located` : ''}${noTime ? `, ${noTime} without a capture time` : ''}${noMatch ? `, ${noMatch} outside the track` : ''}.`, { ms: 8000 });
  app.refresh();
}

async function reverseGeocode(app: App): Promise<void> {
  const table = [...app.prefs.importedPlaces, ...PLACES];
  const { entries, marked } = inputsOf(app);
  const v = await openDialog({ title: 'Look Up Place Names', ok: 'Look up', wide: true, help: `${app.prefs.importedPlaces.length ? `${app.prefs.importedPlaces.length} imported + ` : ''}${PLACES.length} built-in places. Coarse: the nearest known place, not a street address.`, fields: [
    { key: 'i', type: 'info', html: `<p>For <b>${marked ? `the ${entries.length} marked pictures` : `the folder (${entries.length} pictures)`}</b> that have GPS, writes the nearest place to City, State and Country.</p>` },
    { key: 'maxKm', label: 'Only name a city within (km); farther, name just the country', type: 'number', value: 100, min: 1, max: 2000, half: true },
    { key: 'overwrite', label: 'Overwrite existing city/state/country', type: 'checkbox', value: false, half: true },
    { key: 'import', label: 'Import a place CSV (city,state,country,countryCode,lat,lon)…', type: 'button', onClick: async (_x, ctl) => {
      const [f] = await openDocuments('.csv,text/csv', ['.csv'], false); if (!f) return;
      const places = parsePlacesCsv(new TextDecoder().decode(new Uint8Array(f.data)));
      if (!places.length) { toast('No usable rows in that CSV.'); return; }
      app.prefs.importedPlaces = places.slice(0, 200000); app.savePrefs();
      toast(`${places.length} places imported; they are searched first.`); ctl.close(); reverseGeocode(app);
    } },
  ] });
  if (!v) return;
  const maxKm = +v.maxKm || 100;
  let done = 0, noGps = 0, skipped = 0;
  for (const e of entries) {
    try {
      const m = await readMeta(app, e); let lat = m?.props.lat, lon = m?.props.lon;
      if (lat === undefined) { const bf = await e.read(); const ex = readExif(new Uint8Array(bf)); if (ex?.gps) { lat = ex.gps.lat; lon = ex.gps.lon; } }
      if (lat === undefined || lon === undefined) { noGps++; continue; }
      if (!v.overwrite && (m?.props.city || m?.props.country)) { skipped++; continue; }
      const near = nearestPlace(table, lat, lon); if (!near) continue;
      const patch = near.km <= maxKm ? { city: near.place.city, state: near.place.state || '', country: near.place.country } : { city: '', state: '', country: near.place.country };
      await patchXmp(app, e, patch);
      done++;
    } catch { /* skip */ }
  }
  toast(`Named ${done} picture${done === 1 ? '' : 's'}${skipped ? `, ${skipped} already named` : ''}${noGps ? `, ${noGps} without GPS` : ''}.`, { ms: 8000 });
  app.refresh();
}

def([
  { id: 'meta.regions', icon: 'crop_free', noRecord: true, isEnabled: canEdit, tip: 'Named regions (people, pets, objects) in the standard MWG XMP region format', run: (app) => regionsDialog(app) },
  { id: 'meta.personLink', icon: 'person_pin', noRecord: true, isEnabled: canEdit, tip: 'Ties a region to a person record (name, dates, a GEDCOM or FamilySearch id)', run: async (app) => {
      let { regions, dims } = await regionsOf(app, app.picture!.entry); dims = dims || curDims(app);
      if (!regions.length) { if (!(await confirmDialog('No regions yet', 'Link Person attaches a person to a region. Add a region from the current selection now?', 'Add region'))) return; const made = await editRegion(app, regions, -1); if (!made) return; regions = made; }
      const next = await linkPersonTo(app, regions); if (!next) return;
      await forTargets(app, 'Person linked', (e) => patchXmp(app, e, (xml) => writeRegions(xml, next, dims)));
    } },
  { id: 'meta.geotagGpx', icon: 'route', noRecord: true, isEnabled: (app) => app.folder.length > 0, tip: 'Match each picture\'s capture time to a GPX or KML track; a camera-clock offset and time zone', run: (app) => geotagGpx(app) },
  { id: 'meta.reverseGeocode', icon: 'pin_drop', noRecord: true, isEnabled: (app) => app.folder.length > 0, tip: 'Writes the nearest city, state and country from an offline gazetteer (importable) to pictures with GPS', run: (app) => reverseGeocode(app) },
]);
