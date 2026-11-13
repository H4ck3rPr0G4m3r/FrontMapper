import { describe, expect, it } from 'vitest';
import { createGrid } from '../../src/core/grid';
import { analysis, AnalysisClient, analysisPending } from '../../src/state/analysis';
import type { AnalyzeRequest, AnalyzeResult } from '../../src/workers/analysis.worker';

class FakeWorker {
  posted: AnalyzeRequest[] = [];
  onmessage: ((e: MessageEvent<AnalyzeResult>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  postMessage(m: AnalyzeRequest) { this.posted.push(m); }
  terminate() {}
  answer(id: number) {
    this.onmessage!({ data: { type: 'result', id, islands: [], islandRepl: new Uint8Array(), lakes: [], lakeRepl: new Uint8Array(), landTiles: 0, simTerrain: new Uint8Array(16), simMag: new Uint8Array(16) } } as unknown as MessageEvent<AnalyzeResult>);
  }
}

const tick = () => new Promise((r) => setTimeout(r));

describe('AnalysisClient', () => {
  it('keeps one analysis in flight and sends only the newest edits after it', async () => {
    const w = new FakeWorker();
    const c = new AnalysisClient(createGrid(4, 4), () => null, () => w as unknown as Worker);
    await c.flush(1);
    await c.flush(2);
    await c.flush(3);
    expect(w.posted).toHaveLength(1);
    w.answer(w.posted[0].id);
    await tick();
    expect(w.posted).toHaveLength(2); // revision 3, not 2 and 3
    expect(analysisPending.value).toBe(true);
    w.answer(w.posted[1].id);
    await tick();
    expect(analysisPending.value).toBe(false);
    expect(analysis.value?.revision).toBe(3);
  });

  it('does not stay "checking" forever when the worker crashes', async () => {
    const w = new FakeWorker();
    const c = new AnalysisClient(createGrid(4, 4), () => null, () => w as unknown as Worker);
    await c.flush(1);
    w.onerror!({ message: 'boom' } as ErrorEvent);
    expect(analysisPending.value).toBe(false);
    await c.flush(2);
    expect(w.posted).toHaveLength(2);
  });
});
