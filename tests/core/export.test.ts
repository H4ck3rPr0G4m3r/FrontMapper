import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { LAND, createGrid } from '../../src/core/grid';
import { decodeImagePng, encodeImagePng } from '../../src/core/encode';
import { buildExportZip } from '../../src/core/exportZip';
import { creditsSnippet } from '../../src/core/credits';
import { validateInfo } from '../../src/core/info';

function island() {
  const g = createGrid(64, 48);
  for (let y = 10; y < 30; y++) for (let x = 10; x < 40; x++) { g.terrain[y * 64 + x] = LAND; g.mag[y * 64 + x] = 12; }
  g.terrain[2 * 64 + 2] = LAND; // a 1-cell island the generator deletes
  return g;
}

describe('buildExportZip', () => {
  it('contains exactly the five expected files with valid contents', async () => {
    const grid = island();
    const bytes = await buildExportZip({
      grid,
      meta: { name: 'Kökar', categories: ['europe'] },
      nations: [{ id: 'a', name: 'Jurmo', x: 20, y: 20, flag: 'fi', source: 'custom' }],
      sources: ['osm', 'terrain-tiles'],
      toolVersion: '0.1.0',
    });
    const files = unzipSync(bytes);
    expect(Object.keys(files).sort()).toEqual(['CREDITS.md.snippet', 'frontmapper.json', 'kokar/image.png', 'kokar/info.json', 'preview.png']);
    const back = decodeImagePng(files['kokar/image.png']);
    expect(back.terrain).toEqual(grid.terrain);
    expect(back.mag).toEqual(grid.mag);
    const info = JSON.parse(strFromU8(files['kokar/info.json']));
    expect(info.$schema).toBe('../../../info.schema.json');
    expect(validateInfo(info)).toEqual([]);
    const manifest = JSON.parse(strFromU8(files['frontmapper.json']));
    expect(manifest).toMatchObject({ format: 1, tool: 'FrontMapper Studio', folder: 'kokar', id: 'Kokar', width: 64, height: 48, removed: { islands: 1, lakes: 0 }, nations: 1 });
    expect(manifest.landTiles).toBe(600);
    expect(strFromU8(files['CREDITS.md.snippet'])).toContain('OpenStreetMap contributors');
  });

  it('refuses to export an invalid info.json', async () => {
    await expect(buildExportZip({ grid: island(), meta: { name: 'X', categories: [] }, nations: [], sources: [], toolVersion: '0' })).rejects.toThrow(/Categories/);
  });
});

describe('creditsSnippet', () => {
  it('includes both attribution blocks and names the map', () => {
    const s = creditsSnippet(['osm', 'terrain-tiles'], 'Indonesia');
    expect(s).toContain('© [OpenStreetMap contributors](https://www.openstreetmap.org/copyright)');
    expect(s).toContain('Licensed under ODbL');
    expect(s).toContain('[Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (Mapzen/Tilezen), used for the Indonesia map.');
    expect(s).toContain('tilezen/joerd attribution');
    expect(s).not.toContain('Natural Earth');
  });
});

describe('large maps', () => {
  it.skipIf(!process.env.BENCH)('encodes a 10000x5000 map without canvas', () => {
    const g = createGrid(10000, 5000);
    const png = encodeImagePng(g);
    const back = decodeImagePng(png);
    expect([back.width, back.height]).toEqual([10000, 5000]);
  }, 120_000);
});
