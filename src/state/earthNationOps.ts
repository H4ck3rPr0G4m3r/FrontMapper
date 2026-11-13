import { signal } from '@preact/signals';
import { LAND, WATER } from '../core/grid';
import type { Nation } from '../core/nations';
import { countriesNear, defaultRegions, regionRaster, type RegionShape } from '../earth/convert';
import { cityNations, regionNations, type RegionInfo } from '../earth/earthNations';
import { loadCities } from '../earth/regions';
import { flagCodes, loadFlags } from './flags';
import { nations, project, selectedNation } from './store';

export type EarthNationSource = 'city' | 'country' | 'province';

export const earthNationsBusy = signal<EarthNationSource | null>(null);
export const earthNationsNote = signal<{ source: EarthNationSource; text: string; error?: boolean } | null>(null);
export const cityThreshold = signal(1_000_000);

const LABEL: Record<EarthNationSource, [string, string]> = { city: ['city', 'cities'], country: ['country', 'countries'], province: ['province', 'provinces'] };

/** Country (and, for provinces, province) of every non-water pixel of the open Earth map. */
async function regionsFor(level: 'country' | 'province') {
  const p = project.value!;
  const fs = p.earth!.frameSize;
  const g = p.grid;
  const want = new Uint8Array(g.terrain.length);
  for (let i = 0; i < want.length; i++) want[i] = g.terrain[i] !== WATER ? 1 : 0;
  const shapes = await countriesNear(fs, defaultRegions);
  const country = regionRaster(shapes, fs, want);
  const low = await defaultRegions.countriesLow();
  const props = new Map(low.features.map((f) => [f.properties.id, f.properties]));
  const info: RegionInfo = new Map();
  if (level === 'country') {
    for (const id of country.index) info.set(id, { name: props.get(id)?.name ?? id, iso2: props.get(id)?.iso2 ?? '' });
    return { fs, g, grid: country.grid, index: country.index, info };
  }

  // Provinces of every country with land on the map; countries without province data stay whole.
  const hasLand = new Set<number>();
  for (let i = 0; i < g.terrain.length; i++) if (g.terrain[i] === LAND && country.grid[i] >= 0) hasLand.add(country.grid[i]);
  const ids = [...hasLand].map((k) => country.index[k]);
  const sets = await Promise.all(ids.map((a3) => defaultRegions.provinces(a3)));
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
  for (let i = 0; i < want.length; i++) wantProv[i] = want[i] && withProvinces.has(country.index[country.grid[i]]) ? 1 : 0;
  const prov = regionRaster(provShapes, fs, wantProv);

  const index = [...prov.index];
  const countryLabel = new Map<number, number>();
  for (const id of ids)
    if (!withProvinces.has(id)) {
      countryLabel.set(country.index.indexOf(id), index.length);
      index.push(id);
      info.set(id, { name: props.get(id)?.name ?? id, iso2: props.get(id)?.iso2 ?? '' });
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
  return { fs, g, grid, index, info };
}

/** Replace the nations of one source with fresh ones from Earth data; custom ones stay. */
export async function nationsFromEarth(source: EarthNationSource) {
  const p = project.value;
  if (!p?.earth || earthNationsBusy.value) return;
  earthNationsBusy.value = source;
  earthNationsNote.value = null;
  loadFlags();
  try {
    const flags = flagCodes.value ? new Set(flagCodes.value) : null;
    const cities = await loadCities();
    let made: Nation[];
    if (source === 'city') made = cityNations(cities, p.earth.frameSize, p.grid, cityThreshold.value, flags);
    else {
      const r = await regionsFor(source);
      made = regionNations(source, r.fs, r.g, r.grid, r.index, cities, flags, r.info);
    }
    if (project.value !== p) return;
    const kept = nations.value.filter((n) => n.source !== source);
    nations.value = [...kept, ...made];
    if (selectedNation.value && !nations.value.some((n) => n.id === selectedNation.value)) selectedNation.value = null;
    const [one, many] = LABEL[source];
    earthNationsNote.value = { source, text: made.length ? `Placed ${made.length} ${made.length === 1 ? one : many}.` : `No ${many} on this map's land.` };
  } catch (e) {
    earthNationsNote.value = { source, text: e instanceof Error ? e.message : String(e), error: true };
  } finally {
    earthNationsBusy.value = null;
  }
}
