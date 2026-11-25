import { signal } from '@preact/signals';
import type { MapGrid } from '../core/grid';
import type { Nation } from '../core/nations';
import type { RoomsRequest, RoomsResult } from '../workers/rooms.worker';

/** Starting room per nation id, for the nations and map the last check ran on. */
export const spawnRooms = signal<Map<string, { room: number; island: number }> | null>(null);

const DEBOUNCE_MS = 700;

/** Works out each nation's room to grow off the main thread, after nations or the map change. */
export class SpawnRoomClient {
  private worker = new Worker(new URL('../workers/rooms.worker.ts', import.meta.url), { type: 'module' });
  private timer = 0;
  private nextId = 1;
  private pending: { id: number; list: Nation[] } | null = null;

  constructor(private grid: MapGrid) {
    spawnRooms.value = null;
    this.worker.onmessage = (e: MessageEvent<RoomsResult>) => {
      const p = this.pending;
      if (!p || p.id !== e.data.id) return;
      this.pending = null;
      const m = new Map<string, { room: number; island: number }>();
      p.list.forEach((n, k) => m.set(n.id, { room: e.data.room[k], island: e.data.island[k] }));
      spawnRooms.value = m;
    };
  }

  schedule(list: Nation[]) {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.send(list), DEBOUNCE_MS);
  }

  private send(list: Nation[]) {
    if (!list.length) {
      spawnRooms.value = new Map();
      return;
    }
    const id = this.nextId++;
    this.pending = { id, list };
    const req: RoomsRequest = { id, width: this.grid.width, height: this.grid.height, terrain: this.grid.terrain.slice(), points: list.map((n) => ({ x: n.x, y: n.y })) };
    this.worker.postMessage(req, [req.terrain.buffer]);
  }

  dispose() {
    clearTimeout(this.timer);
    this.worker.terminate();
    spawnRooms.value = null;
  }
}
