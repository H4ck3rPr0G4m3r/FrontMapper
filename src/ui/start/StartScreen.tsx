import { useEffect, useRef, useState } from 'preact/hooks';
import { importOpenFrontMap, openProject } from '../../core/project';
import { forgetAutosave, listRecent, loadAutosave, type RecentEntry } from '../../state/autosave';
import { newBlankMap, openInEditor, screen } from '../../state/session';
import { readFile } from '../download';
import './start.css';

const PRESETS: [number, number][] = [
  [2000, 1500],
  [3000, 2000],
  [4000, 2500],
];

function ago(t: number) {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString();
}

export function StartScreen() {
  const [w, setW] = useState(3000);
  const [h, setH] = useState(2000);
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
    <main class="start">
      <header class="start-head">
        <i aria-hidden="true" class="ph-bold ph-map-trifold" />
        <h1>FrontMapper</h1>
        <span>Map maker for OpenFront</span>
      </header>

      {error && (
        <div class="start-error" role="alert">
          <span>{error}</span>
          <button class="icon-btn" aria-label="Dismiss" onClick={() => setError(null)}>
            <i aria-hidden="true" class="ph ph-x" />
          </button>
        </div>
      )}

      <div class="start-grid">
        <section class="start-col">
          <h2>New map</h2>
          <button class="start-action" onClick={() => (screen.value = 'earth')}>
            <i aria-hidden="true" class="ph ph-globe-hemisphere-east" />
            <span>
              <b>From Earth</b>
              <small>Pick countries or an area on the satellite view and convert it.</small>
            </span>
          </button>
          <div class="start-action blank">
            <i aria-hidden="true" class="ph ph-paint-brush" />
            <span>
              <b>Blank map</b>
              <small>All water. Paint land, then texture it.</small>
              <span class="presets" role="group" aria-label="Size presets">
                {PRESETS.map(([pw, ph]) => (
                  <button key={pw} class={`pill${pw === w && ph === h ? ' on' : ''}`} onClick={() => { setW(pw); setH(ph); }}>
                    {`${pw} × ${ph}`}
                  </button>
                ))}
              </span>
              <span class="blank-size">
                <label>
                  Width
                  <input type="number" step={4} min={4} value={w} onInput={(e) => setW(+(e.currentTarget as HTMLInputElement).value)} />
                </label>
                <label>
                  Height
                  <input type="number" step={4} min={4} value={h} onInput={(e) => setH(+(e.currentTarget as HTMLInputElement).value)} />
                </label>
                <button class="btn primary" disabled={w < 4 || h < 4} onClick={() => newBlankMap(w, h)}>
                  Create blank map
                </button>
              </span>
            </span>
          </div>
          <h2>Open</h2>
          <button class="start-action" onClick={() => projectInput.current?.click()}>
            <i aria-hidden="true" class="ph ph-folder-open" />
            <span>
              <b>Project file</b>
              <small>A .frontmap file saved from FrontMapper.</small>
            </span>
          </button>
          <button class="start-action" onClick={() => importInput.current?.click()}>
            <i aria-hidden="true" class="ph ph-download-simple" />
            <span>
              <b>OpenFront map</b>
              <small>image.png and info.json from map-generator/assets/maps.</small>
            </span>
          </button>
          <input ref={projectInput} type="file" accept=".frontmap" hidden onChange={(e) => onProject((e.currentTarget as HTMLInputElement).files)} />
          <input ref={importInput} type="file" accept=".png,.json" multiple hidden onChange={(e) => onImport((e.currentTarget as HTMLInputElement).files)} />
        </section>

        <section class="start-col">
          <h2>Recent</h2>
          {recent === null && <p class="empty-note">Loading…</p>}
          {recent?.length === 0 && <p class="empty-note">Maps you work on are saved in this browser and show up here.</p>}
          {recent && recent.length > 0 && (
            <ul class="recent">
              {recent.map((r) => (
                <li key={r.id}>
                  <button class="recent-item" onClick={() => resume(r)}>
                    <b>{r.name}</b>
                    <small class="mono">{`${r.width} × ${r.height}`}</small>
                    <small>{ago(r.updatedAt)}</small>
                  </button>
                  <button
                    class="icon-btn"
                    aria-label={`Remove ${r.name} from recent`}
                    onClick={async () => {
                      await forgetAutosave(r.id);
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
