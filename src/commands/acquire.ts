/**
 * Open and Repair, Open URL, Screen Capture and Camera Capture (M2). Repair runs the app's tolerant
 * readers and rebuilds JPEG files from their coefficients; capture uses getDisplayMedia / getUserMedia
 * (the desktop answers getDisplayMedia with the screen through Electron's display-media handler).
 */
import { def } from './registry';
import type { App } from '../app';
import { openDialog, toast, promptDialog } from '../ui/dialog';
import { Folder, entryFromBytes } from '../picture/folder';
import { sniff, formatFromName, encodeCanvas, decodePicture } from '../codecs/registry';
import { repairJpeg, isJpeg } from '../codecs/jpegLossless';
import { decodePngTolerant, isPng } from '../codecs/png';
import { decodeGif, isGif } from '../codecs/gif';
import { findEmbeddedJpegs } from '../codecs/rawpreview';
import { openDocuments, fetchPicture, isDesktop, isCapacitor } from '../platform/native';
import { fmtSize } from '../ui/shell';
import { h } from '../ui/dom';

interface RepairStep { method: string; result: string }

/** Every recovery method that applies to the bytes; the best picture to open, and the steps taken. */
export async function repairBytes(u8: Uint8Array, name: string): Promise<{ steps: RepairStep[]; bytes: Uint8Array | null; outName: string; percent: number | null }> {
  const steps: RepairStep[] = [];
  const fmt = sniff(u8, name), byName = formatFromName(name);
  steps.push({ method: 'Identify', result: fmt ? `${fmt.label} by content${byName && byName.id !== fmt.id ? ` (the name says ${byName.label})` : ''}` : byName ? `${byName.label} by name only; the content is not recognized` : 'format not recognized' });
  const base = name.replace(/\.[^.]+$/, '');
  if (isJpeg(u8)) {
    try {
      const r = repairJpeg(u8);
      const pct = r.totalUnits ? Math.round((100 * r.decodedUnits) / r.totalUnits) : 100;
      steps.push({ method: 'Rebuild JPEG from its coefficients', result: `${r.decodedUnits} of ${r.totalUnits} blocks decoded (${pct}%); ${r.warnings.length ? r.warnings.join('; ') : 'no damage found'}; written as a complete baseline file (${fmtSize(r.bytes.length)})` });
      return { steps, bytes: r.bytes, outName: `${base} (repaired).jpg`, percent: pct };
    } catch (e: any) {
      steps.push({ method: 'Rebuild JPEG from its coefficients', result: `failed: ${e?.message || e}` });
      const previews = findEmbeddedJpegs(u8).filter((p) => p.offset > 0);
      if (previews.length) { const p = previews[0]; steps.push({ method: 'Embedded preview (EXIF thumbnail or MPF picture)', result: `${p.width} × ${p.height} JPEG found at byte ${p.offset}` }); return { steps, bytes: u8.slice(p.offset, p.offset + p.length), outName: `${base} (preview).jpg`, percent: null }; }
    }
  } else if (isPng(u8)) {
    try {
      const r = decodePngTolerant(u8);
      const pct = r.rowsTotal ? Math.round((100 * r.rowsDecoded) / r.rowsTotal) : 100;
      steps.push({ method: 'Tolerant PNG decode (CRCs ignored, inflate to the damage)', result: `${r.rowsDecoded} of ${r.rowsTotal} rows (${pct}%); ${r.warnings.length ? r.warnings.join('; ') : 'no damage found'}` });
      const c = document.createElement('canvas'); c.width = r.pages[0].width; c.height = r.pages[0].height;
      c.getContext('2d')!.putImageData(new ImageData(r.pages[0].frames[0].raster.data, c.width, c.height), 0, 0);
      const blob = await encodeCanvas(c, 'png');
      return { steps, bytes: new Uint8Array(await blob.arrayBuffer()), outName: `${base} (repaired).png`, percent: pct };
    } catch (e: any) { steps.push({ method: 'Tolerant PNG decode', result: `failed: ${e?.message || e}` }); }
  } else if (isGif(u8)) {
    try {
      const r = decodeGif(u8);
      steps.push({ method: 'Tolerant GIF decode (frames until the damage, LZW resync)', result: `${r.pages[0].frames.length} frame(s); ${r.warnings.length ? r.warnings.join('; ') : 'no damage found'}` });
      return { steps, bytes: u8, outName: name, percent: r.warnings.length ? null : 100 };
    } catch (e: any) { steps.push({ method: 'Tolerant GIF decode', result: `failed: ${e?.message || e}` }); }
  }
  // Anything else: the normal decoder (own readers are tolerant), then carved previews.
  try {
    const pic = await decodePicture(u8, entryFromBytes(name, u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer));
    steps.push({ method: `Decode as ${pic.format.label}`, result: pic.warnings.length ? pic.warnings.join('; ') : 'opened without problems' });
    pic.release();
    return { steps, bytes: u8, outName: name, percent: pic.warnings.length ? null : 100 };
  } catch (e: any) { steps.push({ method: 'Decode', result: `failed: ${e?.message || e}` }); }
  const previews = findEmbeddedJpegs(u8);
  if (previews.length) { const p = previews[0]; steps.push({ method: 'Carve an embedded JPEG', result: `${p.width} × ${p.height} JPEG at byte ${p.offset}` }); return { steps, bytes: u8.slice(p.offset, p.offset + p.length), outName: `${base} (carved).jpg`, percent: null }; }
  steps.push({ method: 'Carve', result: 'no complete JPEG inside the file' });
  return { steps, bytes: null, outName: name, percent: 0 };
}

def([
  {
    id: 'file.openRepair', icon: 'healing', noRecord: true,
    tip: 'Runs every recovery method on a damaged file and opens what could be read',
    run: async (app, arg?: { name: string; data: ArrayBuffer }) => {
      let name: string, u8: Uint8Array;
      if (arg?.data) { name = arg.name; u8 = new Uint8Array(arg.data); }
      else if (app.picture && app.picture.warnings.length) { name = app.picture.name; u8 = app.picture.bytes; }
      else if (app.tab.error && app.tab.entry) { name = app.tab.entry.name; u8 = new Uint8Array(await app.tab.entry.read()); }
      else { const files = await openDocuments('*/*', ['*/*'], false); if (!files.length) return; name = files[0].name; u8 = new Uint8Array(files[0].data); }
      const r = await repairBytes(u8, name);
      const table = h('table', { class: 'ql-stats qn-info' }, ...r.steps.map((s) => h('tr', null, h('td', null, s.method), h('td', null, s.result))));
      const summary = r.bytes ? (r.percent === 100 ? `${name} is intact; nothing needed repair.` : r.percent !== null ? `${r.percent}% of ${name} could be read. The repaired picture is opened unsaved; Save As writes it under a new name.` : `A picture was recovered from ${name}; it is opened unsaved.`) : `Nothing could be recovered from ${name}.`;
      const ok = await openDialog({ title: 'Open and Repair', wide: true, content: h('div', null, h('p', { class: 'ql-help' }, summary), table), ok: r.bytes ? 'Open' : false, cancel: 'Close' });
      if (!ok || !r.bytes) return;
      await app.openFolder(new Folder([entryFromBytes(r.outName, r.bytes.buffer.slice(r.bytes.byteOffset, r.bytes.byteOffset + r.bytes.byteLength) as ArrayBuffer)], 'Repaired'), 0, { newWindow: true });
    },
  },
  {
    id: 'file.openUrl', icon: 'link', noRecord: true,
    tip: 'Downloads a picture from the web and opens it',
    run: async (app) => {
      const url = await promptDialog('Open URL', 'Address of the picture', '', { placeholder: 'https://…' });
      if (!url) return;
      toast('Downloading…', { ms: 2000 });
      try {
        const f = await fetchPicture(url.trim());
        await app.openFolder(new Folder([entryFromBytes(f.name, f.data)], 'Web'), 0, { newWindow: true });
      } catch (e: any) {
        toast(isDesktop() ? `Could not open the address: ${e?.message || e}` : `Could not open the address: ${e?.message || e}. In a browser the site must allow cross-origin reads; the desktop app has no such limit.`, { ms: 8000 });
      }
    },
  },
  {
    id: 'file.capture', icon: 'screenshot_monitor', noRecord: true, isEnabled: () => !isCapacitor() && !!(navigator.mediaDevices as any)?.getDisplayMedia,
    tip: 'Captures the screen or a window (after an optional delay) into a new picture',
    run: async (app) => {
      const r = await openDialog({ title: 'Screen Capture', ok: 'Capture', fields: [
        { key: 'delay', label: 'Delay (seconds)', type: 'number', min: 0, max: 60, value: 0, half: true },
        { key: 'hide', label: 'Hide Anne\'s Lens while capturing', type: 'checkbox', value: true, half: true },
        { key: 'i', type: 'info', label: isDesktop() ? 'The whole screen is captured. The cursor is not included.' : 'The browser asks which screen, window or tab to share; one frame is taken.' },
      ] });
      if (!r) return;
      app.ui.hideBackstage();
      const stream: MediaStream = await (navigator.mediaDevices as any).getDisplayMedia({ video: { frameRate: 5 }, audio: false, preferCurrentTab: false });
      try {
        if (r.hide && isDesktop()) { const { desktopBridge } = await import('../platform/native'); await desktopBridge()!.minimize(); }
        await new Promise((res) => setTimeout(res, Math.max(r.hide ? 400 : 0, (+r.delay || 0) * 1000)));
        const bytes = await grabFrame(stream);
        await app.openFolder(new Folder([entryFromBytes(`Screen capture ${stamp()}.png`, bytes)], 'Captures'), 0, { newWindow: true });
      } finally { for (const t of stream.getTracks()) t.stop(); }
    },
  },
  {
    id: 'file.captureCamera', icon: 'photo_camera', noRecord: true, isEnabled: () => !!navigator.mediaDevices?.getUserMedia,
    tip: 'Takes a picture with the device camera',
    run: async (app) => {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 4096 }, height: { ideal: 3072 } }, audio: false });
      try {
        const video = document.createElement('video');
        video.srcObject = stream; video.muted = true; video.playsInline = true;
        await video.play();
        const view = h('div', { class: 'ql-camera' }, video);
        const ok = await openDialog({ title: 'Camera Capture', wide: true, content: view, ok: 'Take Picture', cancel: 'Cancel' });
        if (!ok) return;
        const c = document.createElement('canvas'); c.width = video.videoWidth || 1280; c.height = video.videoHeight || 720;
        c.getContext('2d')!.drawImage(video, 0, 0);
        const blob = await encodeCanvas(c, 'png');
        await app.openFolder(new Folder([entryFromBytes(`Camera ${stamp()}.png`, await blob.arrayBuffer())], 'Captures'), 0, { newWindow: true });
      } finally { for (const t of stream.getTracks()) t.stop(); }
    },
  },
]);

const stamp = () => { const d = new Date(), p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; };

async function grabFrame(stream: MediaStream): Promise<ArrayBuffer> {
  const video = document.createElement('video');
  video.srcObject = stream; video.muted = true; video.playsInline = true;
  await video.play();
  await new Promise((res) => { if (video.videoWidth) res(null); else video.onloadedmetadata = () => res(null); });
  await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
  const c = document.createElement('canvas'); c.width = video.videoWidth; c.height = video.videoHeight;
  c.getContext('2d')!.drawImage(video, 0, 0);
  video.pause(); video.srcObject = null;
  return (await encodeCanvas(c, 'png')).arrayBuffer();
}

export { App };
