import type { SelOp, SelShape } from './types';

export type { SelOp, SelShape } from './types';

type Level = 'country' | 'province';

const isRegion = (op: SelOp, level: Level, id: string) => op.shape.kind === 'region' && op.shape.level === level && op.shape.id === id;

/**
 * Click on a country or province. Without a modifier it replaces the selection; with Shift
 * it adds the region, or removes it when it was already added.
 */
export function toggleRegion(ops: SelOp[], level: Level, id: string, additive: boolean, country?: string): SelOp[] {
  const op: SelOp = { mode: 'add', shape: country ? { kind: 'region', level, id, country } : { kind: 'region', level, id } };
  if (!additive) return [op];
  if (ops.some((o) => o.mode === 'add' && isRegion(o, level, id))) return ops.filter((o) => !isRegion(o, level, id));
  return [...ops, op];
}

/** Add a drawn shape. `replace` drops earlier shapes (regions stay); add/subtract append. */
export function addShape(ops: SelOp[], shape: SelShape, mode: 'add' | 'subtract' | 'replace'): SelOp[] {
  if (mode === 'replace') return [...ops.filter((o) => o.shape.kind === 'region'), { mode: 'add', shape }];
  return [...ops, { mode, shape }];
}

/** Regions currently added (and not removed by a later subtract of the same region). */
export function selectedRegionIds(ops: SelOp[]): { country: Set<string>; province: Set<string> } {
  const out = { country: new Set<string>(), province: new Set<string>() };
  for (const o of ops) {
    if (o.shape.kind !== 'region') continue;
    const set = out[o.shape.level];
    if (o.mode === 'add') set.add(o.shape.id);
    else set.delete(o.shape.id);
  }
  return out;
}

export const hasSelection = (ops: SelOp[]) => ops.some((o) => o.mode === 'add');
