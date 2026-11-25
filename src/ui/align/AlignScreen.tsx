import { useEffect, useRef } from 'preact/hooks';
import { effect } from '@preact/signals';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { MapGrid } from '../../core/grid';
import { lonLatToPx, pxToLonLat, unwrapLon, warpPreview, CURVED_MIN_PINS, MIN_PINS, type GeoPin } from '../../earth/georef';
import { mercToLonLat } from '../../earth/projection';
import {
  alignFit, alignHadPins, alignOpacity, alignOverlay, alignPending, alignPins, alignSelected, clickSide, closeAlign, deletePin, movePin, saveAlign, type AlignSide,
} from '../../state/alignState';
import { countriesLow, ensureProvinces } from '../../state/earthState';
import { meta } from '../../state/store';
import { SearchBox, type SearchHit } from '../earth/SearchBox';
import { IMAGERY, LABELS, latLngToPx, mapImageUrl, mercXToLng, offPins, pinIcon, pxToLatLng, type PinLook } from './panes';
import '../earth/earth.css';
import './align.css';

interface PaneApi {
  focus: (pin: GeoPin) => void;
  flyTo?: (b: L.LatLngBoundsExpression) => void;
}

/** Spot of a pin on one side, as a Leaflet coordinate. */
type ToLatLng = (pin: { px: [number, number]; lonLat: [number, number] }) => L.LatLng;

/**
 * Keep a pane's markers in step with the pins: numbered pins (draggable), the waiting first half of
 * a pin, and where the fit expects that spot on this side.
 */
function syncMarkers(map: L.Map, layer: L.LayerGroup, side: AlignSide, toLatLng: ToLatLng, fromLatLng: (ll: L.LatLng) => [number, number]) {
  return effect(() => {
    const pins = alignPins.value;
    const pending = alignPending.value;
    const selected = alignSelected.value;
    const fit = alignFit.value;
    const off = offPins(pins, fit.ok ? fit.fit.residuals : null, fit.ok ? fit.fit.rms : 0);
    layer.clearLayers();
    pins.forEach((p, i) => {
      const look: PinLook = p.id === selected ? 'selected' : 'pin';
      const m = L.marker(toLatLng(p), { icon: pinIcon(String(i + 1), look, off.has(p.id)), draggable: true, keyboard: false, riseOnHover: true, title: `Pin ${i + 1}` });
      m.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        alignSelected.value = p.id;
        alignPending.value = null;
      });
      m.on('dragend', () => movePin(p.id, side, fromLatLng(m.getLatLng())));
      m.addTo(layer);
    });
    if (!pending) return;
    const label = String(pins.length + 1);
    if (pending.side === side) {
      const at = side === 'map' ? { px: pending.at, lonLat: [0, 0] as [number, number] } : { px: [0, 0] as [number, number], lonLat: pending.at };
      L.marker(toLatLng(at), { icon: pinIcon(label, 'pending', false), interactive: false, keyboard: false }).addTo(layer);
    } else if (fit.ok) {
      // Where the fit expects the same spot on this side.
      const guess = side === 'earth' ? { px: [0, 0] as [number, number], lonLat: pxToLonLat(fit.fit, pending.at[0], pending.at[1]) } : { px: lonLatToPx(fit.fit, pending.at[0], pending.at[1]), lonLat: [0, 0] as [number, number] };
      const ll = toLatLng(guess);
      L.marker(ll, { icon: pinIcon(label, 'ghost', false), interactive: false, keyboard: false }).addTo(layer);
      if (!map.getBounds().pad(-0.15).contains(ll)) map.panTo(ll);
    }
  });
}

function MapPane({ grid, api }: { grid: MapGrid; api: { current: PaneApi | null } }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const map = L.map(el.current!, { crs: L.CRS.Simple, zoomSnap: 0.25, zoomDelta: 0.5, wheelPxPerZoomLevel: 90, minZoom: -10, maxZoom: 6, attributionControl: false, boxZoom: false });
    const bounds = L.latLngBounds(pxToLatLng(0, grid.height), pxToLatLng(grid.width, 0));
    map.fitBounds(bounds, { padding: [28, 28] });
    map.setMinZoom(map.getZoom() - 1);
    let url: string | null = null;
    let disposed = false;
    mapImageUrl(grid).then((u) => {
      if (disposed) return URL.revokeObjectURL(u);
      url = u;
      L.imageOverlay(u, bounds, { className: 'al-map-img' }).addTo(map);
    });
    map.on('click', (e: L.LeafletMouseEvent) => clickSide('map', latLngToPx(e.latlng)));
    const layer = L.layerGroup().addTo(map);
    const stop = syncMarkers(map, layer, 'map', (p) => pxToLatLng(p.px[0], p.px[1]), latLngToPx);
    api.current = { focus: (p) => map.panTo(pxToLatLng(p.px[0], p.px[1])) };
    if (import.meta.env.DEV) {
      const w = window as any;
      w.__align = { ...w.__align, mapPoint: (x: number, y: number) => map.latLngToContainerPoint(pxToLatLng(x, y)) };
    }
    return () => {
      disposed = true;
      stop();
      map.remove();
      if (url) URL.revokeObjectURL(url);
      api.current = null;
    };
  }, [grid]);
  return (
    <div class="al-pane" data-waiting={alignPending.value?.side === 'earth' ? '' : undefined}>
      <div ref={el} class="al-leaflet al-map" />
      <span class="al-label">Your map</span>
    </div>
  );
}

function EarthPane({ grid, api }: { grid: MapGrid; api: { current: PaneApi | null } }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const map = L.map(el.current!, { zoomSnap: 0.25, zoomDelta: 0.5, wheelPxPerZoomLevel: 90, minZoom: 1.5, maxZoom: 19, boxZoom: false, worldCopyJump: false });
    map.attributionControl.setPrefix(false);
    L.tileLayer(IMAGERY, { maxZoom: 19, maxNativeZoom: 18, attribution: 'Imagery and labels: Esri, Maxar, Earthstar Geographics' }).addTo(map);
    L.tileLayer(LABELS, { maxZoom: 19, maxNativeZoom: 18 }).addTo(map);
    const pins = alignPins.value;
    // Pins are drawn near the first pin's longitude, so a map across the date line stays together.
    const ref = () => alignPins.value[0]?.lonLat[0] ?? map.getCenter().lng;
    const toLatLng: ToLatLng = (p) => L.latLng(p.lonLat[1], unwrapLon(p.lonLat[0], ref()));
    if (pins.length > 1) map.fitBounds(L.latLngBounds(pins.map((p) => toLatLng(p))).pad(0.35));
    else if (pins.length === 1) map.setView(toLatLng(pins[0]), 8);
    else map.setView([30, 0], 2);
    map.on('click', (e: L.LeafletMouseEvent) => {
      const lng = ((((e.latlng.lng + 180) % 360) + 360) % 360) - 180;
      clickSide('earth', [lng, e.latlng.lat]);
    });

    // The map warped onto Earth, redrawn shortly after the pins settle.
    let overlay: L.ImageOverlay | null = null;
    let url: string | null = null;
    let timer = 0;
    const clearOverlay = () => {
      overlay?.remove();
      overlay = null;
      if (url) URL.revokeObjectURL(url);
      url = null;
    };
    const stopOverlay = effect(() => {
      const fit = alignFit.value;
      const show = alignOverlay.value;
      clearTimeout(timer);
      if (!fit.ok || !show) return clearOverlay();
      timer = window.setTimeout(() => {
        let pv;
        try {
          pv = warpPreview(fit.fit, grid.width, grid.height, grid.terrain);
        } catch {
          return clearOverlay();
        }
        const c = document.createElement('canvas');
        c.width = pv.width;
        c.height = pv.height;
        c.getContext('2d')!.putImageData(new ImageData(pv.rgba as any, pv.width, pv.height), 0, 0);
        c.toBlob((b) => {
          if (!b || alignFit.value !== fit) return;
          clearOverlay();
          url = URL.createObjectURL(b);
          const n = mercToLonLat(0, pv.frame.y0).lat, s = mercToLonLat(0, pv.frame.y1).lat;
          overlay = L.imageOverlay(url, [[s, mercXToLng(pv.frame.x0)], [n, mercXToLng(pv.frame.x1)]], { opacity: alignOpacity.value, className: 'al-overlay' }).addTo(map);
        });
      }, 90);
    });
    const stopOpacity = effect(() => {
      const o = alignOpacity.value;
      overlay?.setOpacity(o);
    });

    const layer = L.layerGroup().addTo(map);
    const stop = syncMarkers(map, layer, 'earth', toLatLng, (ll) => [((((ll.lng + 180) % 360) + 360) % 360) - 180, ll.lat]);
    api.current = { focus: (p) => map.panTo(toLatLng(p)), flyTo: (b) => map.flyToBounds(b, { duration: 0.6, padding: [24, 24] }) };
    if (import.meta.env.DEV) {
      const w = window as any;
      w.__align = { ...w.__align, ready: true, earthPoint: (lat: number, lng: number) => map.latLngToContainerPoint([lat, lng]), setEarthView: (lat: number, lng: number, z: number) => map.setView([lat, lng], z, { animate: false }) };
    }
    return () => {
      clearTimeout(timer);
      stopOverlay();
      stopOpacity();
      stop();
      clearOverlay();
      map.remove();
      api.current = null;
      if (import.meta.env.DEV) delete (window as any).__align;
    };
  }, [grid]);
  return (
    <div class="al-pane" data-waiting={alignPending.value?.side === 'map' ? '' : undefined}>
      <div ref={el} class="al-leaflet al-earth" />
      <span class="al-label">Earth</span>
    </div>
  );
}

const fmtLat = (v: number) => `${Math.abs(v).toFixed(3)}°${v >= 0 ? 'N' : 'S'}`;
const fmtLon = (v: number) => `${Math.abs(v).toFixed(3)}°${v >= 0 ? 'E' : 'W'}`;

function FitStatus() {
  const pins = alignPins.value;
  const r = alignFit.value;
  if (!r.ok) {
    if (pins.length < MIN_PINS) return <p class="empty-note">{r.reason}</p>;
    return <p class="al-problem" role="alert">{r.reason}</p>;
  }
  const f = r.fit;
  return (
    <>
      {pins.length === MIN_PINS ? (
        <p class="al-fit">Three pins always fit exactly. Add a fourth to check them against each other.</p>
      ) : (
        <p class="al-fit">
          Pins are off by <b class="mono">{`${f.rms.toFixed(1)} px`}</b> on average.
        </p>
      )}
      <p class="note">
        {f.kind === 'curved'
          ? 'Curved fit, for a map drawn in another projection.'
          : pins.length >= CURVED_MIN_PINS
            ? 'Straight fit: a curved one fits no better.'
            : `Straight fit. With ${CURVED_MIN_PINS} or more pins the fit can bend, which maps made in QGIS often need.`}
      </p>
    </>
  );
}

function PinList({ onFocus }: { onFocus: (p: GeoPin) => void }) {
  const pins = alignPins.value;
  const r = alignFit.value;
  const off = offPins(pins, r.ok ? r.fit.residuals : null, r.ok ? r.fit.rms : 0);
  if (!pins.length) {
    return (
      <p class="empty-note">
        Pin spots you can find on both: a cape, a river mouth, a bay, a town. Spread them toward the corners of your map.
      </p>
    );
  }
  return (
    <ul class="al-pins">
      {pins.map((p, i) => {
        const res = r.ok && pins.length > MIN_PINS ? r.fit.residuals[i] : null;
        const bad = off.has(p.id);
        return (
          <li key={p.id} class={alignSelected.value === p.id ? 'on' : ''}>
            <button class="al-pin-row" onClick={() => { alignSelected.value = p.id; alignPending.value = null; onFocus(p); }} title={bad ? 'Further off than the other pins. Check it is on the same spot on both sides.' : undefined}>
              <span class={`al-num${bad ? ' off' : ''}`}>{i + 1}</span>
              <span class="al-where mono">{`${fmtLat(p.lonLat[1])} ${fmtLon(p.lonLat[0])}`}</span>
              <span class={`al-res mono${bad ? ' off' : ''}`}>{res === null ? '' : `${res.toFixed(1)} px`}</span>
            </button>
            <button class="icon-btn sm" aria-label={`Delete pin ${i + 1}`} title="Delete pin" onClick={() => deletePin(p.id)}>
              <i aria-hidden="true" class="ph ph-trash" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Line an imported or hand-made map up with Earth by pinning the same spots on both. */
export function AlignScreen({ grid }: { grid: MapGrid }) {
  const mapApi = useRef<PaneApi | null>(null);
  const earthApi = useRef<PaneApi | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select')) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (alignPending.value) alignPending.value = null;
        else if (alignSelected.value) alignSelected.value = null;
        else closeAlign();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && alignSelected.value) {
        e.preventDefault();
        deletePin(alignSelected.value);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const search = async (h: SearchHit) => {
    const geom =
      h.level === 'country'
        ? countriesLow.value?.features.find((f) => f.properties.id === h.id)
        : (await ensureProvinces(h.country)).features.find((f) => f.properties.id === h.id);
    if (geom) earthApi.current?.flyTo?.(L.geoJSON(geom as any).getBounds());
  };

  const pending = alignPending.value;
  const pins = alignPins.value;
  const fit = alignFit.value;
  const canSave = fit.ok || (pins.length === 0 && alignHadPins.value);
  const n = pins.length + 1;

  return (
    <div class="al screen-in" role="dialog" aria-label="Line up with Earth">
      <header class="earth-top al-top">
        <button class="icon-btn" aria-label="Back without saving" title="Back to the editor without saving the pins" onClick={closeAlign}>
          <i aria-hidden="true" class="ph ph-arrow-left" />
        </button>
        <div class="al-title">
          <b>Line up with Earth</b>
          <small>{meta.value.name.trim() || 'Untitled map'}</small>
        </div>
        <span class="bar-sep" />
        <SearchBox onPick={search} />
        <span class="earth-hint al-hint" role="status">
          {!pending ? (
            <>Click a spot on your map, then the same spot on Earth</>
          ) : pending.side === 'map' ? (
            <>{`Now click the same spot on Earth for pin ${n}`}<kbd>Esc</kbd>cancels</>
          ) : (
            <>{`Now click the same spot on your map for pin ${n}`}<kbd>Esc</kbd>cancels</>
          )}
        </span>
      </header>
      <div class="al-body">
        <div class="al-panes">
          <MapPane grid={grid} api={mapApi} />
          <EarthPane grid={grid} api={earthApi} />
        </div>
        <aside class="earth-side">
          <div class="earth-scroll">
            <section class="grp">
              <h4>
                Pins
                {pins.length > 0 && <span class="pending mono">{pins.length}</span>}
              </h4>
              <PinList onFocus={(p) => { mapApi.current?.focus(p); earthApi.current?.focus(p); }} />
              {pins.length > 0 && <p class="note">Drag a pin to move it. <kbd>Del</kbd> removes the selected one.</p>}
            </section>
            <section class="grp">
              <h4>Fit</h4>
              <FitStatus />
            </section>
            <section class="grp">
              <h4>Overlay</h4>
              <label class="al-check">
                <input type="checkbox" checked={alignOverlay.value} onChange={(e) => (alignOverlay.value = (e.currentTarget as HTMLInputElement).checked)} />
                Show your coastlines on Earth
              </label>
              <label class="fe-row al-opacity">
                <span>Opacity</span>
                <input
                  type="range"
                  min={10}
                  max={100}
                  step={5}
                  aria-label="Overlay opacity"
                  disabled={!alignOverlay.value}
                  value={Math.round(alignOpacity.value * 100)}
                  style={{ '--p': `${((alignOpacity.value * 100 - 10) / 90) * 100}%` }}
                  onInput={(e) => (alignOpacity.value = +(e.currentTarget as HTMLInputElement).value / 100)}
                />
                <span class="val">{`${Math.round(alignOpacity.value * 100)}%`}</span>
              </label>
              {!fit.ok && <p class="note">Shows once the pins fit.</p>}
            </section>
          </div>
          <div class="earth-foot">
            <button class="btn primary convert" disabled={!canSave} onClick={saveAlign}>
              {pins.length === 0 && alignHadPins.value ? 'Remove alignment' : 'Save alignment'}
              <i aria-hidden="true" class="ph-bold ph-check" />
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
