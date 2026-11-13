import { describe, it, expect } from 'vitest';
import { WATER, LAND, VOID, createGrid, cropToMultipleOf4, type MapGrid } from '../../src/core/grid';
import { encodeRGB, decodeRGBA, encodeImagePng, decodeImagePng } from '../../src/core/encode';

function px(rgb: Uint8Array, i: number) {
  return [rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]];
}

describe('encodeRGB', () => {
  it('encodes water, void and land per OpenFront blue-channel rules', () => {
    const g = createGrid(4, 1);
    g.terrain.set([WATER, VOID, LAND, LAND]);
    g.mag.set([0, 0, 0, 30]);
    const rgb = encodeRGB(g);
    expect(px(rgb, 0)).toEqual([0, 0, 106]);
    expect(px(rgb, 1)).toEqual([0, 0, 0]);
    expect(px(rgb, 2)).toEqual([140, 140, 140]);
    expect(px(rgb, 3)).toEqual([200, 200, 200]);
  });
});

describe('decodeRGBA', () => {
  it('applies the generator decode rules', () => {
    const rgba = new Uint8Array([
      50, 50, 50, 10, //   alpha < 20 -> water
      200, 10, 106, 255, // blue 106 -> water
      0, 0, 0, 255, //     black -> void
      141, 141, 141, 255, // land mag ceil(0.5) = 1
      230, 230, 230, 255, // clamp -> mag 30
      100, 100, 100, 255, // clamp -> mag 0
    ]);
    const g = decodeRGBA(rgba, 6, 1);
    expect(Array.from(g.terrain)).toEqual([WATER, WATER, VOID, LAND, LAND, LAND]);
    expect(Array.from(g.mag)).toEqual([0, 0, 0, 1, 30, 0]);
  });
});

describe('PNG round trip', () => {
  it('decodeImagePng(encodeImagePng(g)) equals g', () => {
    const g = createGrid(64, 48);
    let s = 12345;
    const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 2 ** 32);
    for (let i = 0; i < g.terrain.length; i++) {
      const t = rnd() < 0.4 ? WATER : rnd() < 0.15 ? VOID : LAND;
      g.terrain[i] = t;
      g.mag[i] = t === LAND ? Math.floor(rnd() * 31) : 0;
    }
    const back = decodeImagePng(encodeImagePng(g));
    expect(back.width).toBe(64);
    expect(back.height).toBe(48);
    expect(back.terrain).toEqual(g.terrain);
    expect(back.mag).toEqual(g.mag);
  });
});

describe('cropToMultipleOf4', () => {
  it('crops 103x58 to 100x56 keeping the top-left', () => {
    const g: MapGrid = createGrid(103, 58);
    g.terrain[0] = LAND;
    g.terrain[57 * 103 + 102] = LAND; // will be cropped away
    g.terrain[55 * 103 + 99] = VOID; // last kept pixel
    const c = cropToMultipleOf4(g);
    expect([c.width, c.height]).toEqual([100, 56]);
    expect(c.terrain[0]).toBe(LAND);
    expect(c.terrain[55 * 100 + 99]).toBe(VOID);
    expect(c.terrain.length).toBe(5600);
  });
});
