/**
 * Scanline polygon fill with the nonzero winding rule, sampled at pixel centres.
 * Pure JS so it behaves the same in a worker, on the main thread and in tests.
 */

type Target = { [i: number]: number; length: number };

/**
 * Fill `rings` (flat [x0, y0, x1, y1, ...] in pixel units, implicitly closed) into `out`
 * (row-major, `w` x `h`) with `value`. All rings form one path, so holes with opposite
 * winding stay unfilled and overlapping same-direction rings union.
 */
export function fillRings(out: Target, w: number, h: number, rings: ArrayLike<number>[], value: number) {
  // Edge table: [yTop, yBottom, xAtTop, dxdy, dir]
  const eTop: number[] = [], eBot: number[] = [], eX: number[] = [], eD: number[] = [], eDir: number[] = [];
  let yMin = Infinity, yMax = -Infinity;
  for (const r of rings) {
    const n = r.length >> 1;
    if (n < 3) continue;
    for (let i = 0; i < n; i++) {
      const x0 = r[2 * i], y0 = r[2 * i + 1];
      const j = i + 1 === n ? 0 : i + 1;
      const x1 = r[2 * j], y1 = r[2 * j + 1];
      if (y0 === y1) continue;
      const down = y1 > y0;
      const top = down ? y0 : y1, bot = down ? y1 : y0;
      const xt = down ? x0 : x1;
      eTop.push(top); eBot.push(bot); eX.push(xt); eD.push((x1 - x0) / (y1 - y0)); eDir.push(down ? 1 : -1);
      if (top < yMin) yMin = top;
      if (bot > yMax) yMax = bot;
    }
  }
  if (!eTop.length) return;
  const rowStart = Math.max(0, Math.ceil(yMin - 0.5));
  const rowEnd = Math.min(h - 1, Math.floor(yMax - 0.5));
  if (rowStart > rowEnd) return;
  const order = eTop.map((_, i) => i).sort((a, b) => eTop[a] - eTop[b]);
  let next = 0;
  let active: number[] = [];
  const xs: number[] = [], ds: number[] = [];
  for (let row = rowStart; row <= rowEnd; row++) {
    const yc = row + 0.5;
    while (next < order.length && eTop[order[next]] <= yc) active.push(order[next++]);
    if (!active.length) continue;
    active = active.filter((e) => eBot[e] > yc);
    xs.length = 0; ds.length = 0;
    for (const e of active) {
      if (eTop[e] > yc) continue;
      xs.push(eX[e] + (yc - eTop[e]) * eD[e]);
      ds.push(eDir[e]);
    }
    if (xs.length < 2) continue;
    const idx = xs.map((_, i) => i).sort((a, b) => xs[a] - xs[b]);
    let wind = 0, startX = 0;
    const base = row * w;
    for (const k of idx) {
      const was = wind;
      wind += ds[k];
      if (was === 0 && wind !== 0) startX = xs[k];
      else if (was !== 0 && wind === 0) {
        const a = Math.max(0, Math.ceil(startX - 0.5));
        const b = Math.min(w, Math.ceil(xs[k] - 0.5));
        for (let x = a; x < b; x++) out[base + x] = value;
      }
    }
  }
}

/**
 * Nearest-label fill: every pixel with `want[i]` set and `labels[i] < 0` takes the label of
 * the nearest labelled pixel (4-connected, through any pixel). Stops once all wanted pixels
 * are labelled; returns how many stayed unlabelled (only when nothing is labelled at all).
 */
export function fillNearest(labels: Int16Array | Int32Array, want: Uint8Array, w: number, h: number): number {
  let remaining = 0;
  for (let i = 0; i < labels.length; i++) if (want[i] && labels[i] < 0) remaining++;
  if (!remaining) return 0;
  let frontier: number[] = [];
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] < 0) continue;
    const x = i % w;
    if ((x > 0 && labels[i - 1] < 0) || (x < w - 1 && labels[i + 1] < 0) || (i >= w && labels[i - w] < 0) || (i + w < labels.length && labels[i + w] < 0)) frontier.push(i);
  }
  while (frontier.length && remaining) {
    const nextF: number[] = [];
    for (const i of frontier) {
      const l = labels[i];
      const x = i % w;
      const visit = (j: number) => {
        if (labels[j] >= 0) return;
        labels[j] = l;
        if (want[j]) remaining--;
        nextF.push(j);
      };
      if (x > 0) visit(i - 1);
      if (x < w - 1) visit(i + 1);
      if (i >= w) visit(i - w);
      if (i + w < labels.length) visit(i + w);
    }
    frontier = nextF;
  }
  void h;
  return remaining;
}
