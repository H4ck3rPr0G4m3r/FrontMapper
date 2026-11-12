import type { Rect } from './grid';

/** Segment edge length in pixels. Rendering, history and jobs all work per segment. */
export const SEGMENT = 256;

export function segmentCols(width: number) {
  return Math.ceil(width / SEGMENT);
}

export function segmentRect(width: number, height: number, seg: number): Rect {
  const cols = segmentCols(width);
  const sx = seg % cols, sy = (seg - sx) / cols;
  const x = sx * SEGMENT, y = sy * SEGMENT;
  return { x, y, w: Math.min(SEGMENT, width - x), h: Math.min(SEGMENT, height - y) };
}

/** Indices (`sy * cols + sx`) of segments overlapping `r`, clipped to the map. */
export function segmentsCovering(width: number, height: number, r: Rect): number[] {
  const cols = segmentCols(width);
  const rows = Math.ceil(height / SEGMENT);
  const sx0 = Math.max(0, Math.floor(r.x / SEGMENT));
  const sy0 = Math.max(0, Math.floor(r.y / SEGMENT));
  const sx1 = Math.min(cols - 1, Math.floor((r.x + r.w - 1) / SEGMENT));
  const sy1 = Math.min(rows - 1, Math.floor((r.y + r.h - 1) / SEGMENT));
  const out: number[] = [];
  for (let sy = sy0; sy <= sy1; sy++) for (let sx = sx0; sx <= sx1; sx++) out.push(sy * cols + sx);
  return out;
}

interface Job {
  key: string;
  seg: number;
  run: () => void;
  prio: number;
}

/**
 * Time-sliced job queue. Jobs for the segments closest to the focus (normally the
 * centre of the view) run first, so what's on screen updates before what isn't.
 */
export class SegmentScheduler {
  private jobs = new Map<string, Job>();
  private heap: Job[] = [];
  private focusX: number;
  private focusY: number;
  private idleWaiters: (() => void)[] = [];
  private readonly cols: number;

  constructor(readonly width: number, readonly height: number, private budgetMs = 8) {
    this.cols = segmentCols(width);
    this.focusX = width / 2;
    this.focusY = height / 2;
  }

  get pending() {
    return this.jobs.size;
  }

  enqueue(kind: string, seg: number, run: () => void) {
    const key = `${kind}:${seg}`;
    const existing = this.jobs.get(key);
    if (existing) {
      existing.run = run; // replaced: keeps its heap slot
      return;
    }
    const job: Job = { key, seg, run, prio: this.priority(seg) };
    this.jobs.set(key, job);
    this.heapPush(job);
  }

  setFocus(x: number, y: number) {
    this.focusX = x;
    this.focusY = y;
    for (const j of this.heap) j.prio = this.priority(j.seg);
    // Re-heapify.
    for (let i = (this.heap.length >> 1) - 1; i >= 0; i--) this.siftDown(i);
  }

  /** Run jobs nearest-first until the time budget is spent. */
  pump(now: () => number = () => performance.now()) {
    const start = now();
    while (this.heap.length && now() - start < this.budgetMs) {
      const job = this.heapPop()!;
      this.jobs.delete(job.key);
      job.run();
    }
    if (!this.heap.length && this.idleWaiters.length) {
      const waiters = this.idleWaiters;
      this.idleWaiters = [];
      waiters.forEach((w) => w());
    }
  }

  whenIdle(): Promise<void> {
    if (!this.heap.length) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private priority(seg: number) {
    const sx = seg % this.cols, sy = (seg - sx) / this.cols;
    const cx = (sx + 0.5) * SEGMENT, cy = (sy + 0.5) * SEGMENT;
    return (cx - this.focusX) ** 2 + (cy - this.focusY) ** 2;
  }

  private heapPush(j: Job) {
    this.heap.push(j);
    let i = this.heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.heap[p].prio <= this.heap[i].prio) break;
      [this.heap[p], this.heap[i]] = [this.heap[i], this.heap[p]];
      i = p;
    }
  }

  private heapPop(): Job | undefined {
    const h = this.heap;
    if (!h.length) return undefined;
    const top = h[0];
    const last = h.pop()!;
    if (h.length) {
      h[0] = last;
      this.siftDown(0);
    }
    return top;
  }

  private siftDown(i: number) {
    const h = this.heap;
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      let m = i;
      if (l < h.length && h[l].prio < h[m].prio) m = l;
      if (r < h.length && h[r].prio < h[m].prio) m = r;
      if (m === i) return;
      [h[m], h[i]] = [h[i], h[m]];
      i = m;
    }
  }
}
