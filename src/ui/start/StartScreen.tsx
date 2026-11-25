import { useEffect, useRef, useState } from 'preact/hooks';
import { importOpenFrontMap, openProject } from '../../core/project';
import { forgetAutosave, listRecent, loadAutosave, type RecentEntry } from '../../state/autosave';
import { countriesLow, ensureCountries } from '../../state/earthState';
import { openInEditor, screen } from '../../state/session';
import { NewMapCard } from './NewMapCard';
import { offlineReady, online } from '../../state/offline';
import { readFile } from '../download';
import './start.css';

function ago(t: number) {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString();
}

/** Latitudes shown on the world strip (the poles are cut off). */
const LAT_TOP = 80;
const LAT_BOTTOM = -57;

/** The world in OpenFront's own terrain colours, drawn from the picker's country outlines. */
function WorldStrip() {
  const ref = useRef<HTMLCanvasElement>(null);
  const world = countriesLow.value;

  useEffect(() => {
    ensureCountries().catch(() => {});
  }, []);

  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext('2d');
    if (!cv || !ctx || !world) return;
    const { width: W, height: H } = cv;
    const px = (lon: number) => ((lon + 180) / 360) * W;
    const py = (lat: number) => ((LAT_TOP - lat) / (LAT_TOP - LAT_BOTTOM)) * H;
    ctx.clearRect(0, 0, W, H);
    ctx.beginPath();
    for (const f of world.features) {
      const g = f.geometry;
      const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
      for (const poly of polys)
        for (const ring of poly) {
          for (let i = 0; i < ring.length; i++) {
            const x = px(ring[i][0]);
            const y = py(ring[i][1]);
            if (i) ctx.lineTo(x, y);
            else ctx.moveTo(x, y);
          }
          ctx.closePath();
        }
    }
    ctx.fillStyle = 'rgb(190,210,138)';
    ctx.fill('evenodd');
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(52,74,40,.5)';
    ctx.stroke();
    cv.dataset.ready = '';
  }, [world]);

  return <canvas ref={ref} class="world" width={1680} height={640} aria-hidden="true" />;
}

export function StartScreen() {
  const [recent, setRecent] = useState<RecentEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const projectInput = useRef<HTMLInputElement>(null);
  const importInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listRecent().then(setRecent);
  }, []);

  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));

  const onProject = async (files: FileList | null) => {
    if (!files?.[0]) return;
    try {
      openInEditor(openProject(await readFile(files[0])));
    } catch (e) {
      fail(e);
    }
  };

  const onImport = async (files: FileList | null) => {
    const list = [...(files ?? [])];
    const png = list.find((f) => f.name.toLowerCase().endsWith('.png'));
    const info = list.find((f) => f.name.toLowerCase().endsWith('.json'));
    if (!png || !info) {
      setError('Pick both image.png and info.json from the map folder.');
      return;
    }
    try {
      openInEditor(importOpenFrontMap(await readFile(png), await info.text()));
    } catch (e) {
      fail(e);
    }
  };

  const resume = async (r: RecentEntry) => {
    const s = await loadAutosave(r.id);
    if (s) openInEditor(s);
    else setError(`"${r.name}" could not be restored from this browser's storage.`);
  };

  return (
    <main class="start screen-in">
      <header class="start-head">
        <i aria-hidden="true" class="ph-bold ph-map-trifold" />
        <h1>FrontMapper</h1>
        <span>Map maker for OpenFront</span>
        {!online.value ? (
          <span class="conn off" role="status">
            <i aria-hidden="true" class="ph ph-cloud-slash" />
            Offline: editing works, Earth needs a connection
          </span>
        ) : (
          offlineReady.value && (
            <span class="conn" title="FrontMapper is saved on this device and opens without a connection.">
              <i aria-hidden="true" class="ph ph-cloud-check" />
              Works offline
            </span>
          )
        )}
      </header>

      {error && (
        <div class="start-error" role="alert">
          <i aria-hidden="true" class="ph-bold ph-warning" />
          <span>{error}</span>
          <button class="icon-btn sm" aria-label="Dismiss" onClick={() => setError(null)}>
            <i aria-hidden="true" class="ph ph-x" />
          </button>
        </div>
      )}

      <div class="start-grid">
        <section class="start-col">
          <h2>New map</h2>
          <button class="earth-card" disabled={!online.value} onClick={() => (screen.value = 'earth')}>
            <WorldStrip />
            <span class="earth-card-txt">
              <b>From Earth</b>
              <small>{online.value ? 'Pick countries or an area on the satellite view and convert it.' : 'Needs an internet connection for satellite imagery and terrain.'}</small>
            </span>
            <i aria-hidden="true" class="ph-bold ph-arrow-right earth-card-go" />
          </button>

          <NewMapCard onError={setError} />

          <h2>Open</h2>
          <div class="open-row">
            <button class="open-card" onClick={() => projectInput.current?.click()}>
              <i aria-hidden="true" class="ph ph-folder-open" />
              <span>
                <b>Project file</b>
                <small>A .frontmap file saved from FrontMapper.</small>
              </span>
            </button>
            <button class="open-card" onClick={() => importInput.current?.click()}>
              <i aria-hidden="true" class="ph ph-download-simple" />
              <span>
                <b>OpenFront map</b>
                <small>image.png and info.json from map-generator/assets/maps.</small>
              </span>
            </button>
          </div>
          <input ref={projectInput} type="file" accept=".frontmap" hidden onChange={(e) => { const el = e.currentTarget as HTMLInputElement; void onProject(el.files).finally(() => (el.value = '')); }} />
          <input ref={importInput} type="file" accept=".png,.json" multiple hidden onChange={(e) => { const el = e.currentTarget as HTMLInputElement; void onImport(el.files).finally(() => (el.value = '')); }} />
        </section>

        <section class="start-col">
          <h2>Recent</h2>
          {recent === null && (
            <ul class="recent" aria-busy="true" aria-label="Loading recent maps">
              <li class="recent-skel" />
              <li class="recent-skel" />
              <li class="recent-skel" />
            </ul>
          )}
          {recent?.length === 0 && (
            <div class="recent-empty">
              <i aria-hidden="true" class="ph ph-clock-counter-clockwise" />
              <p>Maps you work on are saved in this browser and show up here.</p>
            </div>
          )}
          {recent && recent.length > 0 && (
            <ul class="recent">
              {recent.map((r) => (
                <li key={r.id}>
                  <button class="recent-item" onClick={() => resume(r)}>
                    <span class="recent-shape" aria-hidden="true">
                      <b style={{ aspectRatio: `${r.width} / ${r.height}` }} />
                    </span>
                    <span class="recent-txt">
                      <b>{r.name}</b>
                      <small class="mono">{`${r.width} × ${r.height}`}</small>
                    </span>
                    <small class="recent-when">{ago(r.updatedAt)}</small>
                  </button>
                  <button
                    class="icon-btn recent-del"
                    aria-label={`Remove ${r.name} from recent`}
                    title="Remove from recent"
                    onClick={async () => {
                      await forgetAutosave(r.id).catch(() => undefined);
                      setRecent(await listRecent());
                    }}
                  >
                    <i aria-hidden="true" class="ph ph-trash" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
