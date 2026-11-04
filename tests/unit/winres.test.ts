import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { winModuleKind, resources, iconGroups } from '../../src/codecs/winres';
import { sniff } from '../../src/codecs/registry';

const fx = (n: string) => new Uint8Array(readFileSync(`tests/fixtures/iconlib/${n}`));

describe('Icons in Windows programs and icon libraries', () => {
  it('PE (32 and 64 bits) and NE modules are recognized', () => {
    expect([winModuleKind(fx('icons64.dll')), winModuleKind(fx('icons32.dll')), winModuleKind(fx('lib.icl')), winModuleKind(fx('a.ico'))]).toEqual(['pe', 'pe', 'ne', null]);
    expect(resources(fx('icons64.dll')).map((r) => `${r.type}:${r.id}`)).toEqual(['1:1', '3:1', '3:2', '3:3', '3:4', '3:5', '12:3', '14:1', '14:7']);
    expect(sniff(fx('lib.icl'), 'x.icl')?.id).toBe('winres');
  });
  for (const f of ['icons64', 'icons32', 'lib']) {
    it(`${f}: each group is the icon or cursor file it was made from (and what wrestool rebuilds)`, () => {
      const g = iconGroups(fx(f + (f === 'lib' ? '.icl' : '.dll')));
      expect(g.map((x) => [x.kind, x.id])).toEqual([['cursor', 3], ['icon', 1], ['icon', 7]]);
      const ico = g.find((x) => x.id === 1)!, ico7 = g.find((x) => x.id === 7)!, cur = g.find((x) => x.id === 3)!;
      expect([...ico.file]).toEqual([...fx('a.ico')]);
      expect([...ico7.file]).toEqual([...fx('b.ico')]);
      expect([...cur.file]).toEqual([...fx('c.cur')]);
      expect(ico.sizes).toEqual(['16 × 16', '32 × 32', '48 × 48', '256 × 256']);
      // wrestool's files: the same directory and images (it adds bytes after the last image, and keeps a cursor's hotspot in its image).
      const w = fx(`${f}-14-1.ico`); expect([...w.subarray(0, ico.file.length)]).toEqual([...ico.file]);
    });
  }
});
