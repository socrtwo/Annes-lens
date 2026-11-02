/**
 * The people index behind Browse ▸ People: faces found on the device (box, landmarks, a small
 * thumbnail and the SFace description), the people the user has named, and which pictures have
 * been scanned. Kept in IndexedDB only; Forget All Faces deletes it. Nothing is sent anywhere.
 */
import type { App } from '../app';
import type { Entry } from './folder';
import type { Raster } from '../codecs/raster';
import { kvGet, kvSet, kvDel } from '../util/store';
import { detectFaces, alignFace, embedFace, groupFaces, type Face } from './faces';
import { readRegions, writeRegions, type Region } from '../meta/xmp';

export interface FaceRec { id: string; key: string; file: string; box: Face['box']; kps: number[]; score: number; emb: Float32Array; thumb: string; w: number; h: number; person: string | null; ignored?: boolean }
export interface PersonRec { id: string; name: string; born?: string; died?: string; externalId?: string }
export interface Group { index: number; person: PersonRec | null; faces: FaceRec[]; keys: string[] }

const FACES = 'people.v1.faces', PERSONS = 'people.v1.persons', SCANNED = 'people.v1.scanned';
export const listFaces = async (): Promise<FaceRec[]> => (await kvGet<FaceRec[]>(FACES)) || [];
export const saveFaces = (f: FaceRec[]): Promise<void> => kvSet(FACES, f);
export const listPersons = async (): Promise<PersonRec[]> => (await kvGet<PersonRec[]>(PERSONS)) || [];
export const savePersons = (p: PersonRec[]): Promise<void> => kvSet(PERSONS, p);
const scanned = async (): Promise<Record<string, string>> => (await kvGet<Record<string, string>>(SCANNED)) || {};
export async function forgetAll(): Promise<void> { await kvDel(FACES); await kvDel(PERSONS); await kvDel(SCANNED); }

/** A stable key for a picture: its catalog key, its address, or name, size and date. */
export const entryKey = (e: Entry): string => (e as any).catalogKey || e.uri || `${e.name}|${e.size || 0}|${e.mtime || 0}`;
const sig = (e: Entry) => `${e.size || 0}|${e.mtime || 0}`;
const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export interface Models { backend: import('../ai/device').Backend; yunet: () => Promise<ArrayBuffer>; sface: () => Promise<ArrayBuffer>; sfaceKey: string }
export interface ScanReport { pictures: number; skipped: number; faces: number; failed: string[] }

/** A small square thumbnail of a face (data URL), where a canvas is available. */
function faceThumb(r: Raster, box: Face['box']): string {
  if (typeof document === 'undefined') return '';
  const s = Math.max(box[2], box[3]) * 1.3, cx = box[0] + box[2] / 2, cy = box[1] + box[3] / 2;
  const src = document.createElement('canvas'); src.width = r.width; src.height = r.height; src.getContext('2d')!.putImageData(new ImageData(r.data, r.width, r.height), 0, 0);
  const c = document.createElement('canvas'); c.width = c.height = 96; c.getContext('2d')!.drawImage(src, cx - s / 2, cy - s / 2, s, s, 0, 0, 96, 96);
  return c.toDataURL('image/jpeg', 0.8);
}

/** Finds and describes the faces in pictures not scanned yet (or changed since). */
export async function scanPictures(app: App, entries: Entry[], m: Models, read: (e: Entry) => Promise<Raster | null>, progress?: (i: number, n: number, faces: number) => void, signal?: AbortSignal): Promise<ScanReport> {
  const faces = await listFaces(), done = await scanned(), rep: ScanReport = { pictures: 0, skipped: 0, faces: 0, failed: [] };
  for (let i = 0; i < entries.length; i++) {
    if (signal?.aborted) break;
    const e = entries[i], key = entryKey(e);
    if (done[key] === sig(e)) { rep.skipped++; continue; }
    progress?.(i, entries.length, rep.faces);
    try {
      const r = await read(e); if (!r) { rep.failed.push(e.name); continue; }
      const found = await detectFaces(m.backend, m.yunet, r);
      for (let k = faces.length - 1; k >= 0; k--) if (faces[k].key === key) faces.splice(k, 1); // a changed picture is scanned again
      for (const f of found) {
        const emb = await embedFace(m.backend, m.sface, alignFace(r, f.kps), m.sfaceKey);
        faces.push({ id: uid(), key, file: e.name, box: f.box, kps: f.kps, score: f.score, emb, thumb: faceThumb(r, f.box), w: r.width, h: r.height, person: null });
        rep.faces++;
      }
      done[key] = sig(e); rep.pictures++;
    } catch (err) { rep.failed.push(`${e.name} (${(err as Error).message})`); }
    if (i % 10 === 9) { await saveFaces(faces); await kvSet(SCANNED, done); }
  }
  await saveFaces(faces); await kvSet(SCANNED, done);
  return rep;
}

/** People and unnamed groups, largest first after the named ones. */
export function groupsOf(faces: FaceRec[], persons: PersonRec[], thr = 0.42): Group[] {
  const live = faces.filter((f) => !f.ignored);
  const pIndex = new Map(persons.map((p, i) => [p.id, i]));
  const fixed = live.map((f) => (f.person && pIndex.has(f.person) ? pIndex.get(f.person) : undefined));
  const g = live.length ? groupFaces(live.map((f) => f.emb), thr, fixed) : [];
  const groups = new Map<number, Group>();
  live.forEach((f, i) => { let gr = groups.get(g[i]); if (!gr) { gr = { index: g[i], person: g[i] < persons.length ? persons[g[i]] : null, faces: [], keys: [] }; groups.set(g[i], gr); } gr.faces.push(f); if (!gr.keys.includes(f.key)) gr.keys.push(f.key); });
  return [...groups.values()].sort((a, b) => (a.person ? 0 : 1) - (b.person ? 0 : 1) || (a.person && b.person ? a.person.name.localeCompare(b.person.name) : b.faces.length - a.faces.length));
}

/** Names a group: its faces (and the faces that join it later) belong to the person. */
export async function nameGroup(group: Group, person: Omit<PersonRec, 'id'>, existingId?: string): Promise<PersonRec> {
  const persons = await listPersons(), faces = await listFaces();
  let p = existingId ? persons.find((x) => x.id === existingId) : persons.find((x) => x.name === person.name && (x.externalId || '') === (person.externalId || ''));
  if (p) Object.assign(p, person); else { p = { id: uid(), ...person }; persons.push(p); }
  const ids = new Set(group.faces.map((f) => f.id));
  for (const f of faces) if (ids.has(f.id)) f.person = p.id;
  await savePersons(persons); await saveFaces(faces);
  return p;
}
/** Takes faces out of their person (and out of grouping when `ignore`: not a face, or a stranger). */
export async function releaseFaces(ids: string[], ignore: boolean): Promise<void> {
  const faces = await listFaces(), set = new Set(ids);
  for (const f of faces) if (set.has(f.id)) { f.person = null; if (ignore) f.ignored = true; }
  await saveFaces(faces);
}

/** The face as an MWG region of its picture (normalized centre and size). */
export const faceRegion = (f: FaceRec, p: PersonRec): Region => ({ name: p.name, type: 'Face', area: { x: (f.box[0] + f.box[2] / 2) / f.w, y: (f.box[1] + f.box[3] / 2) / f.h, w: f.box[2] / f.w, h: f.box[3] / f.h }, personId: p.externalId || undefined, born: p.born || undefined, died: p.died || undefined });
const overlap = (a: Region['area'], b: Region['area']) => {
  const x0 = Math.max(a.x - a.w / 2, b.x - b.w / 2), x1 = Math.min(a.x + a.w / 2, b.x + b.w / 2), y0 = Math.max(a.y - a.h / 2, b.y - b.h / 2), y1 = Math.min(a.y + a.h / 2, b.y + b.h / 2);
  const i = Math.max(0, x1 - x0) * Math.max(0, y1 - y0); return i / (a.w * a.h + b.w * b.h - i || 1);
};
/** The XMP with this picture's named faces as regions (a face region already there at the same place is replaced). */
export function withFaceRegions(xml: string | null, faces: { f: FaceRec; p: PersonRec }[]): string {
  const doc = readRegions(xml);
  const regions = doc.regions.filter((r) => !(r.type === 'Face' && faces.some(({ f, p }) => overlap(r.area, faceRegion(f, p).area) > 0.4)));
  for (const { f, p } of faces) regions.push(faceRegion(f, p));
  return writeRegions(xml, regions, { w: faces[0].f.w, h: faces[0].f.h });
}
