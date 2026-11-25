import { del, get, set } from 'idb-keyval';
import { signal } from '@preact/signals';
import { openProject, saveProjectAsync, type ProjectState } from '../core/project';
import { newNationId } from '../core/nations';

export interface Checkpoint {
  id: string;
  name: string;
  createdAt: number;
  width: number;
  height: number;
}

const MAX = 20;
const listKey = (projectId: string) => `checkpoints:${projectId}`;
const dataKey = (id: string) => `checkpoint:${id}`;

/** Checkpoints of the open map, newest first (null while loading). */
export const checkpoints = signal<Checkpoint[] | null>(null);
export const checkpointError = signal<string | null>(null);

async function read(projectId: string): Promise<Checkpoint[]> {
  return ((await get(listKey(projectId))) as Checkpoint[] | undefined) ?? [];
}

export async function loadCheckpoints(projectId: string) {
  try {
    checkpoints.value = await read(projectId);
  } catch {
    checkpoints.value = [];
  }
}

/** Keep a named copy of the map as it is now, in this browser. */
export async function saveCheckpoint(s: ProjectState, name: string): Promise<void> {
  const entry: Checkpoint = { id: newNationId(), name: name.trim() || defaultName(), createdAt: Date.now(), width: s.grid.width, height: s.grid.height };
  try {
    await set(dataKey(entry.id), await saveProjectAsync(s)());
    const list = [entry, ...(await read(s.id))];
    for (const old of list.slice(MAX)) await del(dataKey(old.id)).catch(() => undefined);
    await set(listKey(s.id), list.slice(0, MAX));
    checkpoints.value = list.slice(0, MAX);
    checkpointError.value = null;
  } catch (e) {
    checkpointError.value = `Could not save the checkpoint: ${e instanceof Error ? e.message : String(e)}`;
    throw e;
  }
}

/** The map as it was at a checkpoint (same project id), or null if it is gone. */
export async function readCheckpoint(id: string): Promise<ProjectState | null> {
  const bytes = (await get(dataKey(id))) as Uint8Array | undefined;
  return bytes ? openProject(bytes) : null;
}

export async function deleteCheckpoint(projectId: string, id: string) {
  await del(dataKey(id));
  const list = (await read(projectId)).filter((c) => c.id !== id);
  await set(listKey(projectId), list);
  checkpoints.value = list;
}

/** Forget every checkpoint of a map (when it is removed from Recent). */
export async function deleteAllCheckpoints(projectId: string) {
  for (const c of await read(projectId)) await del(dataKey(c.id)).catch(() => undefined);
  await del(listKey(projectId));
}

function defaultName() {
  return new Date().toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
