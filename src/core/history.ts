import type { MapGrid } from './grid';
import { segmentRect } from './segments';

interface SegPatch {
  seg: number;
  before: Uint8Array; // terrain then mag, segment-rect sized
  after: Uint8Array | null;
}

interface Entry {
  label: string;
  patches: SegPatch[];
  bytes: number;
}

/**
 * Undo/redo as before/after copies of the segments an edit touched.
 * Call `touch(seg)` before changing any cell of `seg` inside a `begin`/`commit` pair.
 */
export class History {
  private undoStack: Entry[] = [];
  private redoStack: Entry[] = [];
  private open: { label: string; patches: Map<number, SegPatch> } | null = null;
  private bytes = 0;

  constructor(private g: MapGrid, private maxBytes = 512 * 1024 * 1024) {}

  get canUndo() {
    return this.undoStack.length > 0;
  }

  get canRedo() {
    return this.redoStack.length > 0;
  }

  get inTransaction() {
    return this.open !== null;
  }

  begin(label: string) {
    if (this.open) this.commit();
    this.open = { label, patches: new Map() };
  }

  touch(seg: number) {
    if (!this.open || this.open.patches.has(seg)) return;
    this.open.patches.set(seg, { seg, before: this.copy(seg), after: null });
  }

  /** Close the transaction; returns the changed segments. */
  commit(): number[] {
    const open = this.open;
    this.open = null;
    if (!open || open.patches.size === 0) return [];
    const patches = [...open.patches.values()];
    let bytes = 0;
    for (const p of patches) {
      p.after = this.copy(p.seg);
      bytes += p.before.length + p.after.length;
    }
    this.undoStack.push({ label: open.label, patches, bytes });
    this.bytes += bytes;
    for (const e of this.redoStack) this.bytes -= e.bytes;
    this.redoStack = [];
    while (this.bytes > this.maxBytes && this.undoStack.length) this.bytes -= this.undoStack.shift()!.bytes;
    return patches.map((p) => p.seg);
  }

  /** Close the transaction by putting back everything it changed; returns the restored segments. */
  abort(): number[] {
    const open = this.open;
    this.open = null;
    if (!open) return [];
    for (const p of open.patches.values()) this.paste(p.seg, p.before);
    return [...open.patches.keys()];
  }

  undo(): number[] {
    const e = this.undoStack.pop();
    if (!e) return [];
    for (const p of e.patches) this.paste(p.seg, p.before);
    this.redoStack.push(e);
    return e.patches.map((p) => p.seg);
  }

  redo(): number[] {
    const e = this.redoStack.pop();
    if (!e) return [];
    for (const p of e.patches) this.paste(p.seg, p.after!);
    this.undoStack.push(e);
    return e.patches.map((p) => p.seg);
  }

  private copy(seg: number): Uint8Array {
    const { width } = this.g;
    const r = segmentRect(width, this.g.height, seg);
    const n = r.w * r.h;
    const out = new Uint8Array(n * 2);
    for (let y = 0; y < r.h; y++) {
      const src = (r.y + y) * width + r.x;
      out.set(this.g.terrain.subarray(src, src + r.w), y * r.w);
      out.set(this.g.mag.subarray(src, src + r.w), n + y * r.w);
    }
    return out;
  }

  private paste(seg: number, data: Uint8Array) {
    const { width } = this.g;
    const r = segmentRect(width, this.g.height, seg);
    const n = r.w * r.h;
    for (let y = 0; y < r.h; y++) {
      const dst = (r.y + y) * width + r.x;
      this.g.terrain.set(data.subarray(y * r.w, (y + 1) * r.w), dst);
      this.g.mag.set(data.subarray(n + y * r.w, n + (y + 1) * r.w), dst);
    }
  }
}
