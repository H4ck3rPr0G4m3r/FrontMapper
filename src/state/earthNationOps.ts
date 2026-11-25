import { signal } from '@preact/signals';
import type { Nation } from '../core/nations';
import type { EarthNationSource, PlaceNationsRequest } from '../earth/placeNations';
import type { PickMethod } from '../earth/cityPicks';
import type { NationsWorkerResponse } from '../workers/nations.worker';
import { flagCodes, loadFlags } from './flags';
import { nations, project, selectedNation } from './store';

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

/** Borders are rasterised and searched in a worker, so huge maps don't freeze the editor. */
function place(req: PlaceNationsRequest): Promise<{ nations: Nation[]; evenness?: number | null }> {
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
  if (!p?.earth || earthNationsBusy.value) return;
  earthNationsBusy.value = source;
  earthNationsNote.value = null;
  loadFlags();
  try {
    const { nations: made } = await place({
      source,
      fs: p.earth.frameSize,
      width: p.grid.width,
      height: p.grid.height,
      terrain: p.grid.terrain.slice(),
      minPop: cityThreshold.value,
      flags: flagCodes.value,
      regions: p.earth.regions,
    });
    if (project.value?.id !== p.id) return;
    nations.value = [...nations.value.filter((n) => n.source !== source), ...made];
    if (selectedNation.value && !nations.value.some((n) => n.id === selectedNation.value)) selectedNation.value = null;
    const [one, many] = LABEL[source];
    earthNationsNote.value = { source, text: made.length ? `Placed ${made.length} ${made.length === 1 ? one : many}.` : `No ${many} on this map's land.` };
  } catch (e) {
    earthNationsNote.value = { source, text: e instanceof Error ? e.message : String(e), error: true };
  } finally {
    earthNationsBusy.value = null;
  }
}

/** Pick cities with the current settings and show them on the map (nothing is placed yet). */
export async function previewCityPicks(count: number) {
  const p = project.value;
  if (!p?.earth || picking.value) return;
  const o = pickSettings.value;
  picking.value = true;
  earthNationsNote.value = null;
  loadFlags();
  try {
    const r = await place({
      source: 'city',
      fs: p.earth.frameSize,
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
    } else cityPicks.value = { nations: r.nations, evenness: r.evenness ?? null };
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
