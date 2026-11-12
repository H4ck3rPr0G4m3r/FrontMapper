/** Terrain types, matching the OpenFront generator (Water, Land, Impassable). */
export const WATER = 0;
export const LAND = 1;
export const VOID = 2;
export type Terrain = 0 | 1 | 2;

/** Highest land magnitude (blue 200). Plains < 10, highlands 10..19, mountains >= 20. */
export const MAX_MAG = 30;

/** A map in row-major order (`i = y * width + x`). `mag` is 0 for non-land cells. */
export interface MapGrid {
  width: number;
  height: number;
  terrain: Uint8Array;
  mag: Uint8Array;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function createGrid(width: number, height: number, fill: Terrain = WATER): MapGrid {
  const terrain = new Uint8Array(width * height);
  if (fill !== WATER) terrain.fill(fill);
  return { width, height, terrain, mag: new Uint8Array(width * height) };
}

export function cloneGrid(g: MapGrid): MapGrid {
  return { width: g.width, height: g.height, terrain: g.terrain.slice(), mag: g.mag.slice() };
}

/** The generator crops anything beyond `w - w % 4` and `h - h % 4`. */
export function cropToMultipleOf4(g: MapGrid): MapGrid {
  const w = g.width - (g.width % 4);
  const h = g.height - (g.height % 4);
  if (w === g.width && h === g.height) return cloneGrid(g);
  const out = createGrid(w, h);
  for (let y = 0; y < h; y++) {
    const src = y * g.width;
    out.terrain.set(g.terrain.subarray(src, src + w), y * w);
    out.mag.set(g.mag.subarray(src, src + w), y * w);
  }
  return out;
}
