import { LAND, type MapGrid } from '../core/grid';
import { spawnRoom } from '../core/spawnRoom';

export interface Candidate {
  x: number;
  y: number;
  pop: number;
}

export type PickMethod = 'spread' | 'fair';

export interface PickOpts {
  count: number;
  method: PickMethod;
  /** Spread only: 0 takes the biggest cities, 1 the most evenly spread ones. */
  spread: number;
  /** Same seed, same picks; another seed picks among similarly good cities. */
  seed: number;
}

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Pick `count` cities, trading size against distance: each next pick scores
 * size^(1 - spread) x (distance to the nearest pick)^spread, with a little seeded wobble.
 * Returns indices into `c`, in pick order.
 */
export function pickSpread(c: Candidate[], count: number, spread: number, seed: number, width: number, height: number): number[] {
  const n = Math.min(count, c.length);
  if (n <= 0) return [];
  const rand = rng(seed);
  const s = Math.max(0, Math.min(1, spread));
  // Wobble grows with the spread, so 0 is exactly the biggest cities.
  const jitter = c.map(() => 1 + 0.3 * s * (rand() - 0.5));
  const logs = c.map((v) => Math.log(Math.max(1, v.pop)));
  const lo = Math.min(...logs), hi = Math.max(...logs);
  const size = logs.map((l) => 0.1 + 0.9 * (hi > lo ? (l - lo) / (hi - lo) : 1));
  const diag = Math.hypot(width, height) || 1;
  const nearest = new Float64Array(c.length).fill(diag);
  const taken = new Uint8Array(c.length);
  const out: number[] = [];
  for (let k = 0; k < n; k++) {
    let best = -1, bestScore = -1;
    for (let i = 0; i < c.length; i++) {
      if (taken[i]) continue;
      const score = size[i] ** (1 - s) * (k ? nearest[i] / diag : 1) ** s * jitter[i];
      if (score > bestScore) { bestScore = score; best = i; }
    }
    taken[best] = 1;
    out.push(best);
    for (let i = 0; i < c.length; i++) {
      const d = Math.hypot(c[i].x - c[best].x, c[i].y - c[best].y);
      if (d < nearest[i]) nearest[i] = d;
    }
  }
  return out;
}

/** The map shrunk to about `cells` cells for quick room estimates (a cell is land if its centre is). */
function coarse(g: MapGrid, cells: number) {
  const f = Math.max(1, Math.ceil(Math.sqrt((g.width * g.height) / cells)));
  const w = Math.ceil(g.width / f), h = Math.ceil(g.height / f);
  const terrain = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const sx = Math.min(g.width - 1, x * f + (f >> 1)), sy = Math.min(g.height - 1, y * f + (f >> 1));
      terrain[y * w + x] = g.terrain[sy * g.width + sx];
    }
  return { grid: { width: w, height: h, terrain, mag: new Uint8Array(0) } as MapGrid, f };
}

/** Tightest start over roomiest (1 is perfectly even, 0 means someone has no land). */
function evenness(room: Int32Array) {
  let min = Infinity, max = 0;
  for (const r of room) {
    if (r < min) min = r;
    if (r > max) max = r;
  }
  return max ? min / max : 0;
}

/**
 * Pick `count` cities whose starts are as even as possible: begin from well spread picks, then
 * keep swapping the tightest start for another city while that evens out each nation's room to
 * grow (land it reaches before anyone else, see spawnRoom). Works on a coarse copy of the map.
 */
export function pickFair(g: MapGrid, c: Candidate[], count: number, seed: number): { picks: number[]; evenness: number } {
  const picks = pickSpread(c, count, 0.7, seed, g.width, g.height);
  if (picks.length < 2) return { picks, evenness: 1 };
  const { grid, f } = coarse(g, 160_000);
  const at = (i: number) => {
    const x = Math.min(grid.width - 1, Math.floor(c[i].x / f)), y = Math.min(grid.height - 1, Math.floor(c[i].y / f));
    return { x, y };
  };
  const onLand = c.map((_, i) => {
    const p = at(i);
    return grid.terrain[p.y * grid.width + p.x] === LAND;
  });
  const rooms = (sel: number[]) => spawnRoom(grid, sel.map(at)).room;
  const rand = rng(seed ^ 0x9e3779b9);
  let room = rooms(picks);
  let score = evenness(room);
  for (let iter = 0; iter < 40; iter++) {
    let worst = 0;
    for (let k = 1; k < room.length; k++) if (room[k] < room[worst]) worst = k;
    // Try cities far from the other picks (a few at random among the farthest), in the tightest one's place.
    const chosen = new Set(picks);
    const free = c.map((_, i) => i).filter((i) => !chosen.has(i) && onLand[i]);
    const dist = (i: number) => Math.min(...picks.filter((_, k) => k !== worst).map((p) => Math.hypot(c[i].x - c[p].x, c[i].y - c[p].y)));
    const far = free.map((i) => ({ i, d: dist(i) * (0.8 + 0.4 * rand()) })).sort((a, b) => b.d - a.d).slice(0, 12);
    let bestScore = score, bestI = -1, bestRoom: Int32Array | null = null;
    for (const { i } of far) {
      const next = picks.slice();
      next[worst] = i;
      const r = rooms(next);
      const sc = evenness(r);
      if (sc > bestScore + 1e-9) { bestScore = sc; bestI = i; bestRoom = r; }
    }
    if (bestI < 0) break;
    picks[worst] = bestI;
    room = bestRoom!;
    score = bestScore;
  }
  return { picks, evenness: score };
}
