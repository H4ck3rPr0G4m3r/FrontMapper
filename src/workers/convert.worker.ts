/// <reference lib="webworker" />
import { convert, type ConvertRequest, type ConvertResult, type ConvertStep } from '../earth/convert';
import { TileFetchError } from '../earth/tiles';

export type ConvertWorkerRequest = { type: 'start'; req: ConvertRequest } | { type: 'abort' };
export type ConvertWorkerResponse =
  | { type: 'progress'; step: ConvertStep; done: number; total: number }
  | { type: 'done'; result: ConvertResult }
  | { type: 'error'; message: string; aborted: boolean; failedTiles?: number; totalTiles?: number };

const post = (m: ConvertWorkerResponse, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);
let ctrl: AbortController | null = null;

self.onmessage = async (e: MessageEvent<ConvertWorkerRequest>) => {
  if (e.data.type === 'abort') {
    ctrl?.abort();
    return;
  }
  const c = (ctrl = new AbortController());
  try {
    const result = await convert(e.data.req, { fetch: self.fetch.bind(self), signal: c.signal }, (step, done, total) => post({ type: 'progress', step, done, total }));
    post({ type: 'done', result }, [result.grid.terrain.buffer, result.grid.mag.buffer, result.regionGrid.buffer] as ArrayBuffer[]);
  } catch (err) {
    post({
      type: 'error',
      aborted: c.signal.aborted,
      message: err instanceof Error ? err.message : String(err),
      ...(err instanceof TileFetchError ? { failedTiles: err.failed.length, totalTiles: err.total } : {}),
    });
  }
};
