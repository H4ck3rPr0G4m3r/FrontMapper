import { describe, it, expect } from 'vitest';
import { LAND, createGrid } from '../../src/core/grid';
import { History } from '../../src/core/history';
import { inSelection } from '../../src/core/selection';

const SEG_BYTES = 256 * 256 * 4; // before + after, terrain + mag

describe('History', () => {
  it('undo restores the exact bytes and redo reapplies them', () => {
    const g = createGrid(600, 300);
    const h = new History(g);
    h.begin('paint');
    h.touch(0);
    g.terrain[10] = LAND;
    g.mag[10] = 17;
    expect(h.commit()).toEqual([0]);
    expect(h.undo()).toEqual([0]);
    expect([g.terrain[10], g.mag[10]]).toEqual([0, 0]);
    expect(h.redo()).toEqual([0]);
    expect([g.terrain[10], g.mag[10]]).toEqual([LAND, 17]);
  });

  it('undoes a chain of commits in reverse order, and a new commit clears redo', () => {
    const g = createGrid(300, 300);
    const h = new History(g);
    for (const v of [1, 2, 3]) {
      h.begin('m');
      h.touch(0);
      g.mag[5] = v;
      h.commit();
    }
    h.undo();
    expect(g.mag[5]).toBe(2);
    h.undo();
    expect(g.mag[5]).toBe(1);
    h.begin('m');
    h.touch(0);
    g.mag[5] = 9;
    h.commit();
    expect(h.canRedo).toBe(false);
    h.undo();
    expect(g.mag[5]).toBe(1);
  });

  it('drops the oldest entries beyond maxBytes', () => {
    const g = createGrid(512, 512);
    const h = new History(g, SEG_BYTES * 2);
    for (const v of [1, 2, 3]) {
      h.begin('m');
      h.touch(0);
      g.mag[0] = v;
      h.commit();
    }
    expect(h.undo()).toEqual([0]);
    expect(h.undo()).toEqual([0]);
    expect(h.undo()).toEqual([]);
    expect(h.canUndo).toBe(false);
    expect(g.mag[0]).toBe(1);
  });

  it('only snapshots a segment once per transaction', () => {
    const g = createGrid(300, 300);
    const h = new History(g);
    h.begin('m');
    h.touch(0);
    g.mag[1] = 4;
    h.touch(0);
    g.mag[1] = 8;
    h.commit();
    h.undo();
    expect(g.mag[1]).toBe(0);
  });
});

describe('inSelection', () => {
  it('treats no selection as everything and respects bounds', () => {
    expect(inSelection(null, 5, 5)).toBe(true);
    const s = { x: 10, y: 10, w: 5, h: 5 };
    expect(inSelection(s, 10, 10)).toBe(true);
    expect(inSelection(s, 14, 14)).toBe(true);
    expect(inSelection(s, 15, 10)).toBe(false);
  });
});
