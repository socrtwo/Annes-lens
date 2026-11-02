/**
 * Slideshow ▸ Background Music: audio files kept in the app's IndexedDB store play in order (or
 * shuffled) while a slideshow runs, pause with it, loop, and fade out when it ends.
 */
import type { App } from '../app';
import { kvGet, kvSet } from '../util/store';
import { showHooks, DEFAULT_SLIDESHOW } from './slideshow';

export interface Track { id: string; name: string; type: string; size: number; blob: Blob }
const KEY = 'music.v1.tracks';
export const MAX_BYTES = 300 * 1048576;
export const listTracks = async (): Promise<Track[]> => (await kvGet<Track[]>(KEY)) || [];
export const saveTracks = (t: Track[]): Promise<void> => kvSet(KEY, t);
export const AUDIO_ACCEPT = 'audio/*,.mp3,.m4a,.aac,.ogg,.oga,.opus,.wav,.flac,.weba';

/** The play order: in the list's order, or shuffled (no track twice in a row across rounds). */
export function playOrder(n: number, shuffle: boolean, rnd: () => number = Math.random, avoidFirst = -1): number[] {
  const o = Array.from({ length: n }, (_, i) => i);
  if (shuffle) { for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [o[i], o[j]] = [o[j], o[i]]; } if (n > 1 && o[0] === avoidFirst) [o[0], o[1]] = [o[1], o[0]]; }
  return o;
}

export const music = { audio: null as HTMLAudioElement | null, url: '', tracks: [] as Track[], order: [] as number[], pos: 0, playing: false, track: '', error: '', fading: 0 as any };
const settings = (app: App) => ({ ...DEFAULT_SLIDESHOW, ...app.prefs.slideshow });

function playAt(app: App, pos: number): void {
  const m = music;
  if (!m.tracks.length) return;
  if (pos >= m.order.length) { m.order = playOrder(m.tracks.length, settings(app).musicShuffle, Math.random, m.order[m.order.length - 1]); pos = 0; }
  m.pos = pos;
  const t = m.tracks[m.order[pos]];
  if (m.url) URL.revokeObjectURL(m.url);
  m.url = URL.createObjectURL(t.blob);
  const a = m.audio ??= new Audio();
  a.onended = () => playAt(app, m.pos + 1);
  a.onerror = () => { m.error = `${t.name} cannot be played here`; playAt(app, m.pos + 1); };
  a.src = m.url; a.volume = Math.max(0, Math.min(1, settings(app).musicVolume));
  m.track = t.name;
  a.play().then(() => { m.playing = true; m.error = ''; }).catch((e) => { m.playing = false; m.error = String(e?.message || e); });
}
export async function startMusic(app: App): Promise<void> {
  const s = settings(app);
  if (!s.musicOn) return;
  clearInterval(music.fading);
  music.tracks = await listTracks();
  if (!music.tracks.length) return;
  music.order = playOrder(music.tracks.length, s.musicShuffle);
  playAt(app, 0);
}
export function pauseMusic(paused: boolean): void { const a = music.audio; if (!a || !music.url) return; if (paused) { a.pause(); music.playing = false; } else void a.play().then(() => { music.playing = true; }).catch(() => undefined); }
/** Fades out over `ms`, then stops. */
export function stopMusic(ms = 1200): void {
  const a = music.audio; if (!a || !music.url) return;
  clearInterval(music.fading);
  const v0 = a.volume, t0 = performance.now();
  music.fading = setInterval(() => {
    const k = Math.min(1, (performance.now() - t0) / ms);
    a.volume = v0 * (1 - k);
    if (k >= 1) { clearInterval(music.fading); a.pause(); a.removeAttribute('src'); a.load(); URL.revokeObjectURL(music.url); music.url = ''; music.playing = false; music.track = ''; }
  }, 50);
}

let hooked = false;
export function hookMusic(): void {
  if (hooked) return; hooked = true;
  showHooks.start.push((app) => { void startMusic(app); });
  showHooks.pause.push((_app, paused) => pauseMusic(paused));
  showHooks.stop.push(() => stopMusic());
}
