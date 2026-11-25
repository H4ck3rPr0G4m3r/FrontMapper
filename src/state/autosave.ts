import { get, set, del } from 'idb-keyval';
import { signal } from '@preact/signals';
import { openProject, saveProjectAsync, type ProjectState } from '../core/project';
import { deleteAllCheckpoints } from './checkpoints';

export interface RecentEntry {
  id: string;
  name: string;
  width: number;
  height: number;
  updatedAt: number;
}

const RECENT_KEY = 'recent';

/** Why the last save to this browser failed, or null when it worked. */
export const autosaveError = signal<string | null>(null);
const MAX_RECENT = 10;

/** The write in flight, if any. Listing waits for it so a map closed a moment ago shows up to date. */
let lastWrite: Promise<void> = Promise.resolve();

export async function listRecent(): Promise<RecentEntry[]> {
  await lastWrite;
  return readRecent();
}

async function readRecent(): Promise<RecentEntry[]> {
  try {
    return ((await get(RECENT_KEY)) as RecentEntry[] | undefined) ?? [];
  } catch {
    return [];
  }
}

export async function loadAutosave(id: string): Promise<ProjectState | null> {
  try {
    const bytes = (await get(`autosave:${id}`)) as Uint8Array | undefined;
    return bytes ? openProject(bytes) : null;
  } catch {
    return null;
  }
}

export async function forgetAutosave(id: string) {
  await del(`autosave:${id}`);
  await deleteAllCheckpoints(id).catch(() => undefined);
  await del(`refimage:${id}`).catch(() => undefined);
  await set(RECENT_KEY, (await listRecent()).filter((r) => r.id !== id));
}

/** Debounced writer: one IndexedDB write at a time, the latest state wins. */
export class AutoSaver {
  private timer = 0;
  private writing: Promise<void> = Promise.resolve();

  constructor(private snapshot: () => ProjectState | null, private delayMs = 2000) {}

  schedule() {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.flush(), this.delayMs);
  }

  flush(): Promise<void> {
    clearTimeout(this.timer);
    // Snapshot now: when the editor is closing, the project is gone by the time the write runs.
    const s = this.snapshot();
    if (!s) return this.writing;
    const bytes = saveProjectAsync(s); // copies the map now; compresses when its turn comes
    this.writing = this.writing
      .then(() => this.write(s, bytes))
      .then(
        () => void (autosaveError.value = null),
        (e) => void (autosaveError.value = e instanceof Error ? e.message : String(e)),
      );
    lastWrite = this.writing;
    return this.writing;
  }

  dispose() {
    clearTimeout(this.timer);
  }

  private async write(s: ProjectState, bytes: () => Promise<Uint8Array>) {
    await set(`autosave:${s.id}`, await bytes());
    const entry: RecentEntry = { id: s.id, name: s.meta.name || 'Untitled map', width: s.grid.width, height: s.grid.height, updatedAt: Date.now() };
    const recent = [entry, ...(await readRecent()).filter((r) => r.id !== s.id)];
    await set(RECENT_KEY, recent.slice(0, MAX_RECENT));
    // Maps that fall off the list would otherwise keep their saved copy forever.
    for (const old of recent.slice(MAX_RECENT)) await del(`autosave:${old.id}`).catch(() => undefined);
  }
}
