/**
 * The file-operation journal: every rename, move, copy and delete of this session, newest last, with
 * what it takes to undo it. Deleted files keep their bytes (up to a budget) so Undo can put them back
 * even where the platform has no Recycle Bin.
 */
export type FileOpKind = 'rename' | 'move' | 'copy' | 'delete';

export interface FileOp {
  kind: FileOpKind;
  /** "Renamed a.jpg to b.jpg", "Moved x.png to Keep" */
  label: string;
  when: number;
  /** Reverses the operation; absent when it cannot be undone (the label says why). */
  undo?: () => Promise<void>;
  /** Why there is no undo. */
  noUndo?: string;
  /** Bytes kept for restoring a deleted file. */
  bytes?: ArrayBuffer;
}

export class Journal {
  ops: FileOp[] = [];
  /** Bytes of deleted files kept in memory, oldest dropped first past this budget. */
  budget = 96 * 1024 * 1024;
  private listeners = new Set<() => void>();

  onChange(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private changed(): void { for (const l of this.listeners) l(); }

  push(op: FileOp): void {
    this.ops.push(op);
    if (this.ops.length > 200) this.ops.shift();
    let kept = 0;
    for (let i = this.ops.length - 1; i >= 0; i--) {
      const o = this.ops[i];
      if (!o.bytes) continue;
      kept += o.bytes.byteLength;
      if (kept > this.budget) { o.bytes = undefined; if (o.undo) { o.undo = undefined; o.noUndo = 'its bytes were dropped to free memory'; } }
    }
    this.changed();
  }

  /** The newest operation that can still be undone, or null. */
  get last(): FileOp | null { return this.ops.length ? this.ops[this.ops.length - 1] : null; }
  get canUndo(): boolean { return !!this.last?.undo; }

  /** Undoes the newest operation and removes it from the journal. */
  async undoLast(): Promise<FileOp | null> {
    const op = this.last;
    if (!op) return null;
    if (!op.undo) throw new Error(`${op.label} cannot be undone${op.noUndo ? `: ${op.noUndo}` : ''}.`);
    await op.undo();
    this.ops.pop();
    this.changed();
    return op;
  }

  clear(): void { this.ops = []; this.changed(); }
}
