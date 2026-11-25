import { LAND, MAX_MAG, VOID, WATER, type MapGrid, type Rect } from '../grid';
import type { History } from '../history';
import { fbm } from '../noise';
import { inSelection, type Selection } from '../selection';
import { forFootprint } from './brush';
import { Edit } from './common';

export type TextureMode = 'coast+elevation' | 'elevation';

export interface TextureOpts {
  mode: TextureMode;
  /** 0..1 */
  strength: number;
  /** Feature size in pixels. */
  grain: number;
  seed: number;
}

const COAST_SEED_OFFSET = 7919;

/**
 * Signed distance to the land/water boundary inside a window: positive on land (steps to the
 * nearest water), negative in water. Cells further than `cap` get +-(cap + 1). Void is 0 and
 * acts as a barrier.
 */
function signedDistance(g: MapGrid, win: Rect, cap: number): Int16Array {
  const w = g.width;
  const n = win.w * win.h;
  const d = new Int16Array(n);
  const far = cap + 1;
  const queue = new Int32Array(n);
  let tail = 0;
  for (let ly = 0; ly < win.h; ly++)
    for (let lx = 0; lx < win.w; lx++) {
      const k = ly * win.w + lx;
      const x = win.x + lx;
      const y = win.y + ly;
      const i = y * w + x;
      const t = g.terrain[i];
      if (t === VOID) continue;
      const other = t === LAND ? WATER : LAND;
      const touches =
        (x > 0 && g.terrain[i - 1] === other) ||
        (x < w - 1 && g.terrain[i + 1] === other) ||
        (y > 0 && g.terrain[i - w] === other) ||
        (y < g.height - 1 && g.terrain[i + w] === other);
      if (touches) {
        d[k] = t === LAND ? 1 : -1;
        queue[tail++] = k;
      } else {
        d[k] = t === LAND ? far : -far;
      }
    }
  for (let head = 0; head < tail; head++) {
    const k = queue[head];
    const v = d[k];
    const dist = Math.abs(v);
    if (dist >= cap) continue;
    const lx = k % win.w;
    const ly = (k - lx) / win.w;
    const step = (nk: number) => {
      const nv = d[nk];
      if (nv === 0 || Math.abs(nv) !== far || Math.sign(nv) !== Math.sign(v)) return;
      d[nk] = v > 0 ? dist + 1 : -(dist + 1);
      queue[tail++] = nk;
    };
    if (lx > 0) step(k - 1);
    if (lx < win.w - 1) step(k + 1);
    if (ly > 0) step(k - win.w);
    if (ly < win.h - 1) step(k + win.w);
  }
  return d;
}

function applyCells(g: MapGrid, h: History | null, bounds: Rect, cells: (visit: (x: number, y: number) => void) => void, o: TextureOpts): Rect {
  const e = new Edit(g, h);
  const R = Math.max(1, Math.round(o.grain));
  let win: Rect | null = null;
  let sd: Int16Array | null = null;
  if (o.mode === 'coast+elevation') {
    const x0 = Math.max(0, bounds.x - R - 1);
    const y0 = Math.max(0, bounds.y - R - 1);
    const x1 = Math.min(g.width, bounds.x + bounds.w + R + 1);
    const y1 = Math.min(g.height, bounds.y + bounds.h + R + 1);
    win = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    sd = signedDistance(g, win, R);
  }
  const updates: [number, number, number, number][] = [];
  cells((x, y) => {
    const i = y * g.width + x;
    let t = g.terrain[i];
    if (t === VOID) return;
    let m = g.mag[i];
    if (sd && win) {
      const d = sd[(y - win.y) * win.w + (x - win.x)];
      if (Math.abs(d) <= R) {
        const nt = d + o.strength * R * fbm(o.seed + COAST_SEED_OFFSET, x, y, o.grain) > 0 ? LAND : WATER;
        if (nt !== t) {
          t = nt;
          m = 0;
        }
      }
    }
    if (t === LAND) m = Math.max(0, Math.min(MAX_MAG, m + Math.round(o.strength * 10 * fbm(o.seed, x, y, o.grain))));
    else m = 0;
    if (t !== g.terrain[i] || m !== g.mag[i]) updates.push([x, y, t, m]);
  });
  for (const [x, y, t, m] of updates) {
    e.touch(x, y);
    const i = y * g.width + x;
    g.terrain[i] = t;
    g.mag[i] = m;
  }
  return e.rect();
}

/** Texture brush dab. */
export function textureAt(g: MapGrid, h: History | null, sel: Selection, x: number, y: number, diameter: number, o: TextureOpts): Rect {
  const r = Math.ceil(diameter / 2) + 1;
  const bounds = { x: x - r, y: y - r, w: 2 * r + 1, h: 2 * r + 1 };
  return applyCells(g, h, bounds, (visit) => forFootprint(g, sel, x, y, diameter, (cx, cy) => visit(cx, cy)), o);
}

/** Texture every cell of `r` (that is in `sel`). "Texture over selection" runs this per segment-sized piece. */
export function textureRect(g: MapGrid, h: History | null, r: Rect, o: TextureOpts, sel: Selection = null): Rect {
  const x0 = Math.max(0, r.x);
  const y0 = Math.max(0, r.y);
  const x1 = Math.min(g.width, r.x + r.w);
  const y1 = Math.min(g.height, r.y + r.h);
  const bounds = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  return applyCells(g, h, bounds, (visit) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (inSelection(sel, x, y)) visit(x, y);
  }, o);
}
