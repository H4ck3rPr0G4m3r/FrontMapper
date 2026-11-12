import { signal } from '@preact/signals';
import { deriveIds } from '../core/info';
import { saveProject, type ProjectState } from '../core/project';
import { download } from '../ui/download';
import type { ExportRequest, ExportResponse } from '../workers/export.worker';
import pkg from '../../package.json';
import type { EditorController } from './controller';
import { busy, meta, nations, project, sources } from './store';

export const TOOL_VERSION: string = pkg.version;

export type ExportState = { phase: 'idle' } | { phase: 'waiting' } | { phase: 'exporting' } | { phase: 'error'; message: string };
export const exportState = signal<ExportState>({ phase: 'idle' });

/** Snapshot of everything a project file or autosave needs. */
export function currentProjectState(controller: EditorController | null): ProjectState | null {
  const p = project.value;
  if (!p) return null;
  const cam = controller?.renderer?.camera;
  return {
    id: p.id,
    grid: p.grid,
    meta: meta.value,
    nations: nations.value,
    earth: p.earth,
    camera: cam ? { ...cam } : p.camera,
  };
}

export function saveProjectFile(controller: EditorController | null) {
  const s = currentProjectState(controller);
  if (!s) return;
  download(saveProject(s), `${deriveIds(s.meta.name).folder || 'map'}.frontmap`);
}

/** Wait for pending segment jobs, then build the zip in a worker and download it. */
export async function exportMap(controller: EditorController | null) {
  const p = project.value;
  if (!p || exportState.value.phase === 'exporting') return;
  exportState.value = { phase: 'waiting' };
  await controller?.renderer?.scheduler?.whenIdle();
  while (busy.value) await new Promise((r) => setTimeout(r, 50));
  exportState.value = { phase: 'exporting' };
  const worker = new Worker(new URL('../workers/export.worker.ts', import.meta.url), { type: 'module' });
  const req: ExportRequest = {
    type: 'export',
    grid: { width: p.grid.width, height: p.grid.height, terrain: p.grid.terrain.slice(), mag: p.grid.mag.slice() },
    meta: meta.value,
    nations: nations.value,
    sources: sources.value,
    toolVersion: TOOL_VERSION,
  };
  try {
    const res = await new Promise<ExportResponse>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<ExportResponse>) => resolve(e.data);
      worker.onerror = (e) => reject(new Error(e.message || 'Export failed.'));
      worker.postMessage(req, [req.grid.terrain.buffer, req.grid.mag.buffer]);
    });
    if (res.type === 'error') throw new Error(res.message);
    download(res.zip, `${deriveIds(meta.value.name).folder}.zip`, 'application/zip');
    exportState.value = { phase: 'idle' };
  } catch (err) {
    exportState.value = { phase: 'error', message: err instanceof Error ? err.message : String(err) };
  } finally {
    worker.terminate();
  }
}
