import { LAND, MAX_MAG, type MapGrid, type Rect } from '../grid';
import type { History } from '../history';
import type { Selection } from '../selection';
import { forFootprint } from './brush';
import { Edit } from './common';

const clampMag = (v: number) => Math.max(0, Math.min(MAX_MAG, Math.round(v)));

/** 1 at the brush centre, falling linearly to 0 at its edge. */
function falloff(dx: number, dy: number, diameter: number) {
  const c = Math.round(diameter) % 2 ? 0.5 : 0;
  const r = Math.max(0.5, diameter / 2);
  return Math.max(0, 1 - Math.hypot(dx + 0.5 - c, dy + 0.5 - c) / r);
}

/** Raise (positive amount) or lower (negative) land elevation with linear falloff. */
export function raiseAt(g: MapGrid, h: History | null, sel: Selection, x: number, y: number, diameter: number, amount: number): Rect {
  const e = new Edit(g, h);
  forFootprint(g, sel, x, y, diameter, (cx, cy, dx, dy) => {
    const i = cy * g.width + cx;
    if (g.terrain[i] !== LAND) return;
    const next = clampMag(g.mag[i] + amount * falloff(dx, dy, diameter));
    if (next === g.mag[i]) return;
    e.touch(cx, cy);
    g.mag[i] = next;
  });
  return e.rect();
}

/** 3x3 mean of land magnitudes (land neighbours only), from the values before this dab. */
export function smoothAt(g: MapGrid, h: History | null, sel: Selection, x: number, y: number, diameter: number): Rect {
  const e = new Edit(g, h);
  const updates: [number, number, number][] = [];
  forFootprint(g, sel, x, y, diameter, (cx, cy) => {
    const i = cy * g.width + cx;
    if (g.terrain[i] !== LAND) return;
    let sum = 0;
    let n = 0;
    for (let oy = -1; oy <= 1; oy++)
      for (let ox = -1; ox <= 1; ox++) {
        const nx = cx + ox;
        const ny = cy + oy;
        if (nx < 0 || ny < 0 || nx >= g.width || ny >= g.height) continue;
        const j = ny * g.width + nx;
        if (g.terrain[j] !== LAND) continue;
        sum += g.mag[j];
        n++;
      }
    updates.push([cx, cy, clampMag(sum / n)]);
  });
  for (const [cx, cy, v] of updates) {
    const i = cy * g.width + cx;
    if (g.mag[i] === v) continue;
    e.touch(cx, cy);
    g.mag[i] = v;
  }
  return e.rect();
}
