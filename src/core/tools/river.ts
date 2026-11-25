import { LAND, WATER, type MapGrid, type Rect } from '../grid';
import type { History } from '../history';
import { MIN_LAKE } from '../generator';
import { inSelection, type Selection } from '../selection';
import { brushFootprint, linePoints } from './brush';
import { Edit } from './common';

/**
 * Integer points from a to b where each step moves along one axis only, so a one-pixel
 * river drawn along them is a single body to the generator (it only joins edge neighbours).
 */
export function edgeLinePoints(a: { x: number; y: number }, b: { x: number; y: number }): [number, number][] {
  const out: [number, number][] = [];
  for (const p of linePoints(a, b)) {
    const last = out[out.length - 1];
    if (last && last[0] !== p[0] && last[1] !== p[1]) out.push([p[0], last[1]]);
    out.push(p);
  }
  return out;
}

/** Carve a river from `from` to `to`, `width` pixels wide. Only land becomes water: void and water are left alone. */
export function riverStroke(g: MapGrid, h: History | null, sel: Selection, from: { x: number; y: number }, to: { x: number; y: number }, width: number): Rect {
  const e = new Edit(g, h);
  const fp = brushFootprint(width);
  for (const [px, py] of edgeLinePoints(from, to))
    for (let k = 0; k < fp.length; k += 2) {
      const x = px + fp[k], y = py + fp[k + 1];
      if (x < 0 || y < 0 || x >= g.width || y >= g.height || !inSelection(sel, x, y)) continue;
      if (g.terrain[y * g.width + x] !== LAND) continue;
      e.set(x, y, { terrain: WATER, mag: 0 });
    }
  return e.rect();
}

/**
 * Whether the water at (x, y) survives export: its body is at least `min` px.
 * (The generator also keeps the single largest body, but a drawn river is never that.)
 * Returns the body size, counted up to `min`.
 */
export function waterStays(g: MapGrid, x: number, y: number, min = MIN_LAKE): { stays: boolean; size: number } {
  const { width: w, height: hgt, terrain } = g;
  const start = y * w + x;
  if (x < 0 || y < 0 || x >= w || y >= hgt || terrain[start] !== WATER) return { stays: false, size: 0 };
  const seen = new Set([start]);
  const queue = [start];
  for (let k = 0; k < queue.length && queue.length < min; k++) {
    const i = queue[k];
    const cx = i % w;
    const visit = (j: number) => {
      if (!seen.has(j) && terrain[j] === WATER) {
        seen.add(j);
        queue.push(j);
      }
    };
    if (cx > 0) visit(i - 1);
    if (cx < w - 1) visit(i + 1);
    if (i >= w) visit(i - w);
    if (i < w * hgt - w) visit(i + w);
  }
  return { stays: queue.length >= min, size: Math.min(queue.length, min) };
}
