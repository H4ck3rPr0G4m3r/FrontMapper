/**
 * Minimal Mapbox Vector Tile reader: polygon rings of one layer, in tile coordinates.
 * Only what the water mask needs; attributes are skipped.
 */

export interface MvtPolygons {
  extent: number;
  /** Every ring of every polygon feature, flat [x0, y0, x1, y1, ...], unclosed. */
  rings: number[][];
}

class Reader {
  pos = 0;
  constructor(readonly buf: Uint8Array, readonly end = buf.length) {}
  varint(): number {
    let result = 0, shift = 0, b: number;
    do {
      b = this.buf[this.pos++];
      result += (b & 0x7f) * 2 ** shift;
      shift += 7;
    } while (b & 0x80);
    return result;
  }
  skip(wire: number) {
    if (wire === 0) this.varint();
    else if (wire === 1) this.pos += 8;
    else if (wire === 2) { const len = this.varint(); this.pos += len; }
    else if (wire === 5) this.pos += 4;
    else throw new Error(`Unsupported protobuf wire type ${wire}`);
  }
  sub(): Reader {
    const len = this.varint();
    const r = new Reader(this.buf, this.pos + len);
    r.pos = this.pos;
    this.pos += len;
    return r;
  }
}

const zigzag = (n: number) => (n % 2 === 1 ? -(n + 1) / 2 : n / 2);

function decodeRings(r: Reader, out: number[][]) {
  let x = 0, y = 0, ring: number[] | null = null;
  while (r.pos < r.end) {
    const cmd = r.varint();
    const id = cmd & 7, count = Math.floor(cmd / 8);
    if (id === 7) {
      if (ring && ring.length >= 6) out.push(ring);
      ring = null;
      continue;
    }
    for (let i = 0; i < count; i++) {
      x += zigzag(r.varint());
      y += zigzag(r.varint());
      if (id === 1) {
        if (ring && ring.length >= 6) out.push(ring);
        ring = [x, y];
      } else if (ring) ring.push(x, y);
    }
  }
  if (ring && ring.length >= 6) out.push(ring);
}

/** Polygon rings of `layer`; an empty result if the tile has no such layer. */
export function mvtPolygons(data: Uint8Array, layer: string): MvtPolygons {
  const out: MvtPolygons = { extent: 4096, rings: [] };
  const tile = new Reader(data);
  const dec = new TextDecoder();
  while (tile.pos < tile.end) {
    const tag = tile.varint();
    if (tag >>> 3 !== 3 || (tag & 7) !== 2) { tile.skip(tag & 7); continue; }
    const l = tile.sub();
    let name = '', extent = 4096;
    const features: Reader[] = [];
    while (l.pos < l.end) {
      const t = l.varint();
      const field = t >>> 3, wire = t & 7;
      if (field === 1 && wire === 2) { const s = l.sub(); name = dec.decode(data.subarray(s.pos, s.end)); }
      else if (field === 2 && wire === 2) features.push(l.sub());
      else if (field === 5 && wire === 0) extent = l.varint();
      else l.skip(wire);
    }
    if (name !== layer) continue;
    out.extent = extent;
    for (const f of features) {
      let type = 0;
      let geom: Reader | null = null;
      while (f.pos < f.end) {
        const t = f.varint();
        const field = t >>> 3, wire = t & 7;
        if (field === 3 && wire === 0) type = f.varint();
        else if (field === 4 && wire === 2) geom = f.sub();
        else f.skip(wire);
      }
      if (type === 3 && geom) decodeRings(geom, out.rings);
    }
  }
  return out;
}
