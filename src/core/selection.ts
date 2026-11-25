import { LAND, type MapGrid, type Rect } from './grid';

/**
 * Editor selection: a rectangle, optionally narrowed by a per-cell mask covering that
 * rectangle (`mask[(y - sel.y) * sel.w + (x - sel.x)]`). `null` means "the whole map".
 */
export type Selection = (Rect & { mask?: Uint8Array }) | null;

export type SelectOp = 'replace' | 'add' | 'subtract';

export function inSelection(sel: Selection, x: number, y: number): boolean {
  if (!sel) return true;
  if (x < sel.x || y < sel.y || x >= sel.x + sel.w || y >= sel.y + sel.h) return false;
  return !sel.mask || sel.mask[(y - sel.y) * sel.w + (x - sel.x)] === 1;
}

/** Selection normalised from two corner points (inclusive), clipped to the map. */
export function selectionFromCorners(ax: number, ay: number, bx: number, by: number, width: number, height: number): Selection {
  const x0 = Math.max(0, Math.min(ax, bx)), y0 = Math.max(0, Math.min(ay, by));
  const x1 = Math.min(width - 1, Math.max(ax, bx)), y1 = Math.min(height - 1, Math.max(ay, by));
  if (x1 < x0 || y1 < y0) return null;
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Number of selected cells (the whole map for `null`). */
export function selectionArea(sel: Selection, g: MapGrid): number {
  if (!sel) return g.width * g.height;
  if (!sel.mask) return sel.w * sel.h;
  let n = 0;
  for (const v of sel.mask) n += v;
  return n;
}

/**
 * Add `b` to `a` or take it away. An empty result is `null`, which callers treat as "nothing
 * selected". The result's rectangle is trimmed to the cells actually selected.
 */
export function combineSelections(a: Selection, b: Selection, op: SelectOp): Selection {
  if (op === 'replace' || !a) return op === 'subtract' ? null : b;
  if (!b) return a;
  const x0 = op === 'add' ? Math.min(a.x, b.x) : a.x;
  const y0 = op === 'add' ? Math.min(a.y, b.y) : a.y;
  const x1 = op === 'add' ? Math.max(a.x + a.w, b.x + b.w) : a.x + a.w;
  const y1 = op === 'add' ? Math.max(a.y + a.h, b.y + b.h) : a.y + a.h;
  const w = x1 - x0, h = y1 - y0;
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const inA = inSelection(a, x0 + x, y0 + y);
      const inB = inSelection(b, x0 + x, y0 + y);
      mask[y * w + x] = (op === 'add' ? inA || inB : inA && !inB) ? 1 : 0;
    }
  return trim({ x: x0, y: y0, w, h, mask });
}

/** Shrink a masked selection to the bounding box of its cells; drop the mask if it is full. */
export function trim(sel: Selection): Selection {
  if (!sel?.mask) return sel;
  const { w, h, mask } = sel;
  let x0 = w, y0 = h, x1 = -1, y1 = -1, n = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (mask[y * w + x]) {
        n++;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (!n) return null;
  const nw = x1 - x0 + 1, nh = y1 - y0 + 1;
  if (n === nw * nh) return { x: sel.x + x0, y: sel.y + y0, w: nw, h: nh };
  if (nw === w && nh === h) return sel;
  const out = new Uint8Array(nw * nh);
  for (let y = 0; y < nh; y++) out.set(mask.subarray((y + y0) * w + x0, (y + y0) * w + x0 + nw), y * nw);
  return { x: sel.x + x0, y: sel.y + y0, w: nw, h: nh, mask: out };
}

export interface WandOpts {
  /** Land cells match when their elevation is within this many steps of the clicked one. */
  tolerance: number;
  /** Only cells connected to the clicked one (4-connected), or every matching cell on the map. */
  contiguous: boolean;
}

/** Cells of the same terrain as (x, y) (and, on land, similar elevation). */
export function wandSelect(g: MapGrid, x: number, y: number, o: WandOpts): Selection {
  const { width: w, height: h, terrain, mag } = g;
  if (x < 0 || y < 0 || x >= w || y >= h) return null;
  const start = y * w + x;
  const t0 = terrain[start], m0 = mag[start];
  const match = (i: number) => terrain[i] === t0 && (t0 !== LAND || Math.abs(mag[i] - m0) <= o.tolerance);
  const hit = new Uint8Array(w * h);
  let x0 = x, y0 = y, x1 = x, y1 = y;
  const mark = (i: number) => {
    hit[i] = 1;
    const cx = i % w, cy = (i - cx) / w;
    if (cx < x0) x0 = cx;
    if (cx > x1) x1 = cx;
    if (cy < y0) y0 = cy;
    if (cy > y1) y1 = cy;
  };
  if (o.contiguous) {
    const queue = new Int32Array(w * h);
    let tail = 0;
    mark(start);
    queue[tail++] = start;
    for (let head = 0; head < tail; head++) {
      const i = queue[head];
      const cx = i % w;
      const visit = (j: number) => {
        if (!hit[j] && match(j)) {
          mark(j);
          queue[tail++] = j;
        }
      };
      if (cx > 0) visit(i - 1);
      if (cx < w - 1) visit(i + 1);
      if (i >= w) visit(i - w);
      if (i < w * h - w) visit(i + w);
    }
  } else {
    for (let i = 0; i < w * h; i++) if (match(i)) mark(i);
  }
  const sw = x1 - x0 + 1, sh = y1 - y0 + 1;
  const mask = new Uint8Array(sw * sh);
  for (let yy = 0; yy < sh; yy++) mask.set(hit.subarray((y0 + yy) * w + x0, (y0 + yy) * w + x0 + sw), yy * sw);
  return trim({ x: x0, y: y0, w: sw, h: sh, mask });
}

/**
 * Outline of a selection as horizontal and vertical edge runs in map coordinates
 * ([x0, y0, x1, y1] per run), for drawing marching ants.
 */
export function selectionOutline(sel: NonNullable<Selection>): Float32Array {
  const { x: ox, y: oy, w, h } = sel;
  if (!sel.mask) return Float32Array.of(ox, oy, ox + w, oy, ox + w, oy, ox + w, oy + h, ox + w, oy + h, ox, oy + h, ox, oy + h, ox, oy);
  const m = sel.mask;
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < w && y < h ? m[y * w + x] : 0);
  const out: number[] = [];
  // Horizontal edges: between row y-1 and row y.
  for (let y = 0; y <= h; y++) {
    let run = -1;
    for (let x = 0; x <= w; x++) {
      const edge = x < w && at(x, y - 1) !== at(x, y);
      if (edge && run < 0) run = x;
      if (!edge && run >= 0) {
        out.push(ox + run, oy + y, ox + x, oy + y);
        run = -1;
      }
    }
  }
  // Vertical edges: between column x-1 and column x.
  for (let x = 0; x <= w; x++) {
    let run = -1;
    for (let y = 0; y <= h; y++) {
      const edge = y < h && at(x - 1, y) !== at(x, y);
      if (edge && run < 0) run = y;
      if (!edge && run >= 0) {
        out.push(ox + x, oy + run, ox + x, oy + y);
        run = -1;
      }
    }
  }
  return Float32Array.from(out);
}
