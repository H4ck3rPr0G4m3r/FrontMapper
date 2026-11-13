import { LAND, WATER, type MapGrid, type Rect } from '../grid';
import type { History } from '../history';
import { MIN_ISLAND } from '../generator';
import { Edit } from './common';

/**
 * Grow an island into neighbouring water, ring by ring (each ring in y-then-x order),
 * until it has at least `min` cells. New land gets magnitude 0. Void is never used.
 */
export function growIsland(g: MapGrid, h: History | null, cells: Int32Array, min = MIN_ISLAND): Rect {
  const e = new Edit(g, h);
  const w = g.width;
  const inIsland = new Set<number>(cells);
  let size = inIsland.size;
  let frontier = Array.from(cells);
  while (size < min && frontier.length) {
    const ring = new Set<number>();
    for (const i of frontier) {
      const x = i % w;
      const y = (i - x) / w;
      if (x > 0) ring.add(i - 1);
      if (x < w - 1) ring.add(i + 1);
      if (y > 0) ring.add(i - w);
      if (y < g.height - 1) ring.add(i + w);
    }
    const next = [...ring].filter((j) => !inIsland.has(j) && g.terrain[j] === WATER).sort((a, b) => a - b);
    frontier = [];
    for (const j of next) {
      if (size >= min) break;
      const x = j % w;
      e.touch(x, (j - x) / w);
      g.terrain[j] = LAND;
      g.mag[j] = 0;
      inIsland.add(j);
      frontier.push(j);
      size++;
    }
  }
  return e.rect();
}
