import { describe, it, expect } from 'vitest';
import { LAND, VOID, WATER, createGrid, type MapGrid } from '../../src/core/grid';
import { deriveRect, DEPTH_CAP } from '../../src/core/derive';
import { tileColor, elevationColor } from '../../src/core/colors';

/** Straightforward whole-map reference: shore flags, BFS depth from shore water, capped, void override. */
function reference(g: MapGrid) {
  const { width: w, height: h, terrain: t } = g;
  const n = w * h;
  const shore = new Uint8Array(n);
  const depth = new Uint8Array(n).fill(DEPTH_CAP);
  const dist = new Int32Array(n).fill(-1);
  const q: number[] = [];
  const nb = (i: number) => {
    const x = i % w, y = Math.floor(i / w), out: number[] = [];
    if (x > 0) out.push(i - 1);
    if (x < w - 1) out.push(i + 1);
    if (y > 0) out.push(i - w);
    if (y < h - 1) out.push(i + w);
    return out;
  };
  for (let i = 0; i < n; i++) {
    if (t[i] === LAND && nb(i).some((j) => t[j] === WATER)) shore[i] = 1;
    if (t[i] === WATER && nb(i).some((j) => t[j] === LAND)) { shore[i] = 1; dist[i] = 0; q.push(i); }
  }
  for (let k = 0; k < q.length; k++) {
    const i = q[k];
    for (const j of nb(i)) if (t[j] === WATER && dist[j] < 0) { dist[j] = dist[i] + 1; q.push(j); }
  }
  for (let i = 0; i < n; i++) {
    if (t[i] !== WATER) { depth[i] = 0; continue; }
    if (dist[i] >= 0) depth[i] = Math.min(dist[i], DEPTH_CAP);
    if (nb(i).some((j) => t[j] === VOID)) depth[i] = DEPTH_CAP;
  }
  return { shore, depth };
}

function randomGrid(w: number, h: number, seed: number): MapGrid {
  const g = createGrid(w, h);
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 2 ** 32);
  for (let k = 0; k < 60; k++) {
    const cx = rnd() * w, cy = rnd() * h, r = 2 + rnd() * 25, t = rnd() < 0.85 ? LAND : VOID;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++)
      if ((x - cx) ** 2 + (y - cy) ** 2 < r * r) { g.terrain[y * w + x] = t; g.mag[y * w + x] = t === LAND ? 5 : 0; }
  }
  return g;
}

describe('deriveRect', () => {
  it('quadrant-by-quadrant derivation equals the whole-map reference', () => {
    const g = randomGrid(300, 300, 7);
    const shore = new Uint8Array(g.width * g.height);
    const depth = new Uint8Array(g.width * g.height);
    for (const [x, y] of [[0, 0], [150, 0], [0, 150], [150, 150]])
      deriveRect(g, { x, y, w: 150, h: 150 }, shore, depth);
    const ref = reference(g);
    expect(shore).toEqual(ref.shore);
    expect(depth).toEqual(ref.depth);
  });

  it('gives water next to void depth 20', () => {
    const g = createGrid(10, 10);
    g.terrain[5 * 10 + 5] = VOID;
    g.terrain[0] = LAND;
    const shore = new Uint8Array(100), depth = new Uint8Array(100);
    deriveRect(g, { x: 0, y: 0, w: 10, h: 10 }, shore, depth);
    expect(depth[5 * 10 + 4]).toBe(20);
    expect(depth[1]).toBe(0);
    expect(shore[1]).toBe(1);
    expect(depth[2]).toBe(1);
  });
});

describe('colours', () => {
  it('matches the generator thumbnail palette', () => {
    expect(tileColor(WATER, 0, true, 0)).toEqual([100, 143, 255]);
    expect(tileColor(WATER, 0, false, 0)).toEqual([71, 133, 181]);
    expect(tileColor(WATER, 0, false, 20)).toEqual([61, 123, 171]);
    expect(tileColor(LAND, 5, true, 0)).toEqual([204, 203, 158]);
    expect(tileColor(LAND, 5, false, 0)).toEqual([190, 210, 138]);
    expect(tileColor(LAND, 15, false, 0)).toEqual([230, 213, 168]);
    expect(tileColor(LAND, 25, false, 0)).toEqual([240, 240, 240]);
    expect(tileColor(VOID, 0, false, 0)).toEqual([8, 8, 8]);
  });

  it('elevation view is greyscale by magnitude', () => {
    expect(elevationColor(WATER, 0)).toEqual([20, 26, 34]);
    expect(elevationColor(VOID, 0)).toEqual([0, 0, 0]);
    expect(elevationColor(LAND, 0)).toEqual([60, 60, 60]);
    expect(elevationColor(LAND, 30)).toEqual([255, 255, 255]);
  });
});
