import { describe, it, expect } from 'vitest';
import { LAND, VOID, WATER, createGrid, type MapGrid } from '../../src/core/grid';
import { History } from '../../src/core/history';
import { brushFootprint, paintAt, paintStroke } from '../../src/core/tools/brush';
import { floodFill, pickAt } from '../../src/core/tools/fill';

const count = (g: MapGrid, t: number) => g.terrain.reduce((n, v) => n + (v === t ? 1 : 0), 0);

describe('brushFootprint', () => {
  it('is a pixel disc whose cell count matches the diameter', () => {
    expect(brushFootprint(1).length / 2).toBe(1);
    expect(brushFootprint(2).length / 2).toBe(4);
    expect(brushFootprint(3).length / 2).toBe(9);
    expect(brushFootprint(5).length / 2).toBe(21);
  });
});

describe('painting', () => {
  it('a fast stroke leaves no gaps', () => {
    const g = createGrid(64, 8);
    const h = new History(g);
    h.begin('stroke');
    paintStroke(g, h, null, { x: 0, y: 0 }, { x: 40, y: 0 }, 1, { terrain: LAND, mag: 5 });
    h.commit();
    expect(count(g, LAND)).toBe(41);
    for (let x = 0; x <= 40; x++) expect(g.terrain[x]).toBe(LAND);
  });

  it('ignores cells outside the map and sets mag 0 for water', () => {
    const g = createGrid(8, 8, LAND);
    g.mag.fill(12);
    const r = paintAt(g, null, null, 0, 0, 5, { terrain: WATER, mag: 20 });
    expect(r).toEqual({ x: 0, y: 0, w: 3, h: 3 });
    expect(g.terrain[0]).toBe(WATER);
    expect(g.mag[0]).toBe(0);
    paintAt(g, null, null, -50, -50, 3, { terrain: VOID, mag: 0 });
    expect(count(g, VOID)).toBe(0);
  });

  it('respects the selection', () => {
    const g = createGrid(10, 10);
    paintAt(g, null, { x: 5, y: 5, w: 5, h: 5 }, 5, 5, 5, { terrain: LAND, mag: 1 });
    expect(g.terrain[5 * 10 + 4]).toBe(WATER);
    expect(g.terrain[5 * 10 + 5]).toBe(LAND);
  });
});

describe('floodFill', () => {
  it('stops at different terrain and at different magnitude', () => {
    const g = createGrid(10, 10, LAND);
    g.mag.fill(3);
    for (let y = 0; y < 10; y++) g.terrain[y * 10 + 5] = WATER; // wall
    g.mag[2 * 10 + 2] = 9; // a different-magnitude cell inside the left part
    floodFill(g, null, null, 0, 0, { terrain: LAND, mag: 20 });
    expect(g.mag[0]).toBe(20);
    expect(g.mag[2 * 10 + 2]).toBe(9);
    expect(g.mag[9]).toBe(3);
  });

  it('is clipped to the selection', () => {
    const g = createGrid(10, 10);
    floodFill(g, null, { x: 0, y: 0, w: 3, h: 3 }, 1, 1, { terrain: LAND, mag: 0 });
    expect(count(g, LAND)).toBe(9);
  });

  it('is undoable as one transaction', () => {
    const g = createGrid(300, 300);
    const h = new History(g);
    h.begin('fill');
    floodFill(g, h, null, 0, 0, { terrain: LAND, mag: 4 });
    h.commit();
    expect(count(g, LAND)).toBe(90000);
    h.undo();
    expect(count(g, LAND)).toBe(0);
  });
});

describe('pickAt', () => {
  it('returns the terrain and magnitude under the cursor', () => {
    const g = createGrid(4, 4);
    g.terrain[5] = LAND;
    g.mag[5] = 22;
    expect(pickAt(g, 1, 1)).toEqual({ terrain: LAND, mag: 22 });
  });
});
