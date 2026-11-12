import { useMemo } from 'preact/hooks';
import { simulateExport } from '../core/generator';
import type { Renderer, ViewMode } from '../render/renderer';
import { EditorCanvas } from '../ui/editor/EditorCanvas';
import { buildFixture } from './fixtures';

/** Bare renderer on a fixture map, driven by tests through `window.__fm`. Dev builds only. */
export function FixtureView({ name }: { name: string }) {
  const grid = useMemo(() => buildFixture(name), [name]);
  const onReady = (r: Renderer) => {
    queueMicrotask(() => {
      (window as any).__fm = {
        ready: true,
        renderer: r,
        readMapPixel: (x: number, y: number) => r.readMapPixel(x, y),
        mapToScreen: (x: number, y: number) => r.mapToScreen(x, y),
        setView: (v: ViewMode) => r.setView(v),
        simulate: () => r.setExportSim(simulateExport(r.grid!)),
        maxTextureDim: () => r.maxTextureDim(),
        idle: async () => {
          await r.scheduler?.whenIdle();
          await new Promise((res) => requestAnimationFrame(() => res(null)));
        },
      };
    });
  };
  if (!grid) return <p>Unknown fixture</p>;
  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex' }}>
      <EditorCanvas grid={grid} onReady={onReady} />
    </div>
  );
}
