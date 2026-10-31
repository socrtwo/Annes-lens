/**
 * The desktop command line, renderer side: a --convert job runs through the Batch engine in a hidden
 * window (the main process writes the files and reports); --fullscreen and --slideshow apply once
 * the pictures are open. See electron/cli.cjs.
 */
import type { App } from '../app';
import { desktopBridge, type CliJob } from './native';
import { entryFromUri } from '../picture/folder';
import { runBatch, type BatchJob, type Action } from '../commands/batch';
import type { EncodeFormat } from '../codecs/registry';

const b64 = (u8: Uint8Array) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };

/** The Batch job for a --convert request. */
export function batchJobFor(job: Extract<CliJob, { mode: 'convert' }>): BatchJob {
  const actions: Action[] = job.flip ? [{ kind: 'flip', dir: job.flip }] : [];
  return {
    inputs: job.inputs.map(entryFromUri),
    format: job.format as EncodeFormat,
    quality: job.quality,
    keepMeta: !job.strip,
    names: { pattern: job.names },
    steps: {
      rotate: job.rotate ? ({ 90: 'rot90', 180: 'rot180', 270: 'rot270', exif: 'exif' } as const)[job.rotate] : undefined,
      resize: job.resize ? { ...job.resize, kernel: 'lanczos3', onlyShrink: job.shrinkOnly } : undefined,
      grayscale: job.gray || undefined,
      actions,
    },
  };
}

/** Runs a --convert job and returns true (the main process then exits); false for a normal start. */
export async function runCliConvert(app: App): Promise<boolean> {
  const d = desktopBridge();
  if (!d?.cliJob) return false;
  let job: CliJob | null = null;
  try { job = await d.cliJob(); } catch { return false; }
  if (!job || job.mode !== 'convert') { pendingView = job; return false; }
  const r = await runBatch(app, batchJobFor(job), async (res) => { const w = await d.cliWrite({ name: res.name, data: b64(res.data) }); return { uri: null, name: w.name }; }, { silent: true });
  await d.cliDone({ done: r.done.map((x) => ({ from: x.source.name, to: x.name, note: x.note })), failed: r.failed });
  return true;
}

let pendingView: CliJob | null = null;
/** --fullscreen / --slideshow, after the start-up pictures are open. */
export async function applyCliView(app: App): Promise<void> {
  const v = pendingView; pendingView = null;
  if (!v || v.mode !== 'view') return;
  for (let i = 0; i < 100 && !app.picture; i++) await new Promise((r) => setTimeout(r, 100)); // launch files arrive just after start-up
  if (!app.picture) return;
  if (v.slideshow) app.exec('show.start');
  else if (v.fullscreen) app.exec('view.fullScreen');
}
