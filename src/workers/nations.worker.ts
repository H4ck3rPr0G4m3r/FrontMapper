/// <reference lib="webworker" />
import type { Nation } from '../core/nations';
import { defaultRegions } from '../earth/convert';
import { placeEarthNations, type PlaceNationsRequest } from '../earth/placeNations';
import { loadCities } from '../earth/regions';

export type NationsWorkerResponse = { type: 'done'; nations: Nation[] } | { type: 'error'; message: string };

self.onmessage = async (e: MessageEvent<PlaceNationsRequest>) => {
  const post = (m: NationsWorkerResponse) => (self as unknown as Worker).postMessage(m);
  try {
    post({ type: 'done', nations: await placeEarthNations(e.data, defaultRegions, await loadCities()) });
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
