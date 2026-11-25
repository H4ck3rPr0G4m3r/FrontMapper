import { describe, it, expect } from 'vitest';
import { LAND, VOID, createGrid } from '../../src/core/grid';
import { simulateExport } from '../../src/core/generator';
import { crowdedExtras, nationIssues, remapNations, type Nation } from '../../src/core/nations';
import { medianRoom, spawnRoom } from '../../src/core/spawnRoom';

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

describe('crowdedExtras', () => {
  const at = (id: string, x: number, source: Nation['source']): Nation => ({ id, name: id, x, y: 0, flag: '', source });

  it('picks the auto-placed nations to drop so no two are too close, keeping earlier (bigger) cities', () => {
    const list = [at('jakarta', 0, 'city'), at('bekasi', 10, 'city'), at('depok', 20, 'city'), at('bogor', 35, 'city')];
    expect(crowdedExtras(list, 30)).toEqual(['bekasi', 'depok']);
  });

  it('keeps custom nations, then countries, then provinces over cities', () => {
    const list = [at('city', 0, 'city'), at('prov', 5, 'province'), at('country', 50, 'country'), at('mine', 60, 'custom')];
    expect(crowdedExtras(list, 30).sort()).toEqual(['city', 'country']);
  });

  it('never drops custom nations, even when they crowd each other', () => {
    expect(crowdedExtras([at('a', 0, 'custom'), at('b', 1, 'custom')], 30)).toEqual([]);
  });
});

describe('spawnRoom', () => {
  it('splits land by who reaches it first over land, and measures the landmass', () => {
    const g = createGrid(30, 10);
    for (let y = 0; y < 10; y++) for (let x = 0; x < 20; x++) g.terrain[y * 30 + x] = LAND; // 200 px continent
    for (let y = 0; y < 2; y++) for (let x = 25; x < 28; x++) g.terrain[y * 30 + x] = LAND; // 6 px island
    const r = spawnRoom(g, [{ x: 0, y: 5 }, { x: 19, y: 5 }, { x: 26, y: 0 }, { x: 22, y: 5 }]);
    expect(r.room[0] + r.room[1]).toBe(200);
    expect(r.room[0]).toBe(100);
    expect([...r.island]).toEqual([200, 200, 6, 0]);
    expect(medianRoom(r.room)).toBe(100);
  });
});

describe('too-close check on many nations', () => {
  it('flags exactly the nations within the minimum distance of another, like comparing every pair', () => {
    let s = 7;
    const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const g = createGrid(2000, 1000);
    g.terrain.fill(LAND);
    const list: Nation[] = Array.from({ length: 1500 }, (_, k) => nation(`${k}`, Math.floor(rand() * 2000), Math.floor(rand() * 1000), { name: `N${k}` }));
    list.push(nation('off', -40, 10, { name: 'off' }), nation('off2', -40, 30, { name: 'off2' })); // off the map, close to each other
    const got = new Set(nationIssues(list, g, null, null).filter((i) => i.kind === 'too-close').map((i) => i.nationId));
    const want = new Set(list.filter((n) => list.some((o) => o !== n && Math.hypot(o.x - n.x, o.y - n.y) < 30)).map((n) => n.id));
    expect(got).toEqual(want);
    expect(got.size).toBeGreaterThan(100);
  });
});
