import { describe, it, expect } from 'vitest';
import { LAND, VOID, createGrid, type MapGrid } from '../../src/core/grid';
import { History } from '../../src/core/history';
import { growIsland } from '../../src/core/tools/grow';
import { sizeTier } from '../../src/core/size';

function landCells(g: MapGrid) {
  const out: number[] = [];
  g.terrain.forEach((t, i) => t === LAND && out.push(i));
  return out;
}

function connected(g: MapGrid, cells: number[]) {
  const set = new Set(cells);
  const seen = new Set([cells[0]]);
  const q = [cells[0]];
  while (q.length) {
    const i = q.pop()!;
    for (const j of [i - 1, i + 1, i - g.width, i + g.width])
      if (set.has(j) && !seen.has(j) && Math.abs((j % g.width) - (i % g.width)) <= 1) { seen.add(j); q.push(j); }
  }
  return seen.size === cells.length;
}

describe('growIsland', () => {
  it('grows a 12-cell island to at least 30 connected cells', () => {
    const g = createGrid(40, 40);
    const cells: number[] = [];
    for (let y = 18; y < 21; y++) for (let x = 18; x < 22; x++) { g.terrain[y * 40 + x] = LAND; g.mag[y * 40 + x] = 6; cells.push(y * 40 + x); }
    const h = new History(g);
    h.begin('grow');
    growIsland(g, h, Int32Array.from(cells));
    h.commit();
    const land = landCells(g);
    expect(land.length).toBeGreaterThanOrEqual(30);
    expect(connected(g, land)).toBe(true);
    expect(g.mag[18 * 40 + 18]).toBe(6);
    h.undo();
    expect(landCells(g)).toHaveLength(12);
  });

  it('never consumes void', () => {
    const g = createGrid(20, 20, VOID);
    for (let y = 5; y < 15; y++) for (let x = 5; x < 15; x++) g.terrain[y * 20 + x] = 0; // water pocket
    g.terrain[10 * 20 + 10] = LAND;
    growIsland(g, null, Int32Array.of(10 * 20 + 10));
    expect(g.terrain.filter((t) => t === VOID).length).toBe(300);
    expect(landCells(g).length).toBeGreaterThanOrEqual(30);
  });
});

describe('sizeTier', () => {
  it('uses the Small/Typical/Large/Huge thresholds', () => {
    expect(sizeTier(1_990_000)).toBe('Small');
    expect(sizeTier(2_000_000)).toBe('Typical');
    expect(sizeTier(9_990_000)).toBe('Typical');
    expect(sizeTier(10_000_000)).toBe('Large');
    expect(sizeTier(50_000_000)).toBe('Huge');
  });
});
