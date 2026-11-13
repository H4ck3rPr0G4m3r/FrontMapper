import { HALF } from './projection';
import type { Frame } from './types';

export const MAX_TILES = 1024;

/** Smallest zoom whose tile pixels are at least as fine as `mPerPx`, clamped to [0, maxZoom]. */
export function pickZoom(mPerPx: number, maxZoom: number, tileSize: number): number {
  for (let z = 0; z <= maxZoom; z++) if ((2 * HALF) / (2 ** z * tileSize) <= mPerPx * (1 + 1e-9)) return z;
  return maxZoom;
}

export interface TileRange {
  z: number;
  /** Unwrapped tile columns (x1 may exceed 2^z - 1 when the frame crosses the date line). */
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** Wrapped tile columns for URLs, west to east. */
  xs: number[];
}

/** Tiles covering `frame` at zoom `z`, lowering z until at most MAX_TILES are needed. */
export function tileRangeForFrame(frame: Frame, z: number): TileRange {
  for (;;) {
    const n = 2 ** z;
    const t = (v: number) => ((v + HALF) / (2 * HALF)) * n;
    const x0 = Math.floor(t(frame.x0));
    const x1 = Math.max(x0, Math.ceil(t(frame.x1)) - 1);
    const y0 = Math.max(0, Math.floor(t(frame.y0)));
    const y1 = Math.min(n - 1, Math.max(y0, Math.ceil(t(frame.y1)) - 1));
    const cols = Math.min(n, x1 - x0 + 1);
    if (cols * (y1 - y0 + 1) <= MAX_TILES || z === 0) {
      const xs: number[] = [];
      for (let x = x0; x < x0 + cols; x++) xs.push(((x % n) + n) % n);
      return { z, x0, x1: x0 + cols - 1, y0, y1, xs };
    }
    z--;
  }
}

/** Fill a `{z}/{x}/{y}` URL template. */
export const tileUrl = (template: string, z: number, x: number, y: number) =>
  template.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));

export class TileFetchError extends Error {
  constructor(readonly failed: string[], readonly total: number, cause?: unknown) {
    super(`${failed.length} of ${total} map tiles could not be downloaded.`, { cause });
    this.name = 'TileFetchError';
  }
}

export interface FetchTilesOpts {
  fetch: typeof globalThis.fetch;
  signal: AbortSignal;
  retries?: number;
  concurrency?: number;
  /** Base delay before a retry; doubles each attempt. */
  retryDelayMs?: number;
  onProgress?: (done: number, total: number) => void;
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((res, rej) => {
    if (!ms) return res();
    const t = setTimeout(res, ms);
    signal.addEventListener('abort', () => { clearTimeout(t); rej(signal.reason); }, { once: true });
  });

/**
 * Download and decode every URL. Retries each failure, then rejects with TileFetchError
 * listing what is still missing; it never resolves with a gap.
 */
export async function fetchTiles<T>(urls: string[], decode: (b: ArrayBuffer, url: string) => Promise<T> | T, opts: FetchTilesOpts): Promise<T[]> {
  const { fetch, signal, retries = 3, concurrency = 8, retryDelayMs = 400, onProgress } = opts;
  const out = new Array<T>(urls.length);
  const failed: string[] = [];
  let lastError: unknown;
  let next = 0, done = 0;
  onProgress?.(0, urls.length);
  const one = async (url: string): Promise<T> => {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      signal.throwIfAborted();
      if (attempt) await sleep(retryDelayMs * 2 ** (attempt - 1), signal);
      try {
        const r = await fetch(url, { signal });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return await decode(await r.arrayBuffer(), url);
      } catch (e) {
        if (signal.aborted) throw signal.reason;
        lastErr = e;
      }
    }
    throw lastErr;
  };
  const worker = async () => {
    while (next < urls.length) {
      const i = next++;
      try {
        out[i] = await one(urls[i]);
      } catch (e) {
        if (signal.aborted) throw e;
        failed.push(urls[i]);
        lastError = e;
      }
      onProgress?.(++done, urls.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker));
  if (failed.length) throw new TileFetchError(failed, urls.length, lastError);
  return out;
}
