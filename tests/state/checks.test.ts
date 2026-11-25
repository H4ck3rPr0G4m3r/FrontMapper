import { describe, expect, it } from 'vitest';
import { createGrid, WATER } from '../../src/core/grid';
import type { ExportSimulation } from '../../src/core/generator';
import { analysis } from '../../src/state/analysis';
import { acceptedChecks, openChecks } from '../../src/state/checks';

const sim = (lakes: number[][]): ExportSimulation => ({
  grid: createGrid(8, 8),
  removedIslands: [],
  removedLakes: lakes.map((cells) => ({ cells: Int32Array.from(cells), replacement: WATER })),
  landTiles: 0,
});

describe('accepted checks', () => {
  it('stay accepted when a newer analysis finds different lakes', () => {
    acceptedChecks.value = { islands: false, lakes: false };
    analysis.value = null;
    const base = openChecks.value;
    analysis.value = { sim: sim([[1, 2], [9]]), revision: 1, counts: [] };
    expect(openChecks.value).toBe(base + 1);

    acceptedChecks.value = { ...acceptedChecks.value, lakes: true };
    expect(openChecks.value).toBe(base);

    // An edit (or a check that was still running when Accept was clicked) changes the lakes.
    analysis.value = { sim: sim([[1, 2, 3], [9], [20]]), revision: 2, counts: [] };
    expect(openChecks.value).toBe(base);
  });
});
