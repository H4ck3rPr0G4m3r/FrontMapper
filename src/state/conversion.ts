import { signal } from '@preact/signals';
import type { ConvertStep } from '../earth/convert';
import { selectedRegionIds } from '../earth/selectionOps';
import type { ConvertWorkerRequest, ConvertWorkerResponse } from '../workers/convert.worker';
import { newNationId } from '../core/nations';
import { countriesLow, curve, customRegions, earthOps, frameSize, provincesByCountry, restoreEarth } from './earthState';
import { placeByLonLat } from '../earth/earthNations';
import type { ProjectState } from '../core/project';
import { openInEditor, screen } from './session';

export type ConvertStatus =
  | { phase: 'running'; title: string; step: ConvertStep; done: number; total: number; finished: ConvertStep[] }
  | { phase: 'error'; title: string; step: ConvertStep; message: string; failedTiles?: number; totalTiles?: number };

export const convertStatus = signal<ConvertStatus | null>(null);

/** The Earth map being re-converted (opened from the editor), or null for a new map. */
export const reconverting = signal<ProjectState | null>(null);

/** Leave the editor for the picker with this map's selection, to change it and convert again. */
export function editOnEarth(s: ProjectState) {
  if (!s.earth) return;
  restoreEarth(s.earth);
  reconverting.value = s;
  screen.value = 'earth';
}

/** Back out of the picker: to the map being re-converted if there is one, else the start screen. */
export function leavePicker() {
  cancelConvert();
  const s = reconverting.value;
  reconverting.value = null;
  // Regions grouped in the picker need no new terrain, so they are kept without converting.
  const regions = customRegions.value;
  if (s) openInEditor(s.earth ? { ...s, earth: { ...s.earth, regions: regions.length ? regions : undefined } } : s);
  else screen.value = 'start';
}

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
  const regions = customRegions.value;
  const prev = reconverting.value;
  const title = prev ? prev.meta.name.trim() || selectionTitle() : selectionTitle();
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
      const { grid } = m.result;
      const earth = { ops: req.ops, frameSize: req.fs, curve: req.curve, regions: regions.length ? regions : undefined };
      reconverting.value = null;
      // Re-converting keeps the map's identity, info and nations; Earth nations follow their lon/lat.
      if (prev) openInEditor({ id: prev.id, grid, meta: prev.meta, nations: placeByLonLat(prev.nations, req.fs), earth, accepted: prev.accepted });
      else openInEditor({ id: newNationId(), grid, meta: { name: title, categories: [] }, nations: [], earth });
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
