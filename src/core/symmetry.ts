import type { MapGrid, Rect } from './grid';
import type { History } from './history';
import { inSelection, type Selection } from './selection';
import { Edit } from './tools/common';
import { touchLog } from './tools/common';

/**
 * Symmetry modes for painting. Axes run through the centre of the map.
 * - `x`: mirror left to right
 * - `y`: mirror top to bottom
 * - `xy`: both, four copies
 * - `rot`: half turn around the centre (fair for two sides without mirroring coastlines)
 */
export type Symmetry = 'off' | 'x' | 'y' | 'xy' | 'rot';

/** The other cells a cell maps to under `s` (not including itself; may repeat it on an axis). */
export function mirrorCells(s: Symmetry, w: number, h: number, x: number, y: number): [number, number][] {
  const mx = w - 1 - x, my = h - 1 - y;
  switch (s) {
    case 'off': return [];
    case 'x': return [[mx, y]];
    case 'y': return [[x, my]];
    case 'xy': return [[mx, y], [x, my], [mx, my]];
    case 'rot': return [[mx, my]];
  }
}

/**
 * Run `fn` (which edits the map) and copy every cell it changed to its mirror positions,
 * so the result is exactly symmetric however the tool itself works (noise, smoothing...).
 * Mirror positions outside the selection are left alone, like the tool itself would.
 */
export function withSymmetry(g: MapGrid, h: History | null, s: Symmetry, fn: () => Rect, sel: Selection = null): Rect {
  if (s === 'off') return fn();
  const outer = touchLog.cells;
  const log: number[] = [];
  touchLog.cells = log;
  let r: Rect;
  try {
    r = fn();
  } finally {
    touchLog.cells = outer;
  }
  if (!log.length) return r;
  const e = new Edit(g, h);
  const w = g.width;
  const seen = new Set<number>();
  for (const i of log) {
    if (seen.has(i)) continue;
    seen.add(i);
    const x = i % w, y = (i - x) / w;
    for (const [cx, cy] of mirrorCells(s, w, g.height, x, y)) {
      const j = cy * w + cx;
      if (j === i || seen.has(j) || !inSelection(sel, cx, cy)) continue;
      if (g.terrain[j] === g.terrain[i] && g.mag[j] === g.mag[i]) continue;
      e.touch(cx, cy);
      g.terrain[j] = g.terrain[i];
      g.mag[j] = g.mag[i];
    }
  }
  const m = e.rect();
  if (!m.w) return r;
  if (!r.w) return m;
  const x0 = Math.min(r.x, m.x), y0 = Math.min(r.y, m.y);
  return { x: x0, y: y0, w: Math.max(r.x + r.w, m.x + m.w) - x0, h: Math.max(r.y + r.h, m.y + m.h) - y0 };
}
