import { useEffect, useMemo, useRef } from 'preact/hooks';
import { effect } from '@preact/signals';
import { AnalysisClient } from '../../state/analysis';
import { SpawnRoomClient } from '../../state/spawnRoom';
import { refImage } from '../../state/refImage';
import { acceptedChecks } from '../../state/checks';
import { ChecksTab } from './ChecksTab';
import { NationsTab } from './NationsTab';
import { InfoTab } from './InfoTab';
import { ExportActions } from './ExportActions';
import { editOnEarth } from '../../state/conversion';
import { AutoSaver } from '../../state/autosave';
import { currentProjectState, exportState, saveProjectFile } from '../../state/projectIO';
import { backToStart } from '../../state/session';
import { loadFlags } from '../../state/flags';
import type { Overlay } from '../../render/overlay';
import type { Renderer } from '../../render/renderer';
import { EditorController } from '../../state/controller';
import { brushDiameter, busy, canRedo, canUndo, meta, nations, project, revision, riverPreview, selection, spacePan, tool, view } from '../../state/store';
import { ZoomControl } from './ZoomControl';
import { Minimap } from './Minimap';
import { BottomBar } from './BottomBar';
import { EditorCanvas } from './EditorCanvas';
import { SidePanel, sideTab } from './SidePanel';
import { TOOL_KEYS, ToolRail } from './ToolRail';
import { TopBar } from './TopBar';
import { TopTools } from './TopTools';
import { ShortcutSheet, shortcutsOpen } from './ShortcutSheet';
import './editor.css';

interface Props {
  /** Called once the renderer exists (other features hook in here). */
  onReady?: (c: EditorController) => void;
}

export function Editor({ onReady }: Props) {
  const p = project.value;
  const controller = useMemo(() => (p ? new EditorController(p.grid) : null), [p?.grid]);
  const saver = useRef<AutoSaver | null>(null);

  useEffect(() => {
    if (!controller) return;
    loadFlags();
    // A new grid (opened, cropped, resized) starts with an empty history and no pending work.
    canUndo.value = controller.history.canUndo;
    canRedo.value = controller.history.canRedo;
    busy.value = false;
    if (exportState.value.phase === 'error') exportState.value = { phase: 'idle' };
    controller.onNationPicked = () => (sideTab.value = 'nations');
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 's') {
        e.preventDefault();
        if (!e.repeat) saveProjectFile(controller);
        return;
      }
      if (target.closest('input, textarea, select, [contenteditable]') || shortcutsOpen.value) return;
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
      if ((e.ctrlKey || e.metaKey) && (k === 'c' || k === 'x' || k === 'v')) {
        e.preventDefault();
        if (k === 'c') controller.copy();
        else if (k === 'x') controller.cut();
        else controller.paste();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === '?') {
        shortcutsOpen.value = true;
        return;
      }
      if (k === ' ') {
        if (!spacePan.value) spacePan.value = true;
        controller.updateCursor();
        e.preventDefault();
        return;
      }
      if (k === 'escape') {
        if (controller.hasFloat) controller.cancelFloat();
        else if (riverPreview.value) controller.clearRiverPreview();
        else selection.value = null;
      } else if (k === 'enter' && controller.hasFloat) controller.placeFloat();
      else if ((k === 'delete' || k === 'backspace') && selection.value) controller.clearSelection();
      else if (k === '0') controller.renderer?.fit();
      else if (k === '+' || k === '=') controller.renderer?.zoomBy(1.5);
      else if (k === '-') controller.renderer?.zoomBy(1 / 1.5);
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
    // Keys released while another window has focus never reach us.
    const onBlur = () => {
      spacePan.value = false;
      controller.cancelPointer();
      controller.updateCursor();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    const stopView = effect(() => controller.renderer?.setView(view.value));
    // Switching tools puts down anything still floating.
    const stopTool = effect(() => {
      if (tool.value !== 'select' && tool.value !== 'wand' && tool.value !== 'pan') controller.placeFloat();
    });
    const stopMarks = effect(() => controller.renderer?.setHiddenMarks(acceptedChecks.value));
    const stopRef = effect(() => {
      refImage.value;
      controller.renderer?.requestDraw();
    });
    const client = new AnalysisClient(controller.grid, () => controller.renderer);
    controller.analysis = client;
    const stopAnalysis = effect(() => client.schedule(revision.value));
    const rooms = new SpawnRoomClient(controller.grid);
    const stopRooms = effect(() => {
      revision.value;
      rooms.schedule(nations.value);
    });
    const autosaver = new AutoSaver(() => currentProjectState(controller));
    saver.current = autosaver;
    void autosaver.flush(); // a new or reopened map shows up in Recent right away
    let first = true;
    const stopSave = effect(() => {
      revision.value;
      meta.value;
      nations.value;
      acceptedChecks.value;
      if (first) first = false;
      else autosaver.schedule();
    });
    const flushSave = () => void autosaver.flush();
    window.addEventListener('pagehide', flushSave);
    return () => {
      controller.placeFloat();
      stopSave();
      window.removeEventListener('pagehide', flushSave);
      void autosaver.flush();
      autosaver.dispose();
      saver.current = null;
      busy.value = false;
      spacePan.value = false;
      stopAnalysis();
      client.dispose();
      stopRooms();
      rooms.dispose();
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      stopView();
      stopTool();
      stopMarks();
      stopRef();
    };
  }, [controller]);

  const title = meta.value.name.trim() || 'Untitled map';
  useEffect(() => {
    document.title = `${title} · FrontMapper`;
    return () => {
      document.title = 'FrontMapper';
    };
  }, [title]);

  if (!p || !controller) return null;

  // Save before leaving: once the project is cleared there is nothing left to snapshot.
  const goHome = () => {
    controller.placeFloat();
    void saver.current?.flush();
    backToStart();
  };
  const goEarth = () => {
    controller.placeFloat();
    const s = currentProjectState(controller);
    if (!s) return;
    void saver.current?.flush();
    editOnEarth(s);
  };

  const ready = (r: Renderer, o: Overlay) => {
    controller.attach(r, o);
    r.setView(view.value);
    r.setHiddenMarks(acceptedChecks.value);
    if (import.meta.env.DEV) installDevHook(controller, r);
    onReady?.(controller);
  };

  return (
    <div class="ed screen-in">
      <TopBar tools={<TopTools controller={controller} />} onUndo={() => controller.undo()} onRedo={() => controller.redo()} actions={<ExportActions controller={controller} onEarth={p.earth ? goEarth : undefined} />} onHome={goHome} />
      <div class="ed-body">
        <ToolRail />
        <div class="ed-center">
          <EditorCanvas
            key={gridKey(p.grid)}
            grid={p.grid}
            initialCamera={p.camera}
            onReady={ready}
            wantsPan={controller.wantsPan}
            onDown={controller.onDown}
            onMove={controller.onMove}
            onUp={controller.onUp}
            onLeave={controller.onLeave}
            onCancel={() => controller.cancelPointer()}
          >
            <ZoomControl controller={controller} />
            <Minimap controller={controller} />
          </EditorCanvas>
          <BottomBar controller={controller} />
        </div>
        <ShortcutSheet />
        <SidePanel
          panes={{
            checks: <ChecksTab controller={controller} />,
            nations: <NationsTab controller={controller} />,
            info: <InfoTab />,
          }}
        />
      </div>
    </div>
  );
}

const gridKeys = new WeakMap<object, number>();
let nextGridKey = 1;
/** Stable key per grid object, so replacing the grid (crop, resize, convert) remounts the canvas. */
function gridKey(g: object) {
  let k = gridKeys.get(g);
  if (!k) gridKeys.set(g, (k = nextGridKey++));
  return k;
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
    selection: () => selection.value,
    idle: async () => {
      await r.scheduler?.whenIdle();
      await new Promise((res) => requestAnimationFrame(() => res(null)));
    },
  };
}
