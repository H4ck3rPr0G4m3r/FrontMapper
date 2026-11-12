// Builds the static data FrontMapper Studio ships with (public/data) and refreshes the
// vendored OpenFront info.json schema (src/data). Run with `npm run data`; outputs are committed.
//
// Sources:
//   Natural Earth 10m admin-0 countries, admin-1 states/provinces, populated places (public domain)
//   OpenFront flag list and info.schema.json from github.com/openfrontio/OpenFrontIO (main)
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, readdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { unzipSync } from 'fflate';
import mapshaper from 'mapshaper';

const CACHE = '.cache/data';
const OUT = 'public/data';
const NE = 'https://naciscdn.org/naturalearth/10m/cultural';
const REPO = 'openfrontio/OpenFrontIO';
const UA = { 'user-agent': 'frontmapper-data-script' };

const DATASETS = {
  admin0: 'ne_10m_admin_0_countries',
  admin1: 'ne_10m_admin_1_states_provinces',
  places: 'ne_10m_populated_places',
};

async function download(url, file) {
  if (existsSync(file)) return readFileSync(file);
  console.log(`download ${url}`);
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(file, buf);
  return buf;
}

async function naturalEarth(key) {
  const name = DATASETS[key];
  const dir = join(CACHE, key);
  const shp = join(dir, `${name}.shp`);
  if (!existsSync(shp)) {
    mkdirSync(dir, { recursive: true });
    const zip = await download(`${NE}/${name}.zip`, join(CACHE, `${name}.zip`));
    for (const [path, bytes] of Object.entries(unzipSync(new Uint8Array(zip)))) {
      if (!path.endsWith('/')) writeFileSync(join(dir, path.split('/').pop()), bytes);
    }
  }
  return shp;
}

const run = (cmd) => mapshaper.runCommands(cmd);

/** Ring vertices jumping more than 180 degrees mean a polygon crosses the antimeridian. */
function assertNoDatelineJumps(file) {
  const fc = JSON.parse(readFileSync(file, 'utf8'));
  for (const f of fc.features ?? []) {
    const g = f.geometry;
    if (!g) continue;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    for (const poly of polys)
      for (const ring of poly)
        for (let i = 1; i < ring.length; i++)
          if (Math.abs(ring[i][0] - ring[i - 1][0]) > 180) throw new Error(`${file}: ring crosses the antimeridian`);
  }
}

async function main() {
  mkdirSync(CACHE, { recursive: true });
  for (const d of ['countries', 'provinces']) rmSync(join(OUT, d), { recursive: true, force: true });
  mkdirSync(join(OUT, 'countries'), { recursive: true });
  mkdirSync(join(OUT, 'provinces'), { recursive: true });

  const admin0 = await naturalEarth('admin0');
  const admin1 = await naturalEarth('admin1');
  const places = await naturalEarth('places');

  const countryFields =
    `-each "id=ADM0_A3, name=NAME, iso2=(ISO_A2_EH && ISO_A2_EH != '-99') ? ISO_A2_EH.toLowerCase() : ''" -filter-fields id,name,iso2`;

  console.log('countries-low.json');
  await run(`-i ${admin0} encoding=utf8 ${countryFields} -rename-layers countries -simplify 4% keep-shapes ` +
    `-o ${OUT}/countries-low.json format=topojson id-field=id quantization=100000`);

  console.log('countries/*.json');
  await run(`-i ${admin0} encoding=utf8 ${countryFields} -simplify interval=120 keep-shapes -split id ` +
    `-o ${OUT}/countries/ format=geojson precision=0.0001`);

  console.log('provinces/*.json');
  await run(`-i ${admin1} encoding=utf8 -each "id=adm1_code, iso3166_2=iso_3166_2, a3=adm0_a3" ` +
    `-filter-fields id,name,iso3166_2,a3 -simplify interval=120 keep-shapes -split a3 ` +
    `-o ${OUT}/provinces/ format=geojson precision=0.0001`);

  for (const dir of ['countries', 'provinces'])
    for (const f of readdirSync(join(OUT, dir))) assertNoDatelineJumps(join(OUT, dir, f));

  console.log('cities.json');
  const tmp = join(CACHE, 'places.json');
  await run(`-i ${places} encoding=utf8 -o ${tmp} format=json`);
  const rows = JSON.parse(readFileSync(tmp, 'utf8'))
    .map((p) => {
      const cls = String(p.FEATURECLA ?? '');
      const kind = p.ADM0CAP === 1 || cls.startsWith('Admin-0 capital') ? 'capital' : cls.startsWith('Admin-1') ? 'admin1' : 'city';
      const iso = String(p.ISO_A2 ?? '');
      return [p.NAME, +(+p.LONGITUDE).toFixed(4), +(+p.LATITUDE).toFixed(4), p.POP_MAX | 0, iso === '-99' ? '' : iso.toLowerCase(), kind, p.ADM0_A3];
    })
    .filter((r) => r[3] >= 10000 || r[5] !== 'city')
    .sort((a, b) => b[3] - a[3]);
  writeFileSync(join(OUT, 'cities.json'), JSON.stringify(rows));

  console.log('flags.json');
  const commit = await (await fetch(`https://api.github.com/repos/${REPO}/commits/main`, { headers: UA })).json();
  const tree = await (await fetch(`https://api.github.com/repos/${REPO}/git/trees/${commit.sha}?recursive=1`, { headers: UA })).json();
  if (tree.truncated) throw new Error('GitHub tree listing was truncated');
  const flags = tree.tree
    .filter((t) => t.path.startsWith('resources/flags/') && t.path.endsWith('.svg'))
    .map((t) => t.path.slice('resources/flags/'.length, -4))
    .sort();
  writeFileSync(join(OUT, 'flags.json'), JSON.stringify(flags));

  console.log('info.schema.json');
  const schema = await (await fetch(`https://raw.githubusercontent.com/${REPO}/${commit.sha}/map-generator/info.schema.json`, { headers: UA })).text();
  JSON.parse(schema);
  writeFileSync('src/data/info.schema.json', schema);
  copyFileSync('src/data/info.schema.json', 'tests/fixtures/info.schema.json');

  writeFileSync(
    join(OUT, 'SOURCES.md'),
    [
      '# FrontMapper data sources',
      '',
      `Generated by scripts/data/build-data.mjs on ${new Date().toISOString().slice(0, 10)}.`,
      '',
      `- Natural Earth 10m: ${Object.values(DATASETS).join(', ')} (public domain), ${NE}`,
      `- OpenFront flag list and info.schema.json: ${REPO} @ ${commit.sha}`,
      '',
    ].join('\n'),
  );
  console.log(`done: ${flags.length} flags, ${rows.length} cities`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
