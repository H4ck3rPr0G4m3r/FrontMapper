import type { ComponentChildren } from 'preact';
import { signal } from '@preact/signals';
import { nations } from '../../state/store';
import { openChecks } from './ChecksTab';

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
            {t.id === 'checks' && openChecks.value > 0 && <span class="tab-n warn" aria-hidden="true">{openChecks.value}</span>}
            {t.id === 'nations' && nations.value.length > 0 && <span class="tab-n" aria-hidden="true">{nations.value.length}</span>}
          </button>
        ))}
      </div>
      <div class="pane" role="tabpanel">
        {panes[sideTab.value]}
      </div>
    </aside>
  );
}
