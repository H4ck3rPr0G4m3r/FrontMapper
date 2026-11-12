import { LAND, type MapGrid, type Rect, type Terrain } from '../grid';
import type { History } from '../history';
import { inSelection, type Selection } from '../selection';
import { Edit, type Paint } from './common';

/** 4-connected flood fill of cells with exactly the clicked terrain and magnitude. */
export function floodFill(g: MapGrid, h: History | null, sel: Selection, x: number, y: number, p: Paint): Rect {
  const { width: w, height: hgt, terrain, mag } = g;
  if (x < 0 || y < 0 || x >= w || y >= hgt || !inSelection(sel, x, y)) return { x: 0, y: 0, w: 0, h: 0 };
  const start = y * w + x;
  const t0 = terrain[start], m0 = mag[start];
  const pm = p.terrain === LAND ? p.mag : 0;
  if (t0 === p.terrain && m0 === pm) return { x: 0, y: 0, w: 0, h: 0 };
  const e = new Edit(g, h);
  const match = (cx: number, cy: number) => {
    const i = cy * w + cx;
    return terrain[i] === t0 && mag[i] === m0 && inSelection(sel, cx, cy);
  };
  const stack = [x, y];
  while (stack.length) {
    const cy = stack.pop()!;
    let cx = stack.pop()!;
    if (!match(cx, cy)) continue;
    while (cx > 0 && match(cx - 1, cy)) cx--;
    let up = false, down = false;
    for (; cx < w && match(cx, cy); cx++) {
      e.set(cx, cy, p);
      if (cy > 0) {
        const m = match(cx, cy - 1);
        if (m && !up) stack.push(cx, cy - 1);
        up = m;
      }
      if (cy < hgt - 1) {
        const m = match(cx, cy + 1);
        if (m && !down) stack.push(cx, cy + 1);
        down = m;
      }
    }
  }
  return e.rect();
}

export function pickAt(g: MapGrid, x: number, y: number): Paint {
  const i = y * g.width + x;
  return { terrain: g.terrain[i] as Terrain, mag: g.mag[i] };
}
