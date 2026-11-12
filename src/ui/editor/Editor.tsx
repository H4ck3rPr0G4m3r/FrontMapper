import { useEffect, useMemo } from 'preact/hooks';
import { effect } from '@preact/signals';
import type { Overlay } from '../../render/overlay';
import type { Renderer } from '../../render/renderer';
import { EditorController } from '../../state/controller';
import { brushDiameter, project, selection, spacePan, tool, view } from '../../state/store';
import { BottomBar } from './BottomBar';
import { EditorCanvas } from './EditorCanvas';
import { SidePanel } from './SidePanel';
import { TOOL_KEYS, ToolRail } from './ToolRail';
import { TopBar } from './TopBar';
import './editor.css';

interface Props {
  /** Called once the renderer exists (other features hook in here). */
  onReady?: (c: EditorController) => void;
}

export function Editor({ onReady }: Props) {
  const p = project.value;
  const controller = useMemo(() => (p ? new EditorController(p.grid) : null), [p?.grid]);

  useEffect(() => {
    if (!controller) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, select, [contenteditable]')) return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 'z') {
        e.preventDefault();
        e.shiftKey ? controller.redo() : controller.undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && k === 'y') {
        e.preventDefault();
        controller.redo();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (k === ' ') {
        if (!spacePan.value) spacePan.value = true;
        controller.updateCursor();
        e.preventDefault();
        return;
      }
      if (k === 'escape') selection.value = null;
      else if (k === '[') brushDiameter.value = Math.max(1, brushDiameter.value - (brushDiameter.value > 20 ? 4 : 1));
      else if (k === ']') brushDiameter.value = Math.min(256, brushDiameter.value + (brushDiameter.value >= 20 ? 4 : 1));
      else if (TOOL_KEYS[k]) tool.value = TOOL_KEYS[k];
      else return;
      controller.updateCursor();
      controller.renderer?.requestDraw();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') {
        spacePan.value = false;
        controller.updateCursor();
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    const stopView = effect(() => controller.renderer?.setView(view.value));
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      stopView();
    };
  }, [controller]);

  if (!p || !controller) return null;

  const ready = (r: Renderer, o: Overlay) => {
    controller.attach(r, o);
    r.setView(view.value);
    if (import.meta.env.DEV) installDevHook(controller, r);
    onReady?.(controller);
  };

  return (
    <div class="ed">
      <TopBar onUndo={() => controller.undo()} onRedo={() => controller.redo()} />
      <div class="ed-body">
        <ToolRail />
        <div class="ed-center">
          <EditorCanvas
            grid={p.grid}
            onReady={ready}
            wantsPan={controller.wantsPan}
            onDown={controller.onDown}
            onMove={controller.onMove}
            onUp={controller.onUp}
            onLeave={controller.onLeave}
          />
          <BottomBar onTextureSelection={() => controller.textureSelection()} />
        </div>
        <SidePanel
          panes={{
            checks: <p class="empty-note">Checks appear here after the map is analysed.</p>,
            nations: <p class="empty-note">No nations yet. Use the spawn tool to place one.</p>,
            info: <p class="empty-note">Map details will appear here.</p>,
          }}
        />
      </div>
    </div>
  );
}

function installDevHook(c: EditorController, r: Renderer) {
  (window as any).__fm = {
    ready: true,
    controller: c,
    renderer: r,
    /** Footprint cells as [dx, dy] pairs. */
    get lastBrushCells() {
      const f = c.lastBrushCells;
      if (!f) return null;
      const out: [number, number][] = [];
      for (let k = 0; k < f.length; k += 2) out.push([f[k], f[k + 1]]);
      return out;
    },
    readMapPixel: (x: number, y: number) => r.readMapPixel(x, y),
    mapToScreen: (x: number, y: number) => r.mapToScreen(x, y),
    setBrushDiameter: (d: number) => (brushDiameter.value = d),
    view: () => view.value,
    idle: async () => {
      await r.scheduler?.whenIdle();
      await new Promise((res) => requestAnimationFrame(() => res(null)));
    },
  };
}
