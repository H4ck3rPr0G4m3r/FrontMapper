import { LAND, WATER, type MapGrid } from '../core/grid';
import type { Nation } from '../core/nations';
import { countriesNear, regionRaster, type RegionLoaders, type RegionShape } from './convert';
import { cityCandidates, cityNations, regionNations, type RegionInfo } from './earthNations';
import { pickFair, pickSpread, type PickOpts } from './cityPicks';
import type { CityRow } from './regions';
import type { CustomRegion, FrameSize } from './types';

export type EarthNationSource = 'city' | 'country' | 'province' | 'region';

export interface PlaceNationsRequest {
  source: EarthNationSource;
  fs: FrameSize;
  width: number;
  height: number;
  terrain: Uint8Array;
  minPop: number;
  /** OpenFront flag codes, or null when unknown (flags are then used unchecked). */
  flags: string[] | null;
  /** Cities only: pick this many of them instead of all (spread out, or for even starts). */
  pick?: PickOpts;
  /** The user's own regions, for `region`. */
  regions?: CustomRegion[];
}

/** Country (and for provinces, province) of every non-water pixel, rebuilt from the borders. */
async function regionsFor(level: 'country' | 'province', fs: FrameSize, g: MapGrid, regions: RegionLoaders) {
  const want = new Uint8Array(g.terrain.length);
  for (let i = 0; i < want.length; i++) want[i] = g.terrain[i] !== WATER ? 1 : 0;
  const country = regionRaster(await countriesNear(fs, regions), fs, want);
  const low = await regions.countriesLow();
  const props = new Map(low.features.map((f) => [f.properties.id, f.properties]));
  const info: RegionInfo = new Map();
  const countryInfo = (id: string) => info.set(id, { name: props.get(id)?.name ?? id, iso2: props.get(id)?.iso2 ?? '' });
  if (level === 'country') {
    country.index.forEach(countryInfo);
    return { grid: country.grid, index: country.index, info, provCountry: new Map<string, string>() };
  }

  // Provinces of every country with land on the map; countries without province data stay whole.
  const hasLand = new Set<number>();
  for (let i = 0; i < g.terrain.length; i++) if (g.terrain[i] === LAND && country.grid[i] >= 0) hasLand.add(country.grid[i]);
  const ids = [...hasLand].map((k) => country.index[k]);
  const sets = await Promise.all(ids.map((a3) => regions.provinces(a3)));
  const provShapes: RegionShape[] = [];
  const provCountry = new Map<string, string>();
  sets.forEach((fc, j) => {
    const a3 = ids[j];
    for (const f of fc.features) {
      provShapes.push({ id: f.properties.id, geometry: f.geometry });
      provCountry.set(f.properties.id, a3);
      info.set(f.properties.id, { name: f.properties.name, iso2: props.get(a3)?.iso2 ?? '', iso3166_2: f.properties.iso3166_2 });
    }
  });
  const withProvinces = new Set(ids.filter((_, j) => sets[j].features.length));
  const wantProv = new Uint8Array(want.length);
  for (let i = 0; i < want.length; i++) wantProv[i] = want[i] && country.grid[i] >= 0 && withProvinces.has(country.index[country.grid[i]]) ? 1 : 0;
  const prov = regionRaster(provShapes, fs, wantProv);

  const index = [...prov.index];
  const countryLabel = new Map<number, number>();
  for (const id of ids)
    if (!withProvinces.has(id)) {
      countryLabel.set(country.index.indexOf(id), index.length);
      index.push(id);
      countryInfo(id);
    }
  const grid = new Int16Array(want.length).fill(-1);
  for (let i = 0; i < grid.length; i++) {
    const c = country.grid[i];
    if (c < 0 || !want[i]) continue;
    const a3 = country.index[c];
    if (withProvinces.has(a3)) {
      const k = prov.grid[i];
      if (k >= 0 && provCountry.get(prov.index[k]) === a3) grid[i] = k;
    } else if (countryLabel.has(c)) grid[i] = countryLabel.get(c)!;
  }
  return { grid, index, info, provCountry };
}

/** Nations of one source for an Earth map (runs in the nations worker). */
export async function placeEarthNations(req: PlaceNationsRequest, regions: RegionLoaders, cities: CityRow[]): Promise<Nation[]> {
  const g: MapGrid = { width: req.width, height: req.height, terrain: req.terrain, mag: new Uint8Array(0) };
  const flags = req.flags ? new Set(req.flags) : null;
  if (req.source === 'city' && req.pick) return pickCities(req, req.pick, g, cities, flags).nations;
  if (req.source === 'city') return cityNations(cities, req.fs, g, req.minPop, flags);
  if (req.source === 'region') return customRegionNations(req, g, regions, cities, flags);
  const r = await regionsFor(req.source, req.fs, g, regions);
  return regionNations(req.source, req.fs, g, r.grid, r.index, cities, flags, r.info);
}

/**
 * One nation per custom region: provinces and countries are rasterised as usual, then every
 * pixel of a member (a province, or any province of a member country) counts for its region.
 * The nation sits at a member country's capital when one is on the region's land, otherwise
 * at the point deepest inside the region. It takes the flag of the region's first country.
 */
async function customRegionNations(req: PlaceNationsRequest, g: MapGrid, regions: RegionLoaders, cities: CityRow[], flags: Set<string> | null): Promise<Nation[]> {
  const list = (req.regions ?? []).filter((r) => r.members.length);
  if (!list.length) return [];
  const r = await regionsFor('province', req.fs, g, regions);
  const ofProvince = new Map<string, number>();
  const ofCountry = new Map<string, number>();
  list.forEach((c, k) => {
    for (const m of c.members) (m.level === 'province' ? ofProvince : ofCountry).set(m.id, k);
  });
  // Label -> custom region: the province itself, else its country (or a country without provinces).
  const labelTo = r.index.map((id) => ofProvince.get(id) ?? ofCountry.get(r.provCountry.get(id) ?? id) ?? -1);
  const grid = new Int16Array(r.grid.length).fill(-1);
  for (let i = 0; i < grid.length; i++) if (r.grid[i] >= 0) grid[i] = labelTo[r.grid[i]];
  const low = await regions.countriesLow();
  const iso2 = new Map(low.features.map((f) => [f.properties.id, f.properties.iso2]));
  const info: RegionInfo = new Map();
  const ids = list.map((c) => c.id);
  list.forEach((c) => {
    const first = c.members[0];
    info.set(c.id, { name: c.name, iso2: iso2.get(first.level === 'country' ? first.id : first.country ?? '') ?? '' });
  });
  return regionNations('country', req.fs, g, grid, ids, cities, flags, info).map((n) => ({ ...n, source: 'region' as const }));
}

/** A number of the cities over the minimum: spread out, or chosen for even starts. */
export function pickCities(req: PlaceNationsRequest, pick: PickOpts, g: MapGrid, cities: CityRow[], flags: Set<string> | null): { nations: Nation[]; evenness: number | null } {
  const all = cityCandidates(cities, req.fs, g, req.minPop, flags);
  const cands = all.map((c) => ({ x: c.nation.x, y: c.nation.y, pop: c.pop }));
  if (pick.method === 'fair') {
    const r = pickFair(g, cands, pick.count, pick.seed);
    return { nations: r.picks.map((i) => all[i].nation), evenness: r.evenness };
  }
  return { nations: pickSpread(cands, pick.count, pick.spread, pick.seed, g.width, g.height).map((i) => all[i].nation), evenness: null };
}
