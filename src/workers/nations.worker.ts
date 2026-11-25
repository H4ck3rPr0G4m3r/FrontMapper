/// <reference lib="webworker" />
import type { Nation } from '../core/nations';
import { defaultRegions } from '../earth/convert';
import { pickCities, placeEarthNations, type PlaceNationsRequest } from '../earth/placeNations';
import { loadCitiesIn } from '../earth/regions';
import { lonLatOf } from '../earth/earthNations';
import type { FrameSize } from '../earth/types';

/** `evenness` (tightest start over roomiest) comes with cities picked for even starts. */
export type NationsWorkerResponse = { type: 'done'; nations: Nation[]; evenness?: number | null } | { type: 'error'; message: string };

/** Cities of the countries the map frame touches (a little margin for cities on the edge). */
function citiesFor(fs: FrameSize) {
  const [lonA, latTop] = lonLatOf(fs, 0, 0);
  let [lonB, latBottom] = lonLatOf(fs, fs.width - 1, fs.height - 1);
  if (lonB < lonA) lonB += 360;
  return loadCitiesIn(lonA - 0.5, latBottom - 0.5, lonB + 0.5, latTop + 0.5);
}

self.onmessage = async (e: MessageEvent<PlaceNationsRequest>) => {
  const post = (m: NationsWorkerResponse) => (self as unknown as Worker).postMessage(m);
  try {
    const req = e.data;
    if (req.source === 'city' && req.pick) {
      const g = { width: req.width, height: req.height, terrain: req.terrain, mag: new Uint8Array(0) };
      const flags = req.flags ? new Set(req.flags) : null;
      const r = pickCities(req, req.pick, g, await citiesFor(req.fs), flags);
      post({ type: 'done', nations: r.nations, evenness: r.evenness });
      return;
    }
    post({ type: 'done', nations: await placeEarthNations(req, defaultRegions, req.source === 'region' || req.source === 'country' || req.source === 'city' ? await citiesFor(req.fs) : []) });
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
