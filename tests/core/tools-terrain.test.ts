import { describe, it, expect } from 'vitest';
import { LAND, VOID, WATER, createGrid } from '../../src/core/grid';
import { fbm } from '../../src/core/noise';
import { raiseAt, smoothAt } from '../../src/core/tools/sculpt';
import { textureAt, textureRect } from '../../src/core/tools/texture';

describe('fbm', () => {
  it('is deterministic per seed and stays in [-1, 1]', () => {
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < 5000; i++) {
      const v = fbm(42, i * 1.37, i * 0.71, 16);
      min = Math.min(min, v);
      max = Math.max(max, v);
      expect(fbm(42, i * 1.37, i * 0.71, 16)).toBe(v);
    }
    expect(min).toBeGreaterThanOrEqual(-1);
    expect(max).toBeLessThanOrEqual(1);
    expect(max - min).toBeGreaterThan(0.5);
    expect(fbm(1, 10, 10, 16)).not.toBe(fbm(2, 10, 10, 16));
  });
});

describe('raiseAt', () => {
  it('clamps at 30 and never touches water', () => {
    const g = createGrid(20, 20, LAND);
    g.mag.fill(28);
    g.terrain[10 * 20 + 11] = WATER;
    g.mag[10 * 20 + 11] = 0;
    raiseAt(g, null, null, 10, 10, 7, 10);
    expect(g.mag[10 * 20 + 10]).toBe(30);
    expect(g.terrain[10 * 20 + 11]).toBe(WATER);
    expect(g.mag[10 * 20 + 11]).toBe(0);
  });

  it('lowers with a negative amount and falls off toward the edge', () => {
    const g = createGrid(20, 20, LAND);
    g.mag.fill(20);
    raiseAt(g, null, null, 10, 10, 9, -10);
    expect(g.mag[10 * 20 + 10]).toBe(10);
    expect(g.mag[10 * 20 + 14]).toBeGreaterThan(10);
  });
});

describe('smoothAt', () => {
  it('pulls a 0/30 checkerboard toward 15', () => {
    const g = createGrid(30, 30, LAND);
    for (let y = 0; y < 30; y++) for (let x = 0; x < 30; x++) g.mag[y * 30 + x] = (x + y) % 2 ? 30 : 0;
    for (let k = 0; k < 6; k++) smoothAt(g, null, null, 15, 15, 15);
    for (const [x, y] of [[15, 15], [14, 15], [16, 13]]) expect(Math.abs(g.mag[y * 30 + x] - 15)).toBeLessThanOrEqual(2);
  });
});

describe('texture', () => {
  it('elevation mode never changes terrain types', () => {
    const g = createGrid(128, 64);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) { g.terrain[y * 128 + x] = LAND; g.mag[y * 128 + x] = 10; }
    const before = g.terrain.slice();
    textureRect(g, null, { x: 0, y: 0, w: 128, h: 64 }, { mode: 'elevation', strength: 1, grain: 8, seed: 3 });
    expect(g.terrain).toEqual(before);
    let changed = 0;
    for (let i = 0; i < g.mag.length; i++) if (g.terrain[i] === LAND && g.mag[i] !== 10) changed++;
    expect(changed).toBeGreaterThan(100);
  });

  it('coast mode moves the coastline both ways and never changes void', () => {
    const g = createGrid(128, 64);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) { g.terrain[y * 128 + x] = LAND; g.mag[y * 128 + x] = 5; }
    for (let y = 20; y < 30; y++) for (let x = 60; x < 70; x++) g.terrain[y * 128 + x] = VOID;
    const before = g.terrain.slice();
    textureRect(g, null, { x: 0, y: 0, w: 128, h: 64 }, { mode: 'coast+elevation', strength: 1, grain: 8, seed: 11 });
    let toWater = 0, toLand = 0;
    for (let i = 0; i < before.length; i++) {
      if (before[i] === VOID || g.terrain[i] === VOID) expect(g.terrain[i]).toBe(before[i]);
      if (before[i] === LAND && g.terrain[i] === WATER) toWater++;
      if (before[i] === WATER && g.terrain[i] === LAND) toLand++;
    }
    expect(toWater).toBeGreaterThan(0);
    expect(toLand).toBeGreaterThan(0);
    for (let i = 0; i < g.terrain.length; i++) if (g.terrain[i] === WATER) expect(g.mag[i]).toBe(0);
  });

  it('only touches cells inside the given rect or brush', () => {
    const g = createGrid(64, 64, LAND);
    g.mag.fill(15);
    textureRect(g, null, { x: 10, y: 10, w: 20, h: 20 }, { mode: 'elevation', strength: 1, grain: 4, seed: 5 });
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const inside = x >= 10 && x < 30 && y >= 10 && y < 30;
      if (!inside) expect(g.mag[y * 64 + x]).toBe(15);
    }
    const g2 = createGrid(64, 64, LAND);
    g2.mag.fill(15);
    textureAt(g2, null, { x: 0, y: 0, w: 32, h: 64 }, 31, 31, 9, { mode: 'elevation', strength: 1, grain: 4, seed: 5 });
    for (let y = 0; y < 64; y++) for (let x = 32; x < 64; x++) expect(g2.mag[y * 64 + x]).toBe(15);
  });
});
