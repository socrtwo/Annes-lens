/**
 * The page a video or audio file shows as a picture: the video's first frame (the platform decodes it in a media
 * element), the audio file's cover art, or a drawn placeholder when neither can be had. The file itself plays in
 * the media player (View ▸ Media Player), which opens by itself when such a file is shown.
 */
import type { Page } from '../picture/model';
import { readMedia, describeMedia, type MediaInfo } from './media';

export interface MediaDecode { pages: Page[]; info: Record<string, string>; warnings: string[]; decoder: string; media: MediaInfo }

export async function decodeMediaPicture(u8: Uint8Array, name: string): Promise<MediaDecode> {
  const media = readMedia(u8, name);
  if (!media) throw new Error('Not a video or audio file Anne\'s Lens recognizes');
  const info = describeMedia(media), warnings = [...media.warnings], notes: string[] = [];
  const blob = new Blob([u8 as BlobPart], { type: media.mime });
  let canvas: HTMLCanvasElement | null = null;
  const v = media.tracks.find((t) => t.kind === 'video');
  if (media.kind === 'video') {
    const r = await firstFrame(blob, 8000);
    if (r.canvas) { canvas = r.canvas; notes.push(`video: the first frame is shown; the file plays in the Media Player`); }
    else { warnings.push(r.error === 'timeout' ? 'The first frame did not arrive in time; the platform may not play this file' : `The platform cannot decode this video${v ? ` (${v.codec})` : ''}: ${r.error}`); }
  } else if (media.cover) {
    try { const bmp = await createImageBitmap(new Blob([media.cover.bytes as BlobPart], { type: media.cover.mime })); canvas = document.createElement('canvas'); canvas.width = bmp.width; canvas.height = bmp.height; canvas.getContext('2d')!.drawImage(bmp, 0, 0); bmp.close(); notes.push('audio: the cover art is shown; the file plays in the Media Player'); }
    catch (e: any) { warnings.push(`The cover art could not be decoded (${e?.message || e})`); }
  }
  if (!canvas) { canvas = placeholder(media, name, v); notes.push(`${media.kind}: no ${media.kind === 'video' ? 'frame' : 'cover art'} to show; the file plays in the Media Player`); }
  const page: Page = { width: canvas.width, height: canvas.height, frames: [{ image: canvas, width: canvas.width, height: canvas.height, delay: 0 }], loops: 0, bitDepth: 24, hasAlpha: false, notes };
  return { pages: [page], info, warnings, decoder: 'media', media };
}

/** The first presented frame of a video, through a media element; an error text when the platform cannot decode it. */
export function firstFrame(blob: Blob, timeoutMs: number): Promise<{ canvas: HTMLCanvasElement | null; error?: string }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob), v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto'; (v as any).disableRemotePlayback = true;
    let done = false;
    const finish = (r: { canvas: HTMLCanvasElement | null; error?: string }) => { if (done) return; done = true; clearTimeout(timer); v.pause(); v.removeAttribute('src'); v.load(); URL.revokeObjectURL(url); resolve(r); };
    const timer = setTimeout(() => finish({ canvas: null, error: 'timeout' }), timeoutMs);
    const grab = (): boolean => {
      if (!v.videoWidth || !v.videoHeight) return false;
      const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
      const x = c.getContext('2d', { willReadFrequently: true })!; x.drawImage(v, 0, 0);
      const d = x.getImageData(0, 0, Math.min(8, c.width), Math.min(8, c.height)).data; let any = false; for (let i = 3; i < d.length; i += 4) if (d[i]) { any = true; break; }
      if (!any) return false;
      finish({ canvas: c }); return true;
    };
    v.onerror = () => finish({ canvas: null, error: v.error?.message || `media error ${v.error?.code ?? ''}`.trim() });
    v.onloadeddata = () => { if (grab()) return; if ((v as any).requestVideoFrameCallback) (v as any).requestVideoFrameCallback(() => { if (!grab()) v.currentTime = 0.001; }); v.currentTime = Math.min(0.1, (v.duration || 1) / 10); };
    v.onseeked = () => { if (!grab()) v.play().then(() => setTimeout(() => { grab(); }, 300)).catch(() => undefined); };
    v.ontimeupdate = () => { grab(); };
    v.src = url;
  });
}

function placeholder(m: MediaInfo, name: string, v?: { width?: number; height?: number }): HTMLCanvasElement {
  const w = m.kind === 'video' ? Math.max(160, Math.min(1280, v?.width || 640)) : 512, hgt = m.kind === 'video' ? Math.max(90, Math.min(1280, v?.height || 360)) : 512;
  const c = document.createElement('canvas'); c.width = w; c.height = hgt;
  const x = c.getContext('2d')!;
  const g = x.createLinearGradient(0, 0, 0, hgt); g.addColorStop(0, '#2b3340'); g.addColorStop(1, '#141820'); x.fillStyle = g; x.fillRect(0, 0, w, hgt);
  const s = Math.min(w, hgt) * 0.28, cx = w / 2, cy = hgt / 2 - s * 0.15;
  x.fillStyle = 'rgba(255,255,255,0.85)';
  if (m.kind === 'video') { x.beginPath(); x.moveTo(cx - s * 0.4, cy - s * 0.5); x.lineTo(cx + s * 0.5, cy); x.lineTo(cx - s * 0.4, cy + s * 0.5); x.closePath(); x.fill(); }
  else { // a note: two heads, stems and a beam
    x.beginPath(); x.ellipse(cx - s * 0.35, cy + s * 0.4, s * 0.2, s * 0.14, -0.4, 0, Math.PI * 2); x.fill();
    x.beginPath(); x.ellipse(cx + s * 0.25, cy + s * 0.3, s * 0.2, s * 0.14, -0.4, 0, Math.PI * 2); x.fill();
    x.fillRect(cx - s * 0.2, cy - s * 0.5, s * 0.06, s * 0.9); x.fillRect(cx + s * 0.4, cy - s * 0.6, s * 0.06, s * 0.9);
    x.beginPath(); x.moveTo(cx - s * 0.2, cy - s * 0.5); x.lineTo(cx + s * 0.46, cy - s * 0.6); x.lineTo(cx + s * 0.46, cy - s * 0.42); x.lineTo(cx - s * 0.2, cy - s * 0.32); x.closePath(); x.fill();
  }
  const title = m.tags.title || name.replace(/\.[^.]+$/, ''), sub = [m.tags.artist, m.tags.album].filter(Boolean).join(' · ');
  x.textAlign = 'center'; x.textBaseline = 'top';
  x.font = `${Math.round(Math.min(w, hgt) * 0.06)}px system-ui, sans-serif`; x.fillStyle = 'rgba(255,255,255,0.92)'; x.fillText(title, cx, cy + s * 0.75, w - 24);
  if (sub) { x.font = `${Math.round(Math.min(w, hgt) * 0.045)}px system-ui, sans-serif`; x.fillStyle = 'rgba(255,255,255,0.65)'; x.fillText(sub, cx, cy + s * 0.75 + Math.min(w, hgt) * 0.08, w - 24); }
  return c;
}
