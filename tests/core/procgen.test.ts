import { describe, it, expect } from 'vitest';
import { simulateExport } from '../../src/core/generator';
import { LAND, VOID, WATER } from '../../src/core/grid';
import { DEFAULT_GEN, generateMap, heightmapToGrid } from '../../src/core/procgen';

const share = (t: Uint8Array, v: number) => t.reduce((n, x) => n + (x === v ? 1 : 0), 0) / t.length;

describe('generateMap', () => {
  it('makes about the asked share of land, with sea along every edge', () => {
    for (const land of [0.25, 0.55]) {
      const g = generateMap(240, 160, { ...DEFAULT_GEN, land, seed: 4 });
      expect(Math.abs(share(g.terrain, LAND) - land)).toBeLessThan(0.05);
      for (let x = 0; x < 240; x++) expect(g.terrain[x]).toBe(WATER);
      for (let y = 0; y < 160; y++) expect(g.terrain[y * 240]).toBe(WATER);
    }
  });

  it('leaves nothing for the generator to delete', () => {
    const g = generateMap(320, 200, { ...DEFAULT_GEN, scale: 7, seed: 9 });
    const sim = simulateExport(g);
    expect(sim.removedIslands).toHaveLength(0);
    expect(sim.removedLakes).toHaveLength(0);
  });

  it('is the same for the same seed and has mountains when asked', () => {
    const a = generateMap(160, 100, { ...DEFAULT_GEN, mountains: 1, seed: 2 });
    const b = generateMap(160, 100, { ...DEFAULT_GEN, mountains: 1, seed: 2 });
    expect(a.terrain).toEqual(b.terrain);
    expect(Math.max(...a.mag)).toBeGreaterThanOrEqual(20);
  });

  it('a small preview matches the full map', () => {
    const full = generateMap(400, 200, DEFAULT_GEN, 400, 200, false);
    const preview = generateMap(100, 50, DEFAULT_GEN, 400, 200, false);
    let same = 0;
    for (let y = 0; y < 50; y++) for (let x = 0; x < 100; x++) if (preview.terrain[y * 100 + x] === full.terrain[(y * 4 + 2) * 400 + x * 4 + 2]) same++;
    expect(same / 5000).toBeGreaterThan(0.9);
  });
});

describe('heightmapToGrid', () => {
  it('turns brightness into water and elevation, and transparency into void', () => {
    const lum = Uint8Array.of(0, 40, 41, 255);
    const alpha = Uint8Array.of(255, 255, 255, 0);
    const g = heightmapToGrid(lum, alpha, 2, 2, 40);
    expect([...g.terrain]).toEqual([WATER, WATER, LAND, VOID]);
    expect(g.mag[2]).toBe(0);
    const white = heightmapToGrid(Uint8Array.of(255), null, 1, 1, 40);
    expect(white.mag[0]).toBe(30);
  });
});
