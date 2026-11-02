/**
 * File ▸ Export: Send to Anne's Folio (a PDF), Send to Anne's Stage (a deck: one picture per slide,
 * captions as titles), Insert into Anne's Pen (a document: the pictures with their captions and
 * alt text), Send to Anne's Press (an IDML layout); Create ▸ Photo Book in Anne's Press (an IDML
 * book: title page, facing pages, 1, 2 or 4 pictures a page). On Android the file opens straight in the suite app; elsewhere (or when the app is
 * not installed) it is saved for opening there or in any PDF, presentation or word processor.
 */
import { def } from './registry';
import type { App } from '../app';
import type { Entry } from '../picture/folder';
import type { Picture } from '../picture/model';
import { openDialog, toast, confirmDialog } from '../ui/dialog';
import { decodePicture, encodeCanvas } from '../codecs/registry';
import { readMeta } from '../picture/metadata';
import { inputsOf } from './batch';
import { buildDocx, buildPptx, type DocPicture } from '../suite/ooxml';
import { makePdf, PAPER_PT, type PdfPage } from '../codecs/pdfwrite';
import { buildIdml, gridPages, BOOK_SIZES, type IdmlImage } from '../suite/idml';
import { openInQuillApp, saveAs, type QuillApp } from '../platform/native';

const has = (app: App) => !!app.picture;
const base = (n: string) => n.replace(/\.[^.]+$/, '');
const IDML = 'application/vnd.adobe.indesign-idml-package', DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

/** The pictures to send: the marked ones, else the current one (or the whole folder when `folder`). */
function targets(app: App, folder = false): Entry[] {
  const r = inputsOf(app);
  if (r.marked) return r.entries;
  return folder ? r.entries : app.picture ? [app.picture.entry] : [];
}

/** One picture as document-ready bytes (the shown picture with its edits for the current one; JPEG and PNG files as they are). */
export async function docPicture(app: App, e: Entry, opts: { jpegOnly?: boolean } = {}): Promise<DocPicture> {
  const cur = app.picture && app.picture.entry === e ? app.picture : null;
  const pic: Picture = cur || (await decodePicture(new Uint8Array(await e.read()), e));
  try {
    const meta = await readMeta(app, e).catch(() => null);
    const p = meta?.props || {};
    const asIs = !cur || (cur.version === 0 && !app.tab.dirty);
    let data: Uint8Array, mime: DocPicture['mime'];
    const fmt = pic.format.id;
    if (asIs && !pic.orientationApplied && (fmt === 'jpeg' || (fmt === 'png' && !opts.jpegOnly))) { data = pic.bytes; mime = fmt === 'jpeg' ? 'image/jpeg' : 'image/png'; }
    else {
      const usePng = !opts.jpegOnly && pic.current.hasAlpha;
      const blob = await encodeCanvas(pic.frameCanvas(), usePng ? 'png' : 'jpeg', 0.92);
      data = new Uint8Array(await blob.arrayBuffer()); mime = usePng ? 'image/png' : 'image/jpeg';
    }
    return { data, mime, width: pic.width, height: pic.height, dpi: pic.current.dpi?.[0], name: e.name, caption: p.description || undefined, alt: p.altText || p.description || undefined, title: p.title || undefined };
  } finally { if (!cur) pic.release(); }
}

/** Opens the file in the suite app (Android), or saves it for opening there. */
async function deliver(target: QuillApp, data: Uint8Array, name: string, mime: string, kind: string): Promise<void> {
  const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  const r = await openInQuillApp(target, buf, name, mime);
  if (r.opened) { toast(`Sent to ${target}.`); return; }
  const why = r.reason === 'not-installed' ? `${target} is not installed on this device` : r.reason === 'error' ? `${target} could not be opened (${r.message})` : `Sending straight to ${target} works in the Android app`;
  const s = await saveAs(new Blob([buf], { type: mime }), name);
  toast(s ? `${why}; saved ${s.name}: open it in ${target} or any ${kind}.` : `${why}; nothing was saved.`, { ms: 6000 });
}

async function confirmMany(n: number): Promise<boolean> { return n <= 60 || confirmDialog('Many Pictures', `Send ${n} pictures? Mark the ones you want in the thumbnails to send fewer.`, 'Send'); }

const idmlItems = async (app: App, es: Entry[]) => { const out: { image: IdmlImage; caption?: string }[] = []; for (const e of es) { const d = await docPicture(app, e); out.push({ image: { data: d.data, mime: d.mime, width: d.width, height: d.height, name: d.name, alt: d.alt, ppi: d.dpi }, caption: d.caption }); } return out; };
const sizeOptions = (keys: string[]) => keys.map((k) => ({ value: k, label: BOOK_SIZES[k].label }));

def([
  {
    id: 'file.export.press', icon: 'auto_stories', noRecord: true, isEnabled: has, tip: 'The marked pictures (or the folder) as an IDML layout for Anne\'s Press (also opens in InDesign, Affinity Publisher and Scribus): pictures embedded, captions in a Caption style, alt text kept',
    run: async (app, arg?: { size?: string; perPage?: 1 | 2 | 4; captions?: boolean }) => {
      const es = targets(app, true); if (!es.length || !(await confirmMany(es.length))) return;
      let v = arg;
      if (!v) { const r = await openDialog({ title: 'Send to Anne\'s Press', ok: 'Send', fields: [{ key: 'i', type: 'info', label: `${es.length} picture${es.length === 1 ? '' : 's'}.` }, { key: 'size', label: 'Page size', type: 'select', options: sizeOptions(['letter', 'a4', 'land11', 'a4land', 'square8']), value: 'letter' }, { key: 'perPage', label: 'Pictures per page', type: 'select', options: [{ value: 1, label: 'One' }, { value: 2, label: 'Two' }, { value: 4, label: 'Four' }], value: 1 }, { key: 'captions', label: 'Captions under the pictures', type: 'checkbox', value: true }] }); if (!r) return; v = { size: String(r.size), perPage: +r.perPage as 1 | 2 | 4, captions: !!r.captions }; }
      const sz = BOOK_SIZES[v.size || 'letter'] || BOOK_SIZES.letter, name = base(es.length === 1 ? es[0].name : app.folder.name || 'Pictures');
      const pages = gridPages(await idmlItems(app, es), { width: sz.w, height: sz.h, perPage: v.perPage || 1, captions: v.captions !== false });
      await deliver('Anne\'s Press', buildIdml({ width: sz.w, height: sz.h, title: name, pages }), `${name}.idml`, IDML, 'layout program (InDesign, Affinity Publisher, Scribus)');
    },
  },
  {
    id: 'create.photoBook', icon: 'menu_book', noRecord: true, isEnabled: has, tip: 'A photo book as an IDML layout for Anne\'s Press: title page, facing pages, one, two or four pictures a page with captions',
    run: async (app, arg?: { size?: string; perPage?: 1 | 2 | 4; captions?: boolean; title?: string; subtitle?: string; facing?: boolean }) => {
      const es = targets(app, true); if (!es.length || !(await confirmMany(es.length))) return;
      let v = arg;
      if (!v) { const r = await openDialog({ title: 'Photo Book in Anne\'s Press', ok: 'Make Book', fields: [{ key: 'i', type: 'info', label: `${es.length} picture${es.length === 1 ? '' : 's'}, in the folder's order (mark pictures to choose).` }, { key: 'title', label: 'Title', type: 'text', value: app.folder.name || 'Photo Book' }, { key: 'subtitle', label: 'Subtitle', type: 'text', value: '' }, { key: 'size', label: 'Book size', type: 'select', options: sizeOptions(['square8', 'square12', 'land11', 'land10', 'letter', 'a4', 'a4land']), value: 'square8' }, { key: 'perPage', label: 'Pictures per page', type: 'select', options: [{ value: 1, label: 'One' }, { value: 2, label: 'Two' }, { value: 4, label: 'Four' }], value: 1 }, { key: 'facing', label: 'Facing pages (spreads)', type: 'checkbox', value: true }, { key: 'captions', label: 'Captions', type: 'checkbox', value: true }] }); if (!r) return; v = { size: String(r.size), perPage: +r.perPage as 1 | 2 | 4, captions: !!r.captions, title: String(r.title || ''), subtitle: String(r.subtitle || ''), facing: !!r.facing }; }
      const sz = BOOK_SIZES[v.size || 'square8'] || BOOK_SIZES.square8, title = (v.title || app.folder.name || 'Photo Book').trim();
      const pages = gridPages(await idmlItems(app, es), { width: sz.w, height: sz.h, margin: 45, perPage: v.perPage || 1, captions: v.captions !== false, coverTitle: title, coverSubtitle: v.subtitle || undefined });
      await deliver('Anne\'s Press', buildIdml({ width: sz.w, height: sz.h, margin: 45, facing: v.facing !== false, title, pages }), `${title.replace(/[\\/:*?"<>|]/g, '_')} (photo book).idml`, IDML, 'layout program (InDesign, Affinity Publisher, Scribus)');
    },
  },
  {
    id: 'file.export.folio', icon: 'picture_as_pdf', noRecord: true, isEnabled: has, tip: 'A PDF of the marked pictures (or this one) with their captions, opened in Anne\'s Folio',
    run: async (app, arg?: { paper?: string; captions?: boolean }) => {
      const es = targets(app); if (!es.length || !(await confirmMany(es.length))) return;
      let v = arg;
      if (!v) { const r = await openDialog({ title: 'Send to Anne\'s Folio', ok: 'Send', fields: [{ key: 'i', type: 'info', label: `${es.length} picture${es.length === 1 ? '' : 's'}, one per page.` }, { key: 'paper', label: 'Paper', type: 'select', options: [{ value: 'letter', label: 'Letter' }, { value: 'a4', label: 'A4' }, { value: 'picture', label: 'Each picture\'s own size' }], value: 'letter' }, { key: 'captions', label: 'Captions under the pictures', type: 'checkbox', value: true }] }); if (!r) return; v = { paper: String(r.paper), captions: !!r.captions }; }
      const pages: PdfPage[] = [];
      for (const e of es) {
        const d = await docPicture(app, e, { jpegOnly: true });
        const paper = PAPER_PT[v.paper || 'letter'];
        pages.push({ image: d.data, width: d.width, height: d.height, caption: v.captions !== false ? d.caption : undefined, ...(paper ? { pageWidth: d.width > d.height ? paper[1] : paper[0], pageHeight: d.width > d.height ? paper[0] : paper[1], margin: 36, fit: 'contain' as const } : {}) });
      }
      await deliver('Anne\'s Folio', makePdf(pages, { title: es.length === 1 ? es[0].name : app.folder.name, producer: 'Anne\'s Lens' }), `${base(es.length === 1 ? es[0].name : app.folder.name || 'Pictures')}.pdf`, 'application/pdf', 'PDF reader');
    },
  },
  {
    id: 'file.export.stage', icon: 'slideshow', noRecord: true, isEnabled: has, tip: 'The marked pictures (or the folder) as a deck for Anne\'s Stage: one picture per slide, captions as titles, alt text kept',
    run: async (app, arg?: { titles?: boolean }) => {
      const es = targets(app, true); if (!es.length || !(await confirmMany(es.length))) return;
      let v = arg;
      if (!v) { const r = await openDialog({ title: 'Send to Anne\'s Stage', ok: 'Send', fields: [{ key: 'i', type: 'info', label: `${es.length} picture${es.length === 1 ? '' : 's'}, one per slide (16:9).` }, { key: 'titles', label: 'Captions as slide titles', type: 'checkbox', value: true }] }); if (!r) return; v = { titles: !!r.titles }; }
      const pics: DocPicture[] = []; for (const e of es) pics.push(await docPicture(app, e));
      await deliver('Anne\'s Stage', buildPptx(pics, { title: app.folder.name, captionsAsTitles: v.titles !== false }), `${base(app.folder.name || 'Pictures')}.pptx`, PPTX, 'presentation app');
    },
  },
  {
    id: 'file.export.pen', icon: 'description', noRecord: true, isEnabled: has, tip: 'The picture (or the marked ones) with caption and alt text as a document for Anne\'s Pen',
    run: async (app, arg?: { number?: boolean; paper?: 'letter' | 'a4' }) => {
      const es = targets(app); if (!es.length || !(await confirmMany(es.length))) return;
      let v = arg;
      if (!v) { const r = await openDialog({ title: 'Insert into Anne\'s Pen', ok: 'Send', fields: [{ key: 'i', type: 'info', label: `${es.length} picture${es.length === 1 ? '' : 's'} with caption and alt text (Metadata ▸ Title and Caption, AI ▸ Alt Text).` }, { key: 'number', label: 'Number as figures (Figure 1, Figure 2…)', type: 'checkbox', value: es.length > 1 }, { key: 'paper', label: 'Paper', type: 'select', options: [{ value: 'letter', label: 'Letter' }, { value: 'a4', label: 'A4' }], value: 'letter' }] }); if (!r) return; v = { number: !!r.number, paper: r.paper }; }
      const pics: DocPicture[] = []; for (const e of es) pics.push(await docPicture(app, e));
      const name = es.length === 1 ? base(es[0].name) : app.folder.name || 'Pictures';
      await deliver('Anne\'s Pen', buildDocx(pics, { numberFigures: !!v.number, paper: v.paper }), `${name}.docx`, DOCX, 'word processor');
    },
  },
]);
