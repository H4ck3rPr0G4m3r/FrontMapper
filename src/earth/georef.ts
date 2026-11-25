import { LAND, WATER } from '../core/grid';
import type { Nation } from '../core/nations';
import { HALF, lonLatToMerc, mercToLonLat } from './projection';
import type { Frame, FrameSize, LonLat } from './types';

/**
 * Lining up an imported map with Earth. The user pins spots they can find on both their map and
 * the satellite view. A fit through the pins maps map pixels to Web Mercator and back. Nations are
 * placed on a background copy of the map warped into an Earth frame, then mapped back to the map.
 */

/** One spot on the user's map (pixel coordinates, fractional) and the same spot on Earth. */
export interface GeoPin {
  id: string;
  px: [number, number];
  lonLat: LonLat;
}

/** How an imported map lines up with Earth. */
export interface Georef {
  pins: GeoPin[];
}

export const MIN_PINS = 3;
/** From this many pins the fit may bend (for maps drawn in another projection). */
export const CURVED_MIN_PINS = 7;
/** How far (map pixels) a nation may move to reach land after mapping it back. */
export const SNAP_RADIUS = 3;

type V2 = [number, number];

interface Norm {
  mx: number;
  my: number;
  s: number;
}

/** Polynomial from one plane to another, fitted in normalised coordinates. */
interface Poly {
  order: 1 | 2;
  inN: Norm;
  outN: Norm;
  cx: number[];
  cy: number[];
}

export interface GeoFit {
  /** straight: an affine fit (any rotation, scale and skew). curved: second order, for other projections. */
  kind: 'straight' | 'curved';
  /** Longitude the pins are unwrapped around, so a map across the date line stays in one piece. */
  refLon: number;
  toMerc: Poly;
  toPx: Poly;
  /** How far each pin's Earth spot lands from its map spot, in map pixels. */
  residuals: number[];
  /** Root mean square of the residuals. */
  rms: number;
}

export type FitResult = { ok: true; fit: GeoFit } | { ok: false; reason: string };

function normOf(pts: V2[]): Norm {
  let mx = 0, my = 0;
  for (const [x, y] of pts) { mx += x; my += y; }
  mx /= pts.length; my /= pts.length;
  let ss = 0;
  for (const [x, y] of pts) ss += (x - mx) ** 2 + (y - my) ** 2;
  return { mx, my, s: Math.sqrt(ss / pts.length) || 1 };
}

function basis(order: 1 | 2, u: number, v: number): number[] {
  return order === 1 ? [1, u, v] : [1, u, v, u * u, u * v, v * v];
}

/** Solve M c = r for two right-hand sides (Gaussian elimination, partial pivoting); null when singular. */
function solve(M: number[][], R: number[][]): number[][] | null {
  const k = M.length;
  const a = M.map((row, i) => [...row, ...R[i]]);
  const scale = Math.max(...M.map((row, i) => Math.abs(row[i])), 1e-300);
  for (let c = 0; c < k; c++) {
    let p = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    if (Math.abs(a[p][c]) < 1e-9 * scale) return null;
    [a[c], a[p]] = [a[p], a[c]];
    for (let r = 0; r < k; r++) {
      if (r === c) continue;
      const f = a[r][c] / a[c][c];
      if (f) for (let j = c; j < k + 2; j++) a[r][j] -= f * a[c][j];
    }
  }
  return a.map((row, i) => [row[k] / row[i], row[k + 1] / row[i]]);
}

function fitPoly(order: 1 | 2, from: V2[], to: V2[]): Poly | null {
  const inN = normOf(from), outN = normOf(to);
  const k = order === 1 ? 3 : 6;
  const M = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const R = Array.from({ length: k }, () => [0, 0]);
  from.forEach(([x, y], n) => {
    const b = basis(order, (x - inN.mx) / inN.s, (y - inN.my) / inN.s);
    const tx = (to[n][0] - outN.mx) / outN.s, ty = (to[n][1] - outN.my) / outN.s;
    for (let i = 0; i < k; i++) {
      for (let j = 0; j < k; j++) M[i][j] += b[i] * b[j];
      R[i][0] += b[i] * tx;
      R[i][1] += b[i] * ty;
    }
  });
  const c = solve(M, R);
  if (!c) return null;
  return { order, inN, outN, cx: c.map((v) => v[0]), cy: c.map((v) => v[1]) };
}

function applyPoly(p: Poly, x: number, y: number): V2 {
  const u = (x - p.inN.mx) / p.inN.s, v = (y - p.inN.my) / p.inN.s;
  const c = p.cx, d = p.cy;
  let X = c[0] + c[1] * u + c[2] * v;
  let Y = d[0] + d[1] * u + d[2] * v;
  if (p.order === 2) {
    const uu = u * u, uv = u * v, vv = v * v;
    X += c[3] * uu + c[4] * uv + c[5] * vv;
    Y += d[3] * uu + d[4] * uv + d[5] * vv;
  }
  return [X * p.outN.s + p.outN.mx, Y * p.outN.s + p.outN.my];
}

/** Longitude shifted by +-360 to within 180 degrees of `ref`. */
export function unwrapLon(lon: number, ref: number): number {
  let l = lon;
  while (l < ref - 180) l += 360;
  while (l >= ref + 180) l -= 360;
  return l;
}

function mercAround(refLon: number, lon: number, lat: number): V2 {
  const m = lonLatToMerc(unwrapLon(lon, refLon), lat);
  return [m.x, m.y];
}

/** How far from a straight line the points are: 0 in a line, 1 evenly spread. */
function spread(pts: V2[]): number {
  const n = normOf(pts);
  let sxx = 0, syy = 0, sxy = 0;
  for (const [x, y] of pts) {
    const u = x - n.mx, v = y - n.my;
    sxx += u * u; syy += v * v; sxy += u * v;
  }
  const tr = sxx + syy, det = sxx * syy - sxy * sxy;
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const big = tr / 2 + disc, small = tr / 2 - disc;
  return big > 0 ? Math.sqrt(Math.max(0, small) / big) : 0;
}

function build(order: 1 | 2, px: V2[], merc: V2[], refLon: number): GeoFit | null {
  const toMerc = fitPoly(order, px, merc);
  const toPx = fitPoly(order, merc, px);
  if (!toMerc || !toPx) return null;
  const residuals = px.map((p, i) => {
    const q = applyPoly(toPx, merc[i][0], merc[i][1]);
    return Math.hypot(q[0] - p[0], q[1] - p[1]);
  });
  const rms = Math.sqrt(residuals.reduce((s, r) => s + r * r, 0) / residuals.length);
  return { kind: order === 1 ? 'straight' : 'curved', refLon, toMerc, toPx, residuals, rms };
}

/**
 * Fit the pins. Three to six pins give a straight (affine) fit. From seven on, a curved fit is
 * used when it fits clearly better, which is what maps drawn in another projection need.
 */
export function fitGeoref(pins: GeoPin[]): FitResult {
  if (pins.length < MIN_PINS) {
    const more = MIN_PINS - pins.length;
    return { ok: false, reason: `Add ${more} more ${more === 1 ? 'pin' : 'pins'}.` };
  }
  const refLon = pins[0].lonLat[0];
  const px = pins.map((p) => [p.px[0], p.px[1]] as V2);
  const merc = pins.map((p) => mercAround(refLon, p.lonLat[0], p.lonLat[1]));
  const inLine = { ok: false as const, reason: 'The pins are almost in a line. Add one well off to the side.' };
  if (spread(px) < 0.05 || spread(merc) < 0.05) return inLine;
  const straight = build(1, px, merc, refLon);
  if (!straight) return inLine;
  // Both planes have y pointing south, so a negative determinant means the pins are mirrored.
  const t = straight.toMerc;
  if (t.cx[1] * t.cy[2] - t.cx[2] * t.cy[1] <= 0) {
    return { ok: false, reason: 'The pins are mirrored. Check each pin sits on the same spot on both sides.' };
  }
  if (pins.length >= CURVED_MIN_PINS) {
    const curved = build(2, px, merc, refLon);
    if (curved && curved.rms < straight.rms * 0.7) return { ok: true, fit: curved };
  }
  return { ok: true, fit: straight };
}

/** Map pixel (fractional) of a spot on Earth. */
export function lonLatToPx(fit: GeoFit, lon: number, lat: number): V2 {
  const [x, y] = mercAround(fit.refLon, lon, lat);
  return applyPoly(fit.toPx, x, y);
}

/** Spot on Earth of a map pixel (fractional). */
export function pxToLonLat(fit: GeoFit, x: number, y: number): LonLat {
  const [mx, my] = applyPoly(fit.toMerc, x, y);
  const p = mercToLonLat(mx, my);
  return [p.lon, p.lat];
}

/**
 * The map's outline in (unwrapped) Mercator metres, sampled along its edges. Throws when the pins
 * stretch the map around the world, which only happens with pins that don't belong together.
 */
export function mercBounds(fit: GeoFit, width: number, height: number): Frame {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const N = 64;
  const add = (x: number, y: number) => {
    const [mx, my] = applyPoly(fit.toMerc, x, y);
    x0 = Math.min(x0, mx); x1 = Math.max(x1, mx);
    y0 = Math.min(y0, my); y1 = Math.max(y1, my);
  };
  for (let k = 0; k <= N; k++) {
    const t = k / N;
    add(t * width, 0); add(t * width, height); add(0, t * height); add(width, t * height);
  }
  if (!(x1 - x0 < 2 * HALF) || !(y1 - y0 < 2 * HALF) || !Number.isFinite(x0 + y0 + x1 + y1)) {
    throw new Error('The pins stretch your map around the whole world. Check that each pin is on the same spot on both sides.');
  }
  return { x0, y0, x1, y1 };
}

/** A copy of the map warped into an Earth frame, for the Earth nation tools. */
export interface Warp {
  fs: FrameSize;
  terrain: Uint8Array;
}

/**
 * Resample the map into a Web Mercator frame around it, at about the same number of pixels.
 * Outside the map is water, so nothing gets placed there.
 */
export function buildWarp(fit: GeoFit, width: number, height: number, terrain: Uint8Array): Warp {
  const b = mercBounds(fit, width, height);
  // The frame's west edge goes into [-HALF, HALF), as Earth frames have it; the fit's x moves with it.
  let shift = 0;
  while (b.x0 + shift < -HALF) shift += 2 * HALF;
  while (b.x0 + shift >= HALF) shift -= 2 * HALF;
  const mPerPx = Math.sqrt(((b.x1 - b.x0) * (b.y1 - b.y0)) / (width * height)) || 1;
  const W = Math.max(4, Math.ceil((b.x1 - b.x0) / mPerPx));
  const H = Math.max(4, Math.ceil((b.y1 - b.y0) / mPerPx));
  const frame: Frame = { x0: b.x0 + shift, y0: b.y0, x1: b.x0 + shift + W * mPerPx, y1: b.y0 + H * mPerPx };
  const out = new Uint8Array(W * H);
  for (let j = 0; j < H; j++) {
    const my = b.y0 + (j + 0.5) * mPerPx;
    for (let i = 0; i < W; i++) {
      const [x, y] = applyPoly(fit.toPx, b.x0 + (i + 0.5) * mPerPx, my);
      const xi = Math.floor(x), yi = Math.floor(y);
      out[j * W + i] = xi >= 0 && yi >= 0 && xi < width && yi < height ? terrain[yi * width + xi] : WATER;
    }
  }
  return { fs: { frame, width: W, height: H, mPerPx }, terrain: out };
}

/** Nearest land pixel within `r` of (x, y), or null. */
function nearestLand(terrain: Uint8Array, width: number, height: number, x: number, y: number, r: number): V2 | null {
  let best: V2 | null = null, bestD = Infinity;
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height || terrain[ny * width + nx] !== LAND) continue;
      const d = dx * dx + dy * dy;
      if (d < bestD && d <= r * r) { bestD = d; best = [nx, ny]; }
    }
  return best;
}

/**
 * Move nations placed on the warped copy back onto the map, by where they are on Earth. One that
 * lands just off the coast moves to the nearest land; one with no land nearby is skipped.
 */
export function mapBack(nations: Nation[], fit: GeoFit, width: number, height: number, terrain: Uint8Array): { nations: Nation[]; skipped: number } {
  const out: Nation[] = [];
  let skipped = 0;
  for (const n of nations) {
    if (!n.lonLat) { skipped++; continue; }
    const [x, y] = lonLatToPx(fit, n.lonLat[0], n.lonLat[1]);
    const at = Number.isFinite(x + y) ? nearestLand(terrain, width, height, Math.floor(x), Math.floor(y), SNAP_RADIUS) : null;
    if (!at) { skipped++; continue; }
    out.push({ ...n, x: at[0], y: at[1] });
  }
  return { nations: out, skipped };
}

/** Pins after the map is cropped or resized (new = old * s + o, like nations). */
export function transformPins(g: Georef | undefined, t: { sx: number; sy: number; ox: number; oy: number }): Georef | undefined {
  if (!g) return g;
  return { pins: g.pins.map((p) => ({ ...p, px: [p.px[0] * t.sx + t.ox, p.px[1] * t.sy + t.oy] })) };
}

/** The map as a picture warped onto Earth: its frame in Mercator metres and RGBA pixels. */
export interface WarpPreview {
  frame: Frame;
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
}

/**
 * The map warped onto Earth at up to `maxSide` pixels, for checking the fit over the satellite
 * view: land lightly tinted, coastlines bright, water clear. Longitudes are left unwrapped.
 */
export function warpPreview(fit: GeoFit, width: number, height: number, terrain: Uint8Array, maxSide = 1400): WarpPreview {
  const b = mercBounds(fit, width, height);
  const m = Math.max(b.x1 - b.x0, b.y1 - b.y0) / maxSide;
  const W = Math.max(2, Math.ceil((b.x1 - b.x0) / m)), H = Math.max(2, Math.ceil((b.y1 - b.y0) / m));
  const t = new Uint8Array(W * H).fill(255);
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const [x, y] = applyPoly(fit.toPx, b.x0 + (i + 0.5) * m, b.y0 + (j + 0.5) * m);
      const xi = Math.floor(x), yi = Math.floor(y);
      if (xi >= 0 && yi >= 0 && xi < width && yi < height) t[j * W + i] = terrain[yi * width + xi];
    }
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const k = j * W + i, v = t[k];
      if (v === 255 || v === WATER) continue;
      const land = v === LAND;
      const edge = land && (i === 0 || j === 0 || i === W - 1 || j === H - 1 || t[k - 1] !== LAND || t[k + 1] !== LAND || t[k - W] !== LAND || t[k + W] !== LAND);
      const o = k * 4;
      if (edge) { rgba[o] = 255; rgba[o + 1] = 226; rgba[o + 2] = 92; rgba[o + 3] = 255; }
      else if (land) { rgba[o] = 255; rgba[o + 1] = 226; rgba[o + 2] = 92; rgba[o + 3] = 46; }
      else { rgba[o + 3] = 120; } // void: darkened
    }
  return { frame: { ...b }, width: W, height: H, rgba };
}
