import { decode } from 'fast-png';
import { HALF } from './projection';
import { fetchTiles, pickZoom, tileRangeForFrame, tileUrl } from './tiles';
import type { ElevationCurve, FrameSize } from './types';
import type { TileCtx } from './water';

export type { ElevationCurve } from './types';
export { DEFAULT_CURVE } from './types';

export const TERRARIUM = 'https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png';
const TERRARIUM_MAX_ZOOM = 15;

/**
 * Metres to OpenFront magnitude: up to 0 m is 0; then plains 0..9 up to `highlandsFrom`,
 * highlands 10..19 up to `mountainsFrom`, mountains 20..30 up to `peak` (floored lerp, clamped).
 */
export function magFor(m: number, c: ElevationCurve): number {
  if (!(m > 0)) return 0;
  const lerp = (lo: number, hi: number, a: number, b: number) => lo + Math.floor(((hi - lo) * (m - a)) / Math.max(1e-9, b - a));
  if (m < c.highlandsFrom) return lerp(0, 9, 0, c.highlandsFrom);
  if (m < c.mountainsFrom) return lerp(10, 19, c.highlandsFrom, c.mountainsFrom);
  if (m >= c.peak) return 30;
  return Math.min(30, lerp(20, 30, c.mountainsFrom, c.peak));
}

/** Terrarium PNG to whole metres (R*256 + G + B/256 - 32768). */
export function decodeTerrarium(b: ArrayBuffer): Int16Array {
  const img = decode(new Uint8Array(b));
  const { width, height, data, channels } = img;
  if (width !== 256 || height !== 256) throw new Error(`Unexpected elevation tile size ${width}x${height}`);
  const out = new Int16Array(256 * 256);
  const pal = img.palette;
  for (let i = 0; i < out.length; i++) {
    let r: number, g: number, bl: number;
    if (pal) [r, g, bl] = pal[data[i]] as number[];
    else { r = data[i * channels]; g = data[i * channels + 1]; bl = data[i * channels + 2]; }
    out[i] = Math.max(-32768, Math.min(32767, Math.round(r * 256 + g + bl / 256 - 32768)));
  }
  return out;
}

/**
 * Elevation in whole metres at every output pixel, bilinear sampled from Terrarium tiles
 * one zoom coarser-or-equal to the map (sharper elevation would not show at 31 levels).
 */
export async function elevationGrid(fs: FrameSize, ctx: TileCtx): Promise<Int16Array> {
  const r = tileRangeForFrame(fs.frame, pickZoom(fs.mPerPx * 2, TERRARIUM_MAX_ZOOM, 256));
  const cols = r.xs.length, rows = r.y1 - r.y0 + 1;
  const mw = cols * 256, mh = rows * 256;
  const mosaic = new Int16Array(mw * mh);
  const jobs: { url: string; cx: number; cy: number }[] = [];
  r.xs.forEach((x, k) => {
    for (let y = r.y0; y <= r.y1; y++) jobs.push({ url: tileUrl(TERRARIUM, r.z, x, y), cx: k, cy: y - r.y0 });
  });
  const byUrl = new Map(jobs.map((j) => [j.url, j]));
  await fetchTiles(
    jobs.map((j) => j.url),
    (b, url) => {
      const t = decodeTerrarium(b);
      const { cx, cy } = byUrl.get(url)!;
      for (let y = 0; y < 256; y++) mosaic.set(t.subarray(y * 256, y * 256 + 256), (cy * 256 + y) * mw + cx * 256);
      return true;
    },
    ctx,
  );

  const n = 2 ** r.z;
  const scale = (n * 256) / (2 * HALF);
  const axis = (count: number, origin: number, tile0: number, size: number) => {
    const i0 = new Int32Array(count), f = new Float32Array(count);
    for (let p = 0; p < count; p++) {
      const g = Math.min(size - 1, Math.max(0, ((origin + (p + 0.5) * fs.mPerPx) + HALF) * scale - 0.5 - tile0 * 256));
      i0[p] = Math.min(size - 2, Math.floor(g));
      f[p] = g - i0[p];
    }
    return { i0, f };
  };
  const ax = axis(fs.width, fs.frame.x0, r.x0, mw);
  const ay = axis(fs.height, fs.frame.y0, r.y0, mh);
  const out = new Int16Array(fs.width * fs.height);
  for (let py = 0; py < fs.height; py++) {
    const row0 = ay.i0[py] * mw, row1 = row0 + mw, fy = ay.f[py];
    for (let px = 0; px < fs.width; px++) {
      const x0 = ax.i0[px], fx = ax.f[px];
      const top = mosaic[row0 + x0] * (1 - fx) + mosaic[row0 + x0 + 1] * fx;
      const bot = mosaic[row1 + x0] * (1 - fx) + mosaic[row1 + x0 + 1] * fx;
      out[py * fs.width + px] = Math.round(top * (1 - fy) + bot * fy);
    }
  }
  return out;
}
