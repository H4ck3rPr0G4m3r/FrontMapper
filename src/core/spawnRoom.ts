import { LAND, type MapGrid } from './grid';

/** A spawn on a landmass smaller than this starts boxed in by the sea. */
export const SMALL_START = 1000;
/** A nation with less than this share of the median room is boxed in by its neighbours. */
export const BOXED_IN = 0.2;

export interface SpawnRoom {
  /** Land pixels nearer (over land) to each nation than to any other. 0 when it spawns off land. */
  room: Int32Array;
  /** Size of the landmass each nation spawns on. 0 when it spawns off land. */
  island: Int32Array;
}

/**
 * Room to grow for each spawn point: every land pixel goes to the nation that reaches it first,
 * walking over land only (4-connected, like territory spreads), so a nation squeezed between
 * neighbours or stuck on a small island gets little.
 */
export function spawnRoom(g: MapGrid, points: { x: number; y: number }[]): SpawnRoom {
  const { width: w, height: h, terrain } = g;
  const n = w * h;
  const owner = new Int32Array(n).fill(-1);
  const queue = new Int32Array(n);
  let tail = 0;
  const room = new Int32Array(points.length);
  const island = new Int32Array(points.length);
  points.forEach((p, k) => {
    if (p.x < 0 || p.y < 0 || p.x >= w || p.y >= h) return;
    const i = p.y * w + p.x;
    if (terrain[i] !== LAND || owner[i] >= 0) return;
    owner[i] = k;
    room[k]++;
    queue[tail++] = i;
  });
  for (let head = 0; head < tail; head++) {
    const i = queue[head];
    const k = owner[i];
    const x = i % w;
    const visit = (j: number) => {
      if (owner[j] < 0 && terrain[j] === LAND) {
        owner[j] = k;
        room[k]++;
        queue[tail++] = j;
      }
    };
    if (x > 0) visit(i - 1);
    if (x < w - 1) visit(i + 1);
    if (i >= w) visit(i - w);
    if (i < n - w) visit(i + w);
  }
  // Landmass sizes: flood each spawn's landmass once, and credit it to every nation on it.
  const body = new Int32Array(n).fill(-1);
  const sizes: number[] = [];
  points.forEach((p, k) => {
    if (p.x < 0 || p.y < 0 || p.x >= w || p.y >= h) return;
    const s = p.y * w + p.x;
    if (terrain[s] !== LAND) return;
    if (body[s] < 0) {
      const id = sizes.length;
      body[s] = id;
      let t = 0;
      queue[t++] = s;
      for (let q = 0; q < t; q++) {
        const i = queue[q];
        const x = i % w;
        const visit = (j: number) => {
          if (body[j] < 0 && terrain[j] === LAND) {
            body[j] = id;
            queue[t++] = j;
          }
        };
        if (x > 0) visit(i - 1);
        if (x < w - 1) visit(i + 1);
        if (i >= w) visit(i - w);
        if (i < n - w) visit(i + w);
      }
      sizes.push(t);
    }
    island[k] = sizes[body[s]];
  });
  return { room, island };
}

/** Median of the non-zero values. */
export function medianRoom(room: ArrayLike<number>): number {
  const v = Array.from(room).filter((r) => r > 0).sort((a, b) => a - b);
  if (!v.length) return 0;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}
