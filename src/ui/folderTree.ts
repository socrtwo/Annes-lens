/**
 * The folder tree pane (Browse ▸ Folder Tree, and the left side of the Browser): favorite folders,
 * then the folders around the open one — on the desktop from the top of the drive down to it; on
 * Android and in browsers from the folder that was opened. Subfolders load when a branch opens.
 */
import type { App, PictureTab } from '../app';
import { h, icon } from './dom';
import { isDesktop, canListSubfolders, listSubfolders, parentFolderOf, type FolderRef } from '../platform/native';
import { listFavorites, favoriteRef } from '../picture/favorites';

interface Node { ref: FolderRef; open: boolean; kids: Node[] | null; loading?: boolean }

export class FolderTree {
  el: HTMLElement;
  private body: HTMLElement;
  private roots: Node[] = [];
  private rootKey = '';
  private favorites: HTMLElement;
  constructor(private app: App, private tab: PictureTab) {
    this.favorites = h('div', { class: 'qn-tree-favs' });
    this.body = h('div', { class: 'qn-tree-body', role: 'tree', 'aria-label': 'Folders' });
    this.el = h('aside', { class: 'qn-tree', 'aria-label': 'Folder tree' }, h('div', { class: 'qn-tree-head' }, icon('star'), ' Favorites'), this.favorites, h('div', { class: 'qn-tree-head' }, icon('folder'), ' Folders'), this.body);
  }
  private async kids(n: Node): Promise<Node[]> {
    if (n.kids) return n.kids;
    n.loading = true;
    const list = (await listSubfolders(n.ref.uri).catch(() => null)) || [];
    n.kids = list.map((ref) => ({ ref, open: false, kids: null })); n.loading = false;
    return n.kids;
  }
  /** Rebuilds the roots for the open folder (desktop: its ancestors, opened down to it). */
  async update(force = false): Promise<void> {
    const f = this.tab.folder, uri = f.uri;
    void this.renderFavorites();
    const key = `${uri}|${f.treeTop ?? ''}`;
    if (!force && key === this.rootKey) { this.render(); return; }
    this.rootKey = key;
    if (!uri || !canListSubfolders(uri)) { this.roots = []; this.render(); return; }
    const base = f.name.replace(/ \(with subfolders\)$/, '');
    if (isDesktop()) {
      // The chain from the top down: each ancestor opened to show the next.
      const chain: FolderRef[] = [{ uri, name: base }];
      for (let i = 0; i < 40; i++) { const p = await parentFolderOf(chain[0].uri); if (!p) break; chain.unshift(p); }
      const top: Node = { ref: chain[0], open: true, kids: null };
      let cur = top;
      for (const ref of chain.slice(1)) { const ks = await this.kids(cur); const next = ks.find((k) => k.ref.uri === ref.uri) || { ref, open: false, kids: null }; next.open = true; cur = next; }
      await this.kids(cur);
      this.roots = [top];
    } else {
      // The opened folder stays the root (its branches keep their state); the path to the current folder opens.
      const topUri = f.treeTop || uri;
      if (this.roots[0]?.ref.uri !== topUri) this.roots = [{ ref: { uri: topUri, name: topUri === uri ? base : topUri.split(/[:/]/).pop() || 'Folder' }, open: true, kids: null }];
      let budget = 400;
      const find = async (n: Node, depth: number): Promise<boolean> => {
        if (n.ref.uri === uri) return true;
        if (depth > 8 || budget-- <= 0) return false;
        for (const k of await this.kids(n)) if (await find(k, depth + 1)) { n.open = true; return true; }
        return false;
      };
      await find(this.roots[0], 0);
    }
    this.render();
    void Promise.all(this.roots.map((r) => this.kids(r))).then(() => this.render());
  }
  private async renderFavorites(): Promise<void> {
    const favs = await listFavorites();
    const rows: HTMLElement[] = favs.length ? favs.map((fv): HTMLElement => h('div', { class: 'qn-tree-row', role: 'treeitem', tabindex: '0', title: fv.uri || fv.name, onclick: async () => { const ref = await favoriteRef(fv); if (!ref) { const { toast } = await import('./dialog'); toast(`${fv.name} is not available (moved, or permission refused).`); return; } const { openFolderRef } = await import('../commands/viewWindow'); await openFolderRef(this.app, ref, isDesktop() ? null : ref.uri); } }, icon('folder_special'), h('span', null, fv.name))) : [h('div', { class: 'ql-help qn-tree-empty' }, 'Browse ▸ Favorite Folders ▸ Add')];
    this.favorites.replaceChildren(...rows);
  }
  private render(): void {
    const cur = this.tab.folder.uri;
    const row = (n: Node, depth: number): HTMLElement[] => {
      const toggle = h('button', { class: 'qn-tree-toggle', type: 'button', 'aria-label': n.open ? 'Collapse' : 'Expand', onclick: async (e: Event) => { e.stopPropagation(); n.open = !n.open; if (n.open) await this.kids(n); this.render(); } }, n.kids && !n.kids.length ? '' : n.open ? '▾' : '▸');
      const r = h('div', { class: 'qn-tree-row' + (n.ref.uri === cur ? ' ql-sel' : ''), role: 'treeitem', 'aria-expanded': String(n.open), tabindex: '0', style: `padding-left:${4 + depth * 14}px`, title: n.ref.name, 'data-uri': n.ref.uri,
        onclick: async () => {
          const { openFolderRef } = await import('../commands/viewWindow'); const top = isDesktop() ? null : this.tab.folder.treeTop ?? this.roots[0]?.ref.uri ?? null;
          // A folder without pictures opens its branch instead.
          if (!(await openFolderRef(this.app, n.ref, top, true))) { n.open = true; await this.kids(n); this.render(); const { toast } = await import('./dialog'); toast(`No ${this.app.prefs.showAllFiles ? 'files' : 'pictures'} directly in ${n.ref.name}${n.kids?.length ? '; its folders are listed below it' : ''}.`, { ms: 2000 }); }
        } }, toggle, icon(n.ref.uri === cur ? 'folder_open' : 'folder'), h('span', null, n.ref.name));
      const out: HTMLElement[] = [r];
      if (n.open && n.kids) for (const k of n.kids) out.push(...row(k, depth + 1));
      return out;
    };
    this.body.replaceChildren(...(this.roots.length ? this.roots.flatMap((n) => row(n, 0)) : [h('div', { class: 'ql-help qn-tree-empty' }, 'Open a folder (File ▸ Open Folder) to see its folders here.')]));
    this.body.querySelector('.ql-sel')?.scrollIntoView({ block: 'nearest' });
  }
}
