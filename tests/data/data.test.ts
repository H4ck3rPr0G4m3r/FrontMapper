import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DATA = 'public/data';
const read = (p: string) => JSON.parse(readFileSync(join(DATA, p), 'utf8'));

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
    for (const a3 of ['RUS', 'FJI']) expect(maxLonJump(read(`countries/${a3}.json`))).toBeLessThan(180);
  });

  it('has Jakarta as a capital with its population', () => {
    const cities: [string, number, number, number, string, string, string][] = read('cities.json');
    const jakarta = cities.find((c) => c[0] === 'Jakarta');
    expect(jakarta).toBeTruthy();
    expect(jakarta![5]).toBe('capital');
    expect(jakarta![3]).toBeGreaterThan(8_000_000);
    expect(jakarta![4]).toBe('id');
  });

  it('lists OpenFront flags including subdivisions', () => {
    const flags: string[] = read('flags.json');
    expect(flags).toContain('id');
    expect(flags).toContain('DE-BB');
    expect(flags.length).toBeGreaterThan(500);
  });

  it('has Indonesian provinces with names and ISO 3166-2 codes', () => {
    const fc = read('provinces/IDN.json');
    expect(fc.features.length).toBeGreaterThanOrEqual(30);
    for (const f of fc.features) expect(f.properties.name).toBeTruthy();
    expect(fc.features.some((f: any) => /^ID-/.test(f.properties.iso3166_2))).toBe(true);
  });

  it('keeps every data file under 100 MB', () => {
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
    expect(existsSync(DATA)).toBe(true);
    for (const f of walk(DATA)) expect(statSync(f).size).toBeLessThan(100 * 1024 * 1024);
  });
});
