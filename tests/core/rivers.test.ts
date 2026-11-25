import { describe, it, expect } from 'vitest';
import { LAND, VOID, WATER, cloneGrid, createGrid, type MapGrid } from '../../src/core/grid';
import { History } from '../../src/core/history';
import { simulateExport } from '../../src/core/generator';
import { growRivers, MAX_RIVER_WIDTH } from '../../src/core/tools/rivers';

const W = 160, H = 60;
const land = (w = W, h = H) => createGrid(w, h, LAND);
const set = (g: MapGrid, x: number, y: number, t = WATER) => (g.terrain[y * g.width + x] = t);
const hline = (g: MapGrid, x0: number, x1: number, y: number, t = WATER) => { for (let x = x0; x <= x1; x++) set(g, x, y, t); };
const sea = (g: MapGrid, x0: number) => { for (let y = 0; y < g.height; y++) hline(g, x0, g.width - 1, y); };
const diff = (a: MapGrid, b: MapGrid) => {
  const out: number[] = [];
  a.terrain.forEach((t, i) => t !== b.terrain[i] && out.push(i));
  return out;
};

describe('growRivers', () => {
  it('connects a river piece to the sea with only the gap cells', () => {
    const g = land();
    sea(g, 140);
    hline(g, 100, 137, 20); // ends 2 px from the sea
    const before = cloneGrid(g);
    growRivers(g, null);
    expect(simulateExport(g).removedLakes).toHaveLength(0);
    expect(diff(before, g)).toHaveLength(2);
  });

  it('closes corner joints with one pixel each', () => {
    const g = land();
    sea(g, 140);
    // A diagonal staircase river: every pixel touches the next only at a corner.
    for (let k = 0; k < 30; k++) set(g, 110 + k, 10 + k); // the last pixel touches the sea
    expect(simulateExport(g).removedLakes.length).toBeGreaterThan(20);
    const before = cloneGrid(g);
    const report = growRivers(g, null);
    expect(simulateExport(g).removedLakes).toHaveLength(0);
    expect(report.widened).toBe(0);
    expect(diff(before, g).length).toBe(report.joints);
    expect(report.joints).toBe(29);
  });

  it('bridges a longer gap straight on from a river end to the sea', () => {
    const g = land();
    sea(g, 140);
    hline(g, 60, 131, 30); // ends 8 px before the sea, pointing at it
    const before = cloneGrid(g);
    const report = growRivers(g, null);
    expect(simulateExport(g).removedLakes).toHaveLength(0);
    expect(diff(before, g)).toHaveLength(8);
    expect(report.widened).toBe(0);
  });

  it('does not bridge a long gap sideways', () => {
    const g = land();
    for (let x = 0; x < W; x++) for (let y = 0; y < 8; y++) set(g, x, y); // sea along the top
    hline(g, 40, 120, 16); // runs parallel to the sea, 8 px away
    const report = growRivers(g, null);
    expect(report.bridges).toBe(0);
    for (let y = 8; y < 15; y++) expect(g.terrain[y * W + 80]).toBe(LAND);
  });

  it('leaves round ponds alone, even right next to a river or the sea', () => {
    const g = land();
    sea(g, 140);
    for (let y = 20; y < 23; y++) hline(g, 134, 136, y); // pond 3 px from the sea
    for (let y = 40; y < 43; y++) hline(g, 20, 22, y); // pond next to a river
    hline(g, 24, 120, 41); // river 1 px from the pond, too far from the sea, long enough to widen
    const before = cloneGrid(g);
    const report = growRivers(g, null);
    expect(report.ponds).toBe(2);
    for (let y = 20; y < 23; y++) for (let x = 133; x <= 139; x++) if (x < 134 || x > 136) expect(g.terrain[y * W + x]).toBe(LAND);
    expect(g.terrain[41 * W + 23]).toBe(LAND); // not joined to the pond
    for (const i of diff(before, g)) expect(i % W).toBeGreaterThanOrEqual(23);
  });

  it('widens a lone river only by the missing pixels, downstream first, at most 3 px wide', () => {
    const g = land();
    sea(g, 150);
    hline(g, 20, 109, 30); // 90 px, ends 40 px from the sea: nothing to join
    const report = growRivers(g, null);
    expect(report.widened).toBe(1);
    const sim = simulateExport(g);
    expect(sim.removedLakes).toHaveLength(0);
    let water = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < 140; x++) if (g.terrain[y * W + x] === WATER) water++;
    expect(water).toBe(200);
    for (let x = 20; x <= 109; x++) {
      let col = 0;
      for (let y = 0; y < H; y++) if (g.terrain[y * W + x] === WATER) col++;
      expect(col).toBeLessThanOrEqual(MAX_RIVER_WIDTH);
    }
    // The end nearer the sea is the wide one.
    const width = (x: number) => [29, 30, 31].filter((y) => g.terrain[y * W + x] === WATER).length;
    expect(width(105)).toBe(3);
    expect(width(22)).toBe(1);
  });

  it('leaves a river too short to stay a river as it is', () => {
    const g = land();
    sea(g, 150);
    hline(g, 20, 49, 30); // 30 px: would have to be ~7 px wide to reach 200 px
    const before = cloneGrid(g);
    const report = growRivers(g, null);
    expect(report.tooShort).toBe(1);
    expect(diff(before, g)).toHaveLength(0);
  });

  it('joins river pieces a few pixels apart before deciding to widen', () => {
    const g = land();
    hline(g, 10, 49, 30);
    hline(g, 52, 91, 30); // 2 px gap
    const report = growRivers(g, null);
    expect(report.bridges).toBeGreaterThanOrEqual(1);
    for (const x of [50, 51]) expect(g.terrain[30 * W + x]).toBe(WATER);
    expect(simulateExport(g).removedLakes).toHaveLength(0);
  });

  it('never bridges or widens through void', () => {
    const g = land();
    for (let y = 0; y < H; y++) { hline(g, 140, W - 1, y); hline(g, 138, 139, y, VOID); }
    for (let y = 0; y < H; y++) hline(g, 0, 60, y, VOID);
    hline(g, 62, 137, 20); // touches void on both sides, sea is behind the void
    growRivers(g, null);
    for (let y = 0; y < H; y++) for (const x of [138, 139, 0, 60]) expect(g.terrain[y * W + x]).toBe(VOID);
  });

  it('is one undo step', () => {
    const g = land();
    sea(g, 140);
    hline(g, 100, 137, 20);
    const before = cloneGrid(g);
    const h = new History(g);
    h.begin('Grow rivers');
    growRivers(g, h);
    h.commit();
    expect(diff(before, g).length).toBeGreaterThan(0);
    h.undo();
    expect(diff(before, g)).toHaveLength(0);
  });
});

describe('growRivers on a messy map', () => {
  it('does not leave new slivers of land that the generator would delete', () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const g = createGrid(160, 160, LAND);
    for (let i = 0; i < 160; i++) {
      // Wandering one-pixel rivers with gaps.
      let x = Math.floor(rand() * 160), y = Math.floor(rand() * 160);
      for (let s = 0; s < 60; s++) {
        if (rand() > 0.15) g.terrain[y * 160 + x] = WATER;
        if (rand() < 0.5) x = Math.min(159, Math.max(0, x + (rand() < 0.5 ? -1 : 1)));
        else y = Math.min(159, Math.max(0, y + (rand() < 0.5 ? -1 : 1)));
      }
    }
    for (let y = 0; y < 160; y++) for (let x = 150; x < 160; x++) g.terrain[y * 160 + x] = WATER; // sea
    const before = simulateExport(g).removedIslands.length;
    growRivers(g, null);
    expect(simulateExport(g).removedIslands.length).toBeLessThanOrEqual(before);
  });
});

describe('river tool', () => {
  it('draws diagonal one-pixel rivers as one body', async () => {
    const { riverStroke, waterStays } = await import('../../src/core/tools/river');
    const g = land(120, 120);
    riverStroke(g, null, null, { x: 5, y: 5 }, { x: 100, y: 80 }, 1);
    const sim = simulateExport(g);
    // One body (the largest, which the generator keeps) and nothing split off.
    expect(sim.removedLakes).toHaveLength(0);
    expect(waterStays(g, 5, 5)).toEqual({ stays: false, size: 171 });
  });

  it('only turns land into water', async () => {
    const { riverStroke } = await import('../../src/core/tools/river');
    const g = land(40, 10);
    hline(g, 10, 20, 5, VOID);
    riverStroke(g, null, null, { x: 0, y: 5 }, { x: 39, y: 5 }, 3);
    for (let x = 10; x <= 20; x++) expect(g.terrain[5 * 40 + x]).toBe(VOID);
    expect(g.terrain[5 * 40 + 30]).toBe(WATER);
  });
});

describe('growRivers keeps only what survives export', () => {
  it('never leaves new water that the generator deletes, with or without a sea', () => {
    for (let s = 1; s <= 120; s++) {
      let seed = s;
      const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
      const w = 200, h = 140;
      const g = createGrid(w, h, LAND);
      if (rand() < 0.5) for (let y = 0; y < h; y++) for (let x = w - 15; x < w; x++) g.terrain[y * w + x] = WATER;
      if (rand() < 0.5) for (let y = 0; y < h; y++) for (let x = 0; x < 12; x++) g.terrain[y * w + x] = VOID;
      const rivers = 4 + Math.floor(rand() * 20);
      for (let i = 0; i < rivers; i++) {
        // Broken, wandering rivers that often touch only at corners.
        let x = Math.floor(rand() * w), y = Math.floor(rand() * h);
        const len = 10 + Math.floor(rand() * 120);
        for (let k = 0; k < len; k++) {
          if (rand() > 0.12 && g.terrain[y * w + x] === LAND) g.terrain[y * w + x] = WATER;
          if (rand() < 0.5) x = Math.min(w - 1, Math.max(0, x + (rand() < 0.5 ? -1 : 1)));
          if (rand() < 0.5) y = Math.min(h - 1, Math.max(0, y + (rand() < 0.5 ? -1 : 1)));
        }
      }
      const report = growRivers(g, null);
      const removed = new Set<number>();
      for (const b of simulateExport(g).removedLakes) for (const c of b.cells) removed.add(c);
      expect(report.carved.filter((c) => removed.has(c)), `seed ${s}`).toEqual([]);
    }
  });

  it('puts back joints between pieces that are still too short together', () => {
    const g = land();
    sea(g, 150);
    for (let k = 0; k < 20; k++) set(g, 20 + k, 20 + k); // a 20 px diagonal river: joined it is still tiny
    const before = cloneGrid(g);
    const report = growRivers(g, null);
    expect(diff(before, g)).toHaveLength(0);
    expect(report.joints).toBe(0);
    expect(report.tooShort).toBeGreaterThan(0);
  });
});
