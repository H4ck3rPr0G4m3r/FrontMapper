/// <reference lib="webworker" />
import { generateMap, type GenOpts } from '../core/procgen';

export interface GenerateRequest {
  width: number;
  height: number;
  opts: GenOpts;
}

export type GenerateResponse = { type: 'done'; terrain: Uint8Array; mag: Uint8Array } | { type: 'error'; message: string };

self.onmessage = (e: MessageEvent<GenerateRequest>) => {
  const post = (m: GenerateResponse, t: Transferable[] = []) => (self as unknown as Worker).postMessage(m, t);
  try {
    const { width, height, opts } = e.data;
    const g = generateMap(width, height, opts);
    post({ type: 'done', terrain: g.terrain, mag: g.mag }, [g.terrain.buffer, g.mag.buffer]);
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
