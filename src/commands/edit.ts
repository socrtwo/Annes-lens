/** Edit commands: undo, redo, clipboard. */
import { def } from './registry';
import type { App } from '../app';
import { toast } from '../ui/dialog';
import { encodeCanvas } from '../codecs/registry';
import { Folder, entryFromBytes } from '../picture/folder';

async function clipboardImage(): Promise<Blob | null> {
  try {
    const items = await (navigator.clipboard as any).read?.();
    for (const it of items || []) { const t = it.types.find((x: string) => x.startsWith('image/')); if (t) return await it.getType(t); }
  } catch { /* no image access */ }
  return null;
}

export async function pasteAsNew(app: App, blob?: Blob | null): Promise<void> {
  const b = blob || (await clipboardImage());
  if (!b) {
    if (app.clip) { const data = await encodeCanvas(app.clip.frameCanvas(), 'png'); const buf = await data.arrayBuffer(); await app.openFolder(new Folder([entryFromBytes('Pasted picture.png', buf)], 'Clipboard'), 0, { newWindow: true }); return; }
    toast('The clipboard has no picture (or this platform does not allow reading it; try Ctrl+V on the picture).');
    return;
  }
  const buf = await b.arrayBuffer();
  const ext = (b.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
  await app.openFolder(new Folder([entryFromBytes(`Pasted picture.${ext}`, buf)], 'Clipboard'), 0, { newWindow: true });
}

def([
  { id: 'edit.undo', icon: 'undo', popular: true, noRecord: true, isEnabled: (app) => !!app.tab?.canUndo, run: (app) => { if (!app.tab.undo()) toast('Nothing to undo.'); } },
  { id: 'edit.redo', icon: 'redo', noRecord: true, isEnabled: (app) => !!app.tab?.canRedo, run: (app) => { if (!app.tab.redo()) toast('Nothing to redo.'); } },
  {
    id: 'edit.copy', icon: 'content_copy', popular: true, noRecord: true, isEnabled: (app) => !!app.picture,
    run: async (app) => {
      const pic = app.picture!;
      app.clip = pic;
      try {
        const blob = await encodeCanvas(pic.frameCanvas(), 'png');
        await (navigator.clipboard as any).write([new (window as any).ClipboardItem({ 'image/png': blob })]);
        toast('Picture copied');
      } catch (e: any) { toast(`Copied inside Anne's Lens only (the system clipboard refused: ${e?.message || e})`); }
    },
  },
  { id: 'edit.paste', icon: 'content_paste', popular: true, noRecord: true, tip: 'Opens the clipboard picture in a new window (pasting into a selection comes with the Edit tab)', run: (app) => pasteAsNew(app) },
  { id: 'edit.pasteAsNew', icon: 'add_photo_alternate', noRecord: true, run: (app) => pasteAsNew(app) },
]);
