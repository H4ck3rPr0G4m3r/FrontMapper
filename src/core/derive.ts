import { LAND, VOID, WATER, type MapGrid, type Rect } from './grid';

export type { Rect } from './grid';

/** Water depth is only distinguishable up to here when rendered, so it is capped. */
export const DEPTH_CAP = 20;
const HALO = DEPTH_CAP + 1;

/**
 * Shoreline flags and water depth for the cells in `r`, written into full-map arrays.
 * Mirrors the generator: shore water has depth 0, depth grows by BFS through water,
 * water touching void is deepest. Reads a halo of DEPTH_CAP + 1 around `r`, so
 * deriving a map rect by rect gives the same result as deriving it whole.
 */
export function deriveRect(g: MapGrid, r: Rect, shore: Uint8Array, depth: Uint8Array): void {
  const { width: w, height: h, terrain: t } = g;
  const x0 = Math.max(0, r.x - HALO), y0 = Math.max(0, r.y - HALO);
  const x1 = Math.min(w, r.x + r.w + HALO), y1 = Math.min(h, r.y + r.h + HALO);
  const rw = x1 - x0, rh = y1 - y0;
  const dist = new Uint8Array(rw * rh).fill(255);
  const queue = new Int32Array(rw * rh);
  let tail = 0;

  const touches = (x: number, y: number, type: number) =>
    (x > 0 && t[y * w + x - 1] === type) ||
    (x < w - 1 && t[y * w + x + 1] === type) ||
    (y > 0 && t[(y - 1) * w + x] === type) ||
    (y < h - 1 && t[(y + 1) * w + x] === type);

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (t[y * w + x] === WATER && touches(x, y, LAND)) {
        const k = (y - y0) * rw + (x - x0);
        dist[k] = 0;
        queue[tail++] = k;
      }
    }
  }
  for (let head = 0; head < tail; head++) {
    const k = queue[head];
    const d = dist[k];
    if (d >= DEPTH_CAP) continue;
    const lx = k % rw, ly = (k - lx) / rw;
    const visit = (nx: number, ny: number) => {
      const nk = ny * rw + nx;
      if (dist[nk] === 255 && t[(ny + y0) * w + nx + x0] === WATER) {
        dist[nk] = d + 1;
        queue[tail++] = nk;
      }
    };
    if (lx > 0) visit(lx - 1, ly);
    if (lx < rw - 1) visit(lx + 1, ly);
    if (ly > 0) visit(lx, ly - 1);
    if (ly < rh - 1) visit(lx, ly + 1);
  }

  const ex = Math.min(w, r.x + r.w), ey = Math.min(h, r.y + r.h);
  for (let y = Math.max(0, r.y); y < ey; y++) {
    for (let x = Math.max(0, r.x); x < ex; x++) {
      const i = y * w + x;
      const type = t[i];
      if (type === LAND) {
        shore[i] = touches(x, y, WATER) ? 1 : 0;
        depth[i] = 0;
      } else if (type === WATER) {
        const d = dist[(y - y0) * rw + (x - x0)];
        shore[i] = d === 0 ? 1 : 0;
        depth[i] = touches(x, y, VOID) || d === 255 ? DEPTH_CAP : Math.min(d, DEPTH_CAP);
      } else {
        shore[i] = 0;
        depth[i] = 0;
      }
    }
  }
}
