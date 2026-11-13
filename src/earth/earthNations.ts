import { LAND, type MapGrid } from '../core/grid';
import { newNationId, type Nation } from '../core/nations';
import { HALF, lonLatToMerc, mercToLonLat } from './projection';
import type { CityRow } from './regions';
import type { FrameSize } from './types';

/** Pixel containing a lon/lat, using whichever world copy lands nearest the frame. */
export function pixelOf(fs: FrameSize, lon: number, lat: number): { x: number; y: number } {
  const m = lonLatToMerc(lon, lat);
  const cx = (fs.frame.x0 + fs.frame.x1) / 2;
  let x = m.x;
  while (x < cx - HALF) x += 2 * HALF;
  while (x >= cx + HALF) x -= 2 * HALF;
  return { x: Math.floor((x - fs.frame.x0) / fs.mPerPx), y: Math.floor((m.y - fs.frame.y0) / fs.mPerPx) };
}

/** Lon/lat of a pixel's centre. */
export function lonLatOf(fs: FrameSize, x: number, y: number): [number, number] {
  const p = mercToLonLat(fs.frame.x0 + (x + 0.5) * fs.mPerPx, fs.frame.y0 + (y + 0.5) * fs.mPerPx);
  return [p.lon, p.lat];
}

const flagOr = (code: string, flags: Set<string> | null) => (!code ? '' : !flags || flags.has(code) ? code : '');

/** Cities inside the frame, on land, with at least `minPop` people. */
export function cityNations(cities: CityRow[], fs: FrameSize, grid: MapGrid, minPop: number, flags: Set<string> | null): Nation[] {
  const out: Nation[] = [];
  for (const [name, lon, lat, pop, iso2] of cities) {
    if (pop < minPop) continue;
    const { x, y } = pixelOf(fs, lon, lat);
    if (x < 0 || y < 0 || x >= grid.width || y >= grid.height || grid.terrain[y * grid.width + x] !== LAND) continue;
    out.push({ id: newNationId(), name, x, y, flag: flagOr(iso2, flags), source: 'city', lonLat: [lon, lat] });
  }
  return out;
}

/** Name and flag codes of each region id. */
export type RegionInfo = Map<string, { name: string; iso2: string; iso3166_2?: string }>;

/**
 * Chamfer (3-4) distance from every region pixel to the nearest pixel outside its region
 * (other regions, water, void and the map edge all count as outside).
 */
function regionDistance(grid: MapGrid, labels: Int16Array): Uint32Array {
  const { width: w, height: h } = grid;
  const n = w * h;
  const d = new Uint32Array(n);
  // Region of each pixel, or -1 outside every region (water, void, unassigned).
  const lab = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    lab[i] = grid.terrain[i] === LAND ? labels[i] : -1;
    d[i] = lab[i] >= 0 ? 0xffffffff : 0;
  }
  const FWD = [[-1, 0, 3], [-1, -1, 4], [0, -1, 3], [1, -1, 4]];
  const BWD = [[1, 0, 3], [1, 1, 4], [0, 1, 3], [-1, 1, 4]];
  const pass = (y: number, x: number, steps: number[][]) => {
    const i = y * w + x;
    if (!d[i]) return;
    let best = d[i];
    const l = lab[i];
    for (const [dx, dy, cost] of steps) {
      const nx = x + dx, ny = y + dy;
      // The map edge and other regions count as outside (distance 0).
      const j = ny * w + nx;
      const base = nx < 0 || ny < 0 || nx >= w || ny >= h || lab[j] !== l ? 0 : d[j];
      if (base + cost < best) best = base + cost;
    }
    d[i] = best;
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) pass(y, x, FWD);
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) pass(y, x, BWD);
  return d;
}

/**
 * One nation per region that has land: at its capital (countries) or admin-1 seat
 * (provinces) when that city is on the region's land, otherwise at the point deepest
 * inside the region (nearest its centre among equally deep points).
 */
export function regionNations(
  level: 'country' | 'province',
  fs: FrameSize,
  grid: MapGrid,
  regionGrid: Int16Array,
  regionIndex: string[],
  cities: CityRow[],
  flags: Set<string> | null,
  info: RegionInfo,
): Nation[] {
  const w = grid.width, n = regionIndex.length;
  const count = new Float64Array(n), sx = new Float64Array(n), sy = new Float64Array(n);
  for (let i = 0; i < regionGrid.length; i++) {
    const k = regionGrid[i];
    if (k < 0 || grid.terrain[i] !== LAND) continue;
    count[k]++; sx[k] += i % w; sy[k] += Math.floor(i / w);
  }

  const seat = new Int32Array(n).fill(-1);
  const seatPop = new Float64Array(n);
  const kind = level === 'country' ? 'capital' : 'admin1';
  for (const [, lon, lat, pop, , k] of cities) {
    if (k !== kind) continue;
    const { x, y } = pixelOf(fs, lon, lat);
    if (x < 0 || y < 0 || x >= w || y >= grid.height) continue;
    const i = y * w + x;
    const r = regionGrid[i];
    if (r < 0 || grid.terrain[i] !== LAND || pop <= seatPop[r]) continue;
    seat[r] = i; seatPop[r] = pop;
  }

  let dist: Uint32Array | null = null;
  const best = new Int32Array(n).fill(-1);
  if ([...seat].some((s, k) => s < 0 && count[k] > 0)) {
    dist = regionDistance(grid, regionGrid);
    const bestD = new Uint32Array(n), bestC = new Float64Array(n).fill(Infinity);
    for (let i = 0; i < regionGrid.length; i++) {
      const k = regionGrid[i];
      if (k < 0 || seat[k] >= 0 || !dist[i] || grid.terrain[i] !== LAND) continue;
      const c = Math.hypot(i % w - sx[k] / count[k], Math.floor(i / w) - sy[k] / count[k]);
      if (dist[i] > bestD[k] || (dist[i] === bestD[k] && c < bestC[k])) { bestD[k] = dist[i]; bestC[k] = c; best[k] = i; }
    }
  }

  const out: Nation[] = [];
  regionIndex.forEach((id, k) => {
    if (!count[k]) return;
    const i = seat[k] >= 0 ? seat[k] : best[k];
    if (i < 0) return;
    const x = i % w, y = Math.floor(i / w);
    const r = info.get(id);
    const flag = level === 'province' && r?.iso3166_2 && flags?.has(r.iso3166_2) ? r.iso3166_2 : flagOr(r?.iso2 ?? '', flags);
    out.push({ id: newNationId(), name: r?.name ?? id, x, y, flag, source: level, lonLat: lonLatOf(fs, x, y) });
  });
  return out;
}

/** Re-place nations that know their lon/lat into a (new) frame; others keep their pixel. */
export function placeByLonLat(nations: Nation[], fs: FrameSize): Nation[] {
  return nations.map((n) => (n.lonLat ? { ...n, ...pixelOf(fs, n.lonLat[0], n.lonLat[1]) } : n));
}
