import type { MapGrid, Rect } from '../grid';
import type { History } from '../history';
import { inSelection, type Selection } from '../selection';
import { Edit, unionRect, type Paint } from './common';

export type { Paint } from './common';

const footprints = new Map<number, Int16Array>();

/**
 * Cells covered by a round brush of `diameter` pixels, as [dx, dy] pairs relative to the
 * cursor cell. A cell is in if its centre is within diameter/2 of the brush centre, which is
 * the cursor cell's centre for odd diameters and its top-left corner for even ones.
 */
export function brushFootprint(diameter: number): Int16Array {
  const d = Math.max(1, Math.round(diameter));
  const cached = footprints.get(d);
  if (cached) return cached;
  const c = d % 2 ? 0.5 : 0;
  const r = d / 2;
  const reach = Math.ceil(r) + 1;
  const out: number[] = [];
  for (let dy = -reach; dy <= reach; dy++)
    for (let dx = -reach; dx <= reach; dx++)
      if ((dx + 0.5 - c) ** 2 + (dy + 0.5 - c) ** 2 <= r * r) out.push(dx, dy);
  const fp = Int16Array.from(out);
  footprints.set(d, fp);
  return fp;
}

/** Visit every in-map, in-selection cell of the brush at (x, y). */
export function forFootprint(g: MapGrid, sel: Selection, x: number, y: number, diameter: number, fn: (cx: number, cy: number, dx: number, dy: number) => void) {
  const fp = brushFootprint(diameter);
  for (let k = 0; k < fp.length; k += 2) {
    const cx = x + fp[k], cy = y + fp[k + 1];
    if (cx < 0 || cy < 0 || cx >= g.width || cy >= g.height || !inSelection(sel, cx, cy)) continue;
    fn(cx, cy, fp[k], fp[k + 1]);
  }
}

export function paintAt(g: MapGrid, h: History | null, sel: Selection, x: number, y: number, diameter: number, p: Paint): Rect {
  const e = new Edit(g, h);
  forFootprint(g, sel, x, y, diameter, (cx, cy) => e.set(cx, cy, p));
  return e.rect();
}

/** Integer points from a to b inclusive (Bresenham). */
export function linePoints(a: { x: number; y: number }, b: { x: number; y: number }): [number, number][] {
  let x0 = Math.floor(a.x), y0 = Math.floor(a.y);
  const x1 = Math.floor(b.x), y1 = Math.floor(b.y);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  const out: [number, number][] = [];
  for (;;) {
    out.push([x0, y0]);
    if (x0 === x1 && y0 === y1) return out;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

export function paintStroke(g: MapGrid, h: History | null, sel: Selection, from: { x: number; y: number }, to: { x: number; y: number }, diameter: number, p: Paint): Rect {
  let r: Rect = { x: 0, y: 0, w: 0, h: 0 };
  for (const [x, y] of linePoints(from, to)) r = unionRect(r, paintAt(g, h, sel, x, y, diameter, p));
  return r;
}
