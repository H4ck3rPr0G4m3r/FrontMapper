import { signal } from '@preact/signals';
import type { ExportSimulation } from '../core/generator';
import type { MapGrid, Terrain } from '../core/grid';
import type { Renderer } from '../render/renderer';
import type { AnalyzeRequest, AnalyzeResult } from '../workers/analysis.worker';

export interface Analysis {
  sim: ExportSimulation;
  /** Revision the result belongs to. */
  revision: number;
  /** Pixels of water, plains, highlands, mountains and void (see TERRAIN_KINDS). */
  counts: number[];
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
  /** Request the worker is running, if any. Only one runs at a time. */
  private inFlight: { id: number; revision: number } | null = null;
  /** Newest revision that arrived while a request was running; sent when it finishes. */
  private queued: number | null = null;

  constructor(
    private grid: MapGrid,
    private renderer: () => Renderer | null,
    makeWorker: () => Worker = () => new Worker(new URL('../workers/analysis.worker.ts', import.meta.url), { type: 'module' }),
  ) {
    this.worker = makeWorker();
    this.worker.onmessage = (e: MessageEvent<AnalyzeResult>) => this.onResult(e.data);
    this.worker.onerror = () => {
      this.inFlight = null;
      this.queued = null;
      analysisPending.value = false;
    };
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
    if (this.inFlight) {
      this.queued = revision;
      return;
    }
    const id = this.nextId++;
    this.inFlight = { id, revision };
    await this.renderer()?.scheduler?.whenIdle();
    if (this.inFlight?.id !== id) return;
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
    if (this.inFlight?.id !== r.id) return;
    const { revision } = this.inFlight;
    this.inFlight = null;
    const next = this.queued;
    this.queued = null;
    const sim: ExportSimulation = {
      grid: { width: this.grid.width, height: this.grid.height, terrain: r.simTerrain, mag: r.simMag },
      removedIslands: r.islands.map((cells, k) => ({ cells, replacement: r.islandRepl[k] as Terrain })),
      removedLakes: r.lakes.map((cells, k) => ({ cells, replacement: r.lakeRepl[k] as Terrain })),
      landTiles: r.landTiles,
    };
    analysis.value = { sim, revision, counts: r.counts };
    this.renderer()?.setExportSim(sim);
    if (next !== null) void this.send(next);
    else analysisPending.value = false;
  }
}
