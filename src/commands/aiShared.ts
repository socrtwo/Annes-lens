/** Helpers shared by the AI command modules: result dialogs, "where to run" fields, loading entries. */
import type { App } from '../app';
import type { Raster } from '../codecs/raster';
import { decodePicture, encodeCanvas } from '../codecs/registry';
import { Folder, entryFromBytes, type Entry } from '../picture/folder';
import { frameRaster } from '../picture/edit';
import { patchXmp, forTargets } from '../picture/metadata';
import { openDialog, toast, type Field, type DialogControl } from '../ui/dialog';
import { h } from '../ui/dom';
import { writeClipboardText } from '../platform/native';
import { setXmp } from '../meta/metaEdit';
import { updateXmp, type XmpProps } from '../meta/xmp';
import { hasImage, hasText, imageService, provenanceProps, rasterCanvas, type Provenance } from '../ai';
import { modelById } from '../ai/device';

export const has = (app: App): boolean => !!app.picture;
export const hasSel = (app: App): boolean => !!app.picture && !!app.tab.selection;
export const canText = (app: App): boolean => !!app.picture && hasText(app);
export const canImage = (app: App): boolean => !!app.picture && hasImage(app);

export const AI_NOTE = 'AI output can be wrong; check it before relying on it.';

/** Shows a text result with Copy (and optional save actions). */
export async function textResult(app: App, title: string, text: string, opts: { note?: string; deliberation?: string; saveAs?: { label: string; patch: (t: string) => Partial<XmpProps> }; extra?: { label: string; onClick: (t: string, ctl: DialogControl) => void }[]; editable?: boolean } = {}): Promise<void> {
  const fields: Field[] = [{ key: 'text', label: title, type: 'textarea', value: text, rows: Math.min(14, Math.max(4, text.split('\n').length + 2)) }];
  if (opts.deliberation) fields.push({ key: 'delib', label: 'AI discussion', type: 'textarea', value: opts.deliberation, rows: 10 });
  const buttons: { label: string; onClick: (v: Record<string, any>, ctl: DialogControl) => void }[] = [{ label: 'Copy', onClick: async (v) => { await writeClipboardText(String(v.text || '')); toast('Copied.'); } }];
  if (opts.saveAs && app.picture) buttons.push({ label: opts.saveAs.label, onClick: async (v) => { await forTargets(app, 'Saved', (e) => patchXmp(app, e, opts.saveAs!.patch(String(v.text || '').trim()))); } });
  for (const x of opts.extra || []) buttons.push({ label: x.label, onClick: (v, ctl) => x.onClick(String(v.text || ''), ctl) });
  await openDialog({ title, fields, ok: 'Close', cancel: false, wide: true, help: `${opts.note ? opts.note + ' ' : ''}${AI_NOTE}`, buttons });
}

/** 'device' | 'service' choice for commands that have both. */
export function whereField(app: App, deviceModel: string | null, service: 'image' | 'text' | null): Field | null {
  const opts: { value: string; label: string }[] = [];
  if (deviceModel) opts.push({ value: 'device', label: `This device (${modelById(deviceModel).title})` });
  if (service === 'image' && hasImage(app)) opts.push({ value: 'service', label: `Picture service (${imageService(app)!.name})` });
  if (service === 'text' && hasText(app)) opts.push({ value: 'service', label: 'Text and vision service' });
  if (!opts.length) return null;
  return { key: 'where', label: 'Run on', type: 'select', options: opts, value: opts.find((o) => o.value === app.prefs.ai.prefer)?.value || opts[0].value, half: true };
}
export const resultField = (app: App): Field => ({ key: 'result', label: 'Result', type: 'select', options: [{ value: 'new', label: 'New picture beside the original' }, { value: 'replace', label: 'Replace the picture (undoable)' }], value: app.prefs.ai.result, half: true });

export async function entryRaster(app: App, e: Entry): Promise<Raster> {
  const cur = app.picture;
  if (cur && cur.entry === e) return frameRaster(cur.currentFrame);
  const pic = await decodePicture(new Uint8Array(await e.read()), e);
  const r = frameRaster(pic.currentFrame); pic.release(); return r;
}

/** Opens several results as one new folder of unsaved pictures. */
export async function openResults(app: App, rasters: Raster[], p: Provenance, baseName: string, folderName = 'Generated'): Promise<void> {
  const entries: Entry[] = [];
  const props = provenanceProps(app, p);
  for (let i = 0; i < rasters.length; i++) {
    const blob = await encodeCanvas(rasterCanvas(rasters[i]), 'png');
    let u8 = new Uint8Array(await blob.arrayBuffer());
    if (Object.keys(props).length) u8 = setXmp(u8, 'png', new TextEncoder().encode(updateXmp(null, props))) as Uint8Array<ArrayBuffer>;
    entries.push(entryFromBytes(`${baseName}${rasters.length > 1 ? ` ${i + 1}` : ''}.png`, u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer));
  }
  await app.openFolder(new Folder(entries, folderName), 0, { newWindow: true });
  toast(`${entries.length} AI result${entries.length === 1 ? '' : 's'} opened (not saved yet).`);
}

/** A labeled picture grid (service name, time) for Compare Providers. */
export function labeledGrid(items: { raster: Raster; label: string }[], cell = 512): Raster {
  const cols = Math.min(3, items.length), rows = Math.ceil(items.length / cols), cap = 28, gap = 12;
  const c = document.createElement('canvas'); c.width = cols * (cell + gap) + gap; c.height = rows * (cell + cap + gap) + gap;
  const x = c.getContext('2d')!; x.fillStyle = '#202020'; x.fillRect(0, 0, c.width, c.height); x.imageSmoothingQuality = 'high';
  items.forEach((it, i) => {
    const col = i % cols, row = Math.floor(i / cols), x0 = gap + col * (cell + gap), y0 = gap + row * (cell + cap + gap);
    const k = Math.min(cell / it.raster.width, cell / it.raster.height), w = it.raster.width * k, hh = it.raster.height * k;
    x.drawImage(rasterCanvas(it.raster), x0 + (cell - w) / 2, y0 + (cell - hh) / 2, w, hh);
    x.fillStyle = '#eee'; x.font = '16px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'top'; x.fillText(it.label, x0 + cell / 2, y0 + cell + 6, cell);
  });
  const id = x.getImageData(0, 0, c.width, c.height);
  return { width: c.width, height: c.height, data: id.data as Uint8ClampedArray<ArrayBuffer> };
}

export const promptField = (key: string, label: string, value = '', placeholder = ''): Field => ({ key, label, type: 'textarea', value, rows: 3, placeholder, autofocus: true });
export const info = (html: string): Field => ({ key: `i${Math.random().toString(36).slice(2, 6)}`, type: 'info', html });
export const el = h;
