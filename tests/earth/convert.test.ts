import { describe, expect, it } from 'vitest';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import { LAND, VOID, WATER } from '../../src/core/grid';
import { convert, type RegionLoaders } from '../../src/earth/convert';
import { magFor } from '../../src/earth/elevation';
import { HALF, mercToLonLat } from '../../src/earth/projection';
import { fetchTiles, pickZoom, TileFetchError, tileRangeForFrame } from '../../src/earth/tiles';
import { DEFAULT_CURVE, type FrameSize, type LonLat, type SelOp } from '../../src/earth/types';
import { encodeMvt, terrariumPng } from '../fixtures/tiles/make';

describe('magFor', () => {
  it('maps metres onto plains, highlands and mountains', () => {
    expect([0, 150, 300, 1500, 4000, 9000].map((m) => magFor(m, DEFAULT_CURVE))).toEqual([0, 4, 10, 20, 30, 30]);
    expect(magFor(-50, DEFAULT_CURVE)).toBe(0);
  });
});

describe('tiles', () => {
  it('pickZoom picks the first zoom at least as sharp as the map', () => {
    const res = (z: number) => (2 * HALF) / (2 ** z * 256);
    expect(pickZoom(res(7), 14, 256)).toBe(7);
    expect(pickZoom(res(7) * 1.5, 14, 256)).toBe(7);
    expect(pickZoom(res(16), 14, 256)).toBe(14);
  });

  it('wraps tile x across the date line', () => {
    const toX = (lon: number) => (lon / 180) * HALF;
    const frame = { x0: toX(170), x1: toX(190), y0: -1e6, y1: 1e6 };
    const r = tileRangeForFrame(frame, 3);
    expect(r.z).toBe(3);
    expect(r.xs).toEqual([7, 0]);
  });

  it('lowers the zoom until at most 1024 tiles are needed', () => {
    const r = tileRangeForFrame({ x0: -HALF, x1: HALF, y0: -HALF * 0.9, y1: HALF * 0.9 }, 12);
    expect(r.xs.length * (r.y1 - r.y0 + 1)).toBeLessThanOrEqual(1024);
  });

  it('rejects with the failing URL after retries, never resolving with a gap', async () => {
    const attempts = new Map<string, number>();
    const fetch = (async (u: string) => {
      attempts.set(u, (attempts.get(u) ?? 0) + 1);
      if (u === 'b') throw new TypeError('network');
      return new Response(new Uint8Array([1]));
    }) as unknown as typeof globalThis.fetch;
    const p = fetchTiles(['a', 'b', 'c'], async (b) => b.byteLength, { fetch, retries: 3, concurrency: 8, signal: new AbortController().signal, retryDelayMs: 0 });
    await expect(p).rejects.toBeInstanceOf(TileFetchError);
    await expect(p).rejects.toMatchObject({ failed: ['b'] });
    expect(attempts.get('b')).toBe(4);
  });

  it('stops starting new tiles once one has failed for good, so offline fails fast', async () => {
    let calls = 0;
    const fetch = (async () => { calls++; throw new TypeError('offline'); }) as unknown as typeof globalThis.fetch;
    const urls = Array.from({ length: 200 }, (_, i) => `t${i}`);
    const p = fetchTiles(urls, (b) => b, { fetch, retries: 3, concurrency: 8, signal: new AbortController().signal, retryDelayMs: 0 });
    await expect(p).rejects.toBeInstanceOf(TileFetchError);
    expect(calls).toBeLessThanOrEqual(8 * 4);
  });

  it('does not retry a tile the server says does not exist', async () => {
    let calls = 0;
    const fetch = (async () => { calls++; return new Response('', { status: 404 }); }) as unknown as typeof globalThis.fetch;
    const p = fetchTiles(['x'], (b) => b, { fetch, retries: 3, concurrency: 8, signal: new AbortController().signal, retryDelayMs: 0 });
    await expect(p).rejects.toMatchObject({ failed: ['x'] });
    expect(calls).toBe(1);
  });
});

// One z10 tile is the whole map: 256 x 256 px, 16 MVT units per pixel.
const Z = 10, TX = 824, TY = 530;
const T = (2 * HALF) / 2 ** Z;
const fs: FrameSize = {
  frame: { x0: -HALF + TX * T, x1: -HALF + (TX + 1) * T, y0: -HALF + TY * T, y1: -HALF + (TY + 1) * T },
  width: 256,
  height: 256,
  mPerPx: T / 256,
};
const ll = (px: number, py: number): LonLat => {
  const p = mercToLonLat(fs.frame.x0 + px * fs.mPerPx, fs.frame.y0 + py * fs.mPerPx);
  return [p.lon, p.lat];
};
const rectPx = (x0: number, y0: number, x1: number, y1: number) => [ll(x0, y0), ll(x1, y0), ll(x1, y1), ll(x0, y1), ll(x0, y0)];
const country = (id: string, ring: LonLat[]): Feature<Geometry, any> => ({ type: 'Feature', id, properties: { id, name: id, iso2: id.slice(0, 2) }, geometry: { type: 'Polygon', coordinates: [ring] } });

const A = country('AAA', rectPx(40, 60, 120, 180));
const B = country('BBB', rectPx(120, 60, 200, 180));
const fc = (fs: Feature<Geometry, any>[]): FeatureCollection<Geometry, any> => ({ type: 'FeatureCollection', features: fs });
const regions: RegionLoaders = {
  countriesLow: async () => fc([A, B]),
  country: async (a3) => fc([a3 === 'AAA' ? A : B]),
  provinces: async () => fc([]),
};

const s = (p: number) => p * 16;
const hole = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [[s(x0), s(y0)], [s(x0), s(y1)], [s(x1), s(y1)], [s(x1), s(y0)]];
const OCEAN: [number, number][] = [[0, 0], [4096, 0], [4096, 4096], [0, 4096]];
// Ocean everywhere except the A/B island and a 3-pixel islet west of it.
// Plus a 4x4 lake inside each of A and B.
const lake = (x0: number, y0: number): [number, number][] => [[s(x0), s(y0)], [s(x0 + 4), s(y0)], [s(x0 + 4), s(y0 + 4)], [s(x0), s(y0 + 4)]];
const waterTile = encodeMvt([{ name: 'water', polygons: [[OCEAN, hole(40, 60, 200, 180), hole(30, 120, 33, 121)], [lake(80, 140)], [lake(150, 140)]] }]);
const fullOcean = encodeMvt([{ name: 'water', polygons: [[OCEAN]] }]);

function stubFetch(metres: (px: number, py: number) => number) {
  return (async (input: string) => {
    const u = String(input);
    if (u === 'https://tiles.openfreemap.org/planet') return Response.json({ tiles: ['https://vt.test/{z}/{x}/{y}.pbf'] });
    const m = /\/(\d+)\/(\d+)\/(\d+)\.(pbf|png)$/.exec(u);
    if (!m) return new Response('not found', { status: 404 });
    const [z, x, y] = [+m[1], +m[2], +m[3]];
    if (m[4] === 'pbf') return new Response(z === Z && x === TX && y === TY ? waterTile : fullOcean);
    const t = (2 * HALF) / 2 ** z;
    // Map each Terrarium pixel centre onto the output pixel grid and ask `metres`.
    return new Response(
      terrariumPng((px, py) => {
        const mx = -HALF + x * t + ((px + 0.5) / 256) * t, my = -HALF + y * t + ((py + 0.5) / 256) * t;
        return metres((mx - fs.frame.x0) / fs.mPerPx, (my - fs.frame.y0) / fs.mPerPx);
      }),
    );
  }) as unknown as typeof globalThis.fetch;
}

const run = (ops: SelOp[], metres: (px: number, py: number) => number = () => 100) =>
  convert({ fs, ops, curve: DEFAULT_CURVE }, { fetch: stubFetch(metres), signal: new AbortController().signal, regions, retryDelayMs: 0 }, () => {});

const at = (g: { width: number }, x: number, y: number) => y * g.width + x;
const selectA: SelOp[] = [{ mode: 'add', shape: { kind: 'region', level: 'country', id: 'AAA' } }];

describe('convert', () => {
  it('keeps the selected country and its nearby islet, voids the neighbour, keeps water', async () => {
    const { grid, regionGrid, regionIndex, sources } = await run(selectA);
    expect(grid.width).toBe(256);
    expect(grid.terrain[at(grid, 80, 100)]).toBe(LAND);
    expect(grid.mag[at(grid, 80, 100)]).toBe(magFor(100, DEFAULT_CURVE));
    expect(grid.terrain[at(grid, 31, 120)]).toBe(LAND); // islet outside both polygons, nearer A
    expect(grid.terrain[at(grid, 160, 100)]).toBe(VOID);
    expect(grid.terrain[at(grid, 10, 10)]).toBe(WATER);
    expect(grid.terrain[at(grid, 35, 120)]).toBe(WATER);
    expect(regionIndex[regionGrid[at(grid, 31, 120)]]).toBe('AAA');
    expect(regionIndex[regionGrid[at(grid, 160, 100)]]).toBe('BBB');
    expect(sources).toEqual(['osm', 'terrain-tiles', 'geoboundaries', 'natural-earth']);
  });

  it('small lakes surrounded by void become void (the generator would fill them with void anyway)', async () => {
    const { grid } = await run(selectA);
    expect(grid.terrain[at(grid, 81, 141)]).toBe(WATER); // inside the selection
    expect(grid.terrain[at(grid, 151, 141)]).toBe(VOID); // inside the unselected neighbour
  });

  it('a territory drawn over its neighbour wins, whatever order the countries load in', async () => {
    const T = { ...country('TTT', rectPx(50, 80, 70, 100)), properties: { id: 'TTT', name: 'TTT', iso2: '', over: true } };
    const withT: RegionLoaders = {
      countriesLow: async () => fc([T, A, B]),
      country: async (a3) => fc([a3 === 'TTT' ? T : a3 === 'AAA' ? A : B]),
      provinces: async () => fc([]),
    };
    const { grid } = await convert(
      { fs, ops: [{ mode: 'add', shape: { kind: 'region', level: 'country', id: 'TTT' } }], curve: DEFAULT_CURVE },
      { fetch: stubFetch(() => 100), signal: new AbortController().signal, regions: withT, retryDelayMs: 0 },
      () => {},
    );
    expect(grid.terrain[at(grid, 60, 90)]).toBe(LAND);
    expect(grid.terrain[at(grid, 100, 100)]).toBe(VOID);
  });

  it('subtracting a rectangle turns the selected land inside it into void', async () => {
    const [a, b] = [ll(60, 80), ll(80, 100)];
    const { grid } = await run([...selectA, { mode: 'subtract', shape: { kind: 'rect', a, b } }]);
    expect(grid.terrain[at(grid, 70, 90)]).toBe(VOID);
    expect(grid.terrain[at(grid, 100, 150)]).toBe(LAND);
  });

  it('land below sea level stays land with magnitude 0', async () => {
    const { grid } = await run(selectA, (px) => (px < 60 ? -5 : 2000));
    expect(grid.terrain[at(grid, 50, 100)]).toBe(LAND);
    expect(grid.mag[at(grid, 50, 100)]).toBe(0);
    expect(grid.mag[at(grid, 100, 100)]).toBe(magFor(2000, DEFAULT_CURVE));
  });

  it('fails with the missing tiles instead of converting with a gap', async () => {
    const base = stubFetch(() => 100);
    const fetch = (async (u: string) => (String(u).endsWith('.png') ? new Response('', { status: 503 }) : base(u))) as unknown as typeof globalThis.fetch;
    const p = convert({ fs, ops: selectA, curve: DEFAULT_CURVE }, { fetch, signal: new AbortController().signal, regions, retryDelayMs: 0 }, () => {});
    await expect(p).rejects.toBeInstanceOf(TileFetchError);
  });
});
