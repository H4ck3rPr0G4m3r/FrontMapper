import { describe, it, expect } from 'vitest';
import { LAND, createGrid } from '../../src/core/grid';
import { buildInfoJson, CATEGORIES, cropGrid, deriveIds, resizeGrid, validateInfo, type MapMeta } from '../../src/core/info';
import { remapNations, type Nation } from '../../src/core/nations';

describe('deriveIds', () => {
  it('strips diacritics for the canonical name and ids', () => {
    expect(deriveIds('Kökar')).toEqual({ id: 'Kokar', folder: 'kokar', translationKey: 'map.kokar', canonicalName: 'Kokar' });
  });

  it('drops punctuation the schema forbids and camel-cases words', () => {
    const ids = deriveIds('Bab-el-Mandeb!');
    expect(ids.id).toBe('BabElMandeb');
    expect(ids.canonicalName).toBe('Bab-el-Mandeb');
    expect(ids.canonicalName).toMatch(/^[a-zA-Z0-9\s().-]+$/);
  });

  it('prefixes ids that would start with a digit', () => {
    expect(deriveIds('2 Islands').id).toBe('Map2Islands');
    expect(deriveIds('2 Islands').folder).toBe('map2islands');
  });

  it('trims long names to 29 characters', () => {
    const ids = deriveIds('The Very Long Archipelago Of Many Islands');
    expect(ids.canonicalName.length).toBeLessThanOrEqual(29);
    expect(ids.canonicalName).toBe('The Very Long Archipelago Of');
  });
});

const meta: MapMeta = { name: 'Kökar', author: 'Peter', description: 'Islands.', categories: ['europe'], location: { lat: 59.9, lon: 20.9 } };
const nations: Nation[] = [{ id: 'a', name: 'Jurmo', x: 10, y: 20, flag: 'fi', source: 'custom' }];

describe('buildInfoJson / validateInfo', () => {
  it('builds a schema-valid info.json', () => {
    const info = buildInfoJson(meta, nations) as Record<string, unknown>;
    expect(Object.keys(info)).toEqual(['$schema', 'id', 'name', 'translation_key', 'display_name', 'author', 'description', 'categories', 'location', 'nations']);
    expect(info.$schema).toBe('../../../info.schema.json');
    expect(info.display_name).toBe('Kökar');
    expect(info.nations).toEqual([{ coordinates: [10, 20], name: 'Jurmo', flag: 'fi' }]);
    expect(validateInfo(info)).toEqual([]);
  });

  it('omits display_name when it equals the canonical name, and reports missing categories', () => {
    const info = buildInfoJson({ name: 'Java', categories: [] }, []) as Record<string, unknown>;
    expect('display_name' in info).toBe(false);
    expect(validateInfo(info).join(' ')).toMatch(/categories/i);
  });
});

describe('cropGrid / resizeGrid', () => {
  it('crop moves nations with the map', () => {
    const g = createGrid(100, 100);
    g.terrain[30 * 100 + 30] = LAND;
    const { grid, transform } = cropGrid(g, { x: 10, y: 10, w: 40, h: 40 });
    expect([grid.width, grid.height]).toEqual([40, 40]);
    expect(grid.terrain[20 * 40 + 20]).toBe(LAND);
    const moved = remapNations([{ ...nations[0], x: 30, y: 30 }], transform, 40, 40);
    expect([moved[0].x, moved[0].y]).toEqual([20, 20]);
  });

  it('resize snaps to multiples of 4 and scales nearest-neighbour', () => {
    const g = createGrid(100, 100);
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) g.terrain[y * 100 + x] = LAND;
    const { grid, transform } = resizeGrid(g, 203, 50);
    expect([grid.width, grid.height]).toEqual([200, 48]);
    expect(grid.terrain[0]).toBe(LAND);
    expect(transform.sx).toBeCloseTo(2);
  });
});

describe('validateInfo nation messages', () => {
  it('names the nation instead of a schema path', () => {
    const bad: Nation[] = [
      { id: 'a', name: '', x: 10, y: 20, flag: '', source: 'custom' },
      { id: 'b', name: 'Utö', x: -4, y: 20, flag: '', source: 'custom' },
    ];
    const errors = validateInfo(buildInfoJson(meta, bad));
    expect(errors).toContain('Nation 1: needs a name');
    expect(errors).toContain('Nation "Utö": is outside the map');
  });
});

describe('deriveIds beyond accented Latin', () => {
  it('spells out Latin letters NFD does not split', () => {
    expect(deriveIds('Bjørn Øya').canonicalName).toBe('Bjorn Oya');
    expect(deriveIds('Łódź').canonicalName).toBe('Lodz');
    expect(deriveIds('Straße').id).toBe('Strasse');
  });

  it('transliterates Cyrillic and Greek', () => {
    expect(deriveIds('Москва')).toMatchObject({ canonicalName: 'Moskva', id: 'Moskva' });
    expect(deriveIds('Αθήνα').canonicalName).toBe('Athina');
  });

  it('gives other scripts a valid, distinct name instead of failing the schema', () => {
    const tokyo = deriveIds('東京');
    expect(tokyo.canonicalName).toMatch(/^[a-zA-Z0-9\s().-]+$/);
    expect(tokyo.id).not.toBe(deriveIds('大阪').id);
    expect(deriveIds('!!!').canonicalName).not.toBe('');
    const info = buildInfoJson({ name: '東京', categories: [CATEGORIES[0]] }, []) as Record<string, unknown>;
    expect(validateInfo(info)).toEqual([]);
    expect(info.display_name).toBe('東京');
  });
});
