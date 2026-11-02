/** Slideshow ▸ Background Music and Phone Remote. */
import { def } from './registry';
import type { App } from '../app';
import { openDialog, toast } from '../ui/dialog';
import { h, pickFile } from '../ui/dom';
import { desktopBridge, isDesktop, writeClipboardText } from '../platform/native';
import { listTracks, saveTracks, hookMusic, music, AUDIO_ACCEPT, MAX_BYTES, type Track } from '../picture/music';
import { show, start, stop, togglePause, next, previous, DEFAULT_SLIDESHOW } from '../picture/slideshow';
import { encodeQr, qrSvg } from '../codecs/qr';
import { propsOf } from '../picture/metadata';

hookMusic();
const S = (app: App) => ({ ...DEFAULT_SLIDESHOW, ...app.prefs.slideshow });
const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`;

/** Adds audio files to the music list (refusing what is not audio and keeping the total under 300 MB). */
export async function addTracks(files: File[]): Promise<{ added: number; skipped: string[] }> {
  const tracks = await listTracks(); let total = tracks.reduce((n, t) => n + t.size, 0); const skipped: string[] = []; let added = 0;
  for (const f of files) {
    if (!f.type.startsWith('audio/') && !/\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|weba)$/i.test(f.name)) { skipped.push(`${f.name} (not audio)`); continue; }
    if (total + f.size > MAX_BYTES) { skipped.push(`${f.name} (over the 300 MB music limit)`); continue; }
    tracks.push({ id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, name: f.name, type: f.type || 'audio/mpeg', size: f.size, blob: f });
    total += f.size; added++;
  }
  await saveTracks(tracks);
  return { added, skipped };
}

// Phone Remote ------------------------------------------------------------------------------------
const remote = { on: false, urls: [] as string[], timer: 0 as any, sig: '', thumbFor: '', thumb: '' };
function thumbOf(app: App): string {
  const p = app.picture; if (!p) return '';
  const key = `${p.name}|${p.version}`; if (key === remote.thumbFor) return remote.thumb;
  const src = p.frameCanvas(), k = Math.min(1, 480 / Math.max(src.width, src.height)), c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(src.width * k)); c.height = Math.max(1, Math.round(src.height * k)); c.getContext('2d')!.drawImage(src, 0, 0, c.width, c.height);
  remote.thumbFor = key; remote.thumb = c.toDataURL('image/jpeg', 0.7);
  return remote.thumb;
}
/** What the phone shows; sent when it changes. */
export function remoteState(app: App): Record<string, unknown> {
  const f = app.folder, p = app.picture, x = p ? propsOf(p.entry) : undefined;
  return { name: p?.name || '', index: f.index + 1, total: f.length, running: show.running, paused: show.paused, caption: x?.description || x?.title || '', thumb: thumbOf(app) };
}
function pushState(app: App): void {
  const d = desktopBridge(); if (!d || !remote.on) return;
  const s = remoteState(app), sig = `${s.name}|${s.index}|${s.running}|${s.paused}|${app.picture?.version}`;
  if (sig === remote.sig) return; remote.sig = sig;
  void d.remoteState(s).catch(() => undefined);
}
/** A command from the phone. */
export async function remoteCommand(app: App, cmd: string): Promise<void> {
  if (cmd === 'start') { if (!show.running) start(app, true); }
  else if (cmd === 'stop') { if (show.running) stop(app); }
  else if (cmd === 'pause') { if (show.running) togglePause(app); else start(app, true); }
  else if (cmd === 'next') { if (show.running) await next(app); else await app.exec('view.next'); }
  else if (cmd === 'previous') { if (show.running) await previous(app); else await app.exec('view.previous'); }
  setTimeout(() => pushState(app), 150);
}
let listening = false;

def([
  {
    id: 'show.music', icon: 'music_note', noRecord: true, tip: 'Music that plays during slideshows: your audio files, in order or shuffled, fading out at the end',
    run: async (app, arg?: { files?: File[]; on?: boolean; volume?: number; shuffle?: boolean; clear?: boolean }) => {
      if (arg) {
        if (arg.clear) await saveTracks([]);
        if (arg.files?.length) { const r = await addTracks(arg.files); if (r.skipped.length) toast(`Skipped: ${r.skipped.join(', ')}`, { ms: 4000 }); }
        app.prefs.slideshow = { ...S(app), ...(arg.on !== undefined ? { musicOn: arg.on } : {}), ...(arg.volume !== undefined ? { musicVolume: arg.volume } : {}), ...(arg.shuffle !== undefined ? { musicShuffle: arg.shuffle } : {}) }; app.savePrefs();
        return listTracks();
      }
      let tracks = await listTracks(); const s = S(app);
      const listEl = h('div', { class: 'ql-cmdlist qn-music-list' });
      const drawList = () => listEl.replaceChildren(...(tracks.length ? tracks.map((t, i) => h('div', { class: 'ql-cmdlist-row' }, h('span', null, `${i + 1}. ${t.name} · ${mb(t.size)}`), h('button', { class: 'ql-btn', type: 'button', 'aria-label': `Remove ${t.name}`, onclick: () => { tracks = tracks.filter((x) => x !== t); drawList(); } }, '✕'))) : [h('div', { class: 'ql-help' }, 'No music yet: Add Files…')]));
      drawList();
      let preview: HTMLAudioElement | null = null;
      const r = await openDialog({ title: 'Background Music', ok: 'Save', help: 'The files are kept by Anne\'s Lens on this device (up to 300 MB) and play while a slideshow runs; they pause with it and fade out at the end.', content: listEl, fields: [
        { key: 'on', label: 'Play music during slideshows', type: 'checkbox', value: s.musicOn || !tracks.length },
        { key: 'shuffle', label: 'Shuffle', type: 'checkbox', value: s.musicShuffle, half: true },
        { key: 'volume', label: 'Volume', type: 'range', min: 0, max: 100, value: Math.round(s.musicVolume * 100), half: true },
      ], buttons: [
        { label: 'Add Files…', onClick: async () => { const fs = await pickFile(AUDIO_ACCEPT, true); if (!fs.length) return; await saveTracks(tracks); const res = await addTracks(fs); tracks = await listTracks(); drawList(); if (res.skipped.length) toast(`Skipped: ${res.skipped.join(', ')}`, { ms: 4000 }); } },
        { label: 'Preview', onClick: (v) => { if (preview) { preview.pause(); preview = null; return; } const t = tracks[0]; if (!t) return; preview = new Audio(URL.createObjectURL(t.blob)); preview.volume = (+v.volume || 0) / 100; void preview.play(); setTimeout(() => { preview?.pause(); preview = null; }, 8000); } },
      ] });
      (preview as HTMLAudioElement | null)?.pause();
      if (!r) return;
      await saveTracks(tracks);
      app.prefs.slideshow = { ...S(app), musicOn: !!r.on, musicShuffle: !!r.shuffle, musicVolume: (+r.volume || 0) / 100 }; app.savePrefs();
      toast(tracks.length ? `${tracks.length} track${tracks.length === 1 ? '' : 's'} (${mb(tracks.reduce((n: number, t: Track) => n + t.size, 0))}); music ${r.on ? 'on' : 'off'} for slideshows.` : 'No music chosen.');
    },
  },
  {
    id: 'show.remote', icon: 'phonelink_ring', kind: 'toggle', noRecord: true, isEnabled: () => isDesktop(), isActive: () => remote.on, tip: 'Control the slideshow from a phone on the same network: scan the QR code (desktop app)',
    run: async (app, arg?: { port?: number; quiet?: boolean }) => {
      const d = desktopBridge();
      if (!d) { toast('The phone remote runs from the desktop app (it needs a small server on your network).'); return; }
      if (remote.on && !arg) { await d.remoteStop(); remote.on = false; clearInterval(remote.timer); app.refresh(); toast('Phone remote off.'); return; }
      const r = await d.remoteStart({ port: arg?.port });
      remote.on = true; remote.urls = r.urls; remote.sig = '';
      if (!listening) { listening = true; await (d as unknown as { addListener: (e: string, cb: (x: { cmd: string }) => void) => Promise<unknown> }).addListener('remoteCommand', (x) => { void remoteCommand(app, x.cmd); }); }
      clearInterval(remote.timer); remote.timer = setInterval(() => pushState(app), 1000); pushState(app);
      app.refresh();
      if (arg?.quiet) return r;
      const url = r.urls[0], qr = qrSvg(encodeQr(url, 'M'));
      await openDialog({ title: 'Phone Remote', ok: 'Close', cancel: false, help: 'The phone must be on the same network. Previous, Play/Pause, Next, Start and Stop work from it; it shows the picture and its caption. Turn the remote off with this command again.', content: h('div', { class: 'qn-remote-box' }, h('div', { class: 'qn-remote-qr', html: qr } as any), h('p', null, 'Scan with the phone\'s camera, or open:'), ...r.urls.map((u) => h('code', null, u))), buttons: [{ label: 'Copy Address', onClick: () => void writeClipboardText(url).then(() => toast('Copied.')) }] });
      return r;
    },
  },
]);
