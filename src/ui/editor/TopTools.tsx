import { useEffect, useRef, useState } from 'preact/hooks';
import type { EditorController } from '../../state/controller';
import { checkpointError, checkpoints, deleteCheckpoint, loadCheckpoints, readCheckpoint, saveCheckpoint, type Checkpoint } from '../../state/checkpoints';
import { currentProjectState } from '../../state/projectIO';
import { loadRefImage, refImage, removeRefImage, setRefImage, updateRefImage } from '../../state/refImage';
import { openInEditor } from '../../state/session';
import { project } from '../../state/store';
import { Popover } from './Popover';
import { shortcutsOpen } from './ShortcutSheet';

/** Reference image, checkpoints and the shortcut sheet: the small tools in the top bar. */
export function TopTools({ controller }: { controller: EditorController }) {
  const id = project.value?.id;
  useEffect(() => {
    if (!id) return;
    void loadCheckpoints(id);
    void loadRefImage(id);
  }, [id]);
  if (!id) return null;
  return (
    <div class="top-tools">
      <Popover icon="ph-image" label="Reference image" active={!!refImage.value?.visible}>
        {() => <ReferencePanel projectId={id} />}
      </Popover>
      <Popover icon="ph-bookmark-simple" label="Checkpoints">
        {(close) => <CheckpointsPanel controller={controller} onRestored={close} />}
      </Popover>
      <button class="icon-btn" aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" onClick={() => (shortcutsOpen.value = true)}>
        <i aria-hidden="true" class="ph ph-keyboard" />
      </button>
    </div>
  );
}

function ReferencePanel({ projectId }: { projectId: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const r = refImage.value;
  const pick = async (f: File | undefined) => {
    if (!f) return;
    try {
      setError(null);
      await setRefImage(projectId, f);
    } catch {
      setError('That file is not an image this browser can open.');
    }
  };
  return (
    <div class="pop-body">
      <h3>Reference image</h3>
      {!r && <p class="pop-note">Show a sketch or map over the terrain to trace from. It stays in this browser and is never exported.</p>}
      {r && (
        <>
          <div class="ref-file">
            <img src={r.img.src} alt="" />
            <span title={r.name}>{r.name}</span>
            <small class="mono">{`${r.img.naturalWidth} × ${r.img.naturalHeight}`}</small>
          </div>
          <label class="pop-ctl">
            Opacity
            <input
              type="range"
              min={5}
              max={100}
              step={5}
              value={Math.round(r.opacity * 100)}
              style={{ '--p': `${((r.opacity * 100 - 5) / 95) * 100}%` }}
              onInput={(e) => updateRefImage(projectId, { opacity: +(e.currentTarget as HTMLInputElement).value / 100 })}
            />
            <span class="val">{`${Math.round(r.opacity * 100)}%`}</span>
          </label>
          <div class="pop-ctl">
            Fit
            <div class="seg" role="group" aria-label="Fit">
              <button class={r.fit === 'stretch' ? 'on' : ''} onClick={() => updateRefImage(projectId, { fit: 'stretch' })}>Stretch to map</button>
              <button class={r.fit === 'contain' ? 'on' : ''} onClick={() => updateRefImage(projectId, { fit: 'contain' })}>Keep shape</button>
            </div>
          </div>
        </>
      )}
      {error && <p class="pop-note err">{error}</p>}
      <div class="pop-actions">
        {r && (
          <>
            <button class="btn sm" onClick={() => void removeRefImage(projectId)}>Remove</button>
            <button class="btn sm" onClick={() => updateRefImage(projectId, { visible: !r.visible })}>{r.visible ? 'Hide' : 'Show'}</button>
          </>
        )}
        <span class="grow" />
        <button class={`btn sm${r ? '' : ' primary'}`} onClick={() => input.current?.click()}>
          <i aria-hidden="true" class="ph ph-upload-simple" />
          {r ? 'Replace…' : 'Choose image…'}
        </button>
      </div>
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => { const el = e.currentTarget as HTMLInputElement; void pick(el.files?.[0]).finally(() => (el.value = '')); }} />
    </div>
  );
}

function ago(t: number) {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString();
}

function CheckpointsPanel({ controller, onRestored }: { controller: EditorController; onRestored: () => void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const list = checkpoints.value;
  const p = project.value;

  const save = async () => {
    controller.placeFloat();
    const s = currentProjectState(controller);
    if (!s) return;
    setBusy('save');
    try {
      await saveCheckpoint(s, name);
      setName('');
    } catch {
      /* shown through checkpointError */
    } finally {
      setBusy(null);
    }
  };

  const restore = async (c: Checkpoint) => {
    controller.placeFloat();
    const now = currentProjectState(controller);
    if (!now || !p) return;
    setBusy(c.id);
    try {
      // The map as it is now becomes a checkpoint too, so restoring can be taken back.
      await saveCheckpoint(now, `Before restoring "${c.name}"`);
      const s = await readCheckpoint(c.id);
      if (!s) throw new Error('This checkpoint is no longer stored in this browser.');
      onRestored();
      openInEditor({ ...s, id: p.id });
    } catch (e) {
      checkpointError.value = e instanceof Error ? e.message : String(e);
    } finally {
      setBusy(null);
      setConfirm(null);
    }
  };

  return (
    <div class="pop-body cp">
      <h3>Checkpoints</h3>
      <form class="cp-new" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <input value={name} placeholder="Name, e.g. before rivers" aria-label="Checkpoint name" onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)} />
        <button class="btn sm primary" type="submit" disabled={busy === 'save'}>
          {busy === 'save' ? 'Saving…' : 'Save'}
        </button>
      </form>
      {checkpointError.value && <p class="pop-note err" role="alert">{checkpointError.value}</p>}
      {list === null && <p class="pop-note" aria-busy="true">Loading…</p>}
      {list?.length === 0 && <p class="pop-note">Save the map as it is now, with a name, and come back to it later. Kept in this browser.</p>}
      {list && list.length > 0 && (
        <ul class="cp-list">
          {list.map((c) => (
            <li key={c.id}>
              <span class="cp-txt">
                <b title={c.name}>{c.name}</b>
                <small>
                  {ago(c.createdAt)}
                  {(c.width !== p?.grid.width || c.height !== p?.grid.height) && <span class="mono">{`, ${c.width} × ${c.height}`}</span>}
                </small>
              </span>
              {confirm === c.id ? (
                <>
                  <button class="btn sm" onClick={() => setConfirm(null)}>Cancel</button>
                  <button class="btn sm primary" disabled={busy === c.id} onClick={() => void restore(c)}>{busy === c.id ? 'Restoring…' : 'Restore'}</button>
                </>
              ) : (
                <>
                  <button class="btn sm" onClick={() => setConfirm(c.id)}>Restore</button>
                  <button class="icon-btn sm" aria-label={`Delete checkpoint ${c.name}`} title="Delete" onClick={() => p && void deleteCheckpoint(p.id, c.id)}>
                    <i aria-hidden="true" class="ph ph-trash" />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {confirm && <p class="pop-note">The map as it is now is saved as a checkpoint first, so you can come back to it.</p>}
    </div>
  );
}
