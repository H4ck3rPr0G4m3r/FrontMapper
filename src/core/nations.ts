import type { ExportSimulation } from './generator';
import { LAND, VOID, WATER, type MapGrid } from './grid';

export interface Nation {
  id: string;
  name: string;
  x: number;
  y: number;
  /** OpenFront flag file name without `.svg`; '' for no flag. */
  flag: string;
  source: 'custom' | 'city' | 'country' | 'province';
  /** Where it sits on Earth, for maps made from Earth data (lets re-framing keep it in place). */
  lonLat?: [number, number];
}

export type NationIssueKind = 'in-water' | 'in-void' | 'off-map' | 'removed-on-export' | 'too-close' | 'unknown-flag' | 'duplicate-name';

export interface NationIssue {
  nationId: string;
  kind: NationIssueKind;
}

export const ISSUE_TEXT: Record<NationIssueKind, string> = {
  'in-water': 'Spawns in water',
  'in-void': 'Spawns in impassable void',
  'off-map': 'Outside the map',
  'removed-on-export': 'Spawns on an island that gets deleted',
  'too-close': 'Too close to another nation',
  'unknown-flag': 'Flag not available in OpenFront',
  'duplicate-name': 'Name used more than once',
};

export const MIN_NATION_DISTANCE = 30;

/** Problems with nation placement, flags and names. `flags` null skips the flag check. */
export function nationIssues(nations: Nation[], g: MapGrid, sim: ExportSimulation | null, flags: Set<string> | null, minDist = MIN_NATION_DISTANCE): NationIssue[] {
  const out: NationIssue[] = [];
  const removed = new Set<number>();
  if (sim) for (const b of sim.removedIslands) for (const c of b.cells) removed.add(c);
  const names = new Map<string, number>();
  for (const n of nations) names.set(n.name.trim().toLowerCase(), (names.get(n.name.trim().toLowerCase()) ?? 0) + 1);

  for (const n of nations) {
    const add = (kind: NationIssueKind) => out.push({ nationId: n.id, kind });
    if (n.x < 0 || n.y < 0 || n.x >= g.width || n.y >= g.height) add('off-map');
    else {
      const i = n.y * g.width + n.x;
      const t = g.terrain[i];
      if (t === WATER) add('in-water');
      else if (t === VOID) add('in-void');
      else if (t === LAND && removed.has(i)) add('removed-on-export');
    }
    if (nations.some((o) => o !== n && Math.hypot(o.x - n.x, o.y - n.y) < minDist)) add('too-close');
    if (flags && n.flag && !flags.has(n.flag)) add('unknown-flag');
    if ((names.get(n.name.trim().toLowerCase()) ?? 0) > 1) add('duplicate-name');
  }
  return out;
}

const KEEP_RANK: Record<Nation['source'], number> = { custom: 0, country: 1, province: 2, city: 3 };

/**
 * Ids of auto-placed nations to delete so that none sits within `minDist` of a kept one.
 * Custom nations always stay; then countries, provinces and cities are kept in that order,
 * and within a kind the earlier one wins (cities are placed biggest first).
 */
export function crowdedExtras(nations: Nation[], minDist = MIN_NATION_DISTANCE): string[] {
  const order = nations.map((n, i) => ({ n, i })).sort((a, b) => KEEP_RANK[a.n.source] - KEEP_RANK[b.n.source] || a.i - b.i);
  // Kept nations bucketed by minDist-sized cells, so only the 3x3 neighbourhood is checked.
  const cells = new Map<string, Nation[]>();
  const key = (cx: number, cy: number) => `${cx},${cy}`;
  const drop: string[] = [];
  for (const { n } of order) {
    const cx = Math.floor(n.x / minDist), cy = Math.floor(n.y / minDist);
    let crowded = false;
    if (n.source !== 'custom')
      for (let dy = -1; dy <= 1 && !crowded; dy++)
        for (let dx = -1; dx <= 1 && !crowded; dx++)
          crowded = (cells.get(key(cx + dx, cy + dy)) ?? []).some((o) => Math.hypot(o.x - n.x, o.y - n.y) < minDist);
    if (crowded) drop.push(n.id);
    else {
      const k = key(cx, cy);
      cells.set(k, [...(cells.get(k) ?? []), n]);
    }
  }
  return drop;
}

export interface Transform {
  sx: number;
  sy: number;
  ox: number;
  oy: number;
}

/** Move nations with a crop or resize. Ones that end up outside stay, and are flagged off-map. */
export function remapNations(nations: Nation[], t: Transform, _width: number, _height: number): Nation[] {
  return nations.map((n) => ({ ...n, x: Math.round(n.x * t.sx + t.ox), y: Math.round(n.y * t.sy + t.oy) }));
}

export function newNationId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `n${Date.now()}${Math.random().toString(36).slice(2)}`;
}
