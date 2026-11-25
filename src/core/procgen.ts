import { simulateExport } from './generator';
import { LAND, MAX_MAG, WATER, createGrid, type MapGrid } from './grid';
import { fbm } from './noise';

export interface GenOpts {
  seed: number;
  /** Share of the map that is land, 0.1..0.8. */
  land: number;
  /** Roughly how many landmasses across the map: 1 (one big continent) .. 8 (many islands). */
  scale: number;
  /** How much of the land rises into mountain ranges, 0..1. */
  mountains: number;
}

export const DEFAULT_GEN: GenOpts = { seed: 1, land: 0.4, scale: 3, mountains: 0.5 };

const smooth = (a: number, b: number, v: number) => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * A map with continents, coasts, hills and mountain ranges from layered noise.
 * Builds `w` x `h` cells of a `fullW` x `fullH` map (a smaller size gives a matching preview).
 * The map edge is always sea. With `clean`, islands and lakes the generator would delete are
 * removed, so a fresh map has nothing on the Checks tab.
 */
export function generateMap(w: number, h: number, o: GenOpts, fullW = w, fullH = h, clean = true): MapGrid {
  const sx = fullW / w, sy = fullH / h;
  const feature = Math.max(fullW, fullH) / (o.scale * 1.4);
  const n = w * h;
  const height = new Float32Array(n);
  let lo = Infinity, hi = -Infinity;
  for (let y = 0; y < h; y++) {
    const fy = (y + 0.5) * sy;
    for (let x = 0; x < w; x++) {
      const fx = (x + 0.5) * sx;
      const edge = Math.min(fx / fullW, 1 - fx / fullW, fy / fullH, 1 - fy / fullH);
      const keep = smooth(0, 0.14, edge);
      const v = (fbm(o.seed, fx, fy, feature) + 0.3 * fbm(o.seed + 11, fx, fy, feature / 5)) * keep - (1 - keep);
      height[y * w + x] = v;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  // Sea level: the height that leaves `land` of the map above it.
  const BINS = 1024;
  const hist = new Uint32Array(BINS);
  const span = hi - lo || 1;
  for (let i = 0; i < n; i++) hist[Math.min(BINS - 1, Math.floor(((height[i] - lo) / span) * BINS))]++;
  let below = 0, bin = 0;
  const target = n * (1 - Math.max(0.05, Math.min(0.9, o.land)));
  while (bin < BINS - 1 && below + hist[bin] <= target) below += hist[bin++];
  const sea = lo + (bin / BINS) * span;

  const g = createGrid(w, h);
  const ridgeSize = feature / 2.2;
  for (let y = 0; y < h; y++) {
    const fy = (y + 0.5) * sy;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (height[i] <= sea) continue;
      const fx = (x + 0.5) * sx;
      const t = (height[i] - sea) / (hi - sea || 1); // 0 at the coast, 1 at the highest point
      const ridge = 1 - Math.abs(fbm(o.seed + 23, fx, fy, ridgeSize));
      const range = o.mountains * ridge ** 3 * smooth(0.08, 0.45, t);
      g.terrain[i] = LAND;
      g.mag[i] = Math.max(0, Math.min(MAX_MAG, Math.round(1 + t * 13 + range * 26)));
    }
  }
  if (!clean) return g;
  const out = simulateExport(g).grid;
  // Filled-in lakes come back as flat land at 0; give them the plains around them.
  for (let i = 0; i < out.terrain.length; i++) if (out.terrain[i] === LAND && g.terrain[i] === WATER) out.mag[i] = 3;
  return out;
}

/**
 * A map from a greyscale heightmap: brightness at or below `sea` is water, the rest is land
 * whose elevation rises from 0 at sea level to 30 at white. Transparent pixels become void.
 */
export function heightmapToGrid(lum: Uint8Array, alpha: Uint8Array | null, w: number, h: number, sea: number): MapGrid {
  const g = createGrid(w, h);
  const top = Math.max(1, 255 - sea);
  for (let i = 0; i < w * h; i++) {
    if (alpha && alpha[i] < 128) {
      g.terrain[i] = 2;
      continue;
    }
    const v = lum[i];
    if (v <= sea) continue;
    g.terrain[i] = LAND;
    g.mag[i] = Math.min(MAX_MAG, Math.round(((v - sea) / top) * MAX_MAG));
  }
  return g;
}

/** Luminance (0..255) and alpha of RGBA pixels. */
export function luminance(rgba: Uint8ClampedArray): { lum: Uint8Array; alpha: Uint8Array | null } {
  const n = rgba.length / 4;
  const lum = new Uint8Array(n);
  let transparent = false;
  const alpha = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const k = i * 4;
    lum[i] = Math.round(0.299 * rgba[k] + 0.587 * rgba[k + 1] + 0.114 * rgba[k + 2]);
    alpha[i] = rgba[k + 3];
    if (rgba[k + 3] < 128) transparent = true;
  }
  return { lum, alpha: transparent ? alpha : null };
}
