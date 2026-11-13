import { computed, signal } from '@preact/signals';
import type { FeatureCollection, Geometry } from 'geojson';
import { autoFrame, fitSize, frameAround, lonLatToMerc, partsOf, setSide, type Part } from '../earth/projection';
import { loadCountriesLow, loadCountry, loadProvinces, type CountryProps, type ProvinceProps } from '../earth/regions';
import { hasSelection } from '../earth/selectionOps';
import { sizeProblem } from '../core/size';
import { DEFAULT_CURVE, type ElevationCurve, type FrameSize, type LonLat, type SelOp, type SelShape } from '../earth/types';

export type EarthTool = 'country' | 'province' | 'rect' | 'lasso' | 'circle';

export const earthTool = signal<EarthTool>('country');
export const earthOps = signal<SelOp[]>([]);
export const frameSize = signal<FrameSize | null>(null);
export const linked = signal(false);
export const curve = signal<ElevationCurve>(DEFAULT_CURVE);
export const outliers = signal<Part[]>([]);
export const includeOutliers = signal(false);
/** Output width remembered across selection changes. */
export const preferredWidth = signal(4000);

/** Why the framed map can't be built (too large), or null. */
export const frameProblem = computed(() => (frameSize.value ? sizeProblem(frameSize.value.width, frameSize.value.height) : null));

export const canConvert = computed(() => hasSelection(earthOps.value) && !!frameSize.value && !frameProblem.value);

export const countriesLow = signal<FeatureCollection<Geometry, CountryProps> | null>(null);
export const provincesByCountry = signal<Map<string, FeatureCollection<Geometry, ProvinceProps>>>(new Map());

export async function ensureCountries() {
  if (!countriesLow.value) countriesLow.value = await loadCountriesLow();
  return countriesLow.value;
}

const countryDetail = new Map<string, Promise<FeatureCollection<Geometry, CountryProps>>>();
/** Detailed (geoBoundaries) outline of one country, for display once it matters. */
export function ensureCountryDetail(a3: string) {
  let p = countryDetail.get(a3);
  if (!p) {
    p = loadCountry(a3);
    p.catch(() => countryDetail.delete(a3));
    countryDetail.set(a3, p);
  }
  return p;
}

export async function ensureProvinces(a3: string) {
  const have = provincesByCountry.value.get(a3);
  if (have) return have;
  const fc = await loadProvinces(a3);
  const next = new Map(provincesByCountry.value);
  next.set(a3, fc);
  provincesByCountry.value = next;
  return fc;
}

const M_PER_DEG = 111_320;

function shapeParts(s: SelShape): Part[] {
  const bbox = (pts: LonLat[]): Part => {
    const lons = pts.map((p) => p[0]), lats = pts.map((p) => p[1]);
    const lonMin = Math.min(...lons), lonMax = Math.max(...lons), latMin = Math.min(...lats), latMax = Math.max(...lats);
    return { lonMin, lonMax, latMin, latMax, area: (lonMax - lonMin) * (latMax - latMin) };
  };
  if (s.kind === 'rect') return [bbox([s.a, s.b])];
  if (s.kind === 'lasso') return [bbox(s.points)];
  if (s.kind === 'circle') {
    const dLat = s.radiusM / M_PER_DEG;
    const dLon = dLat / Math.max(0.05, Math.cos((s.center[1] * Math.PI) / 180));
    return [bbox([[s.center[0] - dLon, s.center[1] - dLat], [s.center[0] + dLon, s.center[1] + dLat]])];
  }
  return [];
}

/** Bounding parts of everything added to the selection. */
export async function selectionParts(ops: SelOp[]): Promise<Part[]> {
  const countries = await ensureCountries();
  const parts: Part[] = [];
  for (const op of ops) {
    if (op.mode !== 'add') continue;
    const s = op.shape;
    if (s.kind === 'region' && s.level === 'country') {
      const f = countries.features.find((c) => c.properties.id === s.id);
      if (f) parts.push(...partsOf(f.geometry as any));
    } else if (s.kind === 'region' && s.level === 'province' && s.country) {
      const fc = await ensureProvinces(s.country);
      const f = fc.features.find((p) => p.properties.id === s.id);
      if (f) parts.push(...partsOf(f.geometry as any));
    } else {
      parts.push(...shapeParts(s));
    }
  }
  return parts;
}

let recomputeToken = 0;

/** Re-fit the frame to the selection (call after the selection or the outlier choice changes). */
export async function recomputeFrame() {
  const token = ++recomputeToken;
  const ops = earthOps.value;
  if (!hasSelection(ops)) {
    frameSize.value = null;
    outliers.value = [];
    return;
  }
  const parts = await selectionParts(ops);
  if (token !== recomputeToken || !parts.length) return;
  const auto = autoFrame(parts);
  outliers.value = auto.outliers;
  const frame = includeOutliers.value && auto.outliers.length ? frameAround(parts) : auto.frame;
  frameSize.value = fitSize(frame, preferredWidth.value);
}

export function setFrameSide(side: 'width' | 'height', px: number) {
  const fs = frameSize.value;
  if (!fs || !Number.isFinite(px) || px < 4) return;
  const next = setSide(fs, side, px, linked.value);
  frameSize.value = next;
  preferredWidth.value = next.width;
}

/** Move one frame edge (from a drag handle); keeps the scale, so the pixel size follows. */
export function moveFrameEdge(edge: 'w' | 'e' | 'n' | 's', lon: number, lat: number) {
  const fs = frameSize.value;
  if (!fs) return;
  const m = lonLatToMerc(lon, lat);
  const f = { ...fs.frame };
  const minSpan = fs.mPerPx * 16;
  if (edge === 'w') f.x0 = Math.min(m.x, f.x1 - minSpan);
  if (edge === 'e') f.x1 = Math.max(m.x, f.x0 + minSpan);
  if (edge === 'n') f.y0 = Math.min(m.y, f.y1 - minSpan);
  if (edge === 's') f.y1 = Math.max(m.y, f.y0 + minSpan);
  const width = Math.max(4, Math.round((f.x1 - f.x0) / fs.mPerPx / 4) * 4);
  const height = Math.max(4, Math.round((f.y1 - f.y0) / fs.mPerPx / 4) * 4);
  frameSize.value = { frame: f, width, height, mPerPx: fs.mPerPx };
  preferredWidth.value = width;
}

/** Load picker state (e.g. from a project converted earlier). */
export function restoreEarth(s: { ops: SelOp[]; frameSize: FrameSize; curve: ElevationCurve } | null) {
  earthOps.value = s?.ops ?? [];
  frameSize.value = s?.frameSize ?? null;
  curve.value = s?.curve ?? DEFAULT_CURVE;
  if (s) preferredWidth.value = s.frameSize.width;
  includeOutliers.value = false;
  outliers.value = [];
}
