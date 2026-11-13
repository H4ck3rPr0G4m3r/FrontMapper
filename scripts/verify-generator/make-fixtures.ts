/**
 * Fixture maps for the generator round-trip check: each exercises a part of the
 * small-island / small-lake removal that FrontMapper predicts in its Checks tab.
 */
import { unzipSync } from 'fflate';
import { buildExportZip } from '../../src/core/exportZip';
import { simulateExport } from '../../src/core/generator';
import { createGrid, LAND, VOID, WATER, type MapGrid } from '../../src/core/grid';
import { CATEGORIES, deriveIds } from '../../src/core/info';
import { fbm } from '../../src/core/noise';

export interface Fixture {
  /** Folder name under map-generator/assets/maps. */
  folder: string;
  /** Files of that folder (image.png, info.json) as written by the real export. */
  files: Record<string, Uint8Array>;
  expected: { islands: number; lakes: number };
}

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function disc(g: MapGrid, cx: number, cy: number, r: number, t: number, mag = 5) {
  for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(g.height - 1, cy + r); y++)
    for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(g.width - 1, cx + r); x++)
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) {
        const i = y * g.width + x;
        g.terrain[i] = t;
        g.mag[i] = t === LAND ? mag : 0;
      }
}

function rect(g: MapGrid, x0: number, y0: number, w: number, h: number, t: number, mag = 5) {
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++) {
      const i = y * g.width + x;
      g.terrain[i] = t;
      g.mag[i] = t === LAND ? mag : 0;
    }
}

/** Random land blobs, many of them small enough to be deleted. */
function blobs(): MapGrid {
  const g = createGrid(400, 300);
  const r = rng(1);
  for (let k = 0; k < 140; k++) disc(g, r() * 400, r() * 300, 1 + r() * (k < 20 ? 30 : 4), LAND, Math.floor(r() * 31));
  return g;
}

/** One continent with lakes of every size, some touching each other diagonally. */
function lakes(): MapGrid {
  const g = createGrid(400, 300);
  rect(g, 20, 20, 360, 260, LAND);
  const r = rng(2);
  for (let k = 0; k < 90; k++) disc(g, 30 + r() * 340, 30 + r() * 240, 1 + r() * (k < 10 ? 14 : 6), WATER);
  return g;
}

/** Lakes enclosed by void, by void and land, and a void band splitting the sea. */
function voidLakes(): MapGrid {
  const g = createGrid(400, 300);
  rect(g, 0, 0, 200, 300, VOID);
  rect(g, 200, 40, 160, 220, LAND);
  for (let k = 0; k < 8; k++) disc(g, 40 + k * 20, 60, 2 + (k % 3), WATER); // in void
  for (let k = 0; k < 8; k++) disc(g, 200, 100 + k * 18, 3 + (k % 4), WATER); // on the void/land edge
  for (let k = 0; k < 6; k++) disc(g, 260 + k * 15, 150, 2 + k, WATER); // in land
  rect(g, 0, 280, 400, 6, VOID); // void band cutting a strip of sea off
  return g;
}

/** Small islands touching void, water or both. */
function islandTouchingVoid(): MapGrid {
  const g = createGrid(300, 200);
  rect(g, 0, 0, 120, 200, VOID);
  for (let k = 0; k < 10; k++) rect(g, 120, 10 + k * 18, 2 + k, 3 + (k % 3), LAND); // against the void edge
  for (let k = 0; k < 10; k++) rect(g, 180 + (k % 5) * 20, 30 + Math.floor(k / 5) * 60, 3 + k, 3, LAND); // in open water
  rect(g, 200, 150, 80, 40, LAND);
  rect(g, 230, 160, 6, 6, VOID); // void hole inside land
  return g;
}

/** A 1000 x 600 noise map with coastlines full of islets and ponds. */
function noise(): MapGrid {
  const g = createGrid(1000, 600);
  for (let y = 0; y < 600; y++)
    for (let x = 0; x < 1000; x++) {
      const v = fbm(7, x, y, 90);
      const i = y * 1000 + x;
      if (v > 0.02) { g.terrain[i] = LAND; g.mag[i] = Math.min(30, Math.max(0, Math.floor((v - 0.02) * 80))); }
      else if (v < -0.55) g.terrain[i] = VOID;
    }
  return g;
}

const MAPS: [string, () => MapGrid][] = [
  ['FM Blobs', blobs],
  ['FM Lakes', lakes],
  ['FM Void Lakes', voidLakes],
  ['FM Island Touching Void', islandTouchingVoid],
  ['FM Noise', noise],
];

export async function buildFixtures(): Promise<Fixture[]> {
  const out: Fixture[] = [];
  for (const [name, make] of MAPS) {
    const grid = make();
    const zip = unzipSync(await buildExportZip({ grid, meta: { name, categories: [CATEGORIES[0]] }, nations: [], sources: [], toolVersion: 'verify' }));
    const folder = deriveIds(name).folder;
    const files: Record<string, Uint8Array> = {};
    for (const [path, data] of Object.entries(zip)) if (path.startsWith(`${folder}/`)) files[path.slice(folder.length + 1)] = data;
    const sim = simulateExport(grid);
    out.push({ folder, files, expected: { islands: sim.removedIslands.length, lakes: sim.removedLakes.length } });
  }
  return out;
}
