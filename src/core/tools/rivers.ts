import { LAND, WATER, type MapGrid, type Rect } from '../grid';
import type { History } from '../history';
import { MIN_ISLAND, MIN_LAKE } from '../generator';
import { Edit } from './common';

/** Largest stretch of land a river gap may span (pixels). */
export const RIVER_GAP = 3;

/**
 * Keep rivers that the generator would fill in as small lakes:
 * 1. Join each small water body to the nearest other water (river piece, lake or sea) at most
 *    `maxGap` land pixels away, by turning the shortest land path between them into water.
 * 2. Widen what is still under `min` pixels, ring by ring into land, if it is a waterway:
 *    joined from several pieces, or long and thin. Round ponds are left as they are.
 * Void is never crossed or used.
 */
export function growRivers(g: MapGrid, h: History | null, maxGap = RIVER_GAP, min = MIN_LAKE): Rect {
  const e = new Edit(g, h);
  const { width: w, height: hgt, terrain } = g;
  const n = w * hgt;
  const neighbours = (i: number, out: number[]) => {
    out.length = 0;
    const x = i % w;
    if (x > 0) out.push(i - 1);
    if (x < w - 1) out.push(i + 1);
    if (i >= w) out.push(i - w);
    if (i < n - w) out.push(i + w);
    return out;
  };
  const nb: number[] = [];

  // Water bodies (4-connected). Cells are kept only for the small ones.
  const label = new Int32Array(n).fill(-1);
  const parent: number[] = [];
  const size: number[] = [];
  const pieces: number[] = [];
  const cells: (number[] | null)[] = [];
  const small: number[] = [];
  const queue: number[] = [];
  for (let s = 0; s < n; s++) {
    if (terrain[s] !== WATER || label[s] >= 0) continue;
    const l = parent.length;
    label[s] = l;
    queue.length = 0;
    queue.push(s);
    for (let k = 0; k < queue.length; k++)
      for (const j of neighbours(queue[k], nb))
        if (terrain[j] === WATER && label[j] < 0) { label[j] = l; queue.push(j); }
    parent.push(l);
    size.push(queue.length);
    pieces.push(1);
    cells.push(queue.length < min ? queue.slice() : null);
    if (queue.length < min) small.push(l);
  }
  const find = (l: number) => {
    while (parent[l] !== l) l = parent[l] = parent[parent[l]];
    return l;
  };
  const safe = (r: number) => size[r] >= min;

  // Land that was already a deletable island before this tool ran (left for Grow to 30).
  const wasIsland = smallLand(g, MIN_ISLAND, neighbours);
  const carved: number[] = [];
  const toWater = (i: number) => {
    const x = i % w;
    e.touch(x, (i - x) / w);
    terrain[i] = WATER;
    g.mag[i] = 0;
    carved.push(i);
  };
  const carve = (i: number, r: number) => {
    toWater(i);
    label[i] = r;
    size[r]++;
    cells[r]?.push(i);
  };

  // 1. Bridges, nearest first, until no small body can reach other water.
  for (let progress = true; progress; ) {
    progress = false;
    for (const l of small) {
      const r = find(l);
      if (safe(r)) continue;
      const path = nearestWater(r);
      if (!path) continue;
      const other = find(label[path.to]);
      const [a, b] = size[r] >= size[other] ? [r, other] : [other, r];
      parent[b] = a;
      size[a] += size[b];
      pieces[a] += pieces[b];
      cells[a] = safe(a) || !cells[a] || !cells[b] ? null : cells[a]!.concat(cells[b]!);
      for (const i of path.land) carve(i, a);
      progress = true;
    }
  }

  /** Shortest path over land (at most maxGap cells) from body set `r` to water of another set. */
  function nearestWater(r: number): { land: number[]; to: number } | null {
    const from = new Map<number, number>(); // land cell -> previous cell (-1 at the body)
    let frontier = cells[r]!;
    for (let depth = 0; depth <= maxGap && frontier.length; depth++) {
      const next: number[] = [];
      for (const i of frontier) {
        for (const j of neighbours(i, nb)) {
          if (terrain[j] === WATER) {
            if (find(label[j]) === r) continue;
            const land: number[] = [];
            for (let c = terrain[i] === LAND ? i : -1; c >= 0; c = from.get(c)!) land.push(c);
            return { land, to: j };
          }
          if (depth < maxGap && terrain[j] === LAND && !from.has(j)) {
            from.set(j, terrain[i] === LAND ? i : -1);
            next.push(j);
          }
        }
      }
      frontier = next;
    }
    return null;
  }

  // 2. Widen waterways that are still too small.
  const done = new Set<number>();
  for (const l of small) {
    const r = find(l);
    if (done.has(r) || safe(r)) continue;
    done.add(r);
    const body = cells[r]!;
    if (pieces[r] < 2 && !isThin(body, w)) continue;
    const inBody = new Set(body);
    let frontier = body;
    while (size[r] < min && frontier.length) {
      const ring = new Set<number>();
      for (const i of frontier) for (const j of neighbours(i, nb)) if (terrain[j] === LAND && !inBody.has(j)) ring.add(j);
      frontier = [];
      for (const j of [...ring].sort((a, b) => a - b)) {
        if (size[r] >= min) break;
        carve(j, r);
        inBody.add(j);
        frontier.push(j);
      }
    }
  }

  // 3. Slivers of land cut off by the new water would be deleted on export anyway; flood them now.
  const seen = new Uint8Array(n);
  const body: number[] = [];
  for (let k = 0; k < carved.length; k++) {
    for (const s of neighbours(carved[k], [])) {
      if (terrain[s] !== LAND || seen[s] || wasIsland[s]) continue;
      body.length = 0;
      body.push(s);
      seen[s] = 1;
      for (let q = 0; q < body.length && body.length < MIN_ISLAND; q++)
        for (const j of neighbours(body[q], nb)) if (terrain[j] === LAND && !seen[j]) { seen[j] = 1; body.push(j); }
      if (body.length < MIN_ISLAND && !body.some((c) => wasIsland[c])) for (const c of body) toWater(c);
    }
  }
  return e.rect();
}

/** Marks land cells in 4-connected land bodies smaller than `min`. */
function smallLand(g: MapGrid, min: number, neighbours: (i: number, out: number[]) => number[]) {
  const n = g.width * g.height;
  const out = new Uint8Array(n);
  const seen = new Uint8Array(n);
  const nb: number[] = [];
  const queue: number[] = [];
  for (let s = 0; s < n; s++) {
    if (g.terrain[s] !== LAND || seen[s]) continue;
    queue.length = 0;
    queue.push(s);
    seen[s] = 1;
    for (let k = 0; k < queue.length; k++)
      for (const j of neighbours(queue[k], nb)) if (g.terrain[j] === LAND && !seen[j]) { seen[j] = 1; queue.push(j); }
    if (queue.length < min) for (const c of queue) out[c] = 1;
  }
  return out;
}

/** Long and narrow: at least 6 px long and on average at most 3 px wide. */
function isThin(body: number[], w: number) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const i of body) {
    const x = i % w, y = (i - x) / w;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  const long = Math.max(x1 - x0, y1 - y0) + 1;
  return long >= 6 && body.length / long <= 3;
}
