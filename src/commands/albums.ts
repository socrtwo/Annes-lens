/**
 * Browse ▸ Albums, Smart Albums, Add to Album (Ctrl+Shift+K) and Search by Sketch.
 */
import { def } from './registry';
import type { App } from '../app';
import type { Entry } from '../picture/folder';
import { Folder } from '../picture/folder';
import { openDialog, toast, promptDialog, confirmDialog } from '../ui/dialog';
import { h } from '../ui/dom';
import { listAlbums, saveAlbums, listSmart, saveSmart, newId, refOf, addRefs, entriesOf, specToStore, specFromStore, describeSpec, type Album } from '../picture/albums';
import { currentFilter, applyFilter, ensureInfo } from './organize';
import { colorLayout, sketchDistance } from '../picture/sketch';
import { decodeSmall } from '../picture/similar';
import type { Raster } from '../codecs/raster';

const hasFolder = (app: App) => app.folder.length > 0;
const chosen = (app: App): Entry[] => { const t = app.tab; const m = t.folder.entries.filter((e) => t.marked.has(e)); return m.length ? m : app.picture ? [app.picture.entry] : []; };

/** Opens an album as a folder of its own. */
export async function openAlbum(app: App, a: Album): Promise<void> {
  const { entries, unavailable } = await entriesOf(a);
  if (!entries.length) { toast(`"${a.name}" has no pictures that can be opened here${unavailable ? ` (${unavailable} unavailable)` : ''}.`); return; }
  const f = new Folder(entries, `Album: ${a.name}`);
  await app.openFolder(f, 0);
  toast(`${a.name}: ${entries.length} picture${entries.length === 1 ? '' : 's'}${unavailable ? `; ${unavailable} could not be reached (moved, or permission refused)` : ''}`, { ms: 3000 });
}

async function addTo(app: App, albumId: string | null, name?: string): Promise<void> {
  const es = chosen(app); if (!es.length) return;
  const refs = es.map(refOf), kept = refs.filter((r): r is NonNullable<typeof r> => !!r);
  if (!kept.length) { toast('These pictures have no file address to keep (dropped or pasted); open them from a folder or with Open to add them to an album.', { ms: 5000 }); return; }
  const albums = await listAlbums();
  let a = albums.find((x) => x.id === albumId);
  if (!a) { a = { id: newId(), name: name || 'New Album', created: Date.now(), items: [] }; albums.push(a); }
  const n = await addRefs(a, kept);
  await saveAlbums(albums);
  toast(`${n} added to "${a.name}" (${a.items.length} in all)${kept.length - n ? `; ${kept.length - n} already there` : ''}${refs.length - kept.length ? `; ${refs.length - kept.length} without a file address skipped` : ''}.`, { ms: 3500 });
}

const SKETCH_COLORS = ['#3b7dd8', '#8fc3ff', '#2e8b3a', '#9acd32', '#c8a165', '#f2d16b', '#d94b3d', '#f39c34', '#ffffff', '#808080', '#222222', '#7a4fb5'];
/** The sketch pad: a 240 × 180 canvas, a palette and brush sizes; returns its raster, or null when canceled. */
async function sketchPad(): Promise<Raster | null> {
  const c = h('canvas', { width: '240', height: '180', class: 'qn-sketch' }) as HTMLCanvasElement, x = c.getContext('2d', { willReadFrequently: true })!;
  let color = SKETCH_COLORS[0], size = 28, down = false, painted = false;
  const dot = (e: PointerEvent) => { const r = c.getBoundingClientRect(); const px = ((e.clientX - r.left) * c.width) / r.width, py = ((e.clientY - r.top) * c.height) / r.height; x.fillStyle = color; x.beginPath(); x.arc(px, py, size / 2, 0, Math.PI * 2); x.fill(); painted = true; };
  c.addEventListener('pointerdown', (e) => { down = true; c.setPointerCapture(e.pointerId); dot(e); });
  c.addEventListener('pointermove', (e) => { if (down) dot(e); });
  c.addEventListener('pointerup', () => { down = false; });
  const swatches = h('div', { class: 'qn-sketch-palette' }, ...SKETCH_COLORS.map((col) => { const b = h('button', { type: 'button', class: 'qn-swatch', style: `background:${col}`, title: col, 'aria-label': `Color ${col}` }); b.addEventListener('click', () => { color = col; swatches.querySelectorAll('.qn-swatch').forEach((s) => s.classList.toggle('ql-sel', s === b)); }); return b; }));
  (swatches.firstChild as HTMLElement).classList.add('ql-sel');
  const sizes = h('select', null, ...[['12', 'Fine'], ['28', 'Medium'], ['56', 'Broad'], ['110', 'Very broad']].map(([v, l]) => h('option', { value: v, selected: v === '28' }, l))) as HTMLSelectElement;
  sizes.addEventListener('change', () => { size = +sizes.value; });
  const r = await openDialog({ title: 'Search by Sketch', ok: 'Search', help: 'Paint roughly where the colors are (blue sky on top, green fields below); leave the rest empty. Pictures with that layout come first.', content: h('div', { class: 'qn-sketch-box' }, c, swatches, h('label', null, 'Brush ', sizes)), buttons: [{ label: 'Clear', onClick: () => { x.clearRect(0, 0, c.width, c.height); painted = false; } }] });
  if (!r) return null;
  if (!painted) { toast('Paint something first.'); return null; }
  const d = x.getImageData(0, 0, c.width, c.height);
  return { width: c.width, height: c.height, data: d.data as Uint8ClampedArray<ArrayBuffer> };
}

/** Ranks the folder's pictures against a sketch; the closest are shown first in the thumbnails. */
export async function searchBySketch(app: App, sketch: Raster, keep = 12): Promise<{ entry: Entry; d: number }[]> {
  const sk = colorLayout(sketch, true);
  const scored: { entry: Entry; d: number }[] = [];
  for (const [i, e] of app.folder.entries.entries()) {
    if (i % 10 === 0) toast(`Comparing ${i + 1} of ${app.folder.length}…`, { ms: 600 });
    const small = await decodeSmall(app, e, 96).catch(() => null);
    if (!small) continue;
    const ctx = small.getContext('2d', { willReadFrequently: true })!, id = ctx.getImageData(0, 0, small.width, small.height);
    const d = sketchDistance(sk, colorLayout({ width: small.width, height: small.height, data: id.data as Uint8ClampedArray<ArrayBuffer> }));
    if (d !== null) scored.push({ entry: e, d });
  }
  scored.sort((a, b) => a.d - b.d);
  return scored.slice(0, keep);
}

def([
  {
    id: 'browse.albums', icon: 'photo_album', noRecord: true, tip: 'Your albums (pictures from any folders) and smart albums (saved filters): open, rename, delete',
    run: async (app, arg?: string) => {
      const albums = await listAlbums(), smart = await listSmart();
      if (arg) { const a = albums.find((x) => x.id === arg || x.name === arg); if (a) return openAlbum(app, a); const s = smart.find((x) => x.id === arg || x.name === arg); if (s) return app.exec('browse.smartAlbum', s.id); toast(`No album named ${arg}.`); return; }
      if (!albums.length && !smart.length) { toast('No albums yet: mark pictures and use Add to Album (Ctrl+Shift+K), or save a filter as a smart album.', { ms: 4500 }); return; }
      const r = await openDialog({ title: 'Albums', ok: 'Go', fields: [
        { key: 'which', label: 'Album', type: 'list', value: (albums[0] || smart[0]).id, options: [...albums.map((a) => ({ value: a.id, label: `${a.name} — ${a.items.length} picture${a.items.length === 1 ? '' : 's'}` })), ...smart.map((s) => ({ value: s.id, label: `${s.name} — smart: ${describeSpec(specFromStore(s.spec))}` }))] },
        { key: 'act', label: 'Action', type: 'radio', value: 'open', options: [{ value: 'open', label: 'Open (a smart album filters the open folder)' }, { value: 'rename', label: 'Rename…' }, { value: 'remove', label: 'Remove the marked pictures from the album' }, { value: 'delete', label: 'Delete the album (the pictures stay where they are)' }] },
      ] });
      if (!r) return;
      const a = albums.find((x) => x.id === r.which), s = smart.find((x) => x.id === r.which);
      if (r.act === 'open') { if (a) await openAlbum(app, a); else if (s) await app.exec('browse.smartAlbum', s.id); return; }
      const item = a || s; if (!item) return;
      if (r.act === 'rename') { const n = await promptDialog('Rename Album', 'Name:', item.name); if (!n) return; item.name = n; if (a) await saveAlbums(albums); else await saveSmart(smart); toast(`Renamed to "${n}".`); return; }
      if (r.act === 'delete') { if (!(await confirmDialog('Delete Album', `Delete "${item.name}"? The pictures themselves are not touched.`, 'Delete'))) return; if (a) await saveAlbums(albums.filter((x) => x !== a)); else await saveSmart(smart.filter((x) => x !== s)); toast(`Deleted "${item.name}".`); return; }
      if (r.act === 'remove' && a) {
        const marked = app.tab.folder.entries.filter((e) => app.tab.marked.has(e)).map(refOf).filter(Boolean) as NonNullable<ReturnType<typeof refOf>>[];
        const before = a.items.length; a.items = a.items.filter((x) => !marked.some((m) => (m.uri && m.uri === x.uri) || (!m.uri && m.name === x.name && m.size === x.size)));
        await saveAlbums(albums); toast(`Removed ${before - a.items.length} from "${a.name}".`);
      }
    },
  },
  {
    id: 'browse.addToAlbum', icon: 'library_add', noRecord: true, isEnabled: (app) => !!app.picture, tip: 'Adds the marked pictures (or this one) to an album; the files stay where they are',
    run: async (app, arg?: string | { album?: string; name?: string }) => {
      const albums = await listAlbums();
      let v = typeof arg === 'string' ? { album: arg } : arg;
      if (!v) {
        const n = chosen(app).length;
        const r = await openDialog({ title: 'Add to Album', ok: 'Add', fields: [
          { key: 'album', label: `Add ${n} picture${n === 1 ? '' : 's'} to`, type: 'select', options: [...albums.map((a) => ({ value: a.id, label: `${a.name} (${a.items.length})` })), { value: '', label: 'A new album…' }], value: albums[albums.length - 1]?.id || '' },
          { key: 'name', label: 'New album name', type: 'text', value: app.folder.name || 'My Album', visibleIf: (x) => !x.album },
        ] });
        if (!r) return; v = { album: r.album, name: String(r.name || '').trim() || 'My Album' };
      }
      const id = albums.find((a) => a.id === v!.album || a.name === v!.album)?.id ?? null;
      await addTo(app, id, v.name || (typeof v.album === 'string' && !id ? v.album : undefined));
    },
  },
  {
    id: 'browse.smartAlbum', icon: 'auto_awesome_mosaic', noRecord: true, isEnabled: (app) => hasFolder(app) || app.prefs.useCatalog, tip: 'Saved filters that update themselves: save the Filter Bar\'s filter, or apply a saved one to the open folder',
    run: async (app, arg?: string | { save: string }) => {
      const smart = await listSmart();
      if (typeof arg === 'string') {
        const s = smart.find((x) => x.id === arg || x.name === arg); if (!s) { toast(`No smart album named ${arg}.`); return; }
        // With the catalog, a smart album searches every cataloged picture.
        if (app.prefs.useCatalog) { const { openCatalogView } = await import('./catalog'); if (!(await openCatalogView(app, true))) return; }
        await ensureInfo(app); applyFilter(app, specFromStore(s.spec), `Smart album: ${s.name}`); return;
      }
      const cur = currentFilter();
      if (arg && 'save' in arg) { if (!cur) { toast('Set a filter first (Filter Bar).'); return; } smart.push({ id: newId(), name: arg.save, spec: specToStore(cur) }); await saveSmart(smart); toast(`Saved the smart album "${arg.save}".`); return; }
      const r = await openDialog({ title: 'Smart Albums', ok: 'Go', fields: [
        { key: 'act', label: 'Action', type: 'radio', value: smart.length ? 'apply' : 'save', options: [{ value: 'apply', label: 'Apply a smart album to this folder' }, { value: 'save', label: cur ? `Save the current filter (${describeSpec(cur)}) as a smart album` : 'Save the current filter (set one in the Filter Bar first)' }] },
        { key: 'which', label: 'Smart album', type: 'select', options: smart.map((s) => ({ value: s.id, label: `${s.name} — ${describeSpec(specFromStore(s.spec))}` })), value: smart[0]?.id || '', visibleIf: (x) => x.act === 'apply' },
        { key: 'name', label: 'Name', type: 'text', value: cur ? describeSpec(cur) : '', visibleIf: (x) => x.act === 'save' },
      ] });
      if (!r) return;
      if (r.act === 'save') { if (!cur) { toast('Set a filter first (Browse ▸ Filter Bar), then save it.'); return; } return app.exec('browse.smartAlbum', { save: String(r.name || describeSpec(cur)).trim() }); }
      if (r.which) return app.exec('browse.smartAlbum', String(r.which));
    },
  },
  {
    id: 'browse.searchSketch', icon: 'gesture', noRecord: true, isEnabled: hasFolder, tip: 'Paint a rough color layout; the pictures that look like it come first',
    run: async (app, arg?: Raster) => {
      const sketch = arg || (await sketchPad()); if (!sketch) return;
      const top = await searchBySketch(app, sketch);
      if (!top.length) { toast('No pictures could be compared.'); return; }
      const set = new Set(top.map((t) => t.entry)), t = app.tab.thumbs;
      if (t) { t.filter = (e) => set.has(e); t.filterLabel = `Sketch: ${top.length} closest`; if (!t.open) t.show('grid'); t.refilter(); }
      const i = app.folder.entries.indexOf(top[0].entry); if (i >= 0 && app.folder.select(i)) await app.tab.show();
      toast(`Closest: ${top.slice(0, 3).map((x) => x.entry.name).join(', ')}`, { ms: 3000 });
      return top;
    },
  },
]);
