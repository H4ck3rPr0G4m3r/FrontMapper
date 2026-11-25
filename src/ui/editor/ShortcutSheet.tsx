import { signal } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import { TOOL_INFO } from './ToolRail';

export const shortcutsOpen = signal(false);

type Row = [keys: string[][], what: string];

const GROUPS: { title: string; rows: Row[] }[] = [
  {
    title: 'Tools',
    rows: Object.values(TOOL_INFO).map((t) => [[[t.key]], t.label] as Row),
  },
  {
    title: 'View',
    rows: [
      [[['Space']], 'Hold to pan with any tool'],
      [[['Scroll']], 'Zoom at the cursor'],
      [[['+'], ['-']], 'Zoom in, zoom out'],
      [[['0']], 'Fit the map'],
    ],
  },
  {
    title: 'Painting',
    rows: [
      [[['['], [']']], 'Smaller, larger brush'],
      [[['Alt']], 'Hold to lower (Raise / lower)'],
    ],
  },
  {
    title: 'Selection',
    rows: [
      [[['Shift']], 'Hold to add to the selection'],
      [[['Alt']], 'Hold to take from the selection'],
      [[['Ctrl', 'drag']], 'Drag out a copy'],
      [[['Ctrl', 'C'], ['Ctrl', 'X'], ['Ctrl', 'V']], 'Copy, cut, paste'],
      [[['Delete']], 'Fill with what surrounds it'],
      [[['Enter']], 'Place a moved or pasted piece'],
      [[['Esc']], 'Cancel the piece, or clear the selection'],
    ],
  },
  {
    title: 'Map',
    rows: [
      [[['Ctrl', 'Z']], 'Undo'],
      [[['Ctrl', 'Shift', 'Z'], ['Ctrl', 'Y']], 'Redo'],
      [[['Ctrl', 'S']], 'Save a project file'],
      [[['?']], 'Show these shortcuts'],
    ],
  },
];

/** Keyboard shortcuts, grouped. Opens with ? or from the top bar. */
export function ShortcutSheet() {
  const panel = useRef<HTMLDivElement>(null);
  const open = shortcutsOpen.value;
  useEffect(() => {
    if (!open) return;
    const back = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === '?') {
        e.preventDefault();
        e.stopImmediatePropagation();
        shortcutsOpen.value = false;
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      back?.focus();
    };
  }, [open]);
  if (!open) return null;
  return (
    <div class="scrim" onClick={() => (shortcutsOpen.value = false)}>
      <div ref={panel} class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title" tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <header>
          <h2 id="sheet-title">Keyboard shortcuts</h2>
          <button class="icon-btn sm" aria-label="Close" onClick={() => (shortcutsOpen.value = false)}>
            <i aria-hidden="true" class="ph ph-x" />
          </button>
        </header>
        <div class="sheet-cols">
          {GROUPS.map((g) => (
            <section key={g.title}>
              <h3>{g.title}</h3>
              <dl>
                {g.rows.map(([keys, what]) => (
                  <div key={what} class="sheet-row">
                    <dt>
                      {keys.map((combo, k) => (
                        <span key={k} class="combo">
                          {combo.map((key) => <kbd key={key}>{key}</kbd>)}
                        </span>
                      ))}
                    </dt>
                    <dd>{what}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
