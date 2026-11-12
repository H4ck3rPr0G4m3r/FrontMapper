import { signal } from '@preact/signals';
import type { ExportSimulation } from '../core/generator';
import type { MapGrid, Terrain } from '../core/grid';
import type { Renderer } from '../render/renderer';
import type { AnalyzeRequest, AnalyzeResult } from '../workers/analysis.worker';

export interface Analysis {
  sim: ExportSimulation;
  /** Revision the result belongs to. */
  revision: number;
}

/** Latest finished analysis, or null before the first one. */
export const analysis = signal<Analysis | null>(null);
/** True while edits are newer than `analysis`. */
export const analysisPending = signal(true);

const DEBOUNCE_MS = 600;

/**
 * Runs `simulateExport` off the main thread on a copy of the map, 600 ms after the last
 * change and only once the renderer's segment jobs have drained.
 */
export class AnalysisClient {
  private worker: Worker;
  private timer = 0;
  private nextId = 1;
  private latestSent = 0;
  private revisionFor = new Map<number, number>();

  constructor(private grid: MapGrid, private renderer: () => Renderer | null) {
    this.worker = new Worker(new URL('../workers/analysis.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<AnalyzeResult>) => this.onResult(e.data);
  }

  /** Call after every committed change. */
  schedule(revision: number) {
    analysisPending.value = true;
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.send(revision), DEBOUNCE_MS);
  }

  /** Run now (still waits for pending segment jobs). */
  async flush(revision: number) {
    clearTimeout(this.timer);
    await this.send(revision);
  }

  dispose() {
    clearTimeout(this.timer);
    this.worker.terminate();
  }

  private async send(revision: number) {
    await this.renderer()?.scheduler?.whenIdle();
    const id = this.nextId++;
    this.latestSent = id;
    this.revisionFor.set(id, revision);
    const req: AnalyzeRequest = {
      type: 'analyze',
      id,
      width: this.grid.width,
      height: this.grid.height,
      terrain: this.grid.terrain.slice(),
      mag: this.grid.mag.slice(),
    };
    this.worker.postMessage(req, [req.terrain.buffer, req.mag.buffer]);
  }

  private onResult(r: AnalyzeResult) {
    const revision = this.revisionFor.get(r.id) ?? 0;
    this.revisionFor.delete(r.id);
    if (r.id !== this.latestSent) return; // superseded
    const sim: ExportSimulation = {
      grid: { width: this.grid.width, height: this.grid.height, terrain: r.simTerrain, mag: r.simMag },
      removedIslands: r.islands.map((cells, k) => ({ cells, replacement: r.islandRepl[k] as Terrain })),
      removedLakes: r.lakes.map((cells, k) => ({ cells, replacement: r.lakeRepl[k] as Terrain })),
      landTiles: r.landTiles,
    };
    analysis.value = { sim, revision };
    analysisPending.value = false;
    this.renderer()?.setExportSim(sim);
  }
}
