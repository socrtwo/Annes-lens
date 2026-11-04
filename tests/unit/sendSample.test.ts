import { describe, it, expect } from 'vitest';
import { sniff, isCorel, decodePicture, formatById } from '../../src/codecs/registry';
import { sampleMessage, sampleMailto, SAMPLE_ADDRESS, SAMPLE_TERMS } from '../../src/commands/sendSample';
import { PLAN_COMMANDS } from '../../src/plan.generated';

const ascii = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));
const cdr = new Uint8Array([...ascii('RIFF'), 100, 0, 0, 0, ...ascii('CDRBvrsn'), 2, 0, 0, 0, 0, 0, ...new Array(80).fill(0)]);
const cdrNew = new Uint8Array([...ascii('RIFF'), 100, 0, 0, 0, ...ascii('cdrEvrsn'), 2, 0, 0, 0, 0, 0]);
const cpt = new Uint8Array([...ascii('CPT8FILE'), ...new Array(40).fill(1)]);

describe('Corel files are recognized and a sample is asked for', () => {
  it('CorelDRAW (RIFF CDR*, cdr*) and PHOTO-PAINT (CPT<n>FILE) by content', () => {
    expect([isCorel(cdr), isCorel(cdrNew), isCorel(cpt), isCorel(ascii('RIFF....WEBPVP8 ')), isCorel(ascii('CPTXFILE'))]).toEqual([true, true, true, false, true]);
    expect(sniff(cdr, 'x.bin')?.id).toBe('corel');
    expect(sniff(cpt, 'photo')?.id).toBe('corel');
    expect(sniff(ascii('RIFF....WEBPVP8 '), 'x')?.id).toBe('webp');
    expect(formatById('corel')?.sample).toBe(true);
  });
  it('opening one fails with the error that offers to send a sample', async () => {
    const entry = { name: 'drawing.cdr', uri: null, size: cdr.length, read: async () => cdr.buffer as ArrayBuffer };
    let err: any = null;
    try { await decodePicture(cdr, entry); } catch (e) { err = e; }
    expect(err?.sample).toBe('corel');
    expect(String(err?.message)).toMatch(/CorelDRAW \/ Corel PHOTO-PAINT files are recognized but not opened yet.*Send a Sample File/);
  });
});

describe('The sample-file message', () => {
  const info = { name: 'drawing.cdr', size: 345 * 1024, format: 'CorelDRAW / Corel PHOTO-PAINT', program: 'CorelDRAW 9', notes: 'a map of the parish', publish: true };
  it('names the file, the format, the permissions given and the attachment', () => {
    const m = sampleMessage(info);
    expect(m.subject).toBe("Anne's Lens sample file: drawing.cdr");
    expect(m.body).toContain('drawing.cdr (345 KB), recognized as CorelDRAW / Corel PHOTO-PAINT');
    expect(m.body).toContain('Made by: CorelDRAW 9');
    expect(m.body).toContain('May be kept in the public test suite: yes');
    expect(sampleMessage({ ...info, publish: false, program: '', notes: '' }).body).toMatch(/Made by: not stated\nNotes: none\nMay be kept in the public test suite: no \(private use only\)/);
    expect(m.body).toContain('agreed to the sample-file terms');
  });
  it('is a mailto: address for the mail program', () => {
    const u = sampleMailto(info);
    expect(u.startsWith(`mailto:${SAMPLE_ADDRESS}?subject=`)).toBe(true);
    const q = new URLSearchParams(u.slice(u.indexOf('?') + 1));
    expect(q.get('subject')).toBe("Anne's Lens sample file: drawing.cdr");
    expect(q.get('body')).toContain('(The file drawing.cdr is attached. If it is not, please attach it before sending.)');
  });
  it('the terms say what happens to the file, and the command is in the plan', () => {
    const all = SAMPLE_TERMS.join(' ');
    for (const need of [SAMPLE_ADDRESS, 'uploads nothing', 'right to share', 'nothing confidential', 'only to make Anne\'s Lens read', 'MIT license', 'deleted', 'No payment, credit or reply']) expect(all, need).toContain(need);
    expect(PLAN_COMMANDS['help.sendSample']?.label).toBe('Send a Sample File…');
  });
});
