import type { ComponentChildren } from 'preact';
import { signal } from '@preact/signals';

export type SideTab = 'checks' | 'nations' | 'info';
export const sideTab = signal<SideTab>('checks');

const TABS: { id: SideTab; label: string }[] = [
  { id: 'checks', label: 'Checks' },
  { id: 'nations', label: 'Nations' },
  { id: 'info', label: 'Info' },
];

export function SidePanel({ panes }: { panes: Record<SideTab, ComponentChildren> }) {
  return (
    <aside class="ed-side">
      <div class="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={sideTab.value === t.id} class={sideTab.value === t.id ? 'on' : ''} onClick={() => (sideTab.value = t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div class="pane" role="tabpanel">
        {panes[sideTab.value]}
      </div>
    </aside>
  );
}
