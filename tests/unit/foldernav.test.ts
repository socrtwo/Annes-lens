import { describe, expect, it } from 'vitest';
import { TreeWalker, type FolderTree } from '../../src/picture/folderNav';

// A file system: each path lists its subfolders and how many pictures it holds.
const FS: Record<string, { kids: string[]; n: number }> = {
  '/': { kids: ['Photos', 'Scans'], n: 0 },
  '/Photos': { kids: ['2023', '2024'], n: 0 },
  '/Photos/2023': { kids: ['01 Jan', '02 Feb'], n: 2 },
  '/Photos/2023/01 Jan': { kids: [], n: 5 },
  '/Photos/2023/02 Feb': { kids: ['raw'], n: 0 },
  '/Photos/2023/02 Feb/raw': { kids: [], n: 3 },
  '/Photos/2024': { kids: ['empty'], n: 4 },
  '/Photos/2024/empty': { kids: [], n: 0 },
  '/Scans': { kids: [], n: 7 },
};
const name = (p: string) => p.split('/').pop() || '/';
const ref = (p: string) => ({ uri: p, name: name(p) });
const fs = (opts: { climb: boolean }): FolderTree & { calls: number } => {
  const t = { calls: 0,
    children: async (uri: string) => { t.calls++; return FS[uri] ? FS[uri].kids.map((k) => ref(uri === '/' ? `/${k}` : `${uri}/${k}`)) : null; },
    parent: async (uri: string) => { if (!opts.climb || uri === '/') return null; const p = uri.slice(0, uri.lastIndexOf('/')) || '/'; return ref(p); },
    pictures: async (uri: string) => FS[uri]?.n ?? 0 };
  return t;
};
const walk = async (w: TreeWalker, from: string, dir: 1 | -1, top: string | null) => { const out: string[] = []; let at = ref(from); for (let i = 0; i < 20; i++) { const r = await w.step(at, dir, top); if (!r) break; out.push(r.folder.uri); at = r.folder; } return out; };

describe('Next / Previous Folder', () => {
  it('walks depth first in name order, skipping folders without pictures, climbing on desktops', async () => {
    const w = new TreeWalker(fs({ climb: true }));
    expect(await walk(w, '/Photos/2023', 1, null)).toEqual(['/Photos/2023/01 Jan', '/Photos/2023/02 Feb/raw', '/Photos/2024', '/Scans']);
    expect(await walk(w, '/Scans', -1, null)).toEqual(['/Photos/2024', '/Photos/2023/02 Feb/raw', '/Photos/2023/01 Jan', '/Photos/2023']);
  });
  it('previous then next returns to the same folder', async () => {
    const w = new TreeWalker(fs({ climb: true }));
    const back = await w.step(ref('/Photos/2024'), -1, null), fwd = await w.step(back!.folder, 1, null);
    expect([back!.folder.uri, back!.count, fwd!.folder.uri]).toEqual(['/Photos/2023/02 Feb/raw', 3, '/Photos/2024']);
  });
  it('stays inside the opened folder where the platform gives no parent', async () => {
    const w = new TreeWalker(fs({ climb: false }));
    expect(await walk(w, '/Photos', 1, '/Photos')).toEqual(['/Photos/2023', '/Photos/2023/01 Jan', '/Photos/2023/02 Feb/raw', '/Photos/2024']);
    // From a subfolder reached that way, the walk climbs back through the parents it learned.
    expect(await walk(w, '/Photos/2024', -1, '/Photos')).toEqual(['/Photos/2023/02 Feb/raw', '/Photos/2023/01 Jan', '/Photos/2023']);
    expect(await w.step(ref('/Photos/2024'), 1, '/Photos')).toBeNull();
  });
  it('lists each folder once per walker and gives up at the limit', async () => {
    const t = fs({ climb: true }), w = new TreeWalker(t);
    await walk(w, '/Photos/2023', 1, null); const calls = t.calls; await walk(w, '/Photos/2023', 1, null);
    expect(t.calls).toBe(calls);
    const tight = new TreeWalker(fs({ climb: true }), 1);
    expect(await tight.step(ref('/Photos/2023/01 Jan'), 1, null)).toBeNull(); // 02 Feb (no pictures) uses the one visit
  });
});
