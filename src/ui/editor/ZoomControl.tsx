import type { EditorController } from '../../state/controller';
import { zoom } from '../../state/store';

/** Zoom readout and buttons in the corner of the canvas. */
export function ZoomControl({ controller }: { controller: EditorController }) {
  const z = zoom.value;
  const pct = z * 100;
  return (
    <div class="zoom" role="group" aria-label="Zoom">
      <button class="icon-btn sm" aria-label="Zoom out" title="Zoom out (-)" onClick={() => controller.renderer?.zoomBy(1 / 1.5)}>
        <i aria-hidden="true" class="ph ph-minus" />
      </button>
      <button class="zoom-val" title="Actual size: one screen pixel per map pixel" onClick={() => controller.renderer?.zoomBy(1 / z)}>
        {`${pct < 10 ? pct.toFixed(1) : Math.round(pct)}%`}
      </button>
      <button class="icon-btn sm" aria-label="Zoom in" title="Zoom in (+)" onClick={() => controller.renderer?.zoomBy(1.5)}>
        <i aria-hidden="true" class="ph ph-plus" />
      </button>
      <span class="bar-sep" />
      <button class="icon-btn sm" aria-label="Fit map to view" title="Fit map to view (0)" onClick={() => controller.renderer?.fit()}>
        <i aria-hidden="true" class="ph ph-corners-out" />
      </button>
    </div>
  );
}
