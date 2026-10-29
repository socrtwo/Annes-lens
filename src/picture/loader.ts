/**
 * Decodes pictures ahead of time. The loader keeps a small cache of decoded pictures keyed by entry, so
 * the next and previous pictures (in the direction of travel) are ready before the key is pressed.
 */
import type { Entry, Folder } from './folder';
import { Picture } from './model';
import { decodePicture } from '../codecs/registry';

export class Loader {
  private cache = new Map<Entry, Promise<Picture>>();
  private order: Entry[] = [];
  private limit = 6;
  constructor(private folder: Folder) {}

  setFolder(f: Folder): void { this.clear(); this.folder = f; }

  get(e: Entry): Promise<Picture> {
    let p = this.cache.get(e);
    if (!p) {
      p = (async () => {
        const buf = await e.read();
        (e as any).release?.();
        const pic = await decodePicture(new Uint8Array(buf), e);
        return pic;
      })();
      p.catch(() => this.cache.delete(e));
      this.cache.set(e, p);
      this.order.push(e);
      this.trim();
    } else {
      this.order = this.order.filter((x) => x !== e); this.order.push(e);
    }
    return p;
  }

  has(e: Entry): boolean { return this.cache.has(e); }

  /** Decodes the next `n` and previous `n` pictures in the background. */
  prefetch(n: number): void {
    const wrap = true;
    const cur = this.folder.current;
    if (!cur) return;
    const want: Entry[] = [];
    for (let d = 1; d <= n; d++) { const a = this.folder.peek(d, wrap), b = this.folder.peek(-d, wrap); if (a && a !== cur) want.push(a); if (b && b !== cur && b !== a) want.push(b); }
    this.limit = Math.max(4, want.length + 2);
    const run = async () => { for (const e of want) { if (this.folder.current !== cur) return; try { await this.get(e); } catch { /* reported when shown */ } } };
    void run();
  }

  /** The entry was renamed: the decoded picture stays cached under its new entry. */
  rekey(from: Entry, to: Entry): void {
    const p = this.cache.get(from);
    if (!p) return;
    this.cache.delete(from); this.cache.set(to, p);
    this.order = this.order.map((x) => (x === from ? to : x));
  }

  /** The picture is being replaced (after a save or reload): forget the cached decode. */
  invalidate(e: Entry): void { this.drop(e); }

  private drop(e: Entry): void {
    const p = this.cache.get(e);
    this.cache.delete(e);
    this.order = this.order.filter((x) => x !== e);
    p?.then((pic) => { if (pic !== this.keep) pic.release(); }).catch(() => undefined);
  }
  /** The picture currently shown must never be released by trimming. */
  keep: Picture | null = null;

  private trim(): void {
    while (this.order.length > this.limit) {
      const e = this.order.shift()!;
      if (e === this.folder.current) { this.order.push(e); if (this.order.length <= this.limit + 1) break; continue; }
      this.drop(e);
    }
  }

  clear(): void { for (const e of [...this.order]) this.drop(e); this.cache.clear(); this.order = []; }
}
