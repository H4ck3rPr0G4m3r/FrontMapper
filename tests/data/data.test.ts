import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { feature } from 'topojson-client';

const DATA = 'public/data';
const read = (p: string) => JSON.parse(readFileSync(join(DATA, p), 'utf8'));
/** Per-country and per-province files are TopoJSON with one object. */
const readFc = (p: string): any => {
  const topo = read(p);
  return feature(topo, Object.values(topo.objects)[0] as any);
};
const inBox = (ring: number[][], [x0, y0, x1, y1]: number[]) => ring.every(([x, y]) => x >= x0 && x <= x1 && y >= y0 && y <= y1);

/** Median distance between neighbouring vertices, in metres. */
function medianSegment(fc: any) {
  const d: number[] = [];
  for (const f of fc.features) for (const ring of rings(f.geometry))
    for (let i = 1; i < ring.length; i++) {
      const [a, b] = [ring[i - 1], ring[i]];
      const k = Math.cos(((a[1] + b[1]) / 2) * (Math.PI / 180));
      d.push(Math.hypot((b[0] - a[0]) * k, b[1] - a[1]) * 111_320);
    }
  d.sort((a, b) => a - b);
  return d[d.length >> 1];
}

function* rings(geom: any): Generator<number[][]> {
  if (!geom) return;
  if (geom.type === 'Polygon') yield* geom.coordinates;
  else if (geom.type === 'MultiPolygon') for (const p of geom.coordinates) yield* p;
}

function maxLonJump(fc: any) {
  let max = 0;
  for (const f of fc.features) for (const ring of rings(f.geometry))
    for (let i = 1; i < ring.length; i++) max = Math.max(max, Math.abs(ring[i][0] - ring[i - 1][0]));
  return max;
}

describe('generated data', () => {
  it('has Indonesia in the world outlines with flag code id', () => {
    const topo = read('countries-low.json');
    const geoms = topo.objects.countries.geometries;
    const idn = geoms.find((g: any) => g.id === 'IDN');
    expect(idn.properties).toMatchObject({ name: 'Indonesia', iso2: 'id' });
    expect(statSync(join(DATA, 'countries-low.json')).size).toBeLessThanOrEqual(3 * 1024 * 1024);
  });

  it('splits Russia and Fiji at the antimeridian', () => {
    for (const a3 of ['RUS', 'FJI', 'USA', 'NZL']) expect(maxLonJump(readFc(`countries/${a3}.json`))).toBeLessThan(180);
  });

  it('has Jakarta as a capital with its population', () => {
    const cities: [string, number, number, number, string, string, string][] = read('cities/id.json');
    const jakarta = cities.find((c) => c[0] === 'Jakarta');
    expect(jakarta).toBeTruthy();
    expect(jakarta![5]).toBe('capital');
    expect(jakarta![3]).toBeGreaterThan(8_000_000);
    expect(jakarta![4]).toBe('id');
  });

  it('has small towns too, without city districts (Hungary)', () => {
    const hu: [string, number, number, number, string, string, string][] = read('cities/hu.json');
    expect(hu.length).toBeGreaterThan(500);
    expect(hu.map((c) => c[0])).toEqual(expect.arrayContaining(['Budapest', 'Debrecen', 'Szeged', 'Pécs', 'Győr', 'Hódmezővásárhely']));
    expect(hu.map((c) => c[0])).not.toContain('Buda'); // a district of Budapest
    const index = read('cities-index.json');
    expect(index.hu[4]).toBe(hu.length);
  });

  it('has no broken characters in any name', () => {
    const files = ['provinces-index.json', ...readdirSync(join(DATA, 'provinces')).map((f) => `provinces/${f}`), ...readdirSync(join(DATA, 'cities')).map((f) => `cities/${f}`)];
    for (const f of files) expect(readFileSync(join(DATA, f), 'utf8').includes('\ufffd'), f).toBe(false);
    const hun = read('provinces-index.json').filter((r: string[]) => r[2] === 'HUN').map((r: string[]) => r[1]);
    expect(hun).toEqual(expect.arrayContaining(['Jász-Nagykun-Szolnok', 'Bács-Kiskun', 'Győr-Moson-Sopron']));
  });

  it('lists OpenFront flags including subdivisions', () => {
    const flags: string[] = read('flags.json');
    expect(flags).toContain('id');
    expect(flags).toContain('DE-BB');
    expect(flags.length).toBeGreaterThan(500);
  });

  it('has Indonesian provinces with names and ISO 3166-2 codes', () => {
    const fc = readFc('provinces/IDN.json');
    expect(fc.features.length).toBeGreaterThanOrEqual(30);
    for (const f of fc.features) expect(f.properties.name).toBeTruthy();
    expect(fc.features.some((f: any) => /^ID-/.test(f.properties.iso3166_2))).toBe(true);
  });

  it('draws borders from geoBoundaries at fine detail', () => {
    expect(readFileSync(join(DATA, 'SOURCES.md'), 'utf8')).toContain('geoBoundaries');
    const idn = readFc('countries/IDN.json');
    expect(idn.features[0].properties).toMatchObject({ id: 'IDN', name: 'Indonesia', iso2: 'id' });
    expect(medianSegment(idn)).toBeLessThan(400);
    expect(medianSegment(readFc('provinces/IDN.json'))).toBeLessThan(400);
  });

  it('keeps island territories separate from the country that governs them', () => {
    const pr = [-67.4, 17.8, -65.1, 18.7];
    expect(readFc('countries/PRI.json').features[0].properties.name).toBe('Puerto Rico');
    const usa = readFc('countries/USA.json');
    for (const ring of rings(usa.features[0].geometry)) expect(inBox(ring, pr)).toBe(false);
    // Territories on a mainland keep Natural Earth outlines and are drawn over their neighbour.
    expect(readFc('countries/HKG.json').features[0].properties.over).toBe(true);
  });

  it('keeps every data file under 100 MB', () => {
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
    expect(existsSync(DATA)).toBe(true);
    for (const f of walk(DATA)) expect(statSync(f).size).toBeLessThan(100 * 1024 * 1024);
  });
});
