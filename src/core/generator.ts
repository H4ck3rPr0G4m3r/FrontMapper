/**
 * TypeScript port of the OpenFront map generator's removal passes
 * (map-generator/map_generator.go: removeSmallIslands, processWater, majorityNeighborType).
 * If this ever disagrees with the Go generator, the Go generator is right.
 */
import { LAND, VOID, WATER, cloneGrid, cropToMultipleOf4, type MapGrid, type Terrain } from './grid';

export const MIN_ISLAND = 30;
export const MIN_LAKE = 200;

export interface Body {
  cells: Int32Array;
  replacement: Terrain;
}

export interface ExportSimulation {
  grid: MapGrid;
  removedIslands: Body[];
  removedLakes: Body[];
  landTiles: number;
}

/** Growable Int32 buffer used as a BFS queue; its contents are also the body's cells. */
class IntBuf {
  data = new Int32Array(1024);
  length = 0;
  push(v: number) {
    if (this.length === this.data.length) {
      const next = new Int32Array(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    this.data[this.length++] = v;
  }
}

/**
 * Flood one 4-connected body of `type` starting at `start`. Discovery order of bodies
 * matches Go (column-major scan) so ties for "largest water body" resolve the same way.
 */
function floodBody(g: MapGrid, start: number, type: number, visited: Uint8Array, buf: IntBuf): number {
  const { width: w, height: h, terrain } = g;
  buf.length = 0;
  visited[start] = 1;
  buf.push(start);
  for (let head = 0; head < buf.length; head++) {
    const i = buf.data[head];
    const x = i % w;
    const y = (i - x) / w;
    if (x > 0) { const j = i - 1; if (!visited[j] && terrain[j] === type) { visited[j] = 1; buf.push(j); } }
    if (x < w - 1) { const j = i + 1; if (!visited[j] && terrain[j] === type) { visited[j] = 1; buf.push(j); } }
    if (y > 0) { const j = i - w; if (!visited[j] && terrain[j] === type) { visited[j] = 1; buf.push(j); } }
    if (y < h - 1) { const j = i + w; if (!visited[j] && terrain[j] === type) { visited[j] = 1; buf.push(j); } }
  }
  return buf.length;
}

/** Majority type among unique outside 4-neighbours; ties: Water > Impassable > Land. */
function majorityNeighbor(g: MapGrid, cells: Int32Array): Terrain {
  const { width: w, height: h, terrain } = g;
  const inBody = new Set<number>();
  for (const c of cells) inBody.add(c);
  const seen = new Set<number>();
  const counts = [0, 0, 0];
  const vote = (j: number) => {
    if (inBody.has(j) || seen.has(j)) return;
    seen.add(j);
    counts[terrain[j]]++;
  };
  for (const i of cells) {
    const x = i % w;
    const y = (i - x) / w;
    if (x > 0) vote(i - 1);
    if (x < w - 1) vote(i + 1);
    if (y > 0) vote(i - w);
    if (y < h - 1) vote(i + w);
  }
  let best: Terrain = WATER;
  let bestCount = counts[WATER];
  if (counts[VOID] > bestCount) { best = VOID; bestCount = counts[VOID]; }
  if (counts[LAND] > bestCount) best = LAND;
  return best;
}

function replace(g: MapGrid, cells: Int32Array, t: Terrain) {
  for (const c of cells) {
    g.terrain[c] = t;
    g.mag[c] = 0;
  }
}

/** Simulate what the generator leaves of `input` (never mutates it). */
export function simulateExport(input: MapGrid): ExportSimulation {
  const g = input.width % 4 || input.height % 4 ? cropToMultipleOf4(input) : cloneGrid(input);
  const { width: w, height: h, terrain } = g;
  const n = w * h;
  const buf = new IntBuf();

  // Pass 1: small land bodies. Islands are never 4-adjacent, so replacement order is irrelevant.
  const removedIslands: Body[] = [];
  let visited = new Uint8Array(n);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      const i = y * w + x;
      if (terrain[i] !== LAND || visited[i]) continue;
      const size = floodBody(g, i, LAND, visited, buf);
      if (size < MIN_ISLAND) removedIslands.push({ cells: buf.data.slice(0, size), replacement: WATER });
    }
  }
  for (const body of removedIslands) {
    body.replacement = majorityNeighbor(g, body.cells);
    replace(g, body.cells, body.replacement);
  }

  // Pass 2: water bodies on the updated terrain. The first-discovered largest body is the ocean.
  visited = new Uint8Array(n);
  const small: { cells: Int32Array; order: number }[] = [];
  let largestSize = -1;
  let largestOrder = -1;
  let order = 0;
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      const i = y * w + x;
      if (terrain[i] !== WATER || visited[i]) continue;
      const size = floodBody(g, i, WATER, visited, buf);
      if (size > largestSize) { largestSize = size; largestOrder = order; }
      if (size < MIN_LAKE) small.push({ cells: buf.data.slice(0, size), order });
      order++;
    }
  }
  const removedLakes: Body[] = [];
  for (const body of small) {
    if (body.order === largestOrder) continue;
    const replacement = majorityNeighbor(g, body.cells);
    removedLakes.push({ cells: body.cells, replacement });
  }
  for (const body of removedLakes) replace(g, body.cells, body.replacement);

  let landTiles = 0;
  for (let i = 0; i < n; i++) if (terrain[i] === LAND) landTiles++;
  return { grid: g, removedIslands, removedLakes, landTiles };
}
