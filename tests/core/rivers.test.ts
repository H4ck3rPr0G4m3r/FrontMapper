import { describe, it, expect } from 'vitest';
import { LAND, VOID, WATER, cloneGrid, createGrid, type MapGrid } from '../../src/core/grid';
import { History } from '../../src/core/history';
import { simulateExport } from '../../src/core/generator';
import { growRivers } from '../../src/core/tools/rivers';

const W = 120, H = 60;
const land = () => createGrid(W, H, LAND);
const set = (g: MapGrid, x: number, y: number, t = WATER) => (g.terrain[y * W + x] = t);
const hline = (g: MapGrid, x0: number, x1: number, y: number, t = WATER) => { for (let x = x0; x <= x1; x++) set(g, x, y, t); };
const changed = (a: MapGrid, b: MapGrid) => a.terrain.reduce((n, t, i) => n + (t !== b.terrain[i] ? 1 : 0), 0);

describe('growRivers', () => {
  it('joins river pieces a few pixels apart and widens the river until it survives export', () => {
    const g = land();
    hline(g, 10, 29, 30); // 20 px
    hline(g, 32, 51, 30); // 2 px gap, 20 px
    hline(g, 54, 73, 30); // 2 px gap, 20 px
    for (let y = 0; y < H; y++) hline(g, 100, W - 1, y); // a sea too far away to join
    expect(simulateExport(g).removedLakes).toHaveLength(3);
    growRivers(g, null);
    const sim = simulateExport(g);
    expect(sim.removedLakes).toHaveLength(0);
    expect(g.terrain[30 * W + 98]).toBe(LAND); // not joined to the sea, widened instead
    for (const x of [30, 31, 52, 53]) expect(g.terrain[30 * W + x]).toBe(WATER); // gaps bridged
  });

  it('connects a river piece to the sea with only the gap cells', () => {
    const g = land();
    for (let y = 0; y < H; y++) hline(g, 100, W - 1, y); // sea on the right
    hline(g, 70, 97, 20); // ends 2 px from the sea
    const before = cloneGrid(g);
    growRivers(g, null);
    expect(simulateExport(g).removedLakes).toHaveLength(0);
    expect(changed(before, g)).toBe(2);
  });

  it('leaves round ponds alone', () => {
    const g = land();
    for (let y = 20; y < 23; y++) hline(g, 20, 22, y);
    const before = cloneGrid(g);
    growRivers(g, null);
    expect(changed(before, g)).toBe(0);
  });

  it('never bridges or widens through void', () => {
    const g = land();
    for (let y = 0; y < H; y++) { hline(g, 100, W - 1, y); hline(g, 98, 99, y, VOID); }
    for (let y = 0; y < H; y++) hline(g, 0, 60, y, VOID);
    hline(g, 62, 97, 20); // touches void on both sides, sea is behind the void
    growRivers(g, null);
    for (let y = 0; y < H; y++) for (const x of [98, 99, 0, 60]) expect(g.terrain[y * W + x]).toBe(VOID);
  });

  it('is one undo step', () => {
    const g = land();
    hline(g, 10, 29, 30);
    hline(g, 32, 51, 30);
    const before = cloneGrid(g);
    const h = new History(g);
    h.begin('Grow rivers');
    growRivers(g, h);
    h.commit();
    expect(changed(before, g)).toBeGreaterThan(0);
    h.undo();
    expect(changed(before, g)).toBe(0);
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
