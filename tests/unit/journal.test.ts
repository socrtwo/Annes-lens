import { describe, it, expect } from 'vitest';
import { Journal } from '../../src/picture/journal';
import { parseExifDate } from '../../src/commands/fileOps';
import { fileOpCaps } from '../../src/platform/native';

describe('file-operation journal', () => {
  it('undoes the newest operation first and reports those that cannot be undone', async () => {
    const j = new Journal();
    const log: string[] = [];
    j.push({ kind: 'rename', label: 'Renamed a to b', when: 1, undo: async () => { log.push('rename'); } });
    j.push({ kind: 'delete', label: 'Deleted c', when: 2, noUndo: 'restore it from the trash' });
    expect(j.canUndo).toBe(false);
    await expect(j.undoLast()).rejects.toThrow(/restore it from the trash/);
    j.ops.pop();
    expect(j.canUndo).toBe(true);
    expect((await j.undoLast())?.label).toBe('Renamed a to b');
    expect(log).toEqual(['rename']);
    expect(j.last).toBeNull();
    expect(await j.undoLast()).toBeNull();
  });
  it('drops kept bytes beyond the budget, oldest first, and notifies listeners', () => {
    const j = new Journal();
    j.budget = 10;
    let n = 0;
    j.onChange(() => n++);
    const big = new ArrayBuffer(6);
    j.push({ kind: 'delete', label: 'Deleted x', when: 1, bytes: big, undo: async () => undefined });
    j.push({ kind: 'delete', label: 'Deleted y', when: 2, bytes: big, undo: async () => undefined });
    expect(j.ops[0].bytes).toBeUndefined();
    expect(j.ops[0].undo).toBeUndefined();
    expect(j.ops[0].noUndo).toMatch(/memory/);
    expect(j.ops[1].bytes).toBe(big);
    expect(n).toBe(2);
  });
});

describe('file operations', () => {
  it('parses EXIF and ISO dates', () => {
    expect(parseExifDate('2024:05:17 14:03:22')?.getTime()).toBe(new Date(2024, 4, 17, 14, 3, 22).getTime());
    expect(parseExifDate('2024-05-17T14:03')?.getMinutes()).toBe(3);
    expect(parseExifDate('yesterday')).toBeNull();
  });
  it('offers nothing for in-memory files in a browser', () => {
    const none = fileOpCaps(null, null);
    expect(Object.values(none).every((v) => v === false)).toBe(true);
    expect(fileOpCaps('fsa:nothing', null).delete).toBe(false);
  });
});
