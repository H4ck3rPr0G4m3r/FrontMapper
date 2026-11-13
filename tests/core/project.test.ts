import { describe, it, expect } from 'vitest';
import { LAND, createGrid } from '../../src/core/grid';
import { encodeImagePng } from '../../src/core/encode';
import { importOpenFrontMap, openProject, saveProject, type ProjectState } from '../../src/core/project';

describe('project files', () => {
  it('save/open round-trips the grid, metadata and nations', () => {
    const grid = createGrid(40, 20);
    grid.terrain[5] = LAND;
    grid.mag[5] = 9;
    const s: ProjectState = {
      id: 'p1',
      grid,
      meta: { name: 'Java', categories: ['asia'] },
      nations: [{ id: 'n', name: 'Jakarta', x: 5, y: 0, flag: 'id', source: 'city', lonLat: [106.8, -6.2] }],
      camera: { x: 20, y: 10, zoom: 2 },
      accepted: { islands: false, lakes: true },
    };
    const back = openProject(saveProject(s));
    expect(back.accepted).toEqual({ islands: false, lakes: true });
    expect(back.grid.terrain).toEqual(grid.terrain);
    expect(back.grid.mag).toEqual(grid.mag);
    expect(back.meta).toEqual(s.meta);
    expect(back.nations).toEqual(s.nations);
    expect(back.camera).toEqual(s.camera);
    expect(back.id).toBe('p1');
  });

  it('imports an OpenFront map folder', () => {
    const grid = createGrid(41, 22); // generator crops to 40x20
    for (let i = 0; i < 200; i++) grid.terrain[i] = LAND;
    const info = {
      id: 'SoutheastAsia', name: 'SoutheastAsia', translation_key: 'map.southeastasia', display_name: 'Southeast Asia',
      categories: ['asia'], author: 'Tristar', location: { lat: 12, lon: 113 },
      nations: [{ coordinates: [3, 2], name: 'Vietnam', flag: 'vn' }, { name: 'Random spawn' }],
    };
    const s = importOpenFrontMap(encodeImagePng(grid), JSON.stringify(info));
    expect([s.grid.width, s.grid.height]).toEqual([40, 20]);
    expect(s.meta).toMatchObject({ name: 'Southeast Asia', categories: ['asia'], author: 'Tristar', location: { lat: 12, lon: 113 } });
    expect(s.nations).toHaveLength(1);
    expect(s.nations[0]).toMatchObject({ name: 'Vietnam', x: 3, y: 2, flag: 'vn', source: 'custom' });
  });
});
