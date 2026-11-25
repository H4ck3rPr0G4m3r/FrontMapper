import { describe, it, expect } from 'vitest';
import { LAND, WATER } from '../../src/core/grid';
import type { Nation } from '../../src/core/nations';
import { buildWarp, fitGeoref, lonLatToPx, mapBack, pxToLonLat, transformPins, type GeoFit, type GeoPin } from '../../src/earth/georef';
import { pixelOf } from '../../src/earth/earthNations';
import { fitSize, lonLatToMerc } from '../../src/earth/projection';

type Proj = (lon: number, lat: number) => [number, number];

/** Pins on a grid of n x n spots across the map, placed by `proj`. */
function pinsFrom(proj: Proj, lon0: number, lon1: number, lat0: number, lat1: number, n: number): GeoPin[] {
  const pins: GeoPin[] = [];
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const lon = lon0 + ((lon1 - lon0) * (i + 0.5)) / n, lat = lat0 + ((lat1 - lat0) * (j + 0.5)) / n;
      pins.push({ id: `${i}-${j}`, px: proj(lon, lat), lonLat: [lon, lat] });
    }
  return pins;
}

function maxError(fit: GeoFit, proj: Proj, lon0: number, lon1: number, lat0: number, lat1: number) {
  let worst = 0;
  for (let i = 0; i <= 10; i++)
    for (let j = 0; j <= 10; j++) {
      const lon = lon0 + ((lon1 - lon0) * i) / 10, lat = lat0 + ((lat1 - lat0) * j) / 10;
      const [x, y] = lonLatToPx(fit, lon, lat), [ex, ey] = proj(lon, lat);
      worst = Math.max(worst, Math.hypot(x - ex, y - ey));
    }
  return worst;
}

const fitOf = (pins: GeoPin[]) => {
  const r = fitGeoref(pins);
  if (!r.ok) throw new Error(r.reason);
  return r.fit;
};

// Michigan, roughly.
const LON0 = -90.5, LON1 = -82.3, LAT0 = 41.6, LAT1 = 48.3;

/** QGIS's default: plain latitude/longitude (equirectangular), 2000 px wide. */
const equirect: Proj = (lon, lat) => [((lon - LON0) / (LON1 - LON0)) * 2000, ((LAT1 - lat) / (LAT1 - LAT0)) * 1630];
/** The same map turned 12 degrees, as a state's own projection would be. */
const turned: Proj = (lon, lat) => {
  const [x, y] = equirect(lon, lat), a = (12 * Math.PI) / 180;
  return [x * Math.cos(a) - y * Math.sin(a) + 400, x * Math.sin(a) + y * Math.cos(a)];
};

describe('fitGeoref', () => {
  it('asks for three pins', () => {
    const r = fitGeoref([{ id: 'a', px: [0, 0], lonLat: [0, 0] }]);
    expect(r).toEqual({ ok: false, reason: 'Add 2 more pins.' });
  });

  it('refuses pins in a line and mirrored pins', () => {
    const line = [0, 1, 2].map((k) => ({ id: `${k}`, px: [k * 100, k * 100] as [number, number], lonLat: [k, -k] as [number, number] }));
    expect(fitGeoref(line)).toMatchObject({ ok: false, reason: expect.stringMatching(/in a line/) });
    const mirrored: GeoPin[] = [
      { id: 'a', px: [0, 0], lonLat: [10, 10] },
      { id: 'b', px: [100, 0], lonLat: [0, 10] },
      { id: 'c', px: [0, 100], lonLat: [10, 0] },
    ];
    expect(fitGeoref(mirrored)).toMatchObject({ ok: false, reason: expect.stringMatching(/mirrored/) });
  });

  it('matches an Earth-converted (Mercator) map exactly with three pins', () => {
    const a = lonLatToMerc(LON0, LAT1), b = lonLatToMerc(LON1, LAT0);
    const fs = fitSize({ x0: a.x, y0: a.y, x1: b.x, y1: b.y }, 1600);
    const merc: Proj = (lon, lat) => {
      const m = lonLatToMerc(lon, lat);
      return [(m.x - fs.frame.x0) / fs.mPerPx, (m.y - fs.frame.y0) / fs.mPerPx];
    };
    const fit = fitOf([
      { id: 'a', px: merc(-88, 47), lonLat: [-88, 47] },
      { id: 'b', px: merc(-83, 46.5), lonLat: [-83, 46.5] },
      { id: 'c', px: merc(-86, 42), lonLat: [-86, 42] },
    ]);
    expect(fit.kind).toBe('straight');
    expect(maxError(fit, merc, LON0, LON1, LAT0, LAT1)).toBeLessThan(0.01);
    const [x, y] = lonLatToPx(fit, -84.55, 42.73); // Lansing
    expect([Math.floor(x), Math.floor(y)]).toEqual(Object.values(pixelOf(fs, -84.55, 42.73)));
    const [lon, lat] = pxToLonLat(fit, x, y);
    expect(lon).toBeCloseTo(-84.55, 6);
    expect(lat).toBeCloseTo(42.73, 6);
  });

  it('bends for a map in another projection once there are enough pins', () => {
    const few = fitOf(pinsFrom(equirect, LON0, LON1, LAT0, LAT1, 2).concat(pinsFrom(equirect, -88, -84, 43, 46, 1)));
    expect(few.kind).toBe('straight');
    const straightErr = maxError(few, equirect, LON0, LON1, LAT0, LAT1);
    expect(straightErr).toBeGreaterThan(5); // a straight fit is visibly off for plain lat/lon

    const many = fitOf(pinsFrom(equirect, LON0, LON1, LAT0, LAT1, 3));
    expect(many.kind).toBe('curved');
    expect(maxError(many, equirect, LON0, LON1, LAT0, LAT1)).toBeLessThan(1);
    expect(many.rms).toBeLessThan(0.5);

    const rotated = fitOf(pinsFrom(turned, LON0, LON1, LAT0, LAT1, 3));
    expect(maxError(rotated, turned, LON0, LON1, LAT0, LAT1)).toBeLessThan(1);
  });

  it('reports how far off each pin is', () => {
    const pins = pinsFrom(equirect, LON0, LON1, LAT0, LAT1, 2);
    pins[0] = { ...pins[0], px: [pins[0].px[0] + 40, pins[0].px[1]] }; // one pin put down carelessly
    const fit = fitOf(pins);
    expect(fit.residuals).toHaveLength(4);
    expect(Math.max(...fit.residuals)).toBeGreaterThan(5);
  });

  it('works across the date line', () => {
    const proj: Proj = (lon, lat) => [((((lon - 170 + 360) % 360) / 20) * 1000), ((60 - lat) / 10) * 500];
    const fit = fitOf([
      { id: 'a', px: proj(172, 58), lonLat: [172, 58] },
      { id: 'b', px: proj(-172, 57), lonLat: [-172, 57] },
      { id: 'c', px: proj(178, 52), lonLat: [178, 52] },
    ]);
    const [x] = lonLatToPx(fit, -179, 55);
    expect(x).toBeGreaterThan(500);
    expect(x).toBeLessThan(1000);
  });
});

describe('warp and map back', () => {
  // 200 x 160 map in plain lat/lon: land on the left half, water on the right.
  const W = 200, H = 160;
  const proj: Proj = (lon, lat) => [((lon - LON0) / (LON1 - LON0)) * W, ((LAT1 - lat) / (LAT1 - LAT0)) * H];
  const terrain = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) terrain[y * W + x] = x < 100 ? LAND : WATER;
  const fit = fitOf(pinsFrom(proj, LON0, LON1, LAT0, LAT1, 3));
  const lonAt = (x: number) => LON0 + ((x + 0.5) / W) * (LON1 - LON0);
  const latAt = (y: number) => LAT1 - ((y + 0.5) / H) * (LAT1 - LAT0);
  const nation = (id: string, x: number, y: number): Nation => ({ id, name: id, x: 0, y: 0, flag: '', source: 'city', lonLat: [lonAt(x), latAt(y)] });

  it('warps the map into an Earth frame with its land in the same place', () => {
    const warp = buildWarp(fit, W, H, terrain);
    expect(warp.fs.width * warp.fs.height).toBeGreaterThan(W * H * 0.9);
    let land = 0;
    for (const t of warp.terrain) if (t === LAND) land++;
    expect(land / (warp.fs.width * warp.fs.height)).toBeGreaterThan(0.4);
    expect(land / (warp.fs.width * warp.fs.height)).toBeLessThan(0.6);
    // A pixel deep in the land on the map is land on the warped copy too.
    const p = pixelOf(warp.fs, lonAt(40), latAt(80));
    expect(warp.terrain[p.y * warp.fs.width + p.x]).toBe(LAND);
  });

  it('puts nations back where they are on Earth, moves ones just off the coast, skips ones at sea', () => {
    const r = mapBack([nation('inland', 40, 80), nation('coast', 101, 30), nation('sea', 150, 30)], fit, W, H, terrain);
    expect(r.skipped).toBe(1);
    expect(r.nations.map((n) => [n.id, n.x, n.y])).toEqual([
      ['inland', 40, 80],
      ['coast', 99, 30],
    ]);
  });

  it('moves pins with a crop or resize', () => {
    const g = { pins: [{ id: 'a', px: [10, 20] as [number, number], lonLat: [0, 0] as [number, number] }] };
    expect(transformPins(g, { sx: 1, sy: 1, ox: -5, oy: -8 })!.pins[0].px).toEqual([5, 12]);
    expect(transformPins(g, { sx: 0.5, sy: 0.5, ox: 0, oy: 0 })!.pins[0].px).toEqual([5, 10]);
  });
});
