import { describe, expect, it } from 'vitest';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import { createGrid, LAND } from '../../src/core/grid';
import type { RegionLoaders } from '../../src/earth/convert';
import { lonLatOf } from '../../src/earth/earthNations';
import { placeEarthNations } from '../../src/earth/placeNations';
import { HALF } from '../../src/earth/projection';
import type { FrameSize, LonLat } from '../../src/earth/types';

const T = (2 * HALF) / 1024;
const fs: FrameSize = { frame: { x0: -HALF + 824 * T, x1: -HALF + 825 * T, y0: -HALF + 530 * T, y1: -HALF + 531 * T }, width: 256, height: 256, mPerPx: T / 256 };
const rect = (x0: number, y0: number, x1: number, y1: number): LonLat[] => [lonLatOf(fs, x0, y0), lonLatOf(fs, x1, y0), lonLatOf(fs, x1, y1), lonLatOf(fs, x0, y1), lonLatOf(fs, x0, y0)];
const feat = (props: Record<string, string>, ring: LonLat[]): Feature<Geometry, any> => ({ type: 'Feature', properties: props, geometry: { type: 'Polygon', coordinates: [ring] } });
const fc = (f: Feature<Geometry, any>[]): FeatureCollection<Geometry, any> => ({ type: 'FeatureCollection', features: f });

// AAA (x 20..119) has two provinces; BBB (x 130..229) has none.
const A = feat({ id: 'AAA', name: 'Aland', iso2: 'aa' }, rect(20, 40, 120, 200));
const B = feat({ id: 'BBB', name: 'Bland', iso2: 'bb' }, rect(130, 40, 230, 200));
const regions: RegionLoaders = {
  countriesLow: async () => fc([A, B]),
  country: async (a3) => fc([a3 === 'AAA' ? A : B]),
  provinces: async (a3) =>
    fc(a3 === 'AAA' ? [feat({ id: 'P1', name: 'North', iso3166_2: 'AA-N', a3 }, rect(20, 40, 120, 120)), feat({ id: 'P2', name: 'South', iso3166_2: 'AA-S', a3 }, rect(20, 120, 120, 200))] : []),
};
const grid = createGrid(256, 256);
for (let y = 40; y < 200; y++) for (let x = 20; x < 230; x++) if (x < 120 || x >= 130) grid.terrain[y * 256 + x] = LAND;
const base = { fs, width: 256, height: 256, terrain: grid.terrain, minPop: 0, flags: null };

describe('placeEarthNations', () => {
  it('places one nation per country with land', async () => {
    const out = await placeEarthNations({ ...base, source: 'country' }, regions, []);
    expect(out.map((n) => n.name).sort()).toEqual(['Aland', 'Bland']);
  });

  it('places provinces, keeping countries without province data whole', async () => {
    const out = await placeEarthNations({ ...base, source: 'province' }, regions, []);
    expect(out.map((n) => n.name).sort()).toEqual(['Bland', 'North', 'South']);
    const north = out.find((n) => n.name === 'North')!;
    expect(north.y).toBeLessThan(120);
    expect(north.source).toBe('province');
  });
});
