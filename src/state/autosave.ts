import { get, set, del } from 'idb-keyval';
import { saveProject, openProject, type ProjectState } from '../core/project';

export interface RecentEntry {
  id: string;
  name: string;
  width: number;
  height: number;
  updatedAt: number;
}

const RECENT_KEY = 'recent';
const MAX_RECENT = 10;

export async function listRecent(): Promise<RecentEntry[]> {
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
    this.writing = this.writing.then(() => this.write()).catch(() => undefined);
    return this.writing;
  }

  dispose() {
    clearTimeout(this.timer);
  }

  private async write() {
    const s = this.snapshot();
    if (!s) return;
    await set(`autosave:${s.id}`, saveProject(s));
    const entry: RecentEntry = { id: s.id, name: s.meta.name || 'Untitled map', width: s.grid.width, height: s.grid.height, updatedAt: Date.now() };
    const recent = (await listRecent()).filter((r) => r.id !== s.id);
    await set(RECENT_KEY, [entry, ...recent].slice(0, MAX_RECENT));
  }
}
