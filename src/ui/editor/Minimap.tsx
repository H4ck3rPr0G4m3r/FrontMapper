import { useEffect, useRef, useState } from 'preact/hooks';
import { elevationColor, tileColor } from '../../core/colors';
import type { EditorController } from '../../state/controller';
import { camera, revision, view } from '../../state/store';

const MAX_W = 208;
const MAX_H = 128;
const KEY = 'fm:minimap';

function remembered(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

/** Overview of the whole map with the visible area outlined. Click or drag to move there. */
export function Minimap({ controller }: { controller: EditorController }) {
  const [open, setOpen] = useState(remembered);
  const map = useRef<HTMLCanvasElement>(null);
  const g = controller.grid;
  const scale = Math.min(MAX_W / g.width, MAX_H / g.height);
  const tw = Math.max(1, Math.round(g.width * scale)), th = Math.max(1, Math.round(g.height * scale));
  const rev = revision.value;
  const mode = view.value;

  useEffect(() => {
    try {
      localStorage.setItem(KEY, open ? 'on' : 'off');
    } catch {
      /* private mode: just don't remember */
    }
  }, [open]);

  // Redraw the thumbnail a moment after edits stop.
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      const cv = map.current;
      const ctx = cv?.getContext('2d');
      if (!cv || !ctx) return;
      const img = ctx.createImageData(tw, th);
      for (let y = 0; y < th; y++) {
        const gy = Math.min(g.height - 1, Math.floor(((y + 0.5) * g.height) / th));
        for (let x = 0; x < tw; x++) {
          const gx = Math.min(g.width - 1, Math.floor(((x + 0.5) * g.width) / tw));
          const i = gy * g.width + gx;
          const [r, gg, b] = mode === 'elevation' ? elevationColor(g.terrain[i], g.mag[i]) : tileColor(g.terrain[i], g.mag[i], false, 8);
          img.data.set([r, gg, b, 255], (y * tw + x) * 4);
        }
      }
      ctx.putImageData(img, 0, 0);
    }, 250);
    return () => clearTimeout(t);
  }, [rev, mode, open, tw, th, g]);

  const r = controller.renderer;
  const cam = camera.value;
  let box = null;
  if (r && cam) {
    const vw = r.canvas.clientWidth / cam.zoom, vh = r.canvas.clientHeight / cam.zoom;
    const x0 = Math.max(0, (cam.x - vw / 2) * scale), y0 = Math.max(0, (cam.y - vh / 2) * scale);
    const x1 = Math.min(tw, (cam.x + vw / 2) * scale), y1 = Math.min(th, (cam.y + vh / 2) * scale);
    if (x1 > x0 && y1 > y0) box = { left: x0, top: y0, width: x1 - x0, height: y1 - y0 };
  }

  const go = (e: PointerEvent) => {
    const el = e.currentTarget as HTMLElement;
    const b = el.getBoundingClientRect();
    if (!r) return;
    r.camera.x = Math.max(0, Math.min(g.width, (e.clientX - b.left) / scale));
    r.camera.y = Math.max(0, Math.min(g.height, (e.clientY - b.top) / scale));
    r.cameraChanged();
  };

  if (!open) {
    return (
      <button class="minimap-open icon-btn" aria-label="Show overview map" title="Show overview map" onClick={() => setOpen(true)}>
        <i aria-hidden="true" class="ph ph-map-trifold" />
      </button>
    );
  }
  return (
    <div class="minimap">
      <div
        class="minimap-map"
        style={{ width: tw, height: th }}
        onPointerDown={(e) => {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          go(e);
        }}
        onPointerMove={(e) => e.buttons & 1 && go(e)}
        role="img"
        aria-label="Overview of the whole map. Click to move the view there."
      >
        <canvas ref={map} width={tw} height={th} />
        {box && <span class="minimap-view" style={box} />}
      </div>
      <button class="icon-btn sm minimap-close" aria-label="Hide overview map" title="Hide overview map" onClick={() => setOpen(false)}>
        <i aria-hidden="true" class="ph ph-x" />
      </button>
    </div>
  );
}
