import { describe, it, expect } from 'vitest';
import { LAND, VOID, createGrid } from '../../src/core/grid';
import { simulateExport } from '../../src/core/generator';
import { nationIssues, remapNations, type Nation } from '../../src/core/nations';

const flags = new Set(['id', 'my', 'DE-BB']);
const nation = (id: string, x: number, y: number, extra: Partial<Nation> = {}): Nation => ({
  id, name: `N${id}`, x, y, flag: 'id', source: 'custom', ...extra,
});
const kinds = (issues: { nationId: string; kind: string }[], id: string) => issues.filter((i) => i.nationId === id).map((i) => i.kind);

function landGrid() {
  const g = createGrid(200, 100);
  for (let y = 0; y < 100; y++) for (let x = 0; x < 100; x++) g.terrain[y * 200 + x] = LAND;
  for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) g.terrain[y * 200 + 150 + x] = VOID;
  return g;
}

describe('nationIssues', () => {
  it('flags nations in water, in void and off the map', () => {
    const g = landGrid();
    const issues = nationIssues([nation('a', 150, 50), nation('b', 155, 5), nation('c', 300, 5), nation('d', 50, 50)], g, null, flags);
    expect(kinds(issues, 'a')).toEqual(['in-water']);
    expect(kinds(issues, 'b')).toEqual(['in-void']);
    expect(kinds(issues, 'c')).toEqual(['off-map']);
    expect(kinds(issues, 'd')).toEqual([]);
  });

  it('flags a nation on an island the generator will delete', () => {
    const g = landGrid();
    for (let y = 60; y < 62; y++) for (let x = 170; x < 175; x++) g.terrain[y * 200 + x] = LAND; // 10 cells
    const sim = simulateExport(g);
    const issues = nationIssues([nation('a', 172, 60)], g, sim, flags);
    expect(kinds(issues, 'a')).toEqual(['removed-on-export']);
  });

  it('flags nations closer than 30 px', () => {
    const g = landGrid();
    const close = nationIssues([nation('a', 10, 10), nation('b', 39, 10)], g, null, flags);
    expect(kinds(close, 'a')).toEqual(['too-close']);
    expect(kinds(close, 'b')).toEqual(['too-close']);
    const fine = nationIssues([nation('a', 10, 10), nation('b', 40, 10)], g, null, flags);
    expect(fine).toEqual([]);
  });

  it('flags unknown flags and duplicate names, but allows no flag', () => {
    const g = landGrid();
    const issues = nationIssues(
      [nation('a', 10, 10, { flag: 'xx' }), nation('b', 50, 50, { flag: '', name: 'Same' }), nation('c', 90, 90, { name: 'Same' })],
      g, null, flags,
    );
    expect(kinds(issues, 'a')).toEqual(['unknown-flag']);
    expect(kinds(issues, 'b')).toEqual(['duplicate-name']);
    expect(kinds(issues, 'c')).toEqual(['duplicate-name']);
  });
});

describe('remapNations', () => {
  it('scales and offsets coordinates', () => {
    const out = remapNations([nation('a', 100, 40)], { sx: 0.5, sy: 0.5, ox: 0, oy: 0 }, 100, 50);
    expect([out[0].x, out[0].y]).toEqual([50, 20]);
    const moved = remapNations([nation('a', 30, 30)], { sx: 1, sy: 1, ox: -10, oy: -10 }, 40, 40);
    expect([moved[0].x, moved[0].y]).toEqual([20, 20]);
  });
});
