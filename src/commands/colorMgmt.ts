/**
 * Image ▸ Color Management: Convert to Color Profile, Assign Color Profile and Soft Proof, and
 * View ▸ Color-Managed Display. The profile a picture's values are in travels with each page
 * (embedded on decode, assigned or converted here) and is embedded again on save.
 */
import { def } from './registry';
import type { App } from '../app';
import { openDialog, toast } from '../ui/dialog';
import { pickFile } from '../ui/dom';
import { mapPageRaster } from '../picture/edit';
import { SPACES, spaceIcc } from '../color/spaces';
import { makeTransform, INTENTS, type Intent, type PixelTransform } from '../color/transform';
import { docProfile, profileOf, profileName, embeddedIcc } from '../color/embedded';
import { cmState } from '../color/display';

const has = (app: App) => !!app.picture;
const redraw = (app: App) => { for (const t of app.tabs) t.ui.draw(); app.refresh(); };

/** Profiles loaded from files in this session (they appear in every profile list). */
export const loadedProfiles: { name: string; icc: Uint8Array }[] = [];
const kindOf = (icc: Uint8Array) => { const p = profileOf(icc); return p ? `${p.colorSpace === 'GRAY' ? 'gray' : p.colorSpace}${p.deviceClass === 'prtr' ? ' printer' : ''}` : '?'; };

function options(o: { proof?: boolean; embedded?: Uint8Array | null; untagged?: boolean }): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  if (o.embedded) out.push({ value: 'E', label: `Embedded in the file: ${profileName(o.embedded)}` });
  if (o.untagged) out.push({ value: 'none', label: 'Untagged (shown as sRGB)' });
  for (const s of SPACES) out.push({ value: `S:${s.id}`, label: s.name });
  loadedProfiles.forEach((l, i) => { if (o.proof || docProfile(l.icc)) out.push({ value: `L:${i}`, label: `${l.name} (${kindOf(l.icc)}, loaded)` }); });
  out.push({ value: 'file', label: 'Load a profile file (.icc, .icm)…' });
  return out;
}

/** Reads an ICC file the user picks; it joins the session list. */
export async function loadProfileFile(files?: File[]): Promise<{ name: string; icc: Uint8Array } | null> {
  const [f] = files || (await pickFile('.icc,.icm,application/vnd.iccprofile'));
  if (!f) return null;
  const icc = new Uint8Array(await f.arrayBuffer()), p = profileOf(icc);
  if (!p) { toast(`${f.name} is not an ICC profile.`); return null; }
  const hit = loadedProfiles.find((l) => l.icc.length === icc.length && l.icc.every((b, i) => b === icc[i]));
  if (hit) return hit;
  const item = { name: p.description || f.name, icc }; loadedProfiles.push(item); return item;
}

async function resolve(choice: string, embedded?: Uint8Array | null): Promise<{ name: string; icc: Uint8Array | undefined } | null> {
  if (choice === 'none') return { name: 'untagged sRGB', icc: undefined };
  if (choice === 'E' && embedded) return { name: profileName(embedded), icc: embedded };
  if (choice.startsWith('S:')) { const s = SPACES.find((x) => x.id === choice.slice(2)); return s ? { name: s.name, icc: spaceIcc(s.id) } : null; }
  if (choice.startsWith('L:')) return loadedProfiles[+choice.slice(2)] || null;
  if (choice === 'file') return loadProfileFile();
  return null;
}
const docOnly = (r: { name: string; icc: Uint8Array | undefined }) => {
  if (!r.icc || docProfile(r.icc)) return true;
  toast(`${r.name} is a ${kindOf(r.icc)} profile; pictures can be in RGB or gray profiles only. Use Soft Proof to preview printing with it.`, { ms: 6000 });
  return false;
};

/** Converts every page's values from its profile (sRGB when untagged) to `dst`, keeping the appearance. */
export function convertPicture(app: App, dst: { name: string; icc: Uint8Array }, o: { intent: Intent; bpc: boolean }): void {
  const target = docProfile(dst.icc)!, made = new Map<Uint8Array | undefined, PixelTransform>();
  const fnFor = (icc: Uint8Array | undefined) => { let f = made.get(icc); if (!f) { f = makeTransform(docProfile(icc) || docProfile(spaceIcc('srgb'))!, target, o); made.set(icc, f); } return f; };
  app.edit(`Convert to ${dst.name}`, (p) => {
    p.pages = p.pages.map((pg) => { const fn = fnFor(pg.icc); return mapPageRaster(pg, (r) => { const data = r.data.slice(); fn(data); return { width: r.width, height: r.height, data }; }, { icc: dst.icc }); });
  });
}
/** Gives every page a profile without changing the values. */
export function assignPicture(app: App, r: { name: string; icc: Uint8Array | undefined }): void {
  app.edit(`Assign ${r.name}`, (p) => { p.pages = p.pages.map((pg) => { const n = { ...pg }; if (r.icc) n.icc = r.icc; else delete n.icc; return n; }); });
}

def([
  {
    id: 'image.convertProfile', icon: 'palette', edits: true, isEnabled: has, tip: 'Converts the values to another profile so the colors look the same: sRGB, Display P3, Adobe RGB-compatible, ProPhoto, Rec. 2020, gray, or a profile file',
    run: async (app, arg?: { to: string; intent?: Intent; bpc?: boolean }) => {
      const pic = app.picture!, cur = pic.current.icc;
      let v = arg;
      if (!v) {
        const r = await openDialog({ title: 'Convert to Color Profile', ok: 'Convert', fields: [
          { key: 'from', type: 'info', label: `Now: ${profileName(cur)}` },
          { key: 'to', label: 'Convert to', type: 'select', options: options({}), value: cur ? 'S:srgb' : 'S:p3' },
          { key: 'intent', label: 'Rendering intent', type: 'select', options: INTENTS.map(([value, label]) => ({ value, label })), value: 1 },
          { key: 'bpc', label: 'Black point compensation', type: 'checkbox', value: true },
          { key: 'n', type: 'info', label: 'Display (matrix) profiles convert colorimetrically whatever the intent; printer-style profiles with tables use the intent you pick. Colors outside the new space are clipped.' },
        ] });
        if (!r) return;
        v = { to: String(r.to), intent: +r.intent as Intent, bpc: !!r.bpc };
      }
      const dst = await resolve(v.to);
      if (!dst?.icc || !docOnly(dst)) return;
      try { convertPicture(app, { name: dst.name, icc: dst.icc }, { intent: v.intent ?? 1, bpc: v.bpc ?? true }); toast(`Converted to ${dst.name}.`); }
      catch (e: any) { toast(`Not converted: ${e?.message || e}`, { ms: 6000 }); }
    },
  },
  {
    id: 'image.assignProfile', icon: 'label', edits: true, isEnabled: has, tip: 'Says which profile the values are in without changing them (fixes untagged or mislabeled pictures)',
    run: async (app, arg?: string) => {
      const pic = app.picture!;
      const embedded = await embeddedIcc(pic.bytes, pic.format.id).catch(() => null);
      let choice = arg;
      if (!choice) {
        const r = await openDialog({ title: 'Assign Color Profile', ok: 'Assign', fields: [
          { key: 'from', type: 'info', label: `Now: ${profileName(pic.current.icc)}` },
          { key: 'to', label: 'Assign', type: 'select', options: options({ embedded: docProfile(embedded) ? embedded : null, untagged: true }), value: 'S:adobergb' },
          { key: 'n', type: 'info', label: 'The values stay as they are; the colors change on screen to what the profile says they mean. Use Convert to keep the colors and change the values.' },
        ] });
        if (!r) return;
        choice = String(r.to);
      }
      const prof = await resolve(choice, embedded);
      if (!prof || !docOnly(prof)) return;
      assignPicture(app, prof); toast(`Assigned ${prof.name}.`);
    },
  },
  {
    id: 'image.softProof', icon: 'print', kind: 'toggle', noRecord: true, isEnabled: has, isActive: () => !!cmState.proof, tip: 'Previews the picture as an output profile (a printer, a paper, a gray press or sRGB) would show it, with an optional gamut warning; the picture is not changed',
    run: async (app, arg?: string | { profile: string; intent?: Intent; bpc?: boolean; paperWhite?: boolean; gamutWarning?: boolean }) => {
      if (cmState.proof && arg === undefined) { cmState.proof = null; redraw(app); toast('Soft proof off', { ms: 1200 }); return; }
      let v = typeof arg === 'object' ? arg : undefined;
      if (!v) {
        const last = cmState.proof, lastIdx = last ? loadedProfiles.findIndex((l) => l.icc === last.icc) : -1;
        const r = await openDialog({ title: 'Soft Proof', ok: 'Proof', fields: [
          { key: 'profile', label: 'Proof as', type: 'select', options: options({ proof: true }), value: lastIdx >= 0 ? `L:${lastIdx}` : loadedProfiles.length ? `L:${loadedProfiles.length - 1}` : 'S:gray22' },
          { key: 'intent', label: 'Rendering intent', type: 'select', options: INTENTS.filter(([i]) => i !== 3).map(([value, label]) => ({ value, label })), value: last?.intent ?? 1 },
          { key: 'bpc', label: 'Black point compensation', type: 'checkbox', value: last?.bpc ?? true },
          { key: 'paperWhite', label: 'Simulate paper color and ink black', type: 'checkbox', value: last?.paperWhite ?? false },
          { key: 'gamutWarning', label: 'Gamut warning (magenta where the colors cannot be printed)', type: 'checkbox', value: last?.gamutWarning ?? false },
        ] });
        if (!r) return;
        v = { profile: String(r.profile), intent: +r.intent as Intent, bpc: !!r.bpc, paperWhite: !!r.paperWhite, gamutWarning: !!r.gamutWarning };
      }
      const prof = await resolve(v.profile);
      if (!prof?.icc) return;
      cmState.proof = { icc: prof.icc, name: prof.name, intent: v.intent ?? 1, bpc: v.bpc ?? true, paperWhite: !!v.paperWhite, gamutWarning: !!v.gamutWarning };
      redraw(app); toast(`Soft proof: ${prof.name}${cmState.proof.gamutWarning ? ' — magenta marks colors out of gamut' : ''}`, { ms: 2500 });
    },
  },
  {
    id: 'view.colorManaged', icon: 'invert_colors', kind: 'toggle', noRecord: true, isActive: () => cmState.managed, tip: 'Shows tagged pictures through their color profiles (on), or their raw values as if sRGB (off)',
    run: (app) => { cmState.managed = !cmState.managed; redraw(app); toast(cmState.managed ? 'Color-managed display on' : 'Color management off: values shown as sRGB', { ms: 1500 }); },
  },
]);
