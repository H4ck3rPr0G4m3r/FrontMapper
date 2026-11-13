import { describe, it, expect } from 'vitest';
import { addShape, selectedRegionIds, toggleRegion } from '../../src/earth/selectionOps';
import type { SelOp } from '../../src/earth/types';

describe('toggleRegion', () => {
  it('a plain click replaces the selection', () => {
    let ops: SelOp[] = toggleRegion([], 'country', 'IDN', false);
    ops = toggleRegion(ops, 'country', 'MYS', false);
    expect(selectedRegionIds(ops).country).toEqual(new Set(['MYS']));
  });

  it('shift-click adds, and shift-clicking again removes', () => {
    let ops = toggleRegion([], 'country', 'IDN', false);
    ops = toggleRegion(ops, 'country', 'MYS', true);
    expect(selectedRegionIds(ops).country).toEqual(new Set(['IDN', 'MYS']));
    ops = toggleRegion(ops, 'country', 'IDN', true);
    expect(selectedRegionIds(ops).country).toEqual(new Set(['MYS']));
  });

  it('keeps provinces and countries apart', () => {
    let ops = toggleRegion([], 'country', 'IDN', false);
    ops = toggleRegion(ops, 'province', 'IDN-1185', true);
    const ids = selectedRegionIds(ops);
    expect(ids.country).toEqual(new Set(['IDN']));
    expect(ids.province).toEqual(new Set(['IDN-1185']));
  });
});

describe('addShape', () => {
  const rect = { kind: 'rect' as const, a: [100, 0] as [number, number], b: [110, -5] as [number, number] };
  it('replace drops earlier shapes but keeps regions; add and subtract append', () => {
    let ops = toggleRegion([], 'country', 'IDN', false);
    ops = addShape(ops, rect, 'add');
    ops = addShape(ops, { ...rect, a: [0, 0] }, 'replace');
    expect(ops.filter((o) => o.shape.kind === 'rect')).toHaveLength(1);
    expect(ops[0].shape).toEqual({ kind: 'region', level: 'country', id: 'IDN' });
    ops = addShape(ops, rect, 'subtract');
    expect(ops[ops.length - 1]).toEqual({ mode: 'subtract', shape: rect });
  });
});
