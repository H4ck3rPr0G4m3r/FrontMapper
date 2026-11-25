import { signal } from '@preact/signals';
import type { Nation } from '../core/nations';
import type { EarthNationSource, PlaceNationsRequest } from '../earth/placeNations';
import type { NationsWorkerResponse } from '../workers/nations.worker';
import { flagCodes, loadFlags } from './flags';
import { nations, project, selectedNation } from './store';

export type { EarthNationSource } from '../earth/placeNations';

export const earthNationsBusy = signal<EarthNationSource | null>(null);
export const earthNationsNote = signal<{ source: EarthNationSource; text: string; error?: boolean } | null>(null);
export const cityThreshold = signal(1_000_000);

const LABEL: Record<EarthNationSource, [string, string]> = { city: ['city', 'cities'], country: ['country', 'countries'], province: ['province', 'provinces'], region: ['region', 'regions'] };

/** Borders are rasterised and searched in a worker, so huge maps don't freeze the editor. */
function place(req: PlaceNationsRequest): Promise<Nation[]> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('../workers/nations.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<NationsWorkerResponse>) => {
      w.terminate();
      if (e.data.type === 'done') resolve(e.data.nations);
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
    const made = await place({
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
