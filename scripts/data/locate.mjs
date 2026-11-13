// Point-in-polygon and nearest-polygon lookups over a GeoJSON FeatureCollection (lon/lat).

const polygonsOf = (g) => (!g ? [] : g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);

function bbox(polys) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of polys) for (const [x, y] of p[0]) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

function inRing(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const inPolygon = (poly, x, y) => inRing(poly[0], x, y) && !poly.slice(1).some((h) => inRing(h, x, y));

/** Squared distance (in degrees, longitude scaled by latitude) from a point to a segment. */
function segDist2(x, y, [ax, ay], [bx, by], k) {
  const dx = (bx - ax) * k, dy = by - ay;
  const px = (x - ax) * k, py = y - ay;
  const t = Math.max(0, Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy || 1)));
  return (px - t * dx) ** 2 + (py - t * dy) ** 2;
}

/**
 * Index of features for "which feature contains / is nearest to this point".
 * `maxDeg` limits the nearest search (degrees of latitude).
 */
export function locator(fc) {
  const items = fc.features.map((f) => {
    const polys = polygonsOf(f.geometry);
    return { f, polys, box: bbox(polys) };
  });
  return {
    /** The feature containing the point; where features overlap, the smallest (most specific). */
    containing(x, y) {
      let best = null, bestArea = Infinity;
      for (const it of items) {
        const [x0, y0, x1, y1] = it.box;
        if (x < x0 || x > x1 || y < y0 || y > y1) continue;
        const area = (x1 - x0) * (y1 - y0);
        if (area < bestArea && it.polys.some((p) => inPolygon(p, x, y))) { best = it.f; bestArea = area; }
      }
      return best;
    },
    nearest(x, y, maxDeg) {
      const k = Math.cos((y * Math.PI) / 180);
      let best = null, bestD = maxDeg * maxDeg;
      for (const it of items) {
        const [x0, y0, x1, y1] = it.box;
        if (x < x0 - maxDeg / k || x > x1 + maxDeg / k || y < y0 - maxDeg || y > y1 + maxDeg) continue;
        for (const p of it.polys)
          for (const ring of p)
            for (let i = 1; i < ring.length; i++) {
              const d = segDist2(x, y, ring[i - 1], ring[i], k);
              if (d < bestD) { bestD = d; best = it.f; }
            }
      }
      return best;
    },
  };
}
