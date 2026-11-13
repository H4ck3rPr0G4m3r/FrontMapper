#!/usr/bin/env node
/**
 * Dev-only check that FrontMapper predicts exactly what OpenFront's map generator deletes.
 *
 *   npm run verify:generator                     5 fixture maps
 *   npm run verify:generator -- --zip map.zip    also an exported FrontMapper zip
 *
 * Needs git and Go (on PATH, or unpacked at .cache/go). Works in .cache/ofio, a shallow
 * OpenFrontIO checkout that this script owns and resets.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { runnerImport } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const cache = join(root, '.cache');
const ofio = join(cache, 'ofio');
const gen = join(ofio, 'map-generator');
const exe = process.platform === 'win32' ? '.exe' : '';

function findGo() {
  const local = join(cache, 'go', 'bin', `go${exe}`);
  if (existsSync(local)) return local;
  const r = spawnSync('go', ['version'], { encoding: 'utf8' });
  if (r.status === 0) return 'go';
  console.error('Go is not installed. Install it from https://go.dev/dl/ or unpack it into .cache/go.');
  process.exit(2);
}

function checkout() {
  mkdirSync(cache, { recursive: true });
  const git = (...a) => execFileSync('git', a, { stdio: 'inherit' });
  if (!existsSync(join(ofio, '.git'))) git('clone', '--depth', '1', 'https://github.com/openfrontio/OpenFrontIO.git', ofio);
  else {
    git('-C', ofio, 'fetch', '--depth', '1', 'origin', 'HEAD');
    git('-C', ofio, 'reset', '--hard', 'FETCH_HEAD');
  }
  git('-C', ofio, 'clean', '-fdq');
}

/** Maps from an exported zip: its folder plus the counts the Checks tab showed (frontmapper.json). */
function fromZip(path) {
  const zip = unzipSync(readFileSync(path));
  const manifest = JSON.parse(new TextDecoder().decode(zip['frontmapper.json']));
  const files = {};
  for (const [p, data] of Object.entries(zip)) if (p.startsWith(`${manifest.folder}/`)) files[p.slice(manifest.folder.length + 1)] = data;
  return { folder: manifest.folder, files, expected: manifest.removed, label: path };
}

const args = process.argv.slice(2);
const zips = args.flatMap((a, i) => (a === '--zip' && args[i + 1] ? [resolve(args[i + 1])] : []));

const go = findGo();
checkout();
const { module } = await runnerImport(join(root, 'scripts/verify-generator/make-fixtures.ts'), { root, configFile: false, logLevel: 'error' });
const maps = [...(await module.buildFixtures()), ...zips.map(fromZip)];

console.log('Building the generator...');
const bin = join(gen, `fm-verify${exe}`);
execFileSync(go, ['build', '-o', bin, '.'], { cwd: gen, stdio: 'inherit' });

const rows = [];
for (const m of maps) {
  const dir = join(gen, 'assets', 'maps', m.folder);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const [name, data] of Object.entries(m.files)) writeFileSync(join(dir, name), data);
  const t0 = Date.now();
  const r = spawnSync(bin, [`--maps=${m.folder}`, '--log-level=DEBUG', '--log-removal'], { cwd: gen, encoding: 'utf8', maxBuffer: 1 << 28 });
  const out = `${r.stdout}\n${r.stderr}`;
  const islands = /Identified and removed (\d+) islands/.exec(out)?.[1];
  const lakes = /Identified and removed (\d+) bodies of water/.exec(out)?.[1];
  const got = { islands: islands === undefined ? NaN : +islands, lakes: lakes === undefined ? NaN : +lakes };
  const ok = r.status === 0 && got.islands === m.expected.islands && got.lakes === m.expected.lakes;
  if (r.status !== 0) console.error(out.split('\n').slice(-20).join('\n'));
  rows.push({ map: m.folder, ok, ms: Date.now() - t0, expected: m.expected, got, status: r.status });
}
rmSync(bin, { force: true });
execFileSync('git', ['-C', ofio, 'clean', '-fdq'], { stdio: 'inherit' });
execFileSync('git', ['-C', ofio, 'checkout', '--', '.'], { stdio: 'inherit' });

const pad = (s, n) => String(s).padEnd(n);
console.log(`\n${pad('Map', 28)}${pad('Islands (FM / Go)', 20)}${pad('Lakes (FM / Go)', 20)}Result`);
for (const r of rows)
  console.log(`${pad(r.map, 28)}${pad(`${r.expected.islands} / ${r.got.islands}`, 20)}${pad(`${r.expected.lakes} / ${r.got.lakes}`, 20)}${r.ok ? 'match' : r.status ? `generator failed (${r.status})` : 'MISMATCH'}`);
const bad = rows.filter((r) => !r.ok).length;
console.log(bad ? `\n${bad} of ${rows.length} maps differ.` : `\nAll ${rows.length} maps match the Go generator.`);
process.exit(bad ? 1 : 0);
