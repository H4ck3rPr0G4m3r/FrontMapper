import { LAND, VOID, WATER, type MapGrid, type Rect } from '../grid';
import type { History } from '../history';
import { MIN_ISLAND, MIN_LAKE } from '../generator';
import { Edit } from './common';

/** Largest stretch of land a river gap may span in any direction (pixels). */
export const RIVER_GAP = 3;
/** Longest gap bridged straight on from a river's end, and only to the sea or a lake that stays. */
export const RIVER_REACH = 10;
/** A river is only widened if it can stay at most this wide on average; shorter ones are left alone. */
export const MAX_RIVER_WIDTH = 3;

export interface RiverReport {
  rect: Rect;
  /** Cells turned into water. */
  carved: number[];
  /** Corner joints closed (pixels that only touched diagonally, which the generator splits). */
  joints: number;
  /** Gaps of land bridged. */
  bridges: number;
  /** Rivers widened because they reach no sea or lake. */
  widened: number;
  /** River pieces left as they are: they would have to grow into a lake to stay. */
  tooShort: number;
  /** Small round lakes left as they are. */
  ponds: number;
}

/**
 * Keep rivers that the generator would fill in as small lakes, changing as little as possible:
 * 1. Close corner joints: river pixels that touch only diagonally are separate bodies to the
 *    generator; one pixel joins them.
 * 2. Bridge gaps of up to `RIVER_GAP` px to other river pieces, the sea or a lake, and gaps of
 *    up to `RIVER_REACH` px straight on from a river's end to the sea or a lake that stays.
 * 3. Only as a last resort, widen a river that still reaches nothing, evenly from its
 *    downstream end, by just the missing pixels. Rivers that would end up wider than
 *    `MAX_RIVER_WIDTH` on average are too short to be rivers and are left alone.
 * Round ponds are never joined, bridged to or widened. Void is never crossed or used.
 */
export function growRivers(g: MapGrid, h: History | null, min = MIN_LAKE): RiverReport {
  const e = new Edit(g, h);
  const { width: w, height: hgt, terrain } = g;
  const n = w * hgt;
  const nb: number[] = [];
  const n4 = (i: number, out: number[]) => {
    out.length = 0;
    const x = i % w;
    if (x > 0) out.push(i - 1);
    if (x < w - 1) out.push(i + 1);
    if (i >= w) out.push(i - w);
    if (i < n - w) out.push(i + w);
    return out;
  };
  const n8 = (i: number, out: number[]) => {
    n4(i, out);
    const x = i % w, y = (i - x) / w;
    for (const [dx, dy] of DIAGONALS) {
      const cx = x + dx, cy = y + dy;
      if (cx >= 0 && cy >= 0 && cx < w && cy < hgt) out.push(cy * w + cx);
    }
    return out;
  };

  // Water bodies (4-connected, like the generator). Cells are kept for the small ones.
  const label = new Int32Array(n).fill(-1);
  const parent: number[] = [];
  const size: number[] = [];
  const cells: (number[] | null)[] = [];
  const queue: number[] = [];
  let largest = -1;
  for (let s = 0; s < n; s++) {
    if (terrain[s] !== WATER || label[s] >= 0) continue;
    const l = parent.length;
    label[s] = l;
    queue.length = 0;
    queue.push(s);
    for (let k = 0; k < queue.length; k++)
      for (const j of n4(queue[k], nb))
        if (terrain[j] === WATER && label[j] < 0) { label[j] = l; queue.push(j); }
    parent.push(l);
    size.push(queue.length);
    cells.push(queue.length < min ? queue.slice() : null);
    if (largest < 0 || queue.length > size[largest]) largest = l;
  }
  const find = (l: number) => {
    while (parent[l] !== l) l = parent[l] = parent[parent[l]];
    return l;
  };
  // The largest body is the generator's ocean and stays whatever its size.
  const safe = (r: number) => size[r] >= min || find(largest) === r;

  // River or pond: small bodies are grouped with the ones they touch diagonally, and a group
  // is a river if it is long and thin.
  const river: boolean[] = new Array(parent.length).fill(false);
  const smallIds: number[] = [];
  for (let l = 0; l < parent.length; l++) if (!safe(l)) smallIds.push(l);
  {
    const grouped = new Set<number>();
    const isSmall = (i: number) => terrain[i] === WATER && !safe(label[i]);
    for (const l of smallIds) {
      if (grouped.has(l)) continue;
      const group: number[] = [];
      const bodies = new Set<number>([l]);
      const seen = new Set<number>(cells[l]!);
      group.push(...cells[l]!);
      for (let k = 0; k < group.length; k++)
        for (const j of n8(group[k], nb))
          if (!seen.has(j) && isSmall(j)) {
            seen.add(j);
            bodies.add(label[j]);
            group.push(j);
          }
      const isRiver = thin(group.length, geodesicLength(group, seen, n8));
      for (const b of bodies) {
        grouped.add(b);
        river[b] = isRiver;
      }
    }
  }
  let ponds = 0;
  for (const l of smallIds) if (!river[l]) ponds++;

  const wasIsland = smallLand(g, MIN_ISLAND, n4);
  const carved: number[] = [];
  const toWater = (i: number) => {
    const x = i % w;
    e.touch(x, (i - x) / w);
    terrain[i] = WATER;
    g.mag[i] = 0;
    carved.push(i);
  };
  const union = (a: number, b: number) => {
    a = find(a);
    b = find(b);
    if (a === b) return a;
    const [big, sm] = size[a] >= size[b] ? [a, b] : [b, a];
    parent[sm] = big;
    size[big] += size[sm];
    cells[big] = cells[big] && cells[sm] ? cells[big]!.concat(cells[sm]!) : null;
    river[big] = river[big] || river[sm];
    return big;
  };
  const carve = (i: number, r: number) => {
    toWater(i);
    label[i] = r;
    size[r]++;
    cells[r]?.push(i);
  };
  /** May a river be joined to this body? Rivers, lakes that stay and the sea; never ponds. */
  const joinable = (r: number) => safe(r) || river[r];

  // 1. Corner joints.
  let joints = 0;
  for (const l of smallIds) {
    if (!river[l]) continue;
    for (const i of cells[l]!.slice()) {
      const x = i % w, y = (i - x) / w;
      for (const [dx, dy] of DIAGONALS) {
        const cx = x + dx, cy = y + dy;
        if (cx < 0 || cy < 0 || cx >= w || cy >= hgt) continue;
        const d = cy * w + cx;
        if (terrain[d] !== WATER) continue;
        const r = find(label[i]), o = find(label[d]);
        if (r === o || !joinable(o) || (safe(r) && safe(o))) continue;
        const a = y * w + cx, b = cy * w + x;
        const via = terrain[a] === LAND ? a : terrain[b] === LAND ? b : -1;
        if (via < 0) continue;
        const merged = union(r, o);
        carve(via, merged);
        joints++;
      }
    }
  }

  // 2. Bridges, until no river piece that would be lost can reach anything more.
  let bridges = 0;
  for (let progress = true; progress; ) {
    progress = false;
    const done = new Set<number>();
    for (const l of smallIds) {
      if (!river[l]) continue;
      const r = find(l);
      if (done.has(r) || safe(r)) continue;
      done.add(r);
      const path = nearest(r) ?? straightOn(r);
      if (!path) continue;
      const merged = union(r, find(label[path.to]));
      for (const i of path.land) carve(i, merged);
      bridges++;
      progress = true;
    }
  }

  /** Shortest path over land (at most RIVER_GAP cells) from body `r` to joinable water. */
  function nearest(r: number): Path | null {
    const from = new Map<number, number>(); // land cell -> previous cell (-1 at the body)
    let frontier = cells[r]!;
    for (let depth = 0; depth <= RIVER_GAP && frontier.length; depth++) {
      const next: number[] = [];
      for (const i of frontier) {
        for (const j of n4(i, nb)) {
          if (terrain[j] === WATER) {
            const o = find(label[j]);
            if (o === r || !joinable(o)) continue;
            return { land: trace(from, terrain[i] === LAND ? i : -1), to: j };
          }
          if (depth < RIVER_GAP && terrain[j] === LAND && !from.has(j)) {
            from.set(j, terrain[i] === LAND ? i : -1);
            next.push(j);
          }
        }
      }
      frontier = next;
    }
    return null;
  }

  /** Shortest path over land from either end of river `r`, roughly in the river's direction, to water that stays. */
  function straightOn(r: number): Path | null {
    const body = cells[r]!;
    const ends = riverEnds(body);
    if (!ends) return null;
    let best: Path | null = null;
    for (const { end, dx, dy } of ends) {
      const from = new Map<number, number>();
      const ex = end % w, ey = (end - ex) / w;
      let frontier = [end];
      search: for (let depth = 0; depth <= RIVER_REACH && frontier.length; depth++) {
        const next: number[] = [];
        for (const i of frontier) {
          for (const j of n4(i, nb)) {
            if (terrain[j] === WATER) {
              const o = find(label[j]);
              if (o === r || !safe(o)) continue;
              const p = { land: trace(from, i === end ? -1 : i), to: j };
              if (!best || p.land.length < best.land.length) best = p;
              break search;
            }
            if (depth >= RIVER_REACH || terrain[j] !== LAND || from.has(j)) continue;
            const jx = j % w, jy = (j - jx) / w;
            const vx = jx - ex, vy = jy - ey;
            const len = Math.hypot(vx, vy);
            if (len > 1.5 && (vx * dx + vy * dy) / len < 0.6) continue; // outside a ~53 degree cone
            from.set(j, i === end ? -1 : i);
            next.push(j);
          }
        }
        frontier = next;
      }
    }
    return best;
  }

  /** Both ends of a river and the direction it flows out of each (unit vectors). */
  function riverEnds(body: number[]) {
    const inBody = new Set(body);
    const a = farthest(body[0], inBody, n4).far;
    const { far: b, dist, prev } = farthest(a, inBody, n4);
    const length = (dist.get(b) ?? 0) + 1;
    if (length < 3) return null;
    const path: number[] = [];
    for (let c: number | undefined = b; c !== undefined; c = prev.get(c)) path.push(c); // b ... a
    const k = Math.min(6, Math.floor(length / 2));
    const dir = (end: number, back: number) => {
      const x0 = back % w, y0 = (back - x0) / w, x1 = end % w, y1 = (end - x1) / w;
      const len = Math.hypot(x1 - x0, y1 - y0) || 1;
      return { end, dx: (x1 - x0) / len, dy: (y1 - y0) / len };
    };
    return [dir(b, path[k]), dir(a, path[path.length - 1 - k])];
  }

  // 3. Widen what is still lost, if it is long enough to stay a river.
  let widened = 0;
  let tooShort = 0;
  const done = new Set<number>();
  for (const l of smallIds) {
    if (!river[l]) continue;
    const r = find(l);
    if (done.has(r) || safe(r)) continue;
    done.add(r);
    const body = cells[r]!;
    const inBody = new Set(body);
    const a = farthest(body[0], inBody, n4).far;
    const sweep = farthest(a, inBody, n4);
    const length = (sweep.dist.get(sweep.far) ?? 0) + 1;
    if (length * MAX_RIVER_WIDTH < min) {
      tooShort++;
      continue;
    }
    // Widen from the end nearer the sea or a lake, so the river grows wider downstream.
    const b = sweep.far;
    const upstream = distanceToSafe(b) < distanceToSafe(a) ? a : b;
    const arc = farthest(upstream, inBody, n4).dist;
    let frontier = body.slice();
    while (size[r] < min && frontier.length) {
      const ring = new Map<number, number>();
      for (const i of frontier) {
        const at = arc.get(i) ?? 0;
        for (const j of n4(i, nb)) if (terrain[j] === LAND && !inBody.has(j)) ring.set(j, Math.max(ring.get(j) ?? 0, at));
      }
      frontier = [];
      for (const [j, at] of [...ring].sort((p, q) => q[1] - p[1] || p[0] - q[0])) {
        if (size[r] >= min) break;
        carve(j, r);
        inBody.add(j);
        arc.set(j, at);
        frontier.push(j);
      }
    }
    widened++;
  }

  /** Steps from a cell to the nearest water that stays (through anything but void), capped at 64. */
  function distanceToSafe(start: number) {
    const seen = new Set([start]);
    let frontier = [start];
    for (let d = 0; d <= 64 && frontier.length; d++) {
      const next: number[] = [];
      for (const i of frontier) {
        if (terrain[i] === WATER && label[i] >= 0 && safe(find(label[i]))) return d;
        for (const j of n4(i, nb)) if (!seen.has(j) && terrain[j] !== VOID) { seen.add(j); next.push(j); }
      }
      frontier = next;
    }
    return Infinity;
  }

  // 4. Slivers of land cut off by the new water would be deleted on export anyway; flood them now.
  const seen = new Uint8Array(n);
  const sliver: number[] = [];
  for (let k = 0; k < carved.length; k++) {
    for (const s of n4(carved[k], [])) {
      if (terrain[s] !== LAND || seen[s] || wasIsland[s]) continue;
      sliver.length = 0;
      sliver.push(s);
      seen[s] = 1;
      for (let q = 0; q < sliver.length && sliver.length < MIN_ISLAND; q++)
        for (const j of n4(sliver[q], nb)) if (terrain[j] === LAND && !seen[j]) { seen[j] = 1; sliver.push(j); }
      if (sliver.length < MIN_ISLAND && !sliver.some((c) => wasIsland[c])) for (const c of sliver) toWater(c);
    }
  }
  return { rect: e.rect(), carved, joints, bridges, widened, tooShort, ponds };
}

interface Path {
  land: number[];
  to: number;
}

const DIAGONALS: [number, number][] = [[1, 1], [-1, 1], [1, -1], [-1, -1]];

function trace(from: Map<number, number>, last: number) {
  const land: number[] = [];
  for (let c = last; c >= 0; c = from.get(c)!) land.push(c);
  return land;
}

/** Breadth-first search inside a set of cells: the farthest cell from `start`, with distances and back-links. */
function farthest(start: number, inSet: Set<number>, neighbours: (i: number, out: number[]) => number[]) {
  const dist = new Map<number, number>([[start, 0]]);
  const prev = new Map<number, number>();
  const queue = [start];
  const nb: number[] = [];
  let far = start;
  for (let k = 0; k < queue.length; k++) {
    const i = queue[k];
    const d = dist.get(i)!;
    if (d > dist.get(far)!) far = i;
    for (const j of neighbours(i, nb))
      if (inSet.has(j) && !dist.has(j)) {
        dist.set(j, d + 1);
        prev.set(j, i);
        queue.push(j);
      }
  }
  return { far, dist, prev };
}

/** Length in pixels along a group of cells, measured from end to end (two sweeps). */
function geodesicLength(group: number[], inSet: Set<number>, neighbours: (i: number, out: number[]) => number[]) {
  const a = farthest(group[0], inSet, neighbours).far;
  const s = farthest(a, inSet, neighbours);
  return (s.dist.get(s.far) ?? 0) + 1;
}

/** Long and narrow: at least 6 px long and on average at most 3 px wide. */
function thin(area: number, length: number) {
  return length >= 6 && area / length <= 3;
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
