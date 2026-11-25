import L from 'leaflet';
import { tileColor } from '../../core/colors';
import { LAND, WATER, type MapGrid } from '../../core/grid';
import type { GeoPin } from '../../earth/georef';

/** Leaflet glue for the two panes of the alignment screen. */

export const IMAGERY = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
/** Place names and borders over the imagery, so towns and capes can be found. */
export const LABELS = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';

const R = 6378137;
/** Unwrapped longitude of a Web Mercator x (Leaflet draws past the date line fine). */
export const mercXToLng = (x: number) => (x / R) * (180 / Math.PI);

/** The map in game colours, as an image URL (revoke it when done). */
export function mapImageUrl(g: MapGrid): Promise<string> {
  const { width: w, height: h, terrain, mag } = g;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x, t = terrain[i];
      const other = t === LAND ? WATER : t === WATER ? LAND : -1;
      const shore = other >= 0 && ((x > 0 && terrain[i - 1] === other) || (x < w - 1 && terrain[i + 1] === other) || (y > 0 && terrain[i - w] === other) || (y < h - 1 && terrain[i + w] === other));
      const [r, gg, b] = tileColor(t, mag[i], shore, 4);
      const o = i * 4;
      d[o] = r; d[o + 1] = gg; d[o + 2] = b; d[o + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(URL.createObjectURL(b)) : reject(new Error('Could not draw the map.'))), 'image/png'));
}

/** Map pixel <-> Leaflet's flat (CRS.Simple) coordinates: y grows north there. */
export const pxToLatLng = (x: number, y: number) => L.latLng(-y, x);
export const latLngToPx = (ll: L.LatLng): [number, number] => [ll.lng, -ll.lat];

export type PinLook = 'pin' | 'selected' | 'pending' | 'ghost';

export function pinIcon(label: string, look: PinLook, off: boolean): L.DivIcon {
  return L.divIcon({
    className: `al-pin ${look}${off ? ' off' : ''}`,
    html: `<span class="al-ring"></span><b>${label}</b>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

/** Pins further off than the rest (worth a second look). */
export function offPins(pins: GeoPin[], residuals: number[] | null, rms: number): Set<string> {
  const out = new Set<string>();
  if (!residuals || pins.length < 4) return out;
  const limit = Math.max(4, rms * 2.2);
  pins.forEach((p, i) => residuals[i] > limit && out.add(p.id));
  return out;
}
