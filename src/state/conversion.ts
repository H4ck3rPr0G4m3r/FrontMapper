import { signal } from '@preact/signals';
import type { ConvertStep } from '../earth/convert';
import { selectedRegionIds } from '../earth/selectionOps';
import type { ConvertWorkerRequest, ConvertWorkerResponse } from '../workers/convert.worker';
import { newNationId } from '../core/nations';
import { countriesLow, curve, earthOps, frameSize, provincesByCountry } from './earthState';
import { openInEditor } from './session';

export type ConvertStatus =
  | { phase: 'running'; title: string; step: ConvertStep; done: number; total: number; finished: ConvertStep[] }
  | { phase: 'error'; title: string; step: ConvertStep; message: string; failedTiles?: number; totalTiles?: number };

export const convertStatus = signal<ConvertStatus | null>(null);

/** Country of every land pixel from the last conversion (nations from Earth use it). */
export const lastRegions = signal<{ regionGrid: Int16Array; regionIndex: string[]; width: number; height: number } | null>(null);

let worker: Worker | null = null;

/** Map name from the selection: one or two region names, else the first one's "region". */
export function selectionTitle(): string {
  const ids = selectedRegionIds(earthOps.value);
  const names: string[] = [];
  for (const id of ids.country) names.push(countriesLow.value?.features.find((f) => f.properties.id === id)?.properties.name ?? id);
  for (const id of ids.province)
    for (const fc of provincesByCountry.value.values()) {
      const f = fc.features.find((p) => p.properties.id === id);
      if (f) names.push(f.properties.name);
    }
  if (!names.length) return 'Untitled map';
  return names.length <= 2 ? names.join(' & ') : `${names[0]} region`;
}

export function startConvert() {
  const fs = frameSize.value;
  if (!fs) return;
  cancelConvert();
  const req = { fs, ops: earthOps.value, curve: curve.value };
  const title = selectionTitle();
  const w = (worker = new Worker(new URL('../workers/convert.worker.ts', import.meta.url), { type: 'module' }));
  const finished: ConvertStep[] = [];
  convertStatus.value = { phase: 'running', title, step: 'Coastlines', done: 0, total: 0, finished };
  w.onmessage = (e: MessageEvent<ConvertWorkerResponse>) => {
    if (w !== worker) return;
    const m = e.data;
    const cur = convertStatus.value;
    if (m.type === 'progress') {
      if (cur?.phase === 'running' && cur.step !== m.step && !finished.includes(cur.step)) finished.push(cur.step);
      convertStatus.value = { phase: 'running', title, step: m.step, done: m.done, total: m.total, finished: [...finished] };
    } else if (m.type === 'done') {
      stop();
      convertStatus.value = null;
      const { grid, regionGrid, regionIndex } = m.result;
      lastRegions.value = { regionGrid, regionIndex, width: grid.width, height: grid.height };
      openInEditor({ id: newNationId(), grid, meta: { name: title, categories: [] }, nations: [], earth: { ops: req.ops, frameSize: req.fs, curve: req.curve } });
    } else {
      stop();
      if (m.aborted) return;
      convertStatus.value = { phase: 'error', title, step: cur?.step ?? 'Coastlines', message: m.message, failedTiles: m.failedTiles, totalTiles: m.totalTiles };
    }
  };
  w.onerror = (e) => {
    if (w !== worker) return;
    stop();
    convertStatus.value = { phase: 'error', title, step: convertStatus.value?.step ?? 'Coastlines', message: e.message || 'The converter stopped unexpectedly.' };
  };
  w.postMessage({ type: 'start', req } satisfies ConvertWorkerRequest);
}

function stop() {
  worker?.terminate();
  worker = null;
}

/** Stop a running conversion (or dismiss its error); the picker keeps its state. */
export function cancelConvert() {
  if (worker) worker.postMessage({ type: 'abort' } satisfies ConvertWorkerRequest);
  stop();
  convertStatus.value = null;
}
