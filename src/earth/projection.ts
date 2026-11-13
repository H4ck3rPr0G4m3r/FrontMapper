import type { Frame, FrameSize } from './types';

export type { Frame, FrameSize } from './types';

const R = 6378137;
/** Half the Web Mercator world width in metres (the date line). */
export const HALF = Math.PI * R;
const MAX_LAT = 85;

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Web Mercator metres; y grows southward. Longitude is not wrapped. */
export function lonLatToMerc(lon: number, lat: number): { x: number; y: number } {
  const l = Math.max(-85.0511, Math.min(85.0511, lat));
  return { x: R * rad(lon), y: -R * Math.log(Math.tan(Math.PI / 4 + rad(l) / 2)) };
}

/** Inverse of lonLatToMerc, with longitude normalised to [-180, 180). */
export function mercToLonLat(x: number, y: number): { lon: number; lat: number } {
  let lon = deg(x / R);
  lon = ((((lon + 180) % 360) + 360) % 360) - 180;
  return { lon, lat: deg(2 * Math.atan(Math.exp(-y / R)) - Math.PI / 2) };
}

const snap4 = (v: number) => Math.max(4, Math.round(v / 4) * 4);
const snap4Down = (v: number) => Math.max(4, Math.floor(v / 4) * 4);

/** Size a frame for a given output width. */
export function fitSize(frame: Frame, width: number): FrameSize {
  const w = snap4Down(width);
  const mPerPx = (frame.x1 - frame.x0) / w;
  return { frame, width: w, height: snap4((frame.y1 - frame.y0) / mPerPx), mPerPx };
}

/**
 * Change one side. Linked keeps the frame and changes the resolution; unlinked keeps the
 * resolution and grows or shrinks the frame symmetrically about its centre.
 */
export function setSide(fs: FrameSize, side: 'width' | 'height', px: number, linked: boolean): FrameSize {
  const v = snap4Down(px);
  const f = fs.frame;
  if (linked) {
    const mPerPx = side === 'width' ? (f.x1 - f.x0) / v : (f.y1 - f.y0) / v;
    return {
      frame: f,
      width: side === 'width' ? v : snap4((f.x1 - f.x0) / mPerPx),
      height: side === 'height' ? v : snap4((f.y1 - f.y0) / mPerPx),
      mPerPx,
    };
  }
  const half = (v * fs.mPerPx) / 2;
  if (side === 'width') {
    const c = (f.x0 + f.x1) / 2;
    return { ...fs, width: v, frame: { ...f, x0: c - half, x1: c + half } };
  }
  const c = (f.y0 + f.y1) / 2;
  return { ...fs, height: v, frame: { ...f, y0: c - half, y1: c + half } };
}

export function kmPerPx(fs: FrameSize): number {
  const lat = mercToLonLat(0, (fs.frame.y0 + fs.frame.y1) / 2).lat;
  return (fs.mPerPx * Math.cos(rad(lat))) / 1000;
}

/** One polygon of a selection: bounding box in degrees and a relative area. */
export interface Part {
  lonMin: number;
  lonMax: number;
  latMin: number;
  latMax: number;
  area: number;
}

/** Parts (one per polygon, outer ring) of a GeoJSON geometry. */
export function partsOf(geometry: { type: string; coordinates: any } | null): Part[] {
  if (!geometry) return [];
  const polys: number[][][][] = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
  return polys.map((poly) => {
    const ring = poly[0];
    let lonMin = Infinity, lonMax = -Infinity, latMin = Infinity, latMax = -Infinity, a = 0;
    for (let i = 0; i < ring.length; i++) {
      const [x, y] = ring[i];
      lonMin = Math.min(lonMin, x); lonMax = Math.max(lonMax, x);
      latMin = Math.min(latMin, y); latMax = Math.max(latMax, y);
      const [nx, ny] = ring[(i + 1) % ring.length];
      a += x * ny - nx * y;
    }
    return { lonMin, lonMax, latMin, latMax, area: Math.abs(a) / 2 };
  });
}

/** Distance between two longitude intervals on the circle (0 when they overlap). */
function lonGap(a: Part, b: Part) {
  let best = Infinity;
  for (const shift of [-360, 0, 360]) {
    const b0 = b.lonMin + shift, b1 = b.lonMax + shift;
    best = Math.min(best, Math.max(0, b0 - a.lonMax, a.lonMin - b1));
  }
  return best;
}

const latGap = (a: Part, b: Part) => Math.max(0, b.latMin - a.latMax, a.latMin - b.latMax);

/** Smallest arc [lonMin, lonMax] (lonMax may exceed 180) covering every interval. */
function coveringArc(parts: Part[]): [number, number] {
  const iv = parts.map((p) => [p.lonMin, p.lonMax] as [number, number]).sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [s, e] of iv) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  // Largest empty gap on the circle; the frame is its complement.
  let gapIndex = merged.length - 1;
  let gapSize = merged[0][0] + 360 - merged[merged.length - 1][1];
  for (let i = 0; i < merged.length - 1; i++) {
    const g = merged[i + 1][0] - merged[i][1];
    if (g > gapSize) { gapSize = g; gapIndex = i; }
  }
  const start = merged[(gapIndex + 1) % merged.length][0];
  let end = merged[gapIndex][1];
  if (end < start) end += 360;
  return [start, end];
}

/**
 * Frame around a selection's parts. Parts within `gap` degrees of each other (date line
 * aware) form clusters; the cluster with the most area is framed and the rest are returned
 * as outliers (e.g. far-off island groups) the user can choose to include.
 */
export function autoFrame(parts: Part[]): { frame: Frame; outliers: Part[] } {
  const largest = parts.reduce((a, b) => (b.area > a.area ? b : a), parts[0]);
  const gap = Math.max(3, 0.25 * Math.max(largest.lonMax - largest.lonMin, largest.latMax - largest.latMin));
  const parent = parts.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < parts.length; i++)
    for (let j = i + 1; j < parts.length; j++)
      if (lonGap(parts[i], parts[j]) <= gap && latGap(parts[i], parts[j]) <= gap) parent[find(i)] = find(j);
  const area = new Map<number, number>();
  parts.forEach((p, i) => area.set(find(i), (area.get(find(i)) ?? 0) + p.area));
  const main = [...area].reduce((a, b) => (b[1] > a[1] ? b : a))[0];
  const inMain = parts.filter((_, i) => find(i) === main);
  const outliers = parts.filter((_, i) => find(i) !== main);
  return { frame: frameAround(inMain), outliers };
}

/** Frame around parts with a 4% (x) / 6% (y) margin, latitudes clamped to +-85. */
export function frameAround(parts: Part[]): Frame {
  const [lonMin, lonMax] = coveringArc(parts);
  const latMin = Math.max(-MAX_LAT, Math.min(...parts.map((p) => p.latMin)));
  const latMax = Math.min(MAX_LAT, Math.max(...parts.map((p) => p.latMax)));
  let x0 = lonLatToMerc(lonMin, 0).x, x1 = lonLatToMerc(lonMax, 0).x;
  let y0 = lonLatToMerc(0, latMax).y, y1 = lonLatToMerc(0, latMin).y;
  const mx = (x1 - x0) * 0.04, my = (y1 - y0) * 0.06;
  x0 -= mx; x1 += mx; y0 -= my; y1 += my;
  const yLimit = lonLatToMerc(0, MAX_LAT).y;
  y0 = Math.max(yLimit, y0);
  y1 = Math.min(-yLimit, y1);
  if (x0 < -HALF) { x0 += 2 * HALF; x1 += 2 * HALF; }
  if (x0 >= HALF) { x0 -= 2 * HALF; x1 -= 2 * HALF; }
  return { x0, y0, x1, y1 };
}

/** Longitude shifted by +-360 into [centerLon - 180, centerLon + 180), for drawing near the view. */
export function wrapLonNear(lon: number, centerLon: number): number {
  let l = lon;
  while (l < centerLon - 180) l += 360;
  while (l >= centerLon + 180) l -= 360;
  return l;
}
