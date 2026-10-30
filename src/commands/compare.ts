/**
 * Browse tab, Find and compare: Find Duplicates (byte-identical, same pixels, the same picture at
 * another size), Find Similar Pictures (perceptual hash within a threshold of the current picture)
 * and Sort by Quality (sharpness, noise, exposure and compression scores). Results are shown with
 * thumbnails and can be marked for Delete or Move.
 */
import { def } from './registry';
import type { App } from '../app';
import type { Entry } from '../picture/folder';
import { openDialog, toast } from '../ui/dialog';
import { h } from '../ui/dom';
import { fingerprint, groupDuplicates, hamming, quality, grayOf, decodeSmall, type Fingerprint, type DupKind } from '../picture/similar';
import { fmtSize } from '../ui/shell';

const KIND_LABEL: Record<DupKind, string> = { identical: 'Byte-identical', pixels: 'Same pixels', resized: 'Same picture, another size', similar: 'Similar' };

async function fingerprints(app: App, entries: Entry[], withBytes: boolean, what: string): Promise<Fingerprint[]> {
  const out: Fingerprint[] = []; let i = 0;
  for (const e of entries) { i++; if (i % 8 === 0) toast(`${what} ${i} of ${entries.length}…`, { ms: 700 }); const fp = await fingerprint(app, e, withBytes); if (fp) out.push(fp); }
  return out;
}
const card = (fp: Fingerprint, note: string, onClick: () => void) => h('button', { class: 'qn-fxcard', type: 'button', onclick: onClick, title: fp.entry.name }, fp.canvas || h('span', null, '?'), h('span', null, fp.entry.name), h('span', { class: 'ql-help' }, `${fp.width}×${fp.height}${fp.size ? `, ${fmtSize(fp.size)}` : ''}${note ? ` · ${note}` : ''}`));
function markAndShow(app: App, entries: Entry[]): void {
  const t = app.tab; t.marked.clear(); for (const e of entries) t.marked.add(e);
  if (!t.thumbs.open) t.thumbs.show('grid'); t.thumbs.sync(); app.refresh();
  toast(`${entries.length} picture${entries.length === 1 ? '' : 's'} marked; use Delete, Move or Batch on them.`);
}
const goTo = (app: App, e: Entry) => { const i = app.tab.folder.entries.indexOf(e); if (i >= 0) { app.tab.folder.select(i); void app.tab.show(); } };

def([
  {
    id: 'browse.findDuplicates', icon: 'file_copy', popular: true, noRecord: true, isEnabled: (app) => app.folder.length > 1, tip: 'Byte-identical files, identical pixels, and the same picture at another size, grouped',
    run: async (app) => {
      const f = app.tab.folder;
      const o = await openDialog({ title: 'Find Duplicates', ok: 'Find', help: `Checks the ${f.length} pictures in this folder.`, fields: [
        { key: 'identical', label: 'Byte-identical files', type: 'checkbox', value: true, half: true }, { key: 'pixels', label: 'Same pixels (different metadata or format)', type: 'checkbox', value: true, half: true },
        { key: 'resized', label: 'The same picture at another size', type: 'checkbox', value: true, half: true }, { key: 'similar', label: 'Merely similar (edits, crops, re-encodes)', type: 'checkbox', value: false, half: true },
        { key: 'threshold', label: 'Similarity threshold (bits, lower = stricter)', type: 'range', min: 1, max: 20, value: 8, visibleIf: (v) => !!v.similar },
      ] });
      if (!o) return;
      const fps = await fingerprints(app, f.entries, !!o.identical, 'Hashing');
      const groups = groupDuplicates(fps, { identical: !!o.identical, pixels: !!o.pixels, resized: !!o.resized, similar: !!o.similar, threshold: +o.threshold });
      if (!groups.length) { toast('No duplicates found.'); return; }
      const extras = groups.flatMap((g) => g.items.slice(1).map((x) => x.entry));
      const content = h('div', { style: 'max-height:60vh;overflow:auto' }, ...groups.map((g, gi) => h('div', { class: 'qn-dupgroup' }, h('h4', null, `Group ${gi + 1}: ${KIND_LABEL[g.kind]} (${g.items.length})`), h('div', { class: 'qn-fxgrid' }, ...g.items.map((fp, i) => card(fp, i ? '' : 'keep (largest)', () => goTo(app, fp.entry)))))));
      await openDialog({ title: `Duplicates — ${groups.length} group${groups.length === 1 ? '' : 's'}`, wide: true, cancel: false, ok: 'Close', help: 'The largest picture of each group comes first. Mark the others to delete or move them.', content, buttons: [
        { label: `Mark all but the first (${extras.length})`, primary: true, onClick: (_v, ctl) => { ctl.close(); markAndShow(app, extras); } },
        { label: 'Mark every member', onClick: (_v, ctl) => { ctl.close(); markAndShow(app, groups.flatMap((g) => g.items.map((x) => x.entry))); } },
      ] });
    },
  },
  {
    id: 'browse.findSimilar', icon: 'image_search', noRecord: true, isEnabled: (app) => !!app.picture && app.folder.length > 1, tip: 'Pictures in the folder that look like this one (perceptual hash), nearest first',
    run: async (app) => {
      const pic = app.picture!, f = app.tab.folder;
      const o = await openDialog({ title: 'Find Similar Pictures', ok: 'Find', help: `Compares ${pic.name} with the other ${f.length - 1} pictures in the folder.`, fields: [{ key: 'threshold', label: 'Threshold (bits, 0 = identical, 64 = opposite)', type: 'range', min: 1, max: 32, value: 12 }] });
      if (!o) return;
      const fps = await fingerprints(app, f.entries, false, 'Hashing');
      const me = fps.find((x) => x.entry === pic.entry);
      if (!me) { toast('This picture could not be hashed.'); return; }
      const hits = fps.filter((x) => x !== me).map((x) => ({ fp: x, d: Math.min(hamming(x.phash, me.phash), hamming(x.dhash, me.dhash)) })).filter((x) => x.d <= +o.threshold).sort((a, b) => a.d - b.d);
      if (!hits.length) { toast(`Nothing within ${o.threshold} bits of ${pic.name}.`); return; }
      await openDialog({ title: `Similar to ${pic.name} — ${hits.length}`, wide: true, cancel: false, ok: 'Close', content: h('div', { class: 'qn-fxgrid', style: 'max-height:60vh;overflow:auto' }, ...hits.map((x) => card(x.fp, `${x.d} bit${x.d === 1 ? '' : 's'} apart`, () => goTo(app, x.fp.entry)))), buttons: [{ label: `Mark the ${hits.length}`, primary: true, onClick: (_v, ctl) => { ctl.close(); markAndShow(app, hits.map((x) => x.fp.entry)); } }] });
    },
  },
  {
    id: 'browse.qualitySort', icon: 'sort', noRecord: true, isEnabled: (app) => app.folder.length > 1, tip: 'Orders the folder by sharpness, noise, exposure and compression scores, best first',
    run: async (app) => {
      const f = app.tab.folder; const rows: { e: Entry; q: ReturnType<typeof quality>; c: HTMLCanvasElement }[] = []; let i = 0;
      for (const e of f.entries) {
        i++; if (i % 8 === 0) toast(`Scoring ${i} of ${f.length}…`, { ms: 700 });
        const c = await decodeSmall(app, e, 128); if (!c) continue;
        const pic = app.tab.picture; let bpp: number | null = null;
        if (e.size) { const px = pic && pic.entry === e ? pic.width * pic.height : null; if (px) bpp = e.size / px; else { try { const u8 = new Uint8Array(await e.read()); const b = await createImageBitmap(new Blob([u8 as BlobPart])); bpp = e.size / (b.width * b.height); b.close(); } catch { bpp = null; } } }
        rows.push({ e, q: quality(grayOf(c, c.width, c.height), c.width, c.height, bpp), c });
      }
      rows.sort((a, b) => b.q.score - a.q.score);
      const cur = f.current;
      const scored = new Set(rows.map((r) => r.e));
      f.entries = [...rows.map((r) => r.e), ...f.entries.filter((e) => !scored.has(e))];
      f.select(Math.max(0, cur ? f.entries.indexOf(cur) : 0));
      app.tab.thumbs.sync(); app.refresh();
      const table = h('table', { class: 'ql-stats qn-info', style: 'font-size:12px' }, h('tr', null, h('th', null, ''), h('th', null, 'Picture'), h('th', null, 'Score'), h('th', null, 'Sharpness'), h('th', null, 'Noise'), h('th', null, 'Exposure'), h('th', null, 'Compression')),
        ...rows.map((r) => h('tr', { onclick: () => goTo(app, r.e), style: 'cursor:pointer' }, h('td', null, (() => { r.c.style.width = '48px'; r.c.style.height = 'auto'; return r.c; })()), h('td', null, r.e.name), h('td', null, String(r.q.score)), h('td', null, String(r.q.sharpness)), h('td', null, String(r.q.noise)), h('td', null, String(r.q.exposure)), h('td', null, String(r.q.compression)))));
      await openDialog({ title: 'Sorted by Quality', wide: true, cancel: false, ok: 'Close', help: 'Best first. Scores are 0–100: sharpness (variance of the Laplacian), noise (residual on flat areas), exposure (clipping and mean brightness), compression (bytes per pixel). Sort By restores a name or date order.', content: h('div', { style: 'max-height:60vh;overflow:auto' }, table), buttons: [{ label: `Mark the weakest ${Math.max(1, Math.round(rows.length / 4))}`, onClick: (_v, ctl) => { ctl.close(); markAndShow(app, rows.slice(-Math.max(1, Math.round(rows.length / 4))).map((r) => r.e)); } }] });
    },
  },
]);
