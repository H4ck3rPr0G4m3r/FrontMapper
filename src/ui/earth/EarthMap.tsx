import { useEffect, useRef } from 'preact/hooks';
import { effect } from '@preact/signals';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Feature, Geometry } from 'geojson';
import { mercToLonLat } from '../../earth/projection';
import type { CountryProps, ProvinceProps } from '../../earth/regions';
import { addShape, selectedRegionIds, toggleRegion } from '../../earth/selectionOps';
import type { LonLat, SelShape } from '../../earth/types';
import {
  countriesLow, earthOps, earthTool, ensureCountries, ensureProvinces, frameSize, includeOutliers, moveFrameEdge, provincesByCountry, recomputeFrame,
} from '../../state/earthState';

const SHIFTS = [-360, 0, 360];
const IMAGERY = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

type Kind = 'country' | 'province';

interface Layered {
  id: string;
  kind: Kind;
  country: string;
  layers: L.Path[];
}

/** Leaflet satellite view with clickable country/province outlines, drawing tools and the map frame. */
export function EarthMap({ onFlyTo }: { onFlyTo?: (fn: (b: L.LatLngBoundsExpression) => void) => void }) {
  const el = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const map = L.map(el.current!, { boxZoom: false, worldCopyJump: false, zoomSnap: 0.25, minZoom: 1.5, maxZoom: 14, attributionControl: true, zoomControl: true }).setView([0, 115], 2.5);
    map.attributionControl.setPrefix(false);
    L.tileLayer(IMAGERY, { maxZoom: 17, attribution: 'Imagery: Esri, Maxar, Earthstar Geographics' }).addTo(map);
    const renderer = L.canvas({ padding: 0.5, tolerance: 3 });
    const regions = new Map<string, Layered>();
    let hovered: string | null = null;
    let loaded = false;
    let disposed = false;

    const key = (kind: Kind, id: string) => `${kind}:${id}`;

    /** What the selection looks like right now; worked out once per restyle, not once per region. */
    const selState = () => {
      const ids = selectedRegionIds(earthOps.value);
      const provinceCountries = new Set<string>();
      for (const p of ids.province) {
        const c = regions.get(key('province', p))?.country;
        if (c) provinceCountries.add(c);
      }
      return { ids, provinceCountries, onlyRegions: earthOps.value.every((o) => o.shape.kind === 'region'), any: ids.country.size + ids.province.size > 0 };
    };

    const style = (r: Layered, st = selState()): L.PathOptions => {
      const { ids, onlyRegions, any } = st;
      const k = key(r.kind, r.id);
      const hover = k === hovered;
      if (r.kind === 'country') {
        const sel = ids.country.has(r.id);
        const partly = st.provinceCountries.has(r.id);
        if (sel) return { color: '#fff', weight: 2, opacity: 1, fillColor: '#fff', fillOpacity: 0.06 };
        const dim = any && onlyRegions && !partly;
        return {
          color: '#fff',
          weight: hover && earthTool.value === 'country' ? 1.6 : 0.7,
          opacity: hover && earthTool.value === 'country' ? 0.95 : 0.5,
          fillColor: '#000',
          fillOpacity: dim ? 0.7 : hover && earthTool.value === 'country' ? 0.12 : 0,
        };
      }
      const sel = ids.province.has(r.id);
      if (sel) return { color: '#fff', weight: 1.8, opacity: 1, fillColor: '#fff', fillOpacity: 0.08 };
      const parentSelected = ids.country.has(r.country);
      const anyInCountry = st.provinceCountries.has(r.country);
      return {
        color: '#fff',
        weight: hover ? 1.4 : 0.5,
        opacity: earthTool.value === 'province' ? (hover ? 0.95 : 0.45) : 0,
        fillColor: '#000',
        fillOpacity: anyInCountry && !parentSelected && onlyRegions ? 0.7 : hover ? 0.12 : 0,
      };
    };

    const restyle = () => {
      const st = selState();
      regions.forEach((r) => {
        const s = style(r, st);
        r.layers.forEach((l) => l.setStyle(s));
      });
    };
    /** Hover only changes the region under the pointer, so only that one is restyled. */
    const restyleOne = (k: string | null) => {
      const r = k ? regions.get(k) : undefined;
      if (!r) return;
      const s = style(r);
      r.layers.forEach((l) => l.setStyle(s));
    };

    const addFeature = (f: Feature<Geometry, CountryProps | ProvinceProps>, kind: Kind, country: string, pane?: string) => {
      const id = f.properties.id;
      const r: Layered = { id, kind, country, layers: [] };
      for (const shift of SHIFTS) {
        const layer = L.geoJSON(f as any, {
          // GeoJSON options are passed down to the path layers, which accept a renderer.
          ...({ renderer } as object),
          pane,
          coordsToLatLng: (c: number[]) => L.latLng(c[1], c[0] + shift),
          style: () => style(r),
        });
        layer.on('mouseover', () => {
          const prev = hovered;
          hovered = key(kind, id);
          restyleOne(prev);
          restyleOne(hovered);
        });
        layer.on('mouseout', () => {
          if (hovered !== key(kind, id)) return;
          hovered = null;
          restyleOne(key(kind, id));
        });
        layer.on('click', (e: L.LeafletMouseEvent) => {
          const tool = earthTool.value;
          if (tool !== kind) return;
          L.DomEvent.stopPropagation(e);
          earthOps.value = toggleRegion(earthOps.value, kind, id, e.originalEvent.shiftKey, kind === 'province' ? country : undefined);
        });
        layer.addTo(map);
        layer.eachLayer((l) => r.layers.push(l as L.Path));
      }
      regions.set(key(kind, id), r);
    };

    map.createPane('provinces').style.zIndex = '410';

    ensureCountries().then((fc) => {
      if (disposed) return;
      for (const f of fc.features) addFeature(f, 'country', f.properties.id);
      loaded = true;
      restyle();
    });

    // Provinces of the countries in view, loaded on demand in Province mode or when selected.
    const loadedProvinces = new Set<string>();
    const showProvinces = (a3: string) => {
      if (loadedProvinces.has(a3)) return;
      loadedProvinces.add(a3);
      ensureProvinces(a3).then((fc) => {
        if (disposed) return;
        for (const f of fc.features) addFeature(f, 'province', a3, 'provinces');
        restyle();
      });
    };
    const provincesInView = () => {
      if (earthTool.value !== 'province' || !countriesLow.value) return;
      const view = map.getBounds();
      for (const f of countriesLow.value.features) {
        const r = regions.get(key('country', f.properties.id));
        if (!r) continue;
        const b = (r.layers[1] as any).getBounds?.() as L.LatLngBounds | undefined;
        if (b && view.intersects(b) && map.getZoom() >= 3) showProvinces(f.properties.id);
      }
    };
    map.on('moveend', provincesInView);

    // Drawing tools.
    let drawing: { start: L.LatLng; points: L.LatLng[]; layer: L.Path; mode: 'add' | 'subtract' | 'replace' } | null = null;
    let lastPos: L.LatLng | null = null;
    const ll = (p: L.LatLng): LonLat => [p.lng, p.lat];
    const modeOf = (e: MouseEvent) => (e.altKey ? 'subtract' : e.shiftKey ? 'add' : 'replace');
    map.on('mousedown', (e: L.LeafletMouseEvent) => {
      const t = earthTool.value;
      if (t !== 'rect' && t !== 'lasso' && t !== 'circle') return;
      const opts = { color: '#fff', weight: 1.5, dashArray: '5 4', fillColor: '#fff', fillOpacity: 0.08, interactive: false };
      const layer = t === 'rect' ? L.rectangle(L.latLngBounds(e.latlng, e.latlng), opts) : t === 'circle' ? L.circle(e.latlng, { ...opts, radius: 1 }) : L.polyline([e.latlng], opts);
      layer.addTo(map);
      drawing = { start: e.latlng, points: [e.latlng], layer, mode: modeOf(e.originalEvent) };
      lastPos = e.latlng;
    });
    map.on('mousemove', (e: L.LeafletMouseEvent) => {
      if (!drawing) return;
      lastPos = e.latlng;
      const t = earthTool.value;
      if (t === 'rect') (drawing.layer as L.Rectangle).setBounds(L.latLngBounds(drawing.start, e.latlng));
      else if (t === 'circle') (drawing.layer as L.Circle).setRadius(map.distance(drawing.start, e.latlng));
      else {
        drawing.points.push(e.latlng);
        (drawing.layer as L.Polyline).setLatLngs(drawing.points);
      }
    });
    const finish = (e: { latlng: L.LatLng }) => {
      if (!drawing) return;
      const d = drawing;
      drawing = null;
      d.layer.remove();
      const t = earthTool.value;
      let shape: SelShape | null = null;
      if (t === 'rect' && !d.start.equals(e.latlng)) shape = { kind: 'rect', a: ll(d.start), b: ll(e.latlng) };
      if (t === 'circle') {
        const r = map.distance(d.start, e.latlng);
        if (r > 0) shape = { kind: 'circle', center: ll(d.start), radiusM: r };
      }
      if (t === 'lasso' && d.points.length > 2) shape = { kind: 'lasso', points: d.points.map(ll) };
      if (shape) earthOps.value = addShape(earthOps.value, shape, d.mode);
    };
    map.on('mouseup', finish);
    // Released outside the map: Leaflet never hears about it, so finish with the last point seen.
    const finishOutside = () => {
      if (drawing && lastPos) finish({ latlng: lastPos });
    };
    window.addEventListener('mouseup', finishOutside);

    // Drawn shapes of the current selection.
    const shapeLayer = L.layerGroup().addTo(map);
    const drawShapes = () => {
      shapeLayer.clearLayers();
      for (const op of earthOps.value) {
        const s = op.shape;
        const opts = { color: op.mode === 'add' ? '#fff' : '#ff4f43', weight: 1.5, fill: op.mode === 'add', fillColor: '#fff', fillOpacity: 0.05, interactive: false };
        if (s.kind === 'rect') L.rectangle([[s.a[1], s.a[0]], [s.b[1], s.b[0]]], opts).addTo(shapeLayer);
        if (s.kind === 'circle') L.circle([s.center[1], s.center[0]], { ...opts, radius: s.radiusM }).addTo(shapeLayer);
        if (s.kind === 'lasso') L.polygon(s.points.map((p) => [p[1], p[0]] as [number, number]), opts).addTo(shapeLayer);
      }
    };

    // Frame rectangle and edge handles.
    const frameRect = L.rectangle([[0, 0], [0, 0]], { color: '#fff', weight: 1.4, dashArray: '6 4', fill: false, interactive: false });
    const handles = (['n', 'e', 's', 'w'] as const).map((edge) => {
      const m = L.marker([0, 0], {
        draggable: true,
        icon: L.divIcon({ className: `frame-handle ${edge}`, iconSize: [12, 12] }),
        keyboard: false,
      });
      m.on('drag', () => {
        const p = m.getLatLng();
        moveFrameEdge(edge, p.lng, p.lat);
      });
      return { edge, m };
    });
    const drawFrame = () => {
      const fs = frameSize.value;
      if (!fs) {
        frameRect.remove();
        handles.forEach((h) => h.m.remove());
        return;
      }
      const a = mercToLonLat(fs.frame.x0, fs.frame.y0);
      const b = mercToLonLat(fs.frame.x1, fs.frame.y1);
      const west = a.lon;
      let east = b.lon;
      while (east <= west) east += 360;
      const north = a.lat, south = b.lat;
      frameRect.setBounds([[south, west], [north, east]]).addTo(map);
      const mid = { lat: (north + south) / 2, lng: (west + east) / 2 };
      const pos = { n: [north, mid.lng], s: [south, mid.lng], e: [mid.lat, east], w: [mid.lat, west] } as const;
      for (const h of handles) {
        if (!(h.m as any).dragging?.moving?.()) h.m.setLatLng(pos[h.edge] as [number, number]);
        h.m.addTo(map);
      }
    };

    const stop = [
      effect(() => {
        earthOps.value;
        provincesByCountry.value;
        if (loaded) restyle();
        drawShapes();
        for (const op of earthOps.value) if (op.shape.kind === 'region' && op.shape.level === 'province' && op.shape.country) showProvinces(op.shape.country);
      }),
      // Refit the frame only when the selection itself changes, never on data loads, so typed sizes stick.
      effect(() => {
        earthOps.value;
        includeOutliers.value;
        void recomputeFrame();
      }),
      effect(() => {
        frameSize.value;
        drawFrame();
      }),
      effect(() => {
        const t = earthTool.value;
        if (t === 'country' || t === 'province') map.dragging.enable();
        else map.dragging.disable();
        el.current!.dataset.tool = t;
        provincesInView();
        if (loaded) restyle();
      }),
    ];

    onFlyTo?.((b) => map.flyToBounds(b, { padding: [24, 24], duration: 0.8 }));

    let moving = false;
    map.on('movestart', () => (moving = true));
    map.on('moveend', () => (moving = false));
    if (import.meta.env.DEV) (window as any).__earth = {
      ready: true,
      map,
      toPoint: (lat: number, lng: number) => map.latLngToContainerPoint([lat, lng]),
      /** Resolves once the map has been still for a moment (fly-to animations included). */
      idle: async () => {
        for (let still = 0; still < 6; ) {
          await new Promise((r) => setTimeout(r, 50));
          still = moving ? 0 : still + 1;
        }
      },
    };

    return () => {
      disposed = true;
      window.removeEventListener('mouseup', finishOutside);
      stop.forEach((s) => s());
      map.remove();
      delete (window as any).__earth;
    };
  }, []);

  return <div ref={el} class="earth-map" />;
}
