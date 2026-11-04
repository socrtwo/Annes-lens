/**
 * Help ▸ Send a Sample File: a file Anne's Lens recognizes but cannot open yet (Corel drawings and photos today)
 * goes to the developer by email, from the user's own mail program, after the user has read the terms and agreed.
 * The app uploads nothing: on Android and on phones the file is handed to the mail app through the share sheet;
 * elsewhere the mail program opens with the message written, and the user attaches the file.
 */
import { def } from './registry';
import type { App } from '../app';
import type { Entry } from '../picture/folder';
import { openDialog, toast } from '../ui/dialog';
import { sniff, FORMATS } from '../codecs/registry';
import { shareFile, canShareFiles, openExternal, platformName, desktopBridge } from '../platform/native';

declare const __APP_VERSION__: string;
const VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';

/** Where sample files go. */
export const SAMPLE_ADDRESS = 'socrtwo@gmail.com';

/** The terms the user agrees to before a file is sent (also in docs/LEGAL.md). */
export const SAMPLE_TERMS: string[] = [
  `Anne's Lens cannot open this kind of file yet because its developer has no example of it to build a reader from. If you have a file you are allowed to share, you can send it. The file leaves your device only through your own mail program, addressed to ${SAMPLE_ADDRESS}; Anne's Lens itself uploads nothing.`,
  'By sending a file you confirm that you own it, or have the right to share it for this purpose, and that it holds nothing confidential, private or personal that you would not want a stranger to see. Do not send files you are not permitted to share.',
  'The file will be used only to make Anne\'s Lens read files of its kind: it may be opened with other software, examined byte by byte, and kept for as long as that work takes. It will not be sold, passed on, or used for anything else.',
  'If you also allow the public test suite below, the file (or a reduced copy of it) may be published in Anne\'s Lens\'s open-source repository on GitHub under the MIT license, where anyone can see, copy and use it. Without that permission it stays private and is deleted when the work is done.',
  'No payment, credit or reply is owed for a file. You can withdraw permission and ask for the file to be deleted at any time by writing to the address above; copies already published cannot be recalled.',
];

export interface SampleInfo { name: string; size: number; format: string; program: string; notes: string; publish: boolean }
/** The email's subject and body. */
export function sampleMessage(o: SampleInfo): { subject: string; body: string } {
  const kb = o.size >= 1024 * 1024 ? `${(o.size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(o.size / 1024))} KB`;
  const body = [
    `Sample file for Anne's Lens: ${o.name} (${kb}), recognized as ${o.format}.`,
    `Made by: ${o.program.trim() || 'not stated'}`,
    `Notes: ${o.notes.trim() || 'none'}`,
    `May be kept in the public test suite: ${o.publish ? 'yes' : 'no (private use only)'}`,
    `Sent with Anne's Lens ${VERSION} (${platformName()}); the sender agreed to the sample-file terms shown in the app.`,
    '',
    `(The file ${o.name} is attached. If it is not, please attach it before sending.)`,
  ].join('\n');
  return { subject: `Anne's Lens sample file: ${o.name}`, body };
}
export function sampleMailto(o: SampleInfo): string {
  const m = sampleMessage(o);
  return `mailto:${SAMPLE_ADDRESS}?subject=${encodeURIComponent(m.subject)}&body=${encodeURIComponent(m.body)}`;
}

const formatLabel = (bytes: Uint8Array, name: string): string => sniff(bytes, name)?.label || FORMATS.find((f) => f.extensions.some((x) => name.toLowerCase().endsWith('.' + x)))?.label || 'an unknown format';

async function sendSample(app: App, entry?: Entry): Promise<void> {
  const e = entry && typeof entry.read === 'function' ? entry : app.folder.current && !app.picture ? app.folder.current : null;
  let values: Record<string, any> = { program: '', notes: '', publish: false, agree: false };
  for (;;) {
    const v = await openDialog({
      title: 'Send a Sample File', wide: true, ok: 'Send by email…', help: `The file goes to ${SAMPLE_ADDRESS} from your own mail program. Read the terms, then tick the agreement.`,
      fields: [
        { key: 'terms', type: 'info', html: SAMPLE_TERMS.map((p) => `<p>${p}</p>`).join('') },
        ...(e ? [{ key: 'which', type: 'info' as const, html: `<p><b>File:</b> ${esc(e.name)}${e.size ? ` (${Math.max(1, Math.round(e.size / 1024))} KB)` : ''}</p>` }] : [{ key: 'file', label: 'The file to send', type: 'file' as const, accept: '.cdr,.cpt,.cmx,*' }]),
        { key: 'program', label: 'Which program (and version) made it', type: 'text', value: values.program, placeholder: 'CorelDRAW 9, Corel PHOTO-PAINT 12…', half: true },
        { key: 'notes', label: 'Notes for the developer', type: 'textarea', rows: 2, value: values.notes },
        { key: 'publish', label: 'The file may be kept in Anne\'s Lens\'s public test suite on GitHub (MIT license)', type: 'checkbox', value: values.publish },
        { key: 'agree', label: 'I have read the terms above and agree to them; I have the right to share this file', type: 'checkbox', value: values.agree },
      ],
    });
    if (!v) return;
    values = v;
    if (!v.agree) { toast('Tick the agreement to send the file, or cancel.', { ms: 5000 }); continue; }
    if (!e && !(v.file instanceof File)) { toast('Choose the file to send.', { ms: 5000 }); continue; }
    break;
  }
  const file: File | null = e ? null : values.file;
  const bytes = new Uint8Array(e ? await e.read() : await file!.arrayBuffer());
  const name = e ? e.name : file!.name;
  const info: SampleInfo = { name, size: bytes.length, format: formatLabel(bytes, name), program: String(values.program || ''), notes: String(values.notes || ''), publish: !!values.publish };
  const msg = sampleMessage(info);
  const blob = new Blob([bytes], { type: 'application/octet-stream' });
  if (await canShareFiles(blob, name)) {
    try { await shareFile(blob, name, msg.subject, { text: msg.body, subject: msg.subject, to: SAMPLE_ADDRESS }); toast(`Choose your mail app; the message is addressed to ${SAMPLE_ADDRESS}.`, { ms: 8000 }); return; }
    catch (err: any) { if (/abort|cancel/i.test(String(err?.message || err))) return; }
  }
  openExternal(sampleMailto(info));
  if (e?.uri) { try { await desktopBridge()?.revealInFolder({ uri: e.uri }); } catch { /* the file is named in the message */ } }
  toast(`Your mail program opens with the message. Attach ${name} to it before sending.`, { ms: 12000 });
}
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

def([
  {
    id: 'help.sendSample', icon: 'outgoing_mail', noRecord: true,
    tip: `A file Anne's Lens recognizes but cannot open yet, sent to the developer by email from your own mail program, with your permission and under the terms shown`,
    run: (app, entry?: Entry) => sendSample(app, entry),
  },
]);
