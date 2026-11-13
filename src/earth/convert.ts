import type { FeatureCollection, Geometry, Position } from 'geojson';
import { createGrid, LAND, VOID, type MapGrid } from '../core/grid';
import { voidEnclosedLakes } from '../core/generator';
import type { SourceId } from '../core/credits';
import { elevationGrid, magFor } from './elevation';
import { HALF, lonLatToMerc } from './projection';
import { fillNearest, fillRings } from './raster';
import { DataMissing, loadCountriesLow, loadCountry, loadProvinces, type CountryProps, type ProvinceProps } from './regions';
import type { ElevationCurve, FrameSize, SelOp, SelShape } from './types';
import { waterMask } from './water';

export interface RegionLoaders {
  countriesLow(): Promise<FeatureCollection<Geometry, CountryProps>>;
  country(a3: string): Promise<FeatureCollection<Geometry, CountryProps>>;
  provinces(a3: string): Promise<FeatureCollection<Geometry, ProvinceProps>>;
}

export const defaultRegions: RegionLoaders = { countriesLow: loadCountriesLow, country: loadCountry, provinces: loadProvinces };

export interface ConvertRequest {
  fs: FrameSize;
  ops: SelOp[];
  curve: ElevationCurve;
}

export interface ConvertDeps {
  fetch: typeof globalThis.fetch;
  signal: AbortSignal;
  regions?: RegionLoaders;
  retryDelayMs?: number;
}

export interface ConvertResult {
  grid: MapGrid;
  sources: SourceId[];
  /** Country of every land pixel (index into regionIndex; -1 where there is no country at all). */
  regionGrid: Int16Array;
  /** ADM0_A3 codes. */
  regionIndex: string[];
}

export const CONVERT_STEPS = ['Coastlines', 'Elevation', 'Borders', 'Building map'] as const;
export type ConvertStep = (typeof CONVERT_STEPS)[number];
export type ConvertProgress = (step: ConvertStep, done: number, total: number) => void;

const WORLD = 2 * HALF;

/** Shifts by whole worlds (in Mercator metres) that make an x range overlap the frame. */
function shiftsFor(minX: number, maxX: number, fs: FrameSize): number[] {
  const out: number[] = [];
  for (let k = -2; k <= 2; k++) if (maxX + k * WORLD >= fs.frame.x0 && minX + k * WORLD <= fs.frame.x1) out.push(k * WORLD);
  return out;
}

/** Mercator rings (flat [x, y, ...]) to pixel rings, once per world copy that touches the frame. */
function toPixels(mercRings: number[][], fs: FrameSize): Float64Array[] {
  let minX = Infinity, maxX = -Infinity;
  for (const r of mercRings) for (let i = 0; i < r.length; i += 2) { if (r[i] < minX) minX = r[i]; if (r[i] > maxX) maxX = r[i]; }
  const out: Float64Array[] = [];
  for (const shift of shiftsFor(minX, maxX, fs)) {
    for (const r of mercRings) {
      const p = new Float64Array(r.length);
      for (let i = 0; i < r.length; i += 2) {
        p[i] = (r[i] + shift - fs.frame.x0) / fs.mPerPx;
        p[i + 1] = (r[i + 1] - fs.frame.y0) / fs.mPerPx;
      }
      out.push(p);
    }
  }
  return out;
}

const mercRing = (ring: Position[]) => {
  const out: number[] = new Array(ring.length * 2);
  ring.forEach(([lon, lat], i) => {
    const m = lonLatToMerc(lon, lat);
    out[2 * i] = m.x;
    out[2 * i + 1] = m.y;
  });
  return out;
};

/** Polygons of a GeoJSON geometry as lists of Mercator rings. */
function polygonsOf(g: Geometry | null): number[][][] {
  if (!g) return [];
  if (g.type === 'Polygon') return [g.coordinates.map(mercRing)];
  if (g.type === 'MultiPolygon') return g.coordinates.map((p) => p.map(mercRing));
  if (g.type === 'GeometryCollection') return g.geometries.flatMap(polygonsOf);
  return [];
}

function fillGeometry(out: Int16Array | Uint8Array, fs: FrameSize, g: Geometry | null, value: number) {
  for (const poly of polygonsOf(g)) fillRings(out, fs.width, fs.height, toPixels(poly, fs), value);
}

/** Whether a geometry's bounding box (any world copy) touches the frame. */
function touchesFrame(g: Geometry | null, fs: FrameSize): boolean {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const poly of polygonsOf(g))
    for (let i = 0; i < poly[0].length; i += 2) {
      const x = poly[0][i], y = poly[0][i + 1];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  return maxY >= fs.frame.y0 && minY <= fs.frame.y1 && shiftsFor(minX, maxX, fs).length > 0;
}

/**
 * Raster of region ids (index into the returned `index`, -1 for none). Every pixel with
 * `want` set that no polygon covers takes the nearest region, so islets missed by coarse
 * borders belong to the closest one.
 */
export function regionRaster(features: { id: string; geometry: Geometry | null }[], fs: FrameSize, want: Uint8Array): { grid: Int16Array; index: string[] } {
  const grid = new Int16Array(fs.width * fs.height).fill(-1);
  const index: string[] = [];
  for (const f of features) {
    let k = index.indexOf(f.id);
    if (k < 0) { k = index.length; index.push(f.id); }
    fillGeometry(grid, fs, f.geometry, k);
  }
  fillNearest(grid, want, fs.width, fs.height);
  return { grid, index };
}

export interface RegionShape {
  id: string;
  geometry: Geometry | null;
  over?: boolean;
}

/** Every country touching the frame, at full detail (falling back to its outline). */
export async function countriesNear(fs: FrameSize, regions: RegionLoaders, onProgress?: (done: number, total: number) => void): Promise<RegionShape[]> {
  const low = await regions.countriesLow();
  const near = low.features.filter((f) => touchesFrame(f.geometry, fs));
  let done = 0;
  onProgress?.(0, near.length);
  const out = await Promise.all(
    near.map(async (f) => {
      const id = f.properties.id;
      // Only a country with no detailed file falls back to its outline; a failed download fails.
      const full = await regions.country(id).catch((e) => {
        if (e instanceof DataMissing) return null;
        throw e;
      });
      onProgress?.(++done, near.length);
      if (!full?.features.length) return [{ id, geometry: f.geometry }];
      return full.features.map((g) => ({ id, geometry: g.geometry, over: !!g.properties.over }));
    }),
  );
  // Territories drawn from Natural Earth sit inside a geoBoundaries country: paint them last.
  const flat: RegionShape[] = out.flat();
  return [...flat.filter((s) => !s.over), ...flat.filter((s) => s.over)];
}

/** A drawn shape as Mercator rings. */
function shapeRings(s: Exclude<SelShape, { kind: 'region' }>): number[][] {
  if (s.kind === 'rect') {
    const [a, b] = [s.a, s.b];
    return [mercRing([a, [b[0], a[1]], b, [a[0], b[1]]])];
  }
  if (s.kind === 'lasso') return [mercRing(s.points)];
  // Leaflet draws circles with a radius in ground metres, so Mercator scale grows with latitude.
  const c = lonLatToMerc(s.center[0], s.center[1]);
  const r = s.radiusM / Math.max(0.01, Math.cos((s.center[1] * Math.PI) / 180));
  const ring: number[] = [];
  for (let i = 0; i < 128; i++) {
    const t = (i / 128) * 2 * Math.PI;
    ring.push(c.x + r * Math.cos(t), c.y + r * Math.sin(t));
  }
  return [ring];
}

/** Build the map: water stays water, selected land becomes land with elevation, other land void. */
export async function convert(req: ConvertRequest, deps: ConvertDeps, onProgress: ConvertProgress): Promise<ConvertResult> {
  const { fs, ops, curve } = req;
  const { signal } = deps;
  const regions = deps.regions ?? defaultRegions;
  const ctx = { fetch: deps.fetch, signal, retryDelayMs: deps.retryDelayMs };
  const N = fs.width * fs.height;

  const water = await waterMask(fs, { ...ctx, onProgress: (d, t) => onProgress('Coastlines', d, t) });
  const elev = await elevationGrid(fs, { ...ctx, onProgress: (d, t) => onProgress('Elevation', d, t) });

  const provinceCountries = [...new Set(ops.flatMap((o) => (o.shape.kind === 'region' && o.shape.level === 'province' && o.shape.country ? [o.shape.country] : [])))];
  let done = 0, nearCount = 0;
  const countries = await countriesNear(fs, regions, (d, t) => {
    nearCount = t;
    done = d;
    signal.throwIfAborted();
    onProgress('Borders', d, t + provinceCountries.length);
  });
  const total = nearCount + provinceCountries.length;
  const provinceSets = await Promise.all(
    provinceCountries.map(async (a3) => {
      const fc = await regions.provinces(a3);
      signal.throwIfAborted();
      onProgress('Borders', ++done, total);
      return fc.features.map((f) => ({ id: f.properties.id, geometry: f.geometry }));
    }),
  );

  const steps = 4;
  const land = new Uint8Array(N);
  for (let i = 0; i < N; i++) land[i] = water[i] ? 0 : 1;
  onProgress('Building map', 0, steps);
  const country = regionRaster(countries, fs, land);
  signal.throwIfAborted();
  onProgress('Building map', 1, steps);

  let province: { grid: Int16Array; index: string[] } | null = null;
  if (provinceSets.length) {
    const inProvinceCountries = new Uint8Array(N);
    const codes = new Set(provinceCountries.map((a3) => country.index.indexOf(a3)));
    for (let i = 0; i < N; i++) inProvinceCountries[i] = land[i] && codes.has(country.grid[i]) ? 1 : 0;
    province = regionRaster(provinceSets.flat(), fs, inProvinceCountries);
  }
  signal.throwIfAborted();
  onProgress('Building map', 2, steps);

  // Evaluate the selection in order.
  const sel = new Uint8Array(N);
  const tmp = new Uint8Array(N);
  for (const op of ops) {
    const s = op.shape;
    const v = op.mode === 'add' ? 1 : 0;
    if (s.kind === 'region') {
      if (s.level === 'country') {
        const k = country.index.indexOf(s.id);
        if (k < 0) continue;
        for (let i = 0; i < N; i++) if (country.grid[i] === k) sel[i] = v;
      } else if (province) {
        const k = province.index.indexOf(s.id);
        const c = s.country ? country.index.indexOf(s.country) : -1;
        if (k < 0) continue;
        for (let i = 0; i < N; i++) if (province.grid[i] === k && (c < 0 || country.grid[i] === c)) sel[i] = v;
      }
    } else {
      tmp.fill(0);
      fillRings(tmp, fs.width, fs.height, toPixels(shapeRings(s), fs), 1);
      for (let i = 0; i < N; i++) if (tmp[i]) sel[i] = v;
    }
  }
  signal.throwIfAborted();
  onProgress('Building map', 3, steps);

  const grid = createGrid(fs.width, fs.height);
  for (let i = 0; i < N; i++) {
    if (!land[i]) continue;
    if (sel[i]) {
      grid.terrain[i] = LAND;
      grid.mag[i] = magFor(elev[i], curve);
    } else grid.terrain[i] = VOID;
  }
  voidEnclosedLakes(grid);
  onProgress('Building map', 4, steps);
  return { grid, sources: ['osm', 'terrain-tiles', 'geoboundaries', 'natural-earth'], regionGrid: country.grid, regionIndex: country.index };
}
