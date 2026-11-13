/** Seeded 2D simplex noise and fractal sum, used by the Texture tool. */

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const GRAD = [1, 1, -1, 1, 1, -1, -1, -1, 1, 0, -1, 0, 0, 1, 0, -1];

const perms = new Map<number, Uint8Array>();

function perm(seed: number): Uint8Array {
  const cached = perms.get(seed);
  if (cached) return cached;
  let s = seed >>> 0 || 0x9e3779b9;
  const rnd = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const base = new Uint8Array(256);
  for (let i = 0; i < 256; i++) base[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const tmp = base[i];
    base[i] = base[j];
    base[j] = tmp;
  }
  const p = new Uint8Array(512);
  for (let i = 0; i < 512; i++) p[i] = base[i & 255];
  perms.set(seed, p);
  return p;
}

/** Simplex noise, roughly in [-1, 1]. */
export function simplex(seed: number, x: number, y: number): number {
  const p = perm(seed);
  const s = (x + y) * F2;
  const i = Math.floor(x + s);
  const j = Math.floor(y + s);
  const t = (i + j) * G2;
  const x0 = x - (i - t);
  const y0 = y - (j - t);
  const i1 = x0 > y0 ? 1 : 0;
  const j1 = x0 > y0 ? 0 : 1;
  const x1 = x0 - i1 + G2;
  const y1 = y0 - j1 + G2;
  const x2 = x0 - 1 + 2 * G2;
  const y2 = y0 - 1 + 2 * G2;
  const ii = i & 255;
  const jj = j & 255;
  const corner = (gi: number, cx: number, cy: number) => {
    let tt = 0.5 - cx * cx - cy * cy;
    if (tt < 0) return 0;
    tt *= tt;
    const g = (gi & 7) * 2;
    return tt * tt * (GRAD[g] * cx + GRAD[g + 1] * cy);
  };
  const n0 = corner(p[ii + p[jj]], x0, y0);
  const n1 = corner(p[ii + i1 + p[jj + j1]], x1, y1);
  const n2 = corner(p[ii + 1 + p[jj + 1]], x2, y2);
  return 70 * (n0 + n1 + n2);
}

/** 5-octave fractal noise; `grain` is the feature size in pixels. Result in [-1, 1]. */
export function fbm(seed: number, x: number, y: number, grain: number): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let freq = 1 / Math.max(1, grain);
  for (let o = 0; o < 5; o++) {
    sum += amp * simplex(seed + o * 101, x * freq, y * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return Math.max(-1, Math.min(1, (sum / norm) * 1.6));
}
