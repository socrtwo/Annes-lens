/**
 * Next / Previous Folder: the folder tree in name order, depth first (a folder, then its
 * subfolders, then the next folder beside it), skipping folders without pictures. On desktops the
 * walk climbs past the opened folder to its parents; elsewhere it stays inside the folder that was
 * opened (the platform gives no access above it).
 */
import type { FolderRef } from '../platform/native';

export interface FolderTree {
  children(uri: string): Promise<FolderRef[] | null>;
  parent(uri: string): Promise<FolderRef | null>;
  /** How many pictures a folder holds directly (0 = skip it). */
  pictures(uri: string): Promise<number>;
}

/** Remembers each folder's parent as the walk lists children, so the opened folder's subtree can be climbed. */
export class TreeWalker {
  private parents = new Map<string, FolderRef>();
  private kids = new Map<string, Promise<FolderRef[]>>();
  visited = 0;
  constructor(private tree: FolderTree, private limit = 5000) {}

  private async children(f: FolderRef): Promise<FolderRef[]> {
    let p = this.kids.get(f.uri);
    if (!p) { p = this.tree.children(f.uri).then((c) => c || []); this.kids.set(f.uri, p); }
    const list = await p;
    for (const c of list) this.parents.set(c.uri, f);
    return list;
  }
  private async parent(f: FolderRef, top: string | null): Promise<FolderRef | null> {
    if (top && f.uri === top) return null;
    return this.parents.get(f.uri) || (top ? null : await this.tree.parent(f.uri));
  }
  private async *subtree(f: FolderRef): AsyncGenerator<FolderRef> { for (const c of await this.children(f)) { yield c; yield* this.subtree(c); } }
  private async *subtreeReversed(f: FolderRef): AsyncGenerator<FolderRef> { for (const c of [...(await this.children(f))].reverse()) yield* this.subtreeReversed(c); yield f; }
  private indexIn(list: FolderRef[], f: FolderRef): number { const i = list.findIndex((x) => x.uri === f.uri); return i >= 0 ? i : list.findIndex((x) => x.name === f.name); }

  /** Folders after `from` in tree order. `top` bounds the walk to a subtree (null: climb as far as the platform allows). */
  async *forward(from: FolderRef, top: string | null): AsyncGenerator<FolderRef> {
    yield* this.subtree(from);
    let node = from;
    for (let p = await this.parent(node, top); p; node = p, p = await this.parent(node, top)) {
      const sibs = await this.children(p), i = this.indexIn(sibs, node);
      for (const s of sibs.slice(i + 1)) { yield s; yield* this.subtree(s); }
    }
  }
  /** Folders before `from` in tree order, nearest first. */
  async *backward(from: FolderRef, top: string | null): AsyncGenerator<FolderRef> {
    let node = from;
    for (let p = await this.parent(node, top); p; node = p, p = await this.parent(node, top)) {
      const sibs = await this.children(p), i = this.indexIn(sibs, node);
      for (const s of sibs.slice(0, Math.max(0, i)).reverse()) yield* this.subtreeReversed(s);
      yield p;
    }
  }
  /** The nearest folder with pictures in a direction, or null (none, or the walk limit reached). */
  async step(from: FolderRef, dir: 1 | -1, top: string | null): Promise<{ folder: FolderRef; count: number } | null> {
    for await (const f of dir > 0 ? this.forward(from, top) : this.backward(from, top)) {
      if (++this.visited > this.limit) return null;
      const n = await this.tree.pictures(f.uri);
      if (n > 0) return { folder: f, count: n };
    }
    return null;
  }
  /** Records a known parent (the folder a walk started from, when it came from a picker). */
  setParent(child: string, parent: FolderRef): void { this.parents.set(child, parent); }
}
