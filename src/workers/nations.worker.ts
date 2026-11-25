/// <reference lib="webworker" />
import type { Nation } from '../core/nations';
import { defaultRegions } from '../earth/convert';
import { pickCities, placeEarthNations, type PlaceNationsRequest } from '../earth/placeNations';
import { loadCities } from '../earth/regions';

/** `evenness` (tightest start over roomiest) comes with cities picked for even starts. */
export type NationsWorkerResponse = { type: 'done'; nations: Nation[]; evenness?: number | null } | { type: 'error'; message: string };

self.onmessage = async (e: MessageEvent<PlaceNationsRequest>) => {
  const post = (m: NationsWorkerResponse) => (self as unknown as Worker).postMessage(m);
  try {
    const req = e.data;
    if (req.source === 'city' && req.pick) {
      const g = { width: req.width, height: req.height, terrain: req.terrain, mag: new Uint8Array(0) };
      const flags = req.flags ? new Set(req.flags) : null;
      const r = pickCities(req, req.pick, g, await loadCities(), flags);
      post({ type: 'done', nations: r.nations, evenness: r.evenness });
      return;
    }
    post({ type: 'done', nations: await placeEarthNations(req, defaultRegions, await loadCities()) });
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
