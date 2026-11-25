import { describe, it, expect } from 'vitest';
import { LAND, WATER, createGrid } from '../../src/core/grid';
import { nationGuide } from '../../src/core/nationGuide';
import { spawnRoom } from '../../src/core/spawnRoom';
import { pickFair, pickSpread, type Candidate } from '../../src/earth/cityPicks';

/** A Michigan-like setup: big cities packed in one corner, small towns everywhere else. */
function cities(): Candidate[] {
  const out: Candidate[] = [];
  for (let k = 0; k < 10; k++) out.push({ x: 360 + (k % 5) * 6, y: 260 + Math.floor(k / 5) * 6, pop: 400_000 - k * 20_000 });
  for (let gx = 0; gx < 8; gx++) for (let gy = 0; gy < 6; gy++) out.push({ x: 20 + gx * 50, y: 20 + gy * 50, pop: 20_000 + ((gx * 7 + gy * 3) % 9) * 1000 });
  return out;
}

const spreadOf = (c: Candidate[], picks: number[]) => {
  let min = Infinity;
  for (const a of picks) for (const b of picks) if (a !== b) min = Math.min(min, Math.hypot(c[a].x - c[b].x, c[a].y - c[b].y));
  return min;
};

describe('pickSpread', () => {
  it('at 0 takes the biggest cities', () => {
    const c = cities();
    expect(pickSpread(c, 5, 0, 1, 400, 300).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
  });

  it('spreads picks out as the slider goes up', () => {
    const c = cities();
    const tight = spreadOf(c, pickSpread(c, 8, 0, 1, 400, 300));
    const wide = spreadOf(c, pickSpread(c, 8, 0.8, 1, 400, 300));
    expect(wide).toBeGreaterThan(tight * 4);
  });

  it('repeats for a seed, and another seed can pick differently', () => {
    const c = cities();
    expect(pickSpread(c, 8, 0.7, 3, 400, 300)).toEqual(pickSpread(c, 8, 0.7, 3, 400, 300));
    const seeds = new Set([1, 2, 3, 4, 5, 6].map((s) => pickSpread(c, 8, 0.7, s, 400, 300).join()));
    expect(seeds.size).toBeGreaterThan(1);
  });

  it('never picks more cities than there are', () => {
    expect(pickSpread(cities().slice(0, 3), 10, 0.5, 1, 400, 300)).toHaveLength(3);
  });
});

describe('pickFair', () => {
  it('makes starts more even than plain spreading', () => {
    // Land with a big empty west and a narrow east: spread picks crowd the east.
    const g = createGrid(400, 300, WATER);
    for (let y = 10; y < 290; y++) for (let x = 10; x < 390; x++) g.terrain[y * 400 + x] = LAND;
    const c = cities();
    const even = (picks: number[]) => {
      const r = spawnRoom(g, picks.map((i) => c[i])).room;
      return Math.min(...r) / Math.max(...r);
    };
    const spread = pickSpread(c, 6, 0.7, 1, 400, 300);
    const fair = pickFair(g, c, 6, 1);
    expect(fair.picks).toHaveLength(6);
    expect(new Set(fair.picks).size).toBe(6);
    expect(even(fair.picks)).toBeGreaterThanOrEqual(even(spread));
    expect(fair.evenness).toBeGreaterThan(0.5);
  });
});

describe('nationGuide', () => {
  it('sizes lobbies and the typical nation count from land', () => {
    const g = nationGuide(1_400_000);
    expect(g.lobby).toEqual({ large: 70, medium: 52, small: 35 });
    expect(g.typical).toEqual([9, 30]);
    expect(g.median).toBe(19);
    expect(g.kind).toBeNull();
    expect(nationGuide(1_400_000, ['continental']).kind).toEqual({ label: 'Continental maps', count: 43 });
  });
});
