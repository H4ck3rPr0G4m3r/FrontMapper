/// <reference lib="webworker" />
import { simulateExport } from '../core/generator';

export interface AnalyzeRequest {
  type: 'analyze';
  id: number;
  width: number;
  height: number;
  terrain: Uint8Array;
  mag: Uint8Array;
}

export interface AnalyzeResult {
  type: 'result';
  id: number;
  islands: Int32Array[];
  islandRepl: Uint8Array;
  lakes: Int32Array[];
  lakeRepl: Uint8Array;
  landTiles: number;
  simTerrain: Uint8Array;
  simMag: Uint8Array;
}

self.onmessage = (e: MessageEvent<AnalyzeRequest>) => {
  const { id, width, height, terrain, mag } = e.data;
  const sim = simulateExport({ width, height, terrain, mag });
  const msg: AnalyzeResult = {
    type: 'result',
    id,
    islands: sim.removedIslands.map((b) => b.cells),
    islandRepl: Uint8Array.from(sim.removedIslands.map((b) => b.replacement)),
    lakes: sim.removedLakes.map((b) => b.cells),
    lakeRepl: Uint8Array.from(sim.removedLakes.map((b) => b.replacement)),
    landTiles: sim.landTiles,
    simTerrain: sim.grid.terrain,
    simMag: sim.grid.mag,
  };
  const transfer = [...msg.islands, ...msg.lakes, msg.simTerrain, msg.simMag].map((a) => a.buffer as ArrayBuffer);
  (self as unknown as Worker).postMessage(msg, transfer);
};
