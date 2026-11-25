import type { ComponentChildren } from 'preact';
import type { ViewMode } from '../../render/renderer';
import { canRedo, canUndo, meta, project, view } from '../../state/store';
import { autosaveError } from '../../state/autosave';

const VIEWS: { id: ViewMode; label: string }[] = [
  { id: 'game', label: 'Game' },
  { id: 'elevation', label: 'Elevation' },
  { id: 'export', label: 'After export' },
];

interface Props {
  onUndo: () => void;
  onRedo: () => void;
  /** Extra actions on the right (Earth, Save, Export...). */
  actions?: ComponentChildren;
  onHome?: () => void;
  /** Small tools before the view switch. */
  tools?: ComponentChildren;
}

export function TopBar({ onUndo, onRedo, actions, onHome, tools }: Props) {
  const p = project.value;
  return (
    <header class="ed-top">
      {onHome ? (
        <button class="icon-btn ed-home" aria-label="Back to start" title="Back to start" onClick={onHome}>
          <i aria-hidden="true" class="ph-bold ph-map-trifold" />
        </button>
      ) : (
        <i aria-hidden="true" class="ph-bold ph-map-trifold" style={{ fontSize: 17, margin: '0 5px' }} />
      )}
      <span class="ed-title">
        {meta.value.name.trim() || 'Untitled map'}
        {p && <small>{`${p.grid.width} × ${p.grid.height}`}</small>}
      </span>
      {autosaveError.value && (
        <span class="save-warn" role="status" title={`Saving to this browser failed: ${autosaveError.value} Use Save to keep a copy.`}>
          <i aria-hidden="true" class="ph-bold ph-warning" />
          Not saved in browser
        </span>
      )}
      <span class="bar-sep" />
      <div class="ed-history">
        <button class="icon-btn" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!canUndo.value} onClick={onUndo}>
          <i aria-hidden="true" class="ph ph-arrow-counter-clockwise" />
        </button>
        <button class="icon-btn" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={!canRedo.value} onClick={onRedo}>
          <i aria-hidden="true" class="ph ph-arrow-clockwise" />
        </button>
      </div>
      <div class="grow" />
      {tools}
      {tools && <span class="bar-sep" />}
      <div class="seg" role="group" aria-label="View">
        {VIEWS.map((v) => (
          <button key={v.id} class={view.value === v.id ? 'on' : ''} aria-pressed={view.value === v.id} onClick={() => (view.value = v.id)}>
            {v.label}
          </button>
        ))}
      </div>
      {actions && <span class="bar-sep" />}
      {actions}
    </header>
  );
}
