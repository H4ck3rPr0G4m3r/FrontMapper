import { LAND, VOID, WATER } from './grid';

/** The terrain kinds a map is made of, in display order, with their game-view colours. */
export const TERRAIN_KINDS = [
  { id: 'water', label: 'Water', color: 'rgb(70,132,180)' },
  { id: 'plains', label: 'Plains', color: 'rgb(190,210,138)' },
  { id: 'highlands', label: 'Highlands', color: 'rgb(230,213,168)' },
  { id: 'mountains', label: 'Mountains', color: 'rgb(240,240,240)' },
  { id: 'void', label: 'Void', color: 'rgb(8,8,8)' },
] as const;

/** Pixel counts per TERRAIN_KINDS entry. Plains are elevation 0-9, highlands 10-19, mountains 20+. */
export function terrainCounts(terrain: Uint8Array, mag: Uint8Array): number[] {
  const c = [0, 0, 0, 0, 0];
  for (let i = 0; i < terrain.length; i++) {
    const t = terrain[i];
    if (t === WATER) c[0]++;
    else if (t === VOID) c[4]++;
    else if (t === LAND) c[mag[i] < 10 ? 1 : mag[i] < 20 ? 2 : 3]++;
  }
  return c;
}
