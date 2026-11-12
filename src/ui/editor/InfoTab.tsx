import { useState } from 'preact/hooks';
import { CATEGORIES, deriveIds, THEMES, type MapMeta } from '../../core/info';
import { cropTo, infoErrors, resizeTo } from '../../state/mapOps';
import { meta, project, selection } from '../../state/store';

const label = (s: string) => s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

function set(patch: Partial<MapMeta>) {
  meta.value = { ...meta.value, ...patch };
}

function toggle(list: string[] | undefined, v: string) {
  const cur = list ?? [];
  return cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
}

export function InfoTab() {
  const m = meta.value;
  const ids = deriveIds(m.name);
  const errors = infoErrors.value;
  const nameError = errors.find((e) => e.startsWith('Map name'));
  return (
    <>
      <section class="grp field-grp">
        <label class="field">
          <span>Map name</span>
          <input type="text" value={m.name} aria-invalid={!!nameError} onInput={(e) => set({ name: (e.currentTarget as HTMLInputElement).value })} />
          {nameError && <span class="field-error">{nameError.replace('Map name: ', '')}</span>}
        </label>
        <p class="derived mono">
          {`folder ${ids.folder}`}
          <br />
          {`id ${ids.id}`}
        </p>
        {ids.canonicalName && ids.canonicalName !== m.name.trim() && (
          <p class="note">{`Shown in game as "${m.name.trim()}", stored as "${ids.canonicalName}".`}</p>
        )}
        <label class="field">
          <span>Author</span>
          <input type="text" value={m.author ?? ''} onInput={(e) => set({ author: (e.currentTarget as HTMLInputElement).value })} />
        </label>
        <label class="field">
          <span>Description</span>
          <textarea rows={3} value={m.description ?? ''} onInput={(e) => set({ description: (e.currentTarget as HTMLTextAreaElement).value })} />
        </label>
      </section>

      <section class="grp">
        <h4>Categories</h4>
        <div class="chips" role="group" aria-label="Categories">
          {CATEGORIES.map((c) => {
            const on = m.categories.includes(c);
            return (
              <button key={c} class={`pill${on ? ' on' : ''}`} aria-pressed={on} onClick={() => set({ categories: toggle(m.categories, c) })}>
                {label(c)}
              </button>
            );
          })}
        </div>
        {!m.categories.length && <span class="field-error">Pick at least one</span>}
      </section>

      <section class="grp">
        <h4>Bot tribe names</h4>
        <div class="chips" role="group" aria-label="Tribe name themes">
          {THEMES.map((t) => {
            const on = !!m.themes?.includes(t);
            return (
              <button key={t} class={`pill${on ? ' on' : ''}`} aria-pressed={on} onClick={() => set({ themes: toggle(m.themes, t) })}>
                {label(t)}
              </button>
            );
          })}
        </div>
      </section>

      {m.location && (
        <section class="grp">
          <h4>Location</h4>
          <p class="derived mono">{`${m.location.lat.toFixed(2)}, ${m.location.lon.toFixed(2)}`}</p>
        </section>
      )}

      <MapSize />
    </>
  );
}

function MapSize() {
  const p = project.value;
  const [w, setW] = useState(p?.grid.width ?? 0);
  const [h, setH] = useState(p?.grid.height ?? 0);
  if (!p) return null;
  const sel = selection.value;
  const changed = w !== p.grid.width || h !== p.grid.height;
  return (
    <section class="grp">
      <h4>Map size</h4>
      <div class="size-row">
        <input type="number" step={4} min={4} value={w} aria-label="Width" onInput={(e) => setW(+(e.currentTarget as HTMLInputElement).value)} />
        <i aria-hidden="true" class="ph ph-x" style={{ fontSize: 10 }} />
        <input type="number" step={4} min={4} value={h} aria-label="Height" onInput={(e) => setH(+(e.currentTarget as HTMLInputElement).value)} />
        <button class="btn" disabled={!changed || w < 4 || h < 4} onClick={() => resizeTo(w, h)}>Resize</button>
      </div>
      {sel && (
        <button class="btn grp-action" onClick={() => cropTo(sel)}>
          <i aria-hidden="true" class="ph ph-crop" />
          {`Crop to selection (${sel.w - (sel.w % 4)} × ${sel.h - (sel.h % 4)})`}
        </button>
      )}
      <p class="note">Resizing and cropping move nations with the map and start a fresh undo history.</p>
    </section>
  );
}
