/// <reference lib="webworker" />
import { spawnRoom } from '../core/spawnRoom';

export interface RoomsRequest {
  id: number;
  width: number;
  height: number;
  terrain: Uint8Array;
  points: { x: number; y: number }[];
}

export interface RoomsResult {
  id: number;
  room: Int32Array;
  island: Int32Array;
}

self.onmessage = (e: MessageEvent<RoomsRequest>) => {
  const { id, width, height, terrain, points } = e.data;
  const r = spawnRoom({ width, height, terrain, mag: new Uint8Array(0) }, points);
  const msg: RoomsResult = { id, room: r.room, island: r.island };
  (self as unknown as Worker).postMessage(msg, [r.room.buffer, r.island.buffer]);
};
