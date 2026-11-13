import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, unknown>();
let failWrites = false;
vi.mock('idb-keyval', () => ({
  get: async (k: string) => store.get(k),
  set: async (k: string, v: unknown) => {
    if (failWrites) throw new DOMException('Quota exceeded', 'QuotaExceededError');
    store.set(k, v);
  },
  del: async (k: string) => void store.delete(k),
}));

const { AutoSaver, autosaveError, loadAutosave } = await import('../../src/state/autosave');
const { createGrid, LAND } = await import('../../src/core/grid');

const state = () => ({ id: 'p1', grid: createGrid(8, 8), meta: { name: 'T', categories: [] }, nations: [] });

beforeEach(() => {
  store.clear();
  failWrites = false;
  autosaveError.value = null;
});

describe('AutoSaver', () => {
  it('saves the map as it was when the save was asked for, not later edits', async () => {
    const s = state();
    const saver = new AutoSaver(() => s);
    const done = saver.flush();
    s.grid.terrain[0] = LAND; // an edit right after
    await done;
    expect((await loadAutosave('p1'))!.grid.terrain[0]).toBe(0);
  });

  it('reports a failed write instead of losing it silently', async () => {
    failWrites = true;
    await new AutoSaver(() => state()).flush();
    expect(autosaveError.value).toMatch(/Quota/);
    failWrites = false;
    await new AutoSaver(() => state()).flush();
    expect(autosaveError.value).toBeNull();
  });
});
