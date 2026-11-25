import { signal } from '@preact/signals';
import type { Nation } from '../core/nations';
import type { SourceId } from '../core/credits';
import type { EarthNationSource } from '../earth/placeNations';
import type { PickMethod } from '../earth/cityPicks';
import { fitGeoref } from '../earth/georef';
import type { NationsWorkerRequest, NationsWorkerResponse } from '../workers/nations.worker';
import { flagCodes, loadFlags } from './flags';
import { nations, project, selectedNation, type EditorProject } from './store';

export type { EarthNationSource } from '../earth/placeNations';

export const earthNationsBusy = signal<EarthNationSource | null>(null);
export const earthNationsNote = signal<{ source: EarthNationSource; text: string; error?: boolean } | null>(null);
export const cityThreshold = signal(1_000_000);

/** "Every city over" or "Pick a number" of them. */
export const cityMode = signal<'all' | 'pick'>('all');
/** Settings for picking a number of cities. `count` 0 means "the typical number for this map". */
export const pickSettings = signal<{ count: number; minPop: number; method: PickMethod; spread: number; seed: number }>({
  count: 0,
  minPop: 20_000,
  method: 'spread',
  spread: 0.7,
  seed: 1,
});
/** Cities picked but not placed yet: shown on the map until placed or dropped. */
export const cityPicks = signal<{ nations: Nation[]; evenness: number | null } | null>(null);
export const picking = signal(false);

const LABEL: Record<EarthNationSource, [string, string]> = { city: ['city', 'cities'], country: ['country', 'countries'], province: ['province', 'provinces'], region: ['region', 'regions'] };

/** Where a map sits on Earth: the frame of a converted map, or the pins of a lined-up one. */
function earthTarget(p: EditorProject): { fs: NonNullable<EditorProject['earth']>['frameSize'] } | { pins: NonNullable<EditorProject['georef']>['pins'] } | null {
  if (p.earth) return { fs: p.earth.frameSize };
  if (p.georef && fitGeoref(p.georef.pins).ok) return { pins: p.georef.pins };
  return null;
}

/** The map can take nations from Earth data. */
export function hasEarthTarget(p: EditorProject | null): boolean {
  return !!p && !!earthTarget(p);
}

/** " 2 had no land nearby on your map." for nations dropped while mapping back to a lined-up map. */
const skippedText = (n?: number) => (n ? ` ${n} had no land nearby on your map.` : '');

/** Borders are rasterised and searched in a worker, so huge maps don't freeze the editor. */
function place(req: NationsWorkerRequest): Promise<{ nations: Nation[]; evenness?: number | null; skipped?: number }> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('../workers/nations.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<NationsWorkerResponse>) => {
      w.terminate();
      if (e.data.type === 'done') resolve(e.data);
      else reject(new Error(e.data.message));
    };
    w.onerror = (e) => {
      w.terminate();
      reject(new Error(e.message || 'Placing nations failed.'));
    };
    w.postMessage(req, [req.terrain.buffer]);
  });
}

/** Replace the nations of one source with fresh ones from Earth data; custom ones stay. */
export async function nationsFromEarth(source: EarthNationSource) {
  const p = project.value;
  const target = p && earthTarget(p);
  if (!p || !target || earthNationsBusy.value) return;
  earthNationsBusy.value = source;
  earthNationsNote.value = null;
  loadFlags();
  try {
    const { nations: made, skipped } = await place({
      source,
      ...target,
      width: p.grid.width,
      height: p.grid.height,
      terrain: p.grid.terrain.slice(),
      minPop: cityThreshold.value,
      flags: flagCodes.value,
      regions: p.earth?.regions,
    });
    if (project.value?.id !== p.id) return;
    nations.value = [...nations.value.filter((n) => n.source !== source), ...made];
    if (selectedNation.value && !nations.value.some((n) => n.id === selectedNation.value)) selectedNation.value = null;
    const [one, many] = LABEL[source];
    earthNationsNote.value = { source, text: (made.length ? `Placed ${made.length} ${made.length === 1 ? one : many}.` : `No ${many} on this map's land.`) + skippedText(skipped) };
  } catch (e) {
    earthNationsNote.value = { source, text: e instanceof Error ? e.message : String(e), error: true };
  } finally {
    earthNationsBusy.value = null;
  }
}

/** Pick cities with the current settings and show them on the map (nothing is placed yet). */
export async function previewCityPicks(count: number) {
  const p = project.value;
  const target = p && earthTarget(p);
  if (!p || !target || picking.value) return;
  const o = pickSettings.value;
  picking.value = true;
  earthNationsNote.value = null;
  loadFlags();
  try {
    const r = await place({
      source: 'city',
      ...target,
      width: p.grid.width,
      height: p.grid.height,
      terrain: p.grid.terrain.slice(),
      minPop: o.minPop,
      flags: flagCodes.value,
      pick: { count, method: o.method, spread: o.spread, seed: o.seed },
    });
    if (project.value?.id !== p.id) return;
    if (!r.nations.length) {
      cityPicks.value = null;
      earthNationsNote.value = { source: 'city', text: `No cities over ${o.minPop.toLocaleString()} on this map's land.` };
    } else {
      cityPicks.value = { nations: r.nations, evenness: r.evenness ?? null };
      if (r.skipped) earthNationsNote.value = { source: 'city', text: skippedText(r.skipped).trim() };
    }
  } catch (e) {
    earthNationsNote.value = { source: 'city', text: e instanceof Error ? e.message : String(e), error: true };
  } finally {
    picking.value = false;
  }
}

/** Different picks among similarly good cities. */
export function rerollCityPicks(count: number) {
  pickSettings.value = { ...pickSettings.value, seed: pickSettings.value.seed + 1 };
  return previewCityPicks(count);
}

/** Place the picked cities, replacing cities placed before (nations placed by hand stay). */
export function placeCityPicks() {
  const picks = cityPicks.value;
  if (!picks) return;
  nations.value = [...nations.value.filter((n) => n.source !== 'city'), ...picks.nations];
  if (selectedNation.value && !nations.value.some((n) => n.id === selectedNation.value)) selectedNation.value = null;
  cityPicks.value = null;
  earthNationsNote.value = { source: 'city', text: `Placed ${picks.nations.length} ${picks.nations.length === 1 ? 'city' : 'cities'}.` };
}

export function dropCityPicks() {
  cityPicks.value = null;
}

/**
 * Data sources to credit on export. A converted map used all of them. A lined-up map only used
 * what its nations came from: GeoNames for cities and capitals, the border data for regions.
 */
export function exportSources(p: EditorProject, list: Nation[], converted: SourceId[]): SourceId[] {
  if (p.earth || !p.georef) return converted;
  const out = new Set<SourceId>();
  for (const n of list) {
    if (n.source === 'city') out.add('geonames');
    if (n.source === 'country' || n.source === 'province') ['geoboundaries', 'natural-earth', 'geonames'].forEach((s) => out.add(s as SourceId));
  }
  return (['osm', 'terrain-tiles', 'geoboundaries', 'natural-earth', 'geonames'] as SourceId[]).filter((s) => out.has(s));
}
