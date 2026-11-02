/** Browse ▸ People: faces found and grouped on the device; off until turned on. */
import { def } from './registry';
import type { App } from '../app';
import { Folder, type Entry } from '../picture/folder';
import { openDialog, toast, confirmDialog } from '../ui/dialog';
import { h } from '../ui/dom';
import { decodePicture } from '../codecs/registry';
import { frameRaster } from '../picture/edit';
import { catalogEntries, listCatFolders } from '../picture/catalog';
import { patchXmp } from '../picture/metadata';
import { listFaces, listPersons, scanPictures, groupsOf, nameGroup, releaseFaces, forgetAll, entryKey, withFaceRegions, type Group, type PersonRec, type FaceRec, type Models, type ScanReport } from '../picture/people';
import type { Raster } from '../codecs/raster';

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const label = (g: Group, i: number) => g.person ? g.person.name : `Unnamed ${i + 1}`;

async function models(app: App, status: (t: string) => void): Promise<Models | null> {
  const ai = await import('../ai');
  const y = await ai.ensureModel(app, 'yunet', status); if (!y) return null;
  const s = await ai.ensureModel(app, 'sface', status); if (!s) return null;
  return { backend: ai.deviceBackend(app), yunet: async () => y[0], sface: async () => s[0], sfaceKey: `sface-${ai.dtypeOf(app)}` };
}
async function readRaster(app: App, e: Entry): Promise<Raster | null> {
  const cur = app.picture;
  const pic = cur && cur.entry === e ? cur : await decodePicture(new Uint8Array(await e.read()), e);
  const f = pic.pages[0]?.frames[0]; return f ? frameRaster(f) : null;
}
/** Pictures the index can reach now, by key: the open folder and the catalog. */
async function reachable(app: App): Promise<Map<string, Entry>> {
  const m = new Map<string, Entry>();
  for (const e of (await catalogEntries()).entries) m.set(entryKey(e), e);
  for (const e of app.folder.entries) m.set(entryKey(e), e);
  return m;
}
async function scan(app: App, where: 'folder' | 'catalog'): Promise<ScanReport | null> {
  const entries = where === 'catalog' ? (await catalogEntries()).entries : app.folder.entries;
  if (!entries.length) { toast(where === 'catalog' ? 'The catalog is empty.' : 'Open a folder first.'); return null; }
  const m = await models(app, (t) => toast(t, { ms: 1200 })); if (!m) return null;
  const rep = await scanPictures(app, entries, m, (e) => readRaster(app, e), (i, n, f) => toast(`Finding faces: ${i + 1} of ${n} pictures, ${plural(f, 'face')}…`, { ms: 1500 }));
  toast(`${plural(rep.pictures, 'picture')} scanned (${plural(rep.faces, 'face')} found)${rep.skipped ? `, ${rep.skipped} already done` : ''}${rep.failed.length ? `; not readable: ${rep.failed.slice(0, 3).join(', ')}${rep.failed.length > 3 ? '…' : ''}` : ''}.`, { ms: 5000 });
  return rep;
}
async function openGroup(app: App, g: Group, i: number): Promise<number> {
  const all = await reachable(app), entries = g.keys.map((k) => all.get(k)).filter((e): e is Entry => !!e);
  if (!entries.length) { toast('Those pictures cannot be reached now (open their folder or add it to the catalog).'); return 0; }
  await app.openFolder(new Folder(entries, `People: ${label(g, i)} (${plural(entries.length, 'picture')})`), 0);
  if (!app.tab.thumbs.open) app.tab.thumbs.show('grid');
  return entries.length;
}
/** Writes each named person's faces into their pictures as MWG face regions. */
async function writeNames(app: App): Promise<{ pictures: number; unreachable: number }> {
  const persons = await listPersons(), byId = new Map(persons.map((p) => [p.id, p])), faces = (await listFaces()).filter((f) => f.person && byId.has(f.person) && !f.ignored);
  const per = new Map<string, { f: FaceRec; p: PersonRec }[]>(); for (const f of faces) { const l = per.get(f.key) || []; l.push({ f, p: byId.get(f.person!)! }); per.set(f.key, l); }
  const all = await reachable(app); let pictures = 0, unreachable = 0;
  for (const [key, list] of per) {
    const e = all.get(key); if (!e) { unreachable++; continue; }
    const r = await patchXmp(app, e, (xml) => withFaceRegions(xml, list)); if (r !== 'failed' && r !== 'unsupported') pictures++;
  }
  return { pictures, unreachable };
}
async function askName(app: App, current?: PersonRec | null): Promise<(Omit<PersonRec, 'id'> & { existing?: string }) | null> {
  const roster = app.prefs.people, known = await listPersons();
  const v = await openDialog({ title: 'Name This Person', ok: 'Name', fields: [
    { key: 'pick', label: 'Person', type: 'select', value: '', options: [{ value: '', label: 'New person (fill in below)' }, ...known.map((p) => ({ value: `k:${p.id}`, label: `${p.name} (named here)` })), ...roster.map((p, i) => ({ value: `r:${i}`, label: `${p.name}${p.born || p.died ? ` (${[p.born, p.died].filter(Boolean).join('–')})` : ''} — roster` }))] },
    { key: 'name', label: 'Name', type: 'text', value: current?.name || '' },
    { key: 'born', label: 'Born', type: 'text', value: current?.born || '', half: true, placeholder: 'YYYY or a date' },
    { key: 'died', label: 'Died', type: 'text', value: current?.died || '', half: true },
    { key: 'externalId', label: 'Record id (GEDCOM xref or FamilySearch id)', type: 'text', value: current?.externalId || '' },
  ], onChange: (x, ctl, key) => {
    if (key !== 'pick') return;
    const p = x.pick.startsWith('k:') ? known.find((k) => k.id === x.pick.slice(2)) : x.pick.startsWith('r:') ? roster[+x.pick.slice(2)] : null;
    ctl.set('name', p?.name || ''); ctl.set('born', p?.born || ''); ctl.set('died', p?.died || ''); ctl.set('externalId', p?.externalId || '');
  }, validate: (x) => (!String(x.name).trim() ? 'Enter the person\'s name' : null) });
  if (!v) return null;
  return { name: String(v.name).trim(), born: String(v.born).trim() || undefined, died: String(v.died).trim() || undefined, externalId: String(v.externalId).trim() || undefined, existing: v.pick.startsWith('k:') ? v.pick.slice(2) : current?.id };
}
async function facesOf(app: App, g: Group, i: number): Promise<boolean> {
  const chosen = new Set<string>();
  const grid = h('div', { class: 'qn-faces-grid' }, ...g.faces.map((f) => h('label', { class: 'qn-face', title: f.file }, h('input', { type: 'checkbox', onchange: (ev: Event) => { if ((ev.target as HTMLInputElement).checked) chosen.add(f.id); else chosen.delete(f.id); } }), f.thumb ? h('img', { src: f.thumb, alt: `Face in ${f.file}` }) : h('span', null, '?'), h('span', null, f.file))));
  let changed = false;
  await openDialog({ title: `Faces: ${label(g, i)}`, ok: 'Close', cancel: false, wide: true, content: grid, help: 'Tick faces that do not belong here.', buttons: [
    { label: 'Not This Person', onClick: async (_v, ctl) => { if (!chosen.size) return; await releaseFaces([...chosen], false); changed = true; ctl.close(null); } },
    { label: 'Ignore (not a face, or a stranger)', onClick: async (_v, ctl) => { if (!chosen.size) return; await releaseFaces([...chosen], true); changed = true; ctl.close(null); } },
  ] });
  return changed;
}

/** The People window. */
async function peopleWindow(app: App): Promise<void> {
  for (;;) {
    const thr = app.prefs.faces.threshold, groups = groupsOf(await listFaces(), await listPersons(), thr);
    const sel = new Set<number>();
    const cards = groups.map((g, i) => h('label', { class: `qn-person${g.person ? ' qn-named' : ''}` },
      h('input', { type: 'checkbox', onchange: (ev: Event) => { if ((ev.target as HTMLInputElement).checked) sel.add(i); else sel.delete(i); } }),
      g.faces[0].thumb ? h('img', { src: g.faces[0].thumb, alt: label(g, i) }) : h('span', { class: 'qn-noface' }, '?'),
      h('b', null, label(g, i)), h('span', null, `${plural(g.keys.length, 'picture')}`)));
    const body = h('div', { class: 'qn-people' }, ...(cards.length ? cards : [h('p', { class: 'ql-help' }, 'No faces yet: Scan This Folder or Scan Catalog.')]));
    const hasCatalog = (await listCatFolders()).length > 0;
    let next: string | null = null;
    const pickOne = () => { const a = [...sel]; if (a.length !== 1) { toast('Tick one person.'); return null; } return a[0]; };
    const go = (what: string) => (_v: unknown, ctl: { close: (r?: any) => void }) => { next = what; ctl.close(null); };
    await openDialog({ title: 'People', full: true, ok: 'Close', cancel: false, content: body,
      help: `${plural(groups.length, 'person')}, found on this device. Tick a person, then Open, Name or Faces; tick several to Merge.`,
      buttons: [
        { label: 'Open Pictures', onClick: (v, ctl) => { if (pickOne() !== null) go('open')(v, ctl); } },
        { label: 'Name…', onClick: (v, ctl) => { if (pickOne() !== null) go('name')(v, ctl); } },
        { label: 'Faces…', onClick: (v, ctl) => { if (pickOne() !== null) go('faces')(v, ctl); } },
        { label: 'Merge', onClick: (v, ctl) => { if (sel.size < 2) { toast('Tick two or more people.'); return; } go('merge')(v, ctl); } },
        { label: 'Scan This Folder', onClick: go('scanFolder') },
        ...(hasCatalog ? [{ label: 'Scan Catalog', onClick: go('scanCatalog') }] : []),
        { label: 'Write Names to Pictures', onClick: go('write') },
        { label: 'Settings…', onClick: go('settings') },
      ] });
    const picked = [...sel], g = groups[picked[0]];
    if (!next) return;
    if (next === 'open') { await openGroup(app, g, picked[0]); return; }
    if (next === 'name') { const n = await askName(app, g.person); if (n) await nameGroup(g, n, n.existing); }
    else if (next === 'faces') await facesOf(app, g, picked[0]);
    else if (next === 'merge') {
      const chosen = picked.map((i) => groups[i]), namedOnes = chosen.filter((x) => x.person);
      if (new Set(namedOnes.map((x) => x.person!.id)).size > 1) { toast('Two named people cannot be merged; rename one first.'); continue; }
      const n = namedOnes[0]?.person ? { ...namedOnes[0].person, existing: namedOnes[0].person.id } : await askName(app);
      if (n) await nameGroup({ index: -1, person: null, faces: chosen.flatMap((x) => x.faces), keys: [] }, n, n.existing);
    }
    else if (next === 'scanFolder') await scan(app, 'folder');
    else if (next === 'scanCatalog') await scan(app, 'catalog');
    else if (next === 'write') { const r = await writeNames(app); toast(`Names written into ${plural(r.pictures, 'picture')} as face regions${r.unreachable ? `; ${r.unreachable} not reachable now` : ''}.`, { ms: 4000 }); }
    else if (next === 'settings') {
      const v = await openDialog({ title: 'People Settings', ok: 'Save', fields: [
        { key: 'thr', label: 'Group faces when they are at least this alike (higher: stricter)', type: 'range', min: 30, max: 80, value: Math.round(app.prefs.faces.threshold * 100) },
        { key: 'off', label: 'Turn People off (scanning stops; the faces stay until forgotten)', type: 'checkbox', value: false },
        { key: 'forget', label: 'Forget all faces and names found here', type: 'checkbox', value: false },
      ] });
      if (v) {
        app.prefs.faces = { enabled: !v.off, threshold: +v.thr / 100 }; app.savePrefs();
        if (v.forget && await confirmDialog('Forget all faces?', 'Every face, description and name kept by People on this device is deleted. Names already written into pictures stay there.', 'Forget')) await forgetAll();
        if (v.off) { toast('People is off.'); return; }
      }
    }
  }
}

def([
  {
    id: 'browse.people', icon: 'face', noRecord: true, tip: 'Faces found on this device and grouped by person; name them, open their pictures, write the names into the pictures (off until you turn it on)',
    run: async (app, arg?: { enable?: boolean; scan?: 'folder' | 'catalog'; list?: boolean; name?: { group: number; name: string; born?: string; died?: string; externalId?: string }; open?: number; write?: boolean; forget?: boolean; release?: { faces: string[]; ignore: boolean } }) => {
      if (arg) {
        if (arg.enable !== undefined) { app.prefs.faces = { ...app.prefs.faces, enabled: arg.enable }; app.savePrefs(); }
        if (arg.forget) await forgetAll();
        if (arg.scan) return scan(app, arg.scan);
        const groups = groupsOf(await listFaces(), await listPersons(), app.prefs.faces.threshold);
        if (arg.name) { const p = await nameGroup(groups[arg.name.group], { name: arg.name.name, born: arg.name.born, died: arg.name.died, externalId: arg.name.externalId }); return p; }
        if (arg.release) { await releaseFaces(arg.release.faces, arg.release.ignore); return true; }
        if (arg.open !== undefined) return openGroup(app, groups[arg.open], arg.open);
        if (arg.write) return writeNames(app);
        return groups.map((g, i) => ({ name: label(g, i), named: !!g.person, files: g.faces.map((f) => f.file), faceIds: g.faces.map((f) => f.id), scores: g.faces.map((f) => +f.score.toFixed(3)), boxes: g.faces.map((f) => f.box.map((v) => Math.round(v))) }));
      }
      if (!app.prefs.faces.enabled) {
        const ok = await confirmDialog('Turn on People?', 'People finds faces in your pictures and groups them by person, entirely on this device: two models (YuNet face detection, 0.2 MB, MIT license; SFace face recognition, 9.9 MB, Apache 2.0 license; both from the OpenCV model zoo on huggingface.co) are downloaded once, and the faces and names are kept only in this app\'s storage. Settings ▸ Forget all faces deletes them.', 'Turn On');
        if (!ok) return;
        app.prefs.faces = { ...app.prefs.faces, enabled: true }; app.savePrefs();
        if (!(await listFaces()).length && app.folder.length) await scan(app, 'folder');
      }
      await peopleWindow(app);
    },
  },
]);
