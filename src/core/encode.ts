import { decode, encode } from 'fast-png';
import { LAND, VOID, WATER, createGrid, type MapGrid } from './grid';

const WATER_BLUE = 106;

/** RGB bytes for `image.png`: water rgb(0,0,106), void rgb(0,0,0), land grey 140 + 2 * mag. */
export function encodeRGB(g: MapGrid): Uint8Array {
  const n = g.width * g.height;
  const out = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) {
    const t = g.terrain[i];
    const o = i * 3;
    if (t === WATER) {
      out[o + 2] = WATER_BLUE;
    } else if (t === LAND) {
      const b = 140 + 2 * g.mag[i];
      out[o] = b;
      out[o + 1] = b;
      out[o + 2] = b;
    } // VOID stays 0,0,0
  }
  return out;
}

/** Decode RGBA pixels with the generator's rules (see map_generator.go GenerateMap). */
export function decodeRGBA(rgba: Uint8Array, width: number, height: number): MapGrid {
  const g = createGrid(width, height);
  const n = width * height;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const r = rgba[o], gr = rgba[o + 1], b = rgba[o + 2], a = rgba[o + 3];
    if (a < 20 || b === WATER_BLUE) {
      g.terrain[i] = WATER;
    } else if (r === 0 && gr === 0 && b === 0) {
      g.terrain[i] = VOID;
    } else {
      g.terrain[i] = LAND;
      g.mag[i] = Math.ceil((Math.min(200, Math.max(140, b)) - 140) / 2);
    }
  }
  return g;
}

export function encodeImagePng(g: MapGrid): Uint8Array {
  return encode({ width: g.width, height: g.height, data: encodeRGB(g), channels: 3, depth: 8 });
}

/** Decode any 8/16-bit PNG (grey, grey+alpha, RGB, RGBA, palette) into a grid. */
export function decodeImagePng(bytes: Uint8Array): MapGrid {
  const img = decode(bytes);
  const { width, height } = img;
  const n = width * height;
  const rgba = new Uint8Array(n * 4);
  const src = img.data;
  const shift = img.depth === 16 ? 8 : 0;
  const pal = img.palette;
  for (let i = 0; i < n; i++) {
    let r: number, g: number, b: number, a = 255;
    if (pal) {
      const e = pal[src[i]];
      [r, g, b] = e;
      a = e.length > 3 ? (e as number[])[3] : 255;
    } else {
      const c = img.channels;
      const o = i * c;
      const v = (k: number) => src[o + k] >> shift;
      if (c === 1) { r = g = b = v(0); }
      else if (c === 2) { r = g = b = v(0); a = v(1); }
      else { r = v(0); g = v(1); b = v(2); if (c === 4) a = v(3); }
    }
    const o = i * 4;
    rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = a;
  }
  return decodeRGBA(rgba, width, height);
}
