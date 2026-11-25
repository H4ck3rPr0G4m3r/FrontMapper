/**
 * How many nations maps usually have, from 48 OpenFront maps (community spreadsheet, Feb 2026).
 * The nation count is a design choice with no fixed rule; lobby size, though, follows land.
 */

/** Land tiles per lobby player (median over the maps). */
export const LAND_PER_PLAYER = { large: 19_933, medium: 26_858, small: 39_720 };
/** Land tiles per nation: the middle half of maps lies between `low` and `high`, `mid` is the median. */
export const LAND_PER_NATION = { low: 46_534, mid: 74_716, high: 156_517 };
/** Nations per large-lobby player, by kind of map (median), where the kind is clear from the categories. */
const KINDS: { label: string; ratio: number; categories: string[] }[] = [
  { label: 'Continental maps', ratio: 0.62, categories: ['continental', 'world'] },
  { label: 'Made-up maps', ratio: 0.16, categories: ['fictional'] },
];

export interface NationGuide {
  lobby: { large: number; medium: number; small: number };
  /** Nations most maps with this much land have (middle half). */
  typical: [number, number];
  median: number;
  /** A tighter hint for the map's kind, if its categories say what it is. */
  kind: { label: string; count: number } | null;
}

export function nationGuide(landTiles: number, categories: string[] = []): NationGuide {
  const r = (v: number) => Math.max(1, Math.round(v));
  const large = r(landTiles / LAND_PER_PLAYER.large);
  const k = KINDS.find((x) => x.categories.some((c) => categories.includes(c)));
  return {
    lobby: { large, medium: r(landTiles / LAND_PER_PLAYER.medium), small: r(landTiles / LAND_PER_PLAYER.small) },
    typical: [r(landTiles / LAND_PER_NATION.high), r(landTiles / LAND_PER_NATION.low)],
    median: r(landTiles / LAND_PER_NATION.mid),
    kind: k ? { label: k.label, count: r(k.ratio * large) } : null,
  };
}
