import { describe, it, expect } from 'vitest';
import { LAND, WATER, createGrid, type MapGrid } from '../../src/core/grid';
import { History } from '../../src/core/history';
import { combineSelections, inSelection, selectionArea, selectionOutline, wandSelect } from '../../src/core/selection';
import { extractPatch, fillSelection, stampPatch, surroundingPaint, transformPatch, transformPoint } from '../../src/core/transform';
import { mirrorCells, withSymmetry } from '../../src/core/symmetry';
import { paintAt } from '../../src/core/tools/brush';
import { textureAt } from '../../src/core/tools/texture';

const island = (g: MapGrid, x0: number, y0: number, w: number, h: number, mag = 5) => {
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++) {
      g.terrain[y * g.width + x] = LAND;
      g.mag[y * g.width + x] = mag;
    }
};

describe('selection masks', () => {
  it('adds and subtracts rectangles', () => {
    const a = { x: 0, y: 0, w: 4, h: 4 };
    const b = { x: 2, y: 2, w: 4, h: 4 };
    const u = combineSelections(a, b, 'add')!;
    expect([u.x, u.y, u.w, u.h]).toEqual([0, 0, 6, 6]);
    expect(inSelection(u, 5, 5)).toBe(true);
    expect(inSelection(u, 5, 0)).toBe(false);
    const d = combineSelections(a, b, 'subtract')!;
    expect(inSelection(d, 3, 3)).toBe(false);
    expect(inSelection(d, 1, 1)).toBe(true);
    expect(selectionArea(d, createGrid(8, 8))).toBe(12);
  });

  it('subtracting everything leaves nothing selected', () => {
    expect(combineSelections({ x: 1, y: 1, w: 2, h: 2 }, { x: 0, y: 0, w: 5, h: 5 }, 'subtract')).toBeNull();
  });

  it('magic wand picks connected land within the elevation range', () => {
    const g = createGrid(20, 10);
    island(g, 2, 2, 4, 4, 5);
    island(g, 6, 2, 2, 4, 25); // mountains touching the island
    island(g, 12, 2, 3, 3, 5); // another island
    const near = wandSelect(g, 3, 3, { tolerance: 3, contiguous: true })!;
    expect(selectionArea(near, g)).toBe(16);
    const all = wandSelect(g, 3, 3, { tolerance: 30, contiguous: true })!;
    expect(selectionArea(all, g)).toBe(24);
    const anywhere = wandSelect(g, 3, 3, { tolerance: 3, contiguous: false })!;
    expect(selectionArea(anywhere, g)).toBe(25);
  });

  it('outlines a masked selection with edge runs', () => {
    const sel = combineSelections({ x: 0, y: 0, w: 2, h: 2 }, { x: 2, y: 2, w: 2, h: 2 }, 'add')!;
    const runs = selectionOutline(sel);
    let len = 0;
    for (let k = 0; k < runs.length; k += 4) len += Math.abs(runs[k + 2] - runs[k]) + Math.abs(runs[k + 3] - runs[k + 1]);
    expect(len).toBe(16);
  });
});

describe('patches', () => {
  it('rotates and flips, keeping cells and the mask', () => {
    const g = createGrid(10, 10);
    island(g, 1, 1, 3, 2, 7);
    const sel = { x: 1, y: 1, w: 3, h: 2 };
    const p = extractPatch(g, sel);
    const r = transformPatch(p, 'rotateCW');
    expect([r.w, r.h]).toEqual([2, 3]);
    expect(transformPatch(transformPatch(r, 'rotateCCW'), 'flipX')).toEqual(transformPatch(p, 'flipX'));
    expect(transformPoint(p, 'rotateCW', 0, 0)).toEqual([1, 0]);
    expect(transformPoint(p, 'flipX', 0, 1)).toEqual([2, 1]);
  });

  it('moves an island: what is left behind is sea', () => {
    const g = createGrid(12, 12);
    island(g, 2, 2, 3, 3);
    const sel = { x: 2, y: 2, w: 3, h: 3 };
    const fill = surroundingPaint(g, sel);
    expect(fill).toEqual({ terrain: WATER, mag: 0 });
    const p = extractPatch(g, sel);
    const h = new History(g);
    h.begin('move');
    fillSelection(g, h, sel, fill);
    stampPatch(g, h, p, 7, 7);
    h.commit();
    expect(g.terrain[2 * 12 + 2]).toBe(WATER);
    expect(g.terrain[8 * 12 + 8]).toBe(LAND);
    h.undo();
    expect(g.terrain[2 * 12 + 2]).toBe(LAND);
    expect(g.terrain[8 * 12 + 8]).toBe(WATER);
  });

  it('drops cells stamped off the map', () => {
    const g = createGrid(4, 4);
    const p = extractPatch(createGrid(3, 3, LAND), { x: 0, y: 0, w: 3, h: 3 });
    stampPatch(g, null, p, 2, 2);
    expect(g.terrain.reduce((n, t) => n + t, 0)).toBe(4);
  });
});

describe('symmetry', () => {
  it('maps cells across the centre', () => {
    expect(mirrorCells('x', 10, 6, 1, 2)).toEqual([[8, 2]]);
    expect(mirrorCells('rot', 10, 6, 1, 2)).toEqual([[8, 3]]);
    expect(mirrorCells('xy', 10, 6, 0, 0)).toHaveLength(3);
  });

  it('copies exactly what a tool changed, even noisy ones', () => {
    const g = createGrid(40, 20, LAND);
    g.mag.fill(10);
    withSymmetry(g, null, 'x', () => textureAt(g, null, null, 8, 10, 9, { mode: 'coast+elevation', strength: 1, grain: 4, seed: 3 }));
    withSymmetry(g, null, 'x', () => paintAt(g, null, null, 3, 3, 3, { terrain: WATER, mag: 0 }));
    for (let y = 0; y < 20; y++)
      for (let x = 0; x < 20; x++) {
        const i = y * 40 + x, j = y * 40 + (39 - x);
        expect([g.terrain[j], g.mag[j]]).toEqual([g.terrain[i], g.mag[i]]);
      }
  });

  it('is undone together with the stroke', () => {
    const g = createGrid(20, 20);
    const h = new History(g);
    h.begin('brush');
    withSymmetry(g, h, 'rot', () => paintAt(g, h, null, 2, 2, 1, { terrain: LAND, mag: 3 }));
    h.commit();
    expect(g.terrain[17 * 20 + 17]).toBe(LAND);
    h.undo();
    expect(g.terrain.every((t) => t === WATER)).toBe(true);
  });
});
