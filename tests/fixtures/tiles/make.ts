/** Builders for fixture tiles: a tiny MVT encoder and Terrarium PNGs. */
import { encode } from 'fast-png';

class Writer {
  bytes: number[] = [];
  varint(v: number) {
    while (v >= 0x80) { this.bytes.push((v & 0x7f) | 0x80); v = Math.floor(v / 128); }
    this.bytes.push(v);
  }
  field(num: number, wire: number) { this.varint(num * 8 + wire); }
  lenDelim(num: number, body: number[]) { this.field(num, 2); this.varint(body.length); this.bytes.push(...body); }
}

const zz = (n: number) => (n < 0 ? -2 * n - 1 : 2 * n);

/** Polygons: each a list of rings, each ring [[x, y], ...] in tile units (unclosed). */
export function encodeMvt(layers: { name: string; extent?: number; polygons: [number, number][][][] }[]): Uint8Array<ArrayBuffer> {
  const tile = new Writer();
  for (const l of layers) {
    const layer = new Writer();
    layer.field(15, 0); layer.varint(2);
    layer.lenDelim(1, [...new TextEncoder().encode(l.name)]);
    for (const poly of l.polygons) {
      const geom = new Writer();
      let cx = 0, cy = 0;
      for (const ring of poly) {
        geom.varint(1 | (1 << 3));
        geom.varint(zz(ring[0][0] - cx)); geom.varint(zz(ring[0][1] - cy));
        cx = ring[0][0]; cy = ring[0][1];
        geom.varint(2 | ((ring.length - 1) << 3));
        for (const [x, y] of ring.slice(1)) { geom.varint(zz(x - cx)); geom.varint(zz(y - cy)); cx = x; cy = y; }
        geom.varint(7 | (1 << 3));
      }
      const f = new Writer();
      f.lenDelim(2, [0, 0]); // tags: class=ocean, like real OpenMapTiles water features
      f.field(3, 0); f.varint(3);
      f.lenDelim(4, geom.bytes);
      layer.lenDelim(2, f.bytes);
    }
    layer.lenDelim(3, [...new TextEncoder().encode('class')]);
    const value = new Writer();
    value.lenDelim(1, [...new TextEncoder().encode('ocean')]);
    layer.lenDelim(4, value.bytes);
    layer.field(5, 0); layer.varint(l.extent ?? 4096);
    tile.lenDelim(3, layer.bytes);
  }
  return new Uint8Array(tile.bytes);
}

/** 256x256 Terrarium PNG; `metres(px, py)` gives the height at a tile pixel. */
export function terrariumPng(metres: (px: number, py: number) => number): Uint8Array<ArrayBuffer> {
  const data = new Uint8Array(256 * 256 * 3);
  for (let y = 0; y < 256; y++)
    for (let x = 0; x < 256; x++) {
      const v = metres(x, y) + 32768;
      const i = (y * 256 + x) * 3;
      data[i] = Math.floor(v / 256);
      data[i + 1] = Math.floor(v) % 256;
      data[i + 2] = Math.round((v - Math.floor(v)) * 256) % 256;
    }
  return new Uint8Array(encode({ width: 256, height: 256, data, channels: 3, depth: 8 }));
}
