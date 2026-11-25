import { describe, it, expect } from 'vitest';
import { LAND, VOID, WATER, createGrid, type MapGrid, type Terrain } from '../../src/core/grid';
import { simulateExport, MIN_ISLAND, MIN_LAKE } from '../../src/core/generator';

function rect(g: MapGrid, x0: number, y0: number, w: number, h: number, t: Terrain, mag = 0) {
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++) {
      g.terrain[y * g.width + x] = t;
      g.mag[y * g.width + x] = t === LAND ? mag : 0;
    }
}
const at = (g: MapGrid, x: number, y: number) => g.terrain[y * g.width + x];

describe('simulateExport', () => {
  it('uses the generator thresholds', () => {
    expect(MIN_ISLAND).toBe(30);
    expect(MIN_LAKE).toBe(200);
  });

  it('removes a 29-cell island and keeps a 30-cell one', () => {
    const g = createGrid(40, 20);
    rect(g, 2, 5, 29, 1, LAND, 5);
    rect(g, 2, 10, 30, 1, LAND, 5);
    const sim = simulateExport(g);
    expect(at(sim.grid, 2, 5)).toBe(WATER);
    expect(at(sim.grid, 2, 10)).toBe(LAND);
    expect(sim.removedIslands).toHaveLength(1);
    expect(sim.removedIslands[0].replacement).toBe(WATER);
    expect(at(g, 2, 5)).toBe(LAND); // input untouched
  });

  it('turns an island surrounded only by void into void', () => {
    const g = createGrid(40, 20, VOID);
    rect(g, 0, 0, 10, 20, WATER);
    rect(g, 20, 5, 3, 3, LAND, 9);
    const sim = simulateExport(g);
    expect(at(sim.grid, 21, 6)).toBe(VOID);
    expect(sim.grid.mag[6 * 40 + 21]).toBe(0);
  });

  it('breaks a water/void tie in favour of water', () => {
    const g = createGrid(11, 11);
    rect(g, 5, 4, 1, 1, VOID);
    rect(g, 5, 6, 1, 1, VOID);
    rect(g, 5, 5, 1, 1, LAND);
    const sim = simulateExport(g);
    expect(at(sim.grid, 5, 5)).toBe(WATER);
  });

  it('uses 4-connectivity: corner-touching blobs are separate bodies', () => {
    const g = createGrid(20, 20);
    rect(g, 2, 2, 4, 5, LAND); // 20 cells, corner at (5,6)
    rect(g, 6, 7, 4, 5, LAND); // 20 cells, corner at (6,7)
    const sim = simulateExport(g);
    expect(sim.removedIslands).toHaveLength(2);
    expect(at(sim.grid, 5, 6)).toBe(WATER);
    expect(at(sim.grid, 6, 7)).toBe(WATER);
  });

  it('removes islands before lakes, so a 199-cell lake with a 1-cell islet survives', () => {
    const g = createGrid(60, 40);
    rect(g, 30, 0, 30, 40, LAND, 7);
    rect(g, 35, 10, 20, 10, WATER); // 200 cells
    rect(g, 40, 15, 1, 1, LAND, 3); // lake is now 199 + islet
    const sim = simulateExport(g);
    expect(sim.removedIslands).toHaveLength(1);
    expect(sim.removedLakes).toHaveLength(0);
    expect(at(sim.grid, 40, 15)).toBe(WATER);
  });

  it('never removes the largest water body', () => {
    const g = createGrid(30, 30, LAND);
    rect(g, 10, 10, 5, 10, WATER); // 50-cell pond is the only water
    const sim = simulateExport(g);
    expect(sim.removedLakes).toHaveLength(0);
    expect(at(sim.grid, 12, 12)).toBe(WATER);
  });

  it('fills a 150-cell lake enclosed by void with void', () => {
    const g = createGrid(60, 40, VOID);
    rect(g, 0, 0, 30, 40, WATER);
    rect(g, 40, 10, 15, 10, WATER);
    const sim = simulateExport(g);
    expect(sim.removedLakes).toHaveLength(1);
    expect(sim.removedLakes[0].replacement).toBe(VOID);
    expect(at(sim.grid, 45, 15)).toBe(VOID);
  });

  it('a removed lake inside land becomes land with mag 0, and landTiles counts the result', () => {
    const g = createGrid(40, 40);
    rect(g, 10, 0, 30, 40, LAND, 12); // 1200 land cells
    rect(g, 20, 20, 2, 2, WATER); // 4-cell lake
    const sim = simulateExport(g);
    expect(at(sim.grid, 20, 20)).toBe(LAND);
    expect(sim.grid.mag[20 * 40 + 20]).toBe(0);
    expect(sim.landTiles).toBe(1200);
  });

  it('handles all-water, all-void and no-water maps', () => {
    for (const fill of [WATER, VOID, LAND] as Terrain[]) {
      const g = createGrid(16, 8, fill);
      const sim = simulateExport(g);
      expect(sim.removedIslands).toHaveLength(0);
      expect(sim.removedLakes).toHaveLength(0);
      expect(sim.grid.terrain).toEqual(g.terrain);
    }
  });

  it.skipIf(!process.env.BENCH)('handles a 10000x5000 map', () => {
    const g = createGrid(10000, 5000);
    for (let i = 0; i < 4000; i++) rect(g, (i * 7919) % 9990, (i * 104729) % 4990, 1 + (i % 9), 1 + (i % 7), LAND, 3);
    const t = performance.now();
    const sim = simulateExport(g);
    expect(sim.removedIslands.length).toBeGreaterThan(0);
    console.log('10000x5000 simulateExport ms', Math.round(performance.now() - t));
  }, 120_000); // a benchmark: CI runners take 5 s or more, past vitest's 5 s default
});
