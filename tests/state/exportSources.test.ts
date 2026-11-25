import { describe, it, expect } from 'vitest';
import { createGrid } from '../../src/core/grid';
import type { Nation } from '../../src/core/nations';
import { exportSources } from '../../src/state/earthNationOps';

const n = (source: Nation['source']): Nation => ({ id: source, name: source, x: 0, y: 0, flag: '', source });
const ALL = ['osm', 'terrain-tiles', 'geoboundaries', 'natural-earth', 'geonames'] as const;
const georef = { pins: [] };

describe('exportSources', () => {
  it('credits a converted map with everything it was built from', () => {
    const p = { id: 'a', grid: createGrid(4, 4), earth: {} as any };
    expect(exportSources(p, [], [...ALL])).toEqual([...ALL]);
  });

  it('credits a lined-up map only with what its nations came from', () => {
    const p = { id: 'a', grid: createGrid(4, 4), georef };
    expect(exportSources(p, [n('custom')], [])).toEqual([]);
    expect(exportSources(p, [n('city'), n('custom')], [])).toEqual(['geonames']);
    expect(exportSources(p, [n('province')], [])).toEqual(['geoboundaries', 'natural-earth', 'geonames']);
  });
});
