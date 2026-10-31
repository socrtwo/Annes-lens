/**
 * Tools: Recognize Text (OCR), OCR to Anne's Pen, Read QR Code or Barcode. All three run on the
 * device; nothing is sent anywhere (language data downloads once when a language is first used).
 */
import { def } from './registry';
import type { App } from '../app';
import type { Raster } from '../codecs/raster';
import { openDialog, toast, type Field } from '../ui/dialog';
import { h } from '../ui/dom';
import { frameRaster } from '../picture/edit';
import { crop } from '../picture/ops';
import { viewState, ocrMatch } from '../ui/overlays';
import { recognize, terminateOcr, OCR_LANGS, type OcrResult, type OcrLayout } from '../picture/ocr';
import { readCodes, classify, parseWifi, type CodeResult } from '../picture/barcode';
import { patchXmp, forTargets } from '../picture/metadata';
import { writeClipboardText, openInQuillApp, saveAs, openExternal } from '../platform/native';
import { withJob } from '../ai';
import { confirmDialog } from '../ui/dialog';

const has = (app: App) => !!app.picture;
const base = (n: string) => n.replace(/\.[^.]+$/, '');
const redraw = (app: App) => { app.viewer.draw(); app.refresh(); };

/** The selected area (or the whole picture) and its offset in the picture. */
function area(app: App): { r: Raster; ox: number; oy: number; sel: boolean } {
  const full = frameRaster(app.picture!.currentFrame), s = app.tab.selection;
  return s ? { r: crop(full, s), ox: s.x, oy: s.y, sel: true } : { r: full, ox: 0, oy: 0, sel: false };
}
const shift = (res: OcrResult, ox: number, oy: number): OcrResult => ({ ...res, words: res.words.map((w) => ({ ...w, bbox: { x0: w.bbox.x0 + ox, y0: w.bbox.y0 + oy, x1: w.bbox.x1 + ox, y1: w.bbox.y1 + oy } })) });

const langOptions = OCR_LANGS.map((l) => ({ value: l.id, label: l.label }));
const ocrFields = (app: App): Field[] => [
  { key: 'lang', label: 'Language', type: 'select', options: langOptions, value: app.prefs.ocrLangs[0] || 'eng', half: true },
  { key: 'lang2', label: 'Second language', type: 'select', options: [{ value: '', label: 'None' }, ...langOptions], value: app.prefs.ocrLangs[1] || '', half: true },
  { key: 'layout', label: 'Layout', type: 'select', options: [{ value: 'auto', label: 'Automatic (pages, columns)' }, { value: 'block', label: 'One block of text' }, { value: 'column', label: 'One column' }, { value: 'line', label: 'One line' }, { value: 'sparse', label: 'Scattered text (labels, signs)' }], value: app.prefs.ocrLayout, half: true },
  { key: 'enhance', label: 'Enhance for OCR (gray, enlarge small text)', type: 'checkbox', value: true, half: true },
];
const langsOf = (v: Record<string, any>) => [...new Set([v.lang, v.lang2].filter(Boolean))] as string[];

async function runOcr(app: App, v: Record<string, any>): Promise<OcrResult | null> {
  const langs = langsOf(v); app.prefs.ocrLangs = langs; app.prefs.ocrLayout = v.layout as OcrLayout; app.savePrefs();
  const { r, ox, oy } = area(app);
  return withJob(app, 'Recognize Text', async (status, signal) => {
    signal.addEventListener('abort', () => { void terminateOcr(); });
    const res = await recognize(r, { langs, layout: v.layout, enhance: !!v.enhance, progress: (st, p) => status(`${st}${p ? ` ${Math.round(p * 100)}%` : ''}`) });
    if (signal.aborted) return null;
    return shift(res, ox, oy);
  });
}

async function sendToPen(app: App, text: string): Promise<void> {
  const name = `${base(app.picture?.name || 'OCR')} (text).txt`;
  const data = new TextEncoder().encode(text);
  const r = await openInQuillApp('Anne\'s Pen', data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer, name, 'text/plain');
  if (r.opened) { toast('The text was sent to Anne\'s Pen.'); return; }
  await writeClipboardText(text);
  const save = await confirmDialog('Send to Anne\'s Pen', `${r.reason === 'not-installed' ? 'Anne\'s Pen is not installed on this device. ' : 'Sending straight to Anne\'s Pen works in the Android app. '}The text is on the clipboard: paste it into Anne's Pen. Save it as a text file too?`, 'Save text file…', 'Close');
  if (save) { const s = await saveAs(new Blob([text], { type: 'text/plain' }), name); toast(s ? `Saved ${s.name}.` : 'Not saved.'); }
}

async function ocrResultDialog(app: App, res: OcrResult): Promise<void> {
  viewState.ocr = { show: true, words: res.words, query: '' }; redraw(app);
  let keep = false;
  const low = res.words.filter((w) => w.conf < 60).length;
  await openDialog({ title: 'Recognized Text', wide: true, ok: 'Close', cancel: false, help: `${res.words.length} word${res.words.length === 1 ? '' : 's'} in ${res.lines} line${res.lines === 1 ? '' : 's'}, ${res.confidence}% confidence (${res.langs}, ${(res.ms / 1000).toFixed(1)} s). Boxes on the picture: blue words are confident, orange ones (${low}) are worth checking.`, fields: [
    { key: 'text', label: 'Text (you can correct it here)', type: 'textarea', rows: Math.min(16, Math.max(5, res.text.split('\n').length + 1)), value: res.text },
    { key: 'q', label: 'Find on the picture', type: 'text', value: '', half: true, placeholder: 'a word or name' },
    { key: 'show', label: 'Show the word boxes', type: 'checkbox', value: true, half: true },
    { key: 'keep', label: 'Keep the boxes after closing', type: 'checkbox', value: false, half: true },
  ], onChange: (v, ctl, key) => {
    if (key === 'keep') keep = !!v.keep;
    if (key === 'q' || key === 'show') { viewState.ocr.query = String(v.q || ''); viewState.ocr.show = !!v.show; redraw(app); const n = res.words.filter((w) => ocrMatch(w.text, viewState.ocr.query)).length; if (key === 'q') (ctl.body.querySelector('.qn-ocr-count') as HTMLElement | null)?.replaceChildren(document.createTextNode(viewState.ocr.query.trim() ? `${n} match${n === 1 ? '' : 'es'}` : '')); }
  }, onOpen: (ctl) => { ctl.body.appendChild(h('p', { class: 'ql-help qn-ocr-count' })); }, buttons: [
    { label: 'Copy', onClick: async (v) => { await writeClipboardText(String(v.text || '')); toast('Text copied.'); } },
    { label: 'Save as caption', onClick: async (v) => { await forTargets(app, 'Caption saved', (e) => patchXmp(app, e, { description: String(v.text || '').trim() })); } },
    { label: 'Save text file…', onClick: async (v) => { const s = await saveAs(new Blob([String(v.text || '')], { type: 'text/plain' }), `${base(app.picture!.name)}.txt`); toast(s ? `Saved ${s.name}.` : 'Not saved.'); } },
    { label: 'Send to Anne\'s Pen', onClick: (v) => sendToPen(app, String(v.text || '')) },
  ] });
  if (!keep) { viewState.ocr.show = false; viewState.ocr.words = []; viewState.ocr.query = ''; redraw(app); }
}

def([
  {
    id: 'tools.ocr', icon: 'document_scanner', noRecord: true, popular: true, isEnabled: has, tip: 'Recognizes text in the picture or the selection, on the device: find words on the picture, copy, save as a caption or a text file, send to Anne\'s Pen',
    run: async (app) => {
      const v = await openDialog({ title: 'Recognize Text (OCR)', ok: 'Recognize', help: `${app.tab.selection ? 'The selection is read.' : 'The whole picture is read; select an area to read only that.'} Runs on this device; each language downloads once (English is about 3 MB).`, fields: ocrFields(app) });
      if (!v) return;
      const res = await runOcr(app, v);
      if (!res) return;
      if (!res.text) { toast('No text was found. Try the Enhance option, another layout, or select the text area.', { ms: 7000 }); return; }
      await ocrResultDialog(app, res);
    },
  },
  {
    id: 'tools.ocrToPen', icon: 'edit_note', noRecord: true, isEnabled: has, tip: 'Recognizes the text (with the last OCR settings) and sends it to Anne\'s Pen, or puts it on the clipboard',
    run: async (app) => {
      const res = await runOcr(app, { lang: app.prefs.ocrLangs[0] || 'eng', lang2: app.prefs.ocrLangs[1] || '', layout: app.prefs.ocrLayout, enhance: true });
      if (!res) return;
      if (!res.text) { toast('No text was found.'); return; }
      await sendToPen(app, res.text);
    },
  },
  {
    id: 'tools.readCode', icon: 'qr_code_scanner', noRecord: true, isEnabled: has, tip: 'QR, Data Matrix, Aztec, PDF417 and the linear barcodes (EAN/UPC, Code 128 and others), read on the device',
    run: async (app) => {
      const { r, ox, oy } = area(app);
      const found = await withJob(app, 'Read Code', async () => readCodes(r));
      if (!found) return;
      const codes: CodeResult[] = found.map((c) => ({ ...c, corners: c.corners.map(([x, y]) => [x + ox, y + oy] as [number, number]) }));
      viewState.codes = codes; redraw(app);
      if (!codes.length) { toast('No code was found. Select the code (with a little margin) and try again.', { ms: 6000 }); viewState.codes = []; redraw(app); return; }
      const rows = codes.map((c, i) => {
        const kind = classify(c.text), wifi = kind === 'wifi' ? parseWifi(c.text) : null;
        const actions: HTMLElement[] = [h('button', { class: 'ql-btn', type: 'button', onclick: async () => { await writeClipboardText(c.text); toast('Copied.'); } }, 'Copy')];
        if (kind === 'url') actions.push(h('button', { class: 'ql-btn', type: 'button', onclick: async () => { if (await confirmDialog('Open link?', c.text, 'Open')) openExternal(c.text); } }, 'Open link…'));
        if (kind === 'contact') actions.push(h('button', { class: 'ql-btn', type: 'button', onclick: async () => { const s = await saveAs(new Blob([c.text], { type: 'text/vcard' }), 'contact.vcf'); toast(s ? `Saved ${s.name}.` : 'Not saved.'); } }, 'Save contact…'));
        if (wifi?.password) actions.push(h('button', { class: 'ql-btn', type: 'button', onclick: async () => { await writeClipboardText(wifi.password); toast('Password copied.'); } }, 'Copy password'));
        return h('div', { class: 'qn-ai-model' }, h('span', null, h('b', null, `${i + 1}. ${c.format}`), c.ecLevel ? ` (error correction ${c.ecLevel})` : '', h('br'), wifi ? `Wi-Fi network "${wifi.ssid}" (${wifi.type}${wifi.hidden ? ', hidden' : ''})` : c.text), h('span', null, ...actions));
      });
      await openDialog({ title: `Code${codes.length === 1 ? '' : 's'} Found`, content: h('div', null, ...rows), ok: 'Close', cancel: false, wide: true, help: 'Outlined on the picture. Links open only when you choose Open.' });
      viewState.codes = []; redraw(app);
    },
  },
]);
