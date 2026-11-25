/// <reference lib="webworker" />
import type { Nation } from '../core/nations';
import { defaultRegions } from '../earth/convert';
import { pickCities, placeEarthNations, type PlaceNationsRequest } from '../earth/placeNations';
import { loadCitiesIn } from '../earth/regions';
import { lonLatOf } from '../earth/earthNations';
import { buildWarp, fitGeoref, mapBack, type GeoPin } from '../earth/georef';
import type { FrameSize } from '../earth/types';

/** A map converted from Earth (it has a frame), or one lined up with Earth by pins. */
export type NationsWorkerRequest = PlaceNationsRequest | (Omit<PlaceNationsRequest, 'fs'> & { pins: GeoPin[] });

/**
 * `evenness` (tightest start over roomiest) comes with cities picked for even starts.
 * `skipped`: on a lined-up map, nations that had no land nearby once mapped back.
 */
export type NationsWorkerResponse = { type: 'done'; nations: Nation[]; evenness?: number | null; skipped?: number } | { type: 'error'; message: string };

/** Cities of the countries the map frame touches (a little margin for cities on the edge). */
function citiesFor(fs: FrameSize) {
  const [lonA, latTop] = lonLatOf(fs, 0, 0);
  let [lonB, latBottom] = lonLatOf(fs, fs.width - 1, fs.height - 1);
  if (lonB < lonA) lonB += 360;
  return loadCitiesIn(lonA - 0.5, latBottom - 0.5, lonB + 0.5, latTop + 0.5);
}

async function place(req: PlaceNationsRequest): Promise<{ nations: Nation[]; evenness?: number | null }> {
  if (req.source === 'city' && req.pick) {
    const g = { width: req.width, height: req.height, terrain: req.terrain, mag: new Uint8Array(0) };
    const flags = req.flags ? new Set(req.flags) : null;
    return pickCities(req, req.pick, g, await citiesFor(req.fs), flags);
  }
  const cities = req.source === 'region' || req.source === 'country' || req.source === 'city' ? await citiesFor(req.fs) : [];
  return { nations: await placeEarthNations(req, defaultRegions, cities) };
}

/** Place on a copy of the map warped into an Earth frame, then map the nations back by their lon/lat. */
async function placeLinedUp(req: Omit<PlaceNationsRequest, 'fs'> & { pins: GeoPin[] }) {
  const r = fitGeoref(req.pins);
  if (!r.ok) throw new Error(r.reason);
  const warp = buildWarp(r.fit, req.width, req.height, req.terrain);
  const out = await place({ ...req, fs: warp.fs, width: warp.fs.width, height: warp.fs.height, terrain: warp.terrain });
  const back = mapBack(out.nations, r.fit, req.width, req.height, req.terrain);
  return { nations: back.nations, evenness: out.evenness, skipped: back.skipped };
}

self.onmessage = async (e: MessageEvent<NationsWorkerRequest>) => {
  const post = (m: NationsWorkerResponse) => (self as unknown as Worker).postMessage(m);
  try {
    const req = e.data;
    post({ type: 'done', ...('pins' in req ? await placeLinedUp(req) : await place(req)) });
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
