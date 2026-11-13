import { gunzipSync } from 'fflate';
import { mvtPolygons } from './mvt';
import { HALF } from './projection';
import { fillRings } from './raster';
import { fetchTiles, pickZoom, tileRangeForFrame, tileUrl, type FetchTilesOpts } from './tiles';
import type { FrameSize } from './types';

export const OPENFREEMAP_TILEJSON = 'https://tiles.openfreemap.org/planet';

export type TileCtx = Omit<FetchTilesOpts, 'onProgress'> & { onProgress?: (done: number, total: number) => void };

const bytes = (b: ArrayBuffer) => {
  const u = new Uint8Array(b);
  return u[0] === 0x1f && u[1] === 0x8b ? gunzipSync(u) : u;
};

/** OpenFreeMap tile URL template and max zoom, from its TileJSON. */
async function tileTemplate(ctx: TileCtx): Promise<{ template: string; maxzoom: number }> {
  const [tj] = await fetchTiles([OPENFREEMAP_TILEJSON], (b) => JSON.parse(new TextDecoder().decode(b)), { ...ctx, onProgress: undefined });
  if (!tj?.tiles?.[0]) throw new Error('The coastline service answered without a tile address.');
  return { template: tj.tiles[0], maxzoom: Math.min(14, tj.maxzoom ?? 14) };
}

/**
 * Water mask at output resolution (1 = water) from the OpenFreeMap `water` layer
 * (OSM oceans, seas, lakes and wide rivers). Pixels are water when their centre is.
 */
export async function waterMask(fs: FrameSize, ctx: TileCtx): Promise<Uint8Array> {
  const { template, maxzoom } = await tileTemplate(ctx);
  const r = tileRangeForFrame(fs.frame, pickZoom(fs.mPerPx, maxzoom, 256));
  const n = 2 ** r.z, T = (2 * HALF) / n;
  const mask = new Uint8Array(fs.width * fs.height);
  const jobs: { url: string; tx: number; ty: number }[] = [];
  r.xs.forEach((x, k) => {
    for (let y = r.y0; y <= r.y1; y++) jobs.push({ url: tileUrl(template, r.z, x, y), tx: r.x0 + k, ty: y });
  });
  const byUrl = new Map(jobs.map((j) => [j.url, j]));
  // Rasterise each tile as it arrives (filling is idempotent, so a retried tile is harmless).
  const paint = (b: ArrayBuffer, url: string) => {
    const t = mvtPolygons(bytes(b), 'water');
    const { tx, ty } = byUrl.get(url)!;
    const s = T / t.extent / fs.mPerPx;
    const ox = (-HALF + tx * T - fs.frame.x0) / fs.mPerPx;
    const oy = (-HALF + ty * T - fs.frame.y0) / fs.mPerPx;
    const rings = t.rings.map((ring) => {
      const p = new Float64Array(ring.length);
      for (let k = 0; k < ring.length; k += 2) { p[k] = ox + ring[k] * s; p[k + 1] = oy + ring[k + 1] * s; }
      return p;
    });
    fillRings(mask, fs.width, fs.height, rings, 1);
    return true;
  };
  await fetchTiles(jobs.map((j) => j.url), paint, ctx);
  return mask;
}
