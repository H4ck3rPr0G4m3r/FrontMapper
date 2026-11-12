import { LAND, type MapGrid, type Rect, type Terrain } from '../grid';
import type { History } from '../history';
import { SEGMENT } from '../segments';

export type Paint = { terrain: Terrain; mag: number };

/** Tracks the bounding box of changed cells and snapshots segments before they change. */
export class Edit {
  x0 = Infinity;
  y0 = Infinity;
  x1 = -Infinity;
  y1 = -Infinity;
  private cols: number;
  private lastSeg = -1;

  constructor(readonly g: MapGrid, readonly h: History | null) {
    this.cols = Math.ceil(g.width / SEGMENT);
  }

  /** Call before writing cell (x, y). */
  touch(x: number, y: number) {
    if (x < this.x0) this.x0 = x;
    if (y < this.y0) this.y0 = y;
    if (x > this.x1) this.x1 = x;
    if (y > this.y1) this.y1 = y;
    if (this.h) {
      const seg = Math.floor(y / SEGMENT) * this.cols + Math.floor(x / SEGMENT);
      if (seg !== this.lastSeg) {
        this.h.touch(seg);
        this.lastSeg = seg;
      }
    }
  }

  set(x: number, y: number, p: Paint) {
    const i = y * this.g.width + x;
    const mag = p.terrain === LAND ? p.mag : 0;
    if (this.g.terrain[i] === p.terrain && this.g.mag[i] === mag) return;
    this.touch(x, y);
    this.g.terrain[i] = p.terrain;
    this.g.mag[i] = mag;
  }

  rect(): Rect {
    if (this.x1 < this.x0) return { x: 0, y: 0, w: 0, h: 0 };
    return { x: this.x0, y: this.y0, w: this.x1 - this.x0 + 1, h: this.y1 - this.y0 + 1 };
  }
}

export function unionRect(a: Rect, b: Rect): Rect {
  if (!a.w || !a.h) return b;
  if (!b.w || !b.h) return a;
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}
