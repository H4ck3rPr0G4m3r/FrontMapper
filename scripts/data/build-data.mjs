// Builds the static data FrontMapper Studio ships with (public/data) and refreshes the
// vendored OpenFront info.json schema (src/data). Run with `npm run data`; outputs are committed.
//
// Sources:
//   geoBoundaries CGAZ ADM0/ADM1 (CC BY 4.0 / ODbL): country and province shapes
//   Natural Earth 10m admin-0 countries, admin-1 states/provinces, populated places (public domain):
//     ids, names and flag codes, territories geoBoundaries folds into their sovereign, cities
//   OpenFront flag list and info.schema.json from github.com/openfrontio/OpenFrontIO (main)
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { unzipSync } from 'fflate';
import mapshaper from 'mapshaper';
import { locator } from './locate.mjs';

const CACHE = '.cache/data';
const OUT = 'public/data';
const NE = 'https://naciscdn.org/naturalearth/10m/cultural';
const REPO = 'openfrontio/OpenFrontIO';
const UA = { 'user-agent': 'frontmapper-data-script' };
const CGAZ_REF = '9469f09';
const CGAZ = `https://github.com/wmgeolab/geoBoundaries/raw/${CGAZ_REF}/releaseData/CGAZ`;
/** Simplification of geoBoundaries shapes, in metres (they are drawn into maps down to ~100 m/px). */
const CGAZ_INTERVAL = 60;
/** geoBoundaries groups whose Natural Earth id is not their ISO code. */
const CGAZ_ALIAS = { XKX: 'KOS' };

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
const geojson = async (cmd) => JSON.parse((await mapshaper.applyCommands(`${cmd} -o format=geojson precision=0.00001 out.json`))['out.json']);

async function geoBoundaries(level) {
  const name = `geoBoundariesCGAZ_${level}`;
  const dir = join(CACHE, `cgaz-${level}`);
  const shp = join(dir, `${name}.shp`);
  if (!existsSync(shp)) {
    mkdirSync(dir, { recursive: true });
    const zip = await download(`${CGAZ}/${name}.zip`, join(CACHE, `${name}.zip`));
    for (const [path, bytes] of Object.entries(unzipSync(new Uint8Array(zip)))) {
      if (!path.endsWith('/')) writeFileSync(join(dir, path.split('/').pop()), bytes);
    }
  }
  return shp;
}

const polygonsOf = (g) => (!g ? [] : g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);

function assertNoJumps(name, polys) {
  for (const poly of polys)
    for (const ring of poly)
      for (let i = 1; i < ring.length; i++)
        if (Math.abs(ring[i][0] - ring[i - 1][0]) > 180) throw new Error(`${name}: ring crosses the antimeridian`);
}

/** One TopoJSON file per feature group, quantized to about 5 m. */
async function writeTopo(file, layer, features) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const f of features) for (const p of polygonsOf(f.geometry)) for (const [x, y] of p[0]) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  const q = Math.min(1e7, Math.max(1e4, Math.ceil((Math.max(x1 - x0, y1 - y0) * 111_320) / 5)));
  const out = await mapshaper.applyCommands(`-i in.json name=${layer} -o format=topojson quantization=${q} out.json`, {
    'in.json': JSON.stringify({ type: 'FeatureCollection', features }),
  });
  writeFileSync(file, out['out.json']);
}

/**
 * Country and province shapes from geoBoundaries CGAZ, labelled with Natural Earth ids.
 * geoBoundaries folds territories (Puerto Rico, Faroe Is., New Caledonia...) into their
 * sovereign; each island part is handed back to the Natural Earth territory it lies in.
 * Territories that share a mainland (Hong Kong, Gibraltar, Kosovo...) keep the Natural Earth
 * outline and are marked `over`, so they are drawn over their neighbour.
 */
async function borders(admin0, admin1) {
  const cgaz0 = await geoBoundaries('ADM0');
  const cgaz1 = await geoBoundaries('ADM1');
  const ne = await geojson(`-i ${admin0} encoding=utf8 -simplify interval=120 keep-shapes`);
  const neById = new Map(ne.features.map((f) => [f.properties.ADM0_A3, f]));
  const neLoc = locator(ne);
  const neIdAt = (x, y) => (neLoc.containing(x, y) ?? neLoc.nearest(x, y, 0.3))?.properties.ADM0_A3 ?? null;

  const simplify = `-simplify interval=${CGAZ_INTERVAL} keep-shapes`;
  const parts = await geojson(`-i ${cgaz0} encoding=utf8 ${simplify} -explode`);
  const partPts = await geojson(`-i ${cgaz0} encoding=utf8 ${simplify} -explode -points inner`);

  // geoBoundaries group (ISO 3166-1 alpha-3) -> Natural Earth id
  const groups = new Set(parts.features.map((f) => f.properties.shapeGroup));
  const toNe = new Map();
  for (const f of ne.features) {
    const p = f.properties;
    const key = [p.ADM0_A3, p.ISO_A3, p.ISO_A3_EH].find((k) => k && k !== '-99' && groups.has(k) && !toNe.has(k));
    if (key) toNe.set(key, p.ADM0_A3);
  }
  for (const [g, id] of Object.entries(CGAZ_ALIAS)) if (groups.has(g)) toNe.set(g, id);
  const covered = new Set(toNe.values());
  const neOnly = new Set(ne.features.map((f) => f.properties.ADM0_A3).filter((id) => !covered.has(id)));
  const ownerAt = (group, x, y) => {
    const hit = neIdAt(x, y);
    return hit && neOnly.has(hit) ? hit : toNe.get(group) ?? group;
  };

  const shapes = new Map(); // id -> { polys, points }
  const add = (id, polys, pt) => {
    if (!shapes.has(id)) shapes.set(id, { polys: [], points: [] });
    shapes.get(id).polys.push(...polys);
    if (pt) shapes.get(id).points.push(pt);
  };
  parts.features.forEach((f, i) => {
    const pt = partPts.features[i].geometry?.coordinates;
    if (!pt) return;
    const { shapeGroup: g, shapeType } = f.properties;
    // Disputed areas follow the Natural Earth view (the picker's countries).
    const id = shapeType === 'DISP' ? neIdAt(pt[0], pt[1]) : ownerAt(g, pt[0], pt[1]);
    if (id) add(id, polygonsOf(f.geometry), pt);
  });

  const iso2Of = (p) => (p.ISO_A2_EH && p.ISO_A2_EH !== '-99' ? p.ISO_A2_EH.toLowerCase() : '');
  const over = new Set();
  // Territories, plus any country that ended up with no geoBoundaries part (W. Sahara east of the berm).
  const needOutline = new Set([...neOnly, ...ne.features.map((f) => f.properties.ADM0_A3).filter((id) => !shapes.has(id))]);
  for (const id of needOutline) {
    // Natural Earth polygons of the territory that no geoBoundaries part landed in.
    const own = shapes.get(id)?.points ?? [];
    const missing = polygonsOf(neById.get(id).geometry).filter((poly) => {
      const one = locator({ features: [{ geometry: { type: 'Polygon', coordinates: poly } }] });
      return !own.some(([x, y]) => one.containing(x, y));
    });
    if (missing.length) {
      add(id, missing, null);
      over.add(id);
    }
  }

  for (const [id, s] of shapes) {
    assertNoJumps(`countries/${id}`, s.polys);
    const p = neById.get(id)?.properties;
    const props = { id, name: p?.NAME ?? id, iso2: p ? iso2Of(p) : '', ...(over.has(id) ? { over: true } : {}) };
    await writeTopo(join(OUT, 'countries', `${id}.json`), 'country', [{ type: 'Feature', properties: props, geometry: { type: 'MultiPolygon', coordinates: s.polys } }]);
  }
  console.log(`  ${shapes.size} countries (${over.size} drawn over a neighbour)`);

  // Provinces: geoBoundaries ADM1, ISO 3166-2 codes from the Natural Earth province they sit in.
  const neProv = await geojson(`-i ${admin1} encoding=utf8 -simplify interval=500 keep-shapes -filter-fields iso_3166_2`);
  const provLoc = locator(neProv);
  const provs = await geojson(`-i ${cgaz1} encoding=utf8 ${simplify}`);
  const provPts = await geojson(`-i ${cgaz1} encoding=utf8 ${simplify} -points inner`);
  const byCountry = new Map();
  provs.features.forEach((f, i) => {
    const pt = provPts.features[i].geometry?.coordinates;
    if (!pt || !f.geometry) return;
    const { shapeGroup: g, shapeID, shapeName } = f.properties;
    if (g === 'ATA') return; // one polar ring around the world; Antarctica has no provinces to pick
    const a3 = ownerAt(g, pt[0], pt[1]);
    const iso = String(provLoc.containing(pt[0], pt[1])?.properties.iso_3166_2 ?? '');
    assertNoJumps(`provinces/${shapeID}`, polygonsOf(f.geometry));
    const feat = { type: 'Feature', properties: { id: shapeID, name: shapeName, iso3166_2: iso.includes('-99') ? '' : iso, a3 }, geometry: f.geometry };
    if (!byCountry.has(a3)) byCountry.set(a3, []);
    byCountry.get(a3).push(feat);
  });
  const index = [];
  for (const [a3, feats] of [...byCountry].sort(([a], [b]) => a.localeCompare(b))) {
    await writeTopo(join(OUT, 'provinces', `${a3}.json`), 'provinces', feats);
    for (const f of feats) if (f.properties.name) index.push([f.properties.id, f.properties.name, a3, f.properties.iso3166_2]);
  }
  console.log(`  ${index.length} provinces in ${byCountry.size} countries`);
  return index;
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

  console.log('countries/*.json, provinces/*.json');
  const index = await borders(admin0, admin1);

  // Small search index for provinces: [id, name, countryA3, iso3166_2]
  console.log('provinces-index.json');
  writeFileSync(join(OUT, 'provinces-index.json'), JSON.stringify(index));

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
      `- geoBoundaries CGAZ ADM0 and ADM1 @ ${CGAZ_REF} (CC BY 4.0 / ODbL), ${CGAZ}, simplified to ${CGAZ_INTERVAL} m.`,
      '  Runfola, D. et al. (2020) geoBoundaries: A global database of political administrative boundaries. PLoS ONE 15(4): e0231866.',
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
