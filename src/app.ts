/**
 * Anne's Lens application core: picture windows (tabs), the current folder (file set), command
 * execution, undo/redo of picture edits and macro recording. Each tab shows one picture out of a
 * folder; next/previous move through the folder with pictures decoded ahead of time.
 */
import { getCommand, allCommands, type Command } from './commands/registry';
import { loadPrefs, savePrefs, type Prefs } from './prefs';
import { toast } from './ui/dialog';
import { canonicalKey } from './util/keys';
import type { Shell } from './ui/shell';
import type { Viewer } from './ui/viewer';
import { Folder, type Entry } from './picture/folder';
import { Picture } from './picture/model';
import { Loader } from './picture/loader';
import { Journal } from './picture/journal';
import { decodeOptions } from './codecs/registry';

let tabCounter = 0;

interface Snapshot { label: string; pages: Picture['pages']; page: number; frame: number }

export class PictureTab {
  id = `t${Date.now().toString(36)}${tabCounter++}`;
  el!: HTMLElement;
  ui!: Viewer;
  folder: Folder;
  /** The picture shown, or null while loading / when nothing is open. */
  picture: Picture | null = null;
  loading: Entry | null = null;
  error = '';
  dirty = false;
  created = Date.now();
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  readonly loader: Loader;
  constructor(public app: App, folder?: Folder) {
    this.folder = folder || new Folder();
    this.loader = new Loader(this.folder);
  }
  get displayName(): string { return this.picture?.name || this.loading?.name || 'No picture'; }
  get entry(): Entry | null { return this.folder.current; }
  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }
  get undoLabel(): string { return this.undoStack[this.undoStack.length - 1]?.label || ''; }
  get redoLabel(): string { return this.redoStack[this.redoStack.length - 1]?.label || ''; }

  private snapshot(label: string): Snapshot {
    const p = this.picture!;
    return { label, pages: p.pages, page: p.page, frame: p.frame };
  }
  private restore(s: Snapshot): void {
    const p = this.picture!;
    p.pages = s.pages; p.page = s.page; p.frame = s.frame;
    p.version++;
  }
  /** Runs an edit as one undoable step. `fn` returns the new pages (never mutating the old ones). */
  edit(label: string, fn: (p: Picture) => void): void {
    if (!this.picture) throw new Error('No picture is open.');
    const before = this.snapshot(label);
    fn(this.picture);
    this.picture.version++;
    this.undoStack.push(before);
    if (this.undoStack.length > 30) this.undoStack.shift();
    this.redoStack = [];
    this.afterChange();
  }
  undo(): boolean {
    const s = this.undoStack.pop();
    if (!s || !this.picture) return false;
    this.redoStack.push(this.snapshot(s.label));
    this.restore(s);
    this.afterChange();
    return true;
  }
  redo(): boolean {
    const s = this.redoStack.pop();
    if (!s || !this.picture) return false;
    this.undoStack.push(this.snapshot(s.label));
    this.restore(s);
    this.afterChange();
    return true;
  }
  clearHistory(): void { this.undoStack = []; this.redoStack = []; }
  afterChange(): void {
    this.dirty = this.undoStack.length > 0;
    this.ui.pictureChanged();
    this.app.ui.tabsChanged();
    this.app.refresh();
  }

  /** Shows the folder's current entry (decoding it, or taking it from the prefetch cache). */
  async show(): Promise<void> {
    const e = this.folder.current;
    if (!e) { this.picture = null; this.loading = null; this.error = ''; this.clearHistory(); this.ui.pictureChanged(); this.app.ui.tabsChanged(); this.app.refresh(); return; }
    if (this.dirty && this.picture && this.app.prefs.confirmClose) {
      const { choiceDialog } = await import('./ui/dialog');
      const c = await choiceDialog('Save Changes?', `Save changes to "${this.picture.name}" before moving on?`, ['Save', 'Don\'t Save']);
      if (c < 0) { this.folder.select(this.folder.entries.indexOf(this.picture.entry)); return; }
      if (c === 0) { const { saveTab } = await import('./commands/file'); if (!(await saveTab(this.app, this))) { this.folder.select(this.folder.entries.indexOf(this.picture.entry)); return; } }
    }
    this.loading = e; this.error = '';
    this.app.ui.tabsChanged();
    const t0 = performance.now();
    try {
      const pic = await this.loader.get(e);
      if (this.folder.current !== e) return; // the user moved on
      this.picture = pic; this.loading = null; this.dirty = false; this.clearHistory();
      pic.loadMs = Math.round(performance.now() - t0);
      this.ui.pictureChanged(true);
      this.app.addRecent(e);
    } catch (err: any) {
      if (this.folder.current !== e) return;
      this.picture = null; this.loading = null; this.error = err?.message || String(err);
      this.ui.pictureChanged(true);
      toast(`Could not open ${e.name}: ${this.error}`, { ms: 6000 });
    }
    this.app.ui.tabsChanged();
    this.app.refresh();
    this.loader.prefetch(this.app.prefs.prefetch);
  }

  destroy(): void { this.loader.clear(); this.ui.destroy(); }
}

export class App {
  prefs: Prefs = loadPrefs();
  tabs: PictureTab[] = [];
  active!: PictureTab;
  ui!: Shell;
  recording: { name: string; steps: { id: string; arg?: any }[] } | null = null;
  recordingPaused = false;
  private refreshQueued = false;
  private listeners = new Set<(app: App) => void>();
  lastCommand: { id: string; arg?: any } | null = null;
  keyIndex = new Map<string, string>();
  /** Copied picture (for Paste as New Picture when the system clipboard is not readable). */
  clip: Picture | null = null;
  /** Renames, moves, copies and deletes of this session, for Undo File Operation. */
  journal = new Journal();

  constructor(public host: HTMLElement) { this.rebuildKeyIndex(); decodeOptions.autoRotate = this.prefs.autoRotateExif; }

  get tab(): PictureTab { return this.active; }
  /** The picture in the active window, or null. */
  get picture(): Picture | null { return this.active?.picture || null; }
  get viewer(): Viewer { return this.active.ui; }
  get folder(): Folder { return this.active.folder; }

  onRefresh(fn: (app: App) => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  savePrefs(): void { savePrefs(this.prefs); this.rebuildKeyIndex(); decodeOptions.autoRotate = this.prefs.autoRotateExif; }

  rebuildKeyIndex(): void {
    this.keyIndex.clear();
    for (const c of allCommands()) for (const k of c.keys || []) this.keyIndex.set(canonicalKey(k), c.id);
    for (const [k, id] of Object.entries(this.prefs.keymap)) { if (id) this.keyIndex.set(canonicalKey(k), id); else this.keyIndex.delete(canonicalKey(k)); }
  }

  // ------------------------------------------------------------------------------------------
  // Windows (tabs)

  createTab(folder?: Folder): PictureTab {
    const tab = new PictureTab(this, folder);
    this.ui.mountTab(tab);
    this.tabs.push(tab);
    this.activate(tab);
    return tab;
  }

  activate(tab: PictureTab): void {
    this.active = tab;
    for (const d of this.tabs) d.el.classList.toggle('ql-hidden-tab', d !== tab);
    this.ui.tabsChanged();
    tab.ui.layout();
    this.refresh();
    document.title = `${tab.displayName}${tab.dirty ? ' •' : ''} – Anne's Lens`;
  }

  closeTab(tab: PictureTab): void {
    const i = this.tabs.indexOf(tab);
    if (i < 0) return;
    tab.destroy();
    tab.el.remove();
    this.tabs.splice(i, 1);
    if (!this.tabs.length) this.createTab();
    else this.activate(this.tabs[Math.max(0, i - 1)]);
  }

  /** Opens a folder (a set of entries) in the active window, or a new one, and shows `index`. */
  async openFolder(folder: Folder, index = 0, opts: { newWindow?: boolean } = {}): Promise<PictureTab> {
    let tab = this.active;
    if (opts.newWindow || (tab.picture && tab.dirty)) tab = this.createTab(folder);
    else { tab.folder = folder; tab.loader.setFolder(folder); }
    folder.select(index);
    this.activate(tab);
    await tab.show();
    return tab;
  }

  addRecent(e: Entry): void {
    if (!e.uri) return;
    const key = e.uri;
    const list = this.prefs.recent.filter((r) => r.key !== key);
    const old = this.prefs.recent.find((r) => r.key === key);
    list.unshift({ key, name: e.name, when: Date.now(), uri: e.uri, pinned: old?.pinned });
    this.prefs.recent = [...list.filter((r) => r.pinned), ...list.filter((r) => !r.pinned)].slice(0, 40);
    savePrefs(this.prefs);
  }

  /** Called after an edit, undo or redo, and after a picture changes. */
  refresh(): void {
    if (this.refreshQueued) return;
    this.refreshQueued = true;
    requestAnimationFrame(() => {
      this.refreshQueued = false;
      if (!this.active) return;
      this.ui.refresh();
      for (const l of this.listeners) l(this);
    });
  }

  // ------------------------------------------------------------------------------------------
  // Commands

  handleKey(key: string): boolean {
    const id = this.keyIndex.get(canonicalKey(key));
    if (!id) return false;
    const c = getCommand(id);
    if (!c) return false;
    if (c.isEnabled && !c.isEnabled(this)) return false;
    this.exec(id);
    return true;
  }

  exec(id: string, arg?: any): unknown {
    const c = getCommand(id);
    if (!c) { toast(`Unknown command: ${id}`); return false; }
    if (c.edits && !this.picture) { toast('Open a picture first.'); return false; }
    if (c.isEnabled && !c.isEnabled(this)) { toast(`${c.label} is not available here.`); return false; }
    if (this.recording && !c.noRecord && id !== 'dev.recordMacro' && id !== 'dev.stopRecording') this.recordStep(id, arg);
    if (!c.noRecord) this.lastCommand = { id, arg };
    try {
      const r = c.run(this, arg);
      if (r instanceof Promise) r.catch((e) => this.reportError(c, e)).finally(() => this.refresh());
      this.refresh();
      return r;
    } catch (e) {
      this.reportError(c, e);
      return false;
    }
  }

  private reportError(c: Command, e: unknown): void {
    console.error(e);
    toast(`${c.label}: ${(e as any)?.message || e}`, { ms: 6000 });
  }

  recordStep(id: string, arg?: any): void {
    if (!this.recording || this.recordingPaused) return;
    this.recording.steps.push(arg === undefined ? { id } : { id, arg: JSON.parse(JSON.stringify(arg)) });
  }

  /** One undoable edit of the active picture. */
  edit(label: string, fn: (p: Picture) => void): void {
    if (!this.picture) { toast('Open a picture first.'); return; }
    this.active.edit(label, fn);
  }

  followLink(href: string): void {
    if (!/^(https?|mailto):/i.test(href.trim())) { toast(`Blocked a link with an unsupported address: ${href.slice(0, 60)}`); return; }
    import('./platform/native').then(({ openExternal }) => openExternal(href));
  }

  focus(): void { this.active?.ui.focus(); }
}
