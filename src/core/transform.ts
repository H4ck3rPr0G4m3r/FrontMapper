import { LAND, VOID, WATER, type MapGrid, type Rect } from './grid';
import { inSelection, type Selection } from './selection';
import { Edit, type Paint } from './tools/common';
import type { History } from './history';

/** A rectangle of terrain lifted off the map (or copied), with the cells it carries. */
export interface Patch {
  w: number;
  h: number;
  terrain: Uint8Array;
  mag: Uint8Array;
  /** 1 where the patch has a cell; 0 is see-through. */
  mask: Uint8Array;
}

/** Copy the selected cells. */
export function extractPatch(g: MapGrid, sel: NonNullable<Selection>): Patch {
  const { x: ox, y: oy, w, h } = sel;
  const n = w * h;
  const p: Patch = { w, h, terrain: new Uint8Array(n), mag: new Uint8Array(n), mask: new Uint8Array(n) };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const mx = ox + x, my = oy + y;
      if (mx < 0 || my < 0 || mx >= g.width || my >= g.height || !inSelection(sel, mx, my)) continue;
      const k = y * w + x, i = my * g.width + mx;
      p.terrain[k] = g.terrain[i];
      p.mag[k] = g.mag[i];
      p.mask[k] = 1;
    }
  return p;
}

/** Map a patch cell through a flip or quarter turn. Returns the new size and a cell mapper. */
function remap(p: Patch, kind: PatchTransform): { w: number; h: number; to: (x: number, y: number) => [number, number] } {
  const { w, h } = p;
  switch (kind) {
    case 'flipX': return { w, h, to: (x, y) => [w - 1 - x, y] };
    case 'flipY': return { w, h, to: (x, y) => [x, h - 1 - y] };
    case 'rotateCW': return { w: h, h: w, to: (x, y) => [h - 1 - y, x] };
    case 'rotateCCW': return { w: h, h: w, to: (x, y) => [y, w - 1 - x] };
  }
}

export type PatchTransform = 'flipX' | 'flipY' | 'rotateCW' | 'rotateCCW';

export function transformPatch(p: Patch, kind: PatchTransform): Patch {
  const m = remap(p, kind);
  const n = m.w * m.h;
  const out: Patch = { w: m.w, h: m.h, terrain: new Uint8Array(n), mag: new Uint8Array(n), mask: new Uint8Array(n) };
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++) {
      const [nx, ny] = m.to(x, y);
      const k = y * p.w + x, j = ny * m.w + nx;
      out.terrain[j] = p.terrain[k];
      out.mag[j] = p.mag[k];
      out.mask[j] = p.mask[k];
    }
  return out;
}

/** Where a point inside a patch (in patch cells, fractional) ends up after a transform. */
export function transformPoint(p: { w: number; h: number }, kind: PatchTransform, x: number, y: number): [number, number] {
  // Work on cell centres so a point keeps the same cell.
  const cx = x + 0.5, cy = y + 0.5;
  switch (kind) {
    case 'flipX': return [p.w - cx - 0.5, y];
    case 'flipY': return [x, p.h - cy - 0.5];
    case 'rotateCW': return [p.h - cy - 0.5, cx - 0.5];
    case 'rotateCCW': return [cy - 0.5, p.w - cx - 0.5];
  }
}

/** Write a patch's cells onto the map with its top-left at (x, y). Cells off the map are dropped. */
export function stampPatch(g: MapGrid, h: History | null, p: Patch, x: number, y: number): Rect {
  const e = new Edit(g, h);
  for (let py = 0; py < p.h; py++)
    for (let px = 0; px < p.w; px++) {
      const k = py * p.w + px;
      if (!p.mask[k]) continue;
      const mx = x + px, my = y + py;
      if (mx < 0 || my < 0 || mx >= g.width || my >= g.height) continue;
      e.set(mx, my, { terrain: p.terrain[k] as Paint['terrain'], mag: p.mag[k] });
    }
  return e.rect();
}

/** Paint every selected cell with `paint`. */
export function fillSelection(g: MapGrid, h: History | null, sel: NonNullable<Selection>, paint: Paint): Rect {
  const e = new Edit(g, h);
  const x1 = Math.min(g.width, sel.x + sel.w), y1 = Math.min(g.height, sel.y + sel.h);
  for (let y = Math.max(0, sel.y); y < y1; y++)
    for (let x = Math.max(0, sel.x); x < x1; x++) if (inSelection(sel, x, y)) e.set(x, y, paint);
  return e.rect();
}

/**
 * What to leave behind when a selection is moved or cleared: the most common terrain just
 * outside it (an island lifted out of the sea leaves sea), with the average elevation of that
 * surrounding land. Water if nothing surrounds it.
 */
export function surroundingPaint(g: MapGrid, sel: NonNullable<Selection>): Paint {
  const counts = [0, 0, 0];
  let magSum = 0;
  const { width: w, height: h } = g;
  const look = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h || inSelection(sel, x, y)) return;
    const i = y * w + x;
    counts[g.terrain[i]]++;
    if (g.terrain[i] === LAND) magSum += g.mag[i];
  };
  for (let y = sel.y; y < sel.y + sel.h; y++)
    for (let x = sel.x; x < sel.x + sel.w; x++) {
      if (!inSelection(sel, x, y)) continue;
      look(x - 1, y);
      look(x + 1, y);
      look(x, y - 1);
      look(x, y + 1);
    }
  let t: Paint['terrain'] = WATER;
  if (counts[LAND] > counts[t]) t = LAND;
  if (counts[VOID] > counts[t]) t = VOID;
  return { terrain: t, mag: t === LAND ? Math.round(magSum / counts[LAND]) : 0 };
}

/** The selection a patch covers when placed at (x, y). */
export function patchSelection(p: Patch, x: number, y: number): NonNullable<Selection> {
  let full = true;
  for (const v of p.mask) if (!v) { full = false; break; }
  return full ? { x, y, w: p.w, h: p.h } : { x, y, w: p.w, h: p.h, mask: p.mask.slice() };
}
