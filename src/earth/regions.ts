import type { Feature, FeatureCollection, Geometry } from 'geojson';
import { feature } from 'topojson-client';

/** Rows of cities/<iso2>.json: [name, lon, lat, population, iso2, kind, countryA3]. */
export type CityRow = [string, number, number, number, string, 'capital' | 'admin1' | 'city', string];
/** Rows of provinces-index.json: [id, name, countryA3, iso3166_2]. */
export type ProvinceIndexRow = [string, string, string, string];

export interface CountryProps {
  id: string;
  name: string;
  iso2: string;
  /** Natural Earth outline of a territory inside a geoBoundaries country: drawn over it. */
  over?: boolean;
}
export interface ProvinceProps {
  id: string;
  name: string;
  iso3166_2: string;
  a3: string;
}

const base = () => `${import.meta.env.BASE_URL}data/`;

/** The data file does not exist (as opposed to a download that failed). */
export class DataMissing extends Error {
  constructor(path: string) {
    super(`${path} does not exist.`);
    this.name = 'DataMissing';
  }
}
const cache = new Map<string, Promise<unknown>>();

function getJson<T>(path: string): Promise<T> {
  let p = cache.get(path) as Promise<T> | undefined;
  if (!p) {
    p = fetch(base() + path).then((r) => {
      // Dev servers and some hosts answer a missing file with the app's HTML page.
      if (r.status === 404 || (r.ok && (r.headers.get('content-type') ?? '').includes('text/html'))) throw new DataMissing(path);
      if (!r.ok) throw new Error(`Could not load ${path} (HTTP ${r.status}).`);
      return r.json() as Promise<T>;
    });
    p.catch(() => cache.delete(path));
    cache.set(path, p);
  }
  return p;
}

/** Simplified world outlines for the picker. Feature ids are ADM0_A3 codes. */
export async function loadCountriesLow(): Promise<FeatureCollection<Geometry, CountryProps>> {
  const topo = await getJson<any>('countries-low.json');
  const fc = feature(topo, topo.objects.countries) as unknown as FeatureCollection<Geometry, CountryProps>;
  for (const f of fc.features) f.properties = { ...f.properties, id: String(f.id) };
  return fc;
}

/** Per-country files are TopoJSON with a single object. */
async function getTopo<P>(path: string): Promise<FeatureCollection<Geometry, P>> {
  const topo = await getJson<any>(path);
  const key = Object.keys(topo.objects)[0];
  return feature(topo, topo.objects[key]) as unknown as FeatureCollection<Geometry, P>;
}

/** Full-detail outline of one country (geoBoundaries). */
export function loadCountry(a3: string): Promise<FeatureCollection<Geometry, CountryProps>> {
  return getTopo(`countries/${a3}.json`);
}

/** Provinces/states of one country (empty if there are none; a failed download throws). */
export async function loadProvinces(a3: string): Promise<FeatureCollection<Geometry, ProvinceProps>> {
  try {
    return await getTopo(`provinces/${a3}.json`);
  } catch (e) {
    if (e instanceof DataMissing) return { type: 'FeatureCollection', features: [] };
    throw e;
  }
}

export const loadProvinceIndex = () => getJson<ProvinceIndexRow[]>('provinces-index.json');
/** Where each country's cities are: iso2 -> [minLon, minLat, maxLon, maxLat, count]. */
export const loadCityIndex = () => getJson<Record<string, [number, number, number, number, number]>>('cities-index.json');

/**
 * Cities (GeoNames, 1000+ people) of every country with cities inside a lon/lat box, biggest
 * first. `lon1` may pass 180 for boxes across the date line.
 */
export async function loadCitiesIn(lon0: number, lat0: number, lon1: number, lat1: number): Promise<CityRow[]> {
  const index = await loadCityIndex();
  const hit = Object.entries(index)
    .filter(([, [x0, y0, x1, y1]]) => y1 >= lat0 && y0 <= lat1 && [-360, 0, 360].some((s) => x1 + s >= lon0 && x0 + s <= lon1))
    .map(([iso]) => iso);
  const sets = await Promise.all(hit.map((iso) => getJson<CityRow[]>(`cities/${iso}.json`)));
  return sets.flat().sort((a, b) => b[3] - a[3]);
}

export type RegionFeature = Feature<Geometry, CountryProps | ProvinceProps>;
