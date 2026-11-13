import type { Rect } from './grid';

/** Rectangular editor selection; `null` means "the whole map". */
export type Selection = Rect | null;

export function inSelection(sel: Selection, x: number, y: number): boolean {
  if (!sel) return true;
  return x >= sel.x && y >= sel.y && x < sel.x + sel.w && y < sel.y + sel.h;
}

/** Selection normalised from two corner points (inclusive), clipped to the map. */
export function selectionFromCorners(ax: number, ay: number, bx: number, by: number, width: number, height: number): Selection {
  const x0 = Math.max(0, Math.min(ax, bx)), y0 = Math.max(0, Math.min(ay, by));
  const x1 = Math.min(width - 1, Math.max(ax, bx)), y1 = Math.min(height - 1, Math.max(ay, by));
  if (x1 < x0 || y1 < y0) return null;
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
