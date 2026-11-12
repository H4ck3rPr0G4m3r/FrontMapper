import type { ComponentChildren } from 'preact';
import type { ViewMode } from '../../render/renderer';
import { canRedo, canUndo, project, view } from '../../state/store';

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
}

export function TopBar({ onUndo, onRedo, actions }: Props) {
  const p = project.value;
  return (
    <header class="ed-top">
      <i class="ph-bold ph-map-trifold" style={{ fontSize: 16 }} />
      <span class="ed-title">
        {p?.name ?? 'Untitled map'}
        {p && <small>{`${p.grid.width} × ${p.grid.height}`}</small>}
      </span>
      <button class="icon-btn" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!canUndo.value} onClick={onUndo}>
        <i class="ph ph-arrow-counter-clockwise" />
      </button>
      <button class="icon-btn" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={!canRedo.value} onClick={onRedo}>
        <i class="ph ph-arrow-clockwise" />
      </button>
      <div class="grow" />
      <div class="seg" role="group" aria-label="View">
        {VIEWS.map((v) => (
          <button key={v.id} class={view.value === v.id ? 'on' : ''} aria-pressed={view.value === v.id} onClick={() => (view.value = v.id)}>
            {v.label}
          </button>
        ))}
      </div>
      {actions}
    </header>
  );
}
