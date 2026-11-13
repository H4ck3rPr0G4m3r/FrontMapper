import { describe, expect, it } from 'vitest';
import { createGrid, LAND, VOID, WATER } from '../../src/core/grid';
import { cityNations, lonLatOf, pixelOf, placeByLonLat, regionNations, type RegionInfo } from '../../src/earth/earthNations';
import { HALF } from '../../src/earth/projection';
import type { CityRow } from '../../src/earth/regions';
import type { FrameSize } from '../../src/earth/types';

// 256 x 256 map near Java. Land: region 0 at x 20..119, region 1 at x 130..229 (rows 40..199); void at x 230..249.
const T = (2 * HALF) / 1024;
const fs: FrameSize = { frame: { x0: -HALF + 824 * T, x1: -HALF + 825 * T, y0: -HALF + 530 * T, y1: -HALF + 531 * T }, width: 256, height: 256, mPerPx: T / 256 };
const grid = createGrid(256, 256);
const regionGrid = new Int16Array(256 * 256).fill(-1);
for (let y = 40; y < 200; y++)
  for (let x = 20; x < 250; x++) {
    const i = y * 256 + x;
    if (x < 120) { grid.terrain[i] = LAND; regionGrid[i] = 0; }
    else if (x >= 130 && x < 230) { grid.terrain[i] = LAND; regionGrid[i] = 1; }
    else if (x >= 230) { grid.terrain[i] = VOID; regionGrid[i] = 1; }
  }
const city = (name: string, x: number, y: number, pop: number, kind: CityRow[5] = 'city', iso2 = 'aa', a3 = 'AAA'): CityRow => {
  const [lon, lat] = lonLatOf(fs, x, y);
  return [name, lon, lat, pop, iso2, kind, a3];
};
const flags = new Set(['aa', 'bb', 'BB-02']);

describe('pixel <-> lon/lat', () => {
  it('round-trips pixel centres', () => {
    const [lon, lat] = lonLatOf(fs, 37, 201);
    expect(pixelOf(fs, lon, lat)).toEqual({ x: 37, y: 201 });
  });
});

describe('cityNations', () => {
  it('keeps cities over the threshold on land only', () => {
    const cities = [city('Big', 50, 100, 2_000_000), city('Small', 60, 100, 500_000), city('OnVoid', 240, 100, 3_000_000, 'city', 'bb'), city('AtSea', 5, 5, 5_000_000)];
    const out = cityNations(cities, fs, grid, 1_000_000, flags);
    expect(out.map((n) => n.name)).toEqual(['Big']);
    expect(out[0]).toMatchObject({ x: 50, y: 100, flag: 'aa', source: 'city' });
    expect(out[0].lonLat).toBeDefined();
  });

  it('leaves the flag empty when OpenFront has none for the country', () => {
    const out = cityNations([city('Elsewhere', 50, 100, 2_000_000, 'city', 'zz')], fs, grid, 1_000_000, flags);
    expect(out[0].flag).toBe('');
  });
});

describe('regionNations', () => {
  const countries: RegionInfo = new Map([
    ['AAA', { name: 'Aland', iso2: 'aa' }],
    ['BBB', { name: 'Bland', iso2: 'bb' }],
  ]);

  it('spawns a country at its capital when the capital is on its land', () => {
    const out = regionNations('country', fs, grid, regionGrid, ['AAA', 'BBB'], [city('Acap', 30, 50, 100, 'capital')], flags, countries);
    expect(out.find((n) => n.name === 'Aland')).toMatchObject({ x: 30, y: 50, flag: 'aa', source: 'country' });
  });

  it('spawns a province without a capital deep inside its own land', () => {
    const provinces: RegionInfo = new Map([
      ['P1', { name: 'One', iso2: 'aa', iso3166_2: 'AA-01' }],
      ['P2', { name: 'Two', iso2: 'bb', iso3166_2: 'BB-02' }],
    ]);
    const out = regionNations('province', fs, grid, regionGrid, ['P1', 'P2'], [], flags, provinces);
    expect(out).toHaveLength(2);
    for (const [k, n] of out.entries()) {
      const i = n.y * 256 + n.x;
      expect(grid.terrain[i]).toBe(LAND);
      expect(regionGrid[i]).toBe(k);
    }
    const one = out.find((n) => n.name === 'One')!;
    expect(Math.abs(one.x - 69.5)).toBeLessThanOrEqual(1);
    expect(one.y).toBeGreaterThan(70);
    expect(one.y).toBeLessThan(170);
    // A province flag falls back to its country's flag when OpenFront has none.
    expect(one.flag).toBe('aa');
    expect(out.find((n) => n.name === 'Two')!.flag).toBe('BB-02');
  });

  it('skips regions with no land', () => {
    const water = createGrid(256, 256, WATER);
    expect(regionNations('country', fs, water, regionGrid, ['AAA', 'BBB'], [], flags, new Map())).toEqual([]);
  });
});

describe('placeByLonLat', () => {
  it('keeps Earth nations on the same spot after a re-frame (to 1 px)', () => {
    const [lon, lat] = lonLatOf(fs, 100, 120);
    const moved: FrameSize = { ...fs, frame: { ...fs.frame, x0: fs.frame.x0 - 10.3 * fs.mPerPx, y0: fs.frame.y0 + 7.6 * fs.mPerPx }, mPerPx: fs.mPerPx / 2 };
    const [n] = placeByLonLat([{ id: 'a', name: 'A', x: 100, y: 120, flag: '', source: 'custom', lonLat: [lon, lat] }], moved);
    const ex = ((100.5 + 10.3) * fs.mPerPx) / moved.mPerPx;
    const ey = ((120.5 - 7.6) * fs.mPerPx) / moved.mPerPx;
    expect(Math.abs(n.x + 0.5 - ex)).toBeLessThanOrEqual(1);
    expect(Math.abs(n.y + 0.5 - ey)).toBeLessThanOrEqual(1);
  });

  it('leaves nations without lon/lat where they are', () => {
    const [n] = placeByLonLat([{ id: 'a', name: 'A', x: 3, y: 4, flag: '', source: 'custom' }], fs);
    expect(n).toMatchObject({ x: 3, y: 4 });
  });
});
