import { LAND, WATER, type Terrain } from './grid';

export type RGB = [number, number, number];

/** Game-view colour. Mirrors the generator thumbnail palette (getThumbnailColor); the shader must match. */
export function tileColor(t: Terrain | number, mag: number, shore: boolean, depth: number): RGB {
  if (t === WATER) {
    if (shore) return [100, 143, 255];
    const adj = 1 - Math.min(depth / 2, 10);
    return [70 + adj, 132 + adj, 180 + adj];
  }
  if (t === LAND) {
    if (shore) return [204, 203, 158];
    if (mag < 10) return [190, 220 - 2 * mag, 138];
    if (mag < 20) return [200 + 2 * mag, 183 + 2 * mag, 138 + 2 * mag];
    return [240, 240, 240];
  }
  return [8, 8, 8];
}

export function elevationColor(t: Terrain | number, mag: number): RGB {
  if (t === WATER) return [20, 26, 34];
  if (t === LAND) {
    const v = Math.round(60 + (mag / 30) * 195);
    return [v, v, v];
  }
  return [0, 0, 0];
}

/** Solid red used for cells the generator will delete. */
export const REMOVED_RGB: RGB = [255, 40, 40];
