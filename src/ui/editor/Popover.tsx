import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

/** An icon button in a bar that opens a small panel under it. Closes on Esc or a click outside. */
export function Popover(props: { icon: string; label: string; active?: boolean; children: (close: () => void) => ComponentChildren }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        setOpen(false);
      }
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);
  return (
    <div class="pop" ref={root}>
      <button
        class={`icon-btn${props.active ? ' active' : ''}`}
        aria-label={props.label}
        title={props.label}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(!open)}
      >
        <i aria-hidden="true" class={`ph ${props.icon}`} />
      </button>
      {open && (
        <div class="pop-panel" role="dialog" aria-label={props.label}>
          {props.children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
