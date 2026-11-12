import { useEffect, useRef } from 'preact/hooks';
import type { MapGrid } from '../../core/grid';
import { Overlay } from '../../render/overlay';
import { Renderer } from '../../render/renderer';

export interface PointerInfo {
  /** Map coordinates (fractional). */
  x: number;
  y: number;
  buttons: number;
  shift: boolean;
  alt: boolean;
}

export interface CanvasHandlers {
  /** Return true when the event should pan instead of being handled by a tool. */
  wantsPan?: (e: PointerEvent) => boolean;
  onDown?: (p: PointerInfo) => void;
  onMove?: (p: PointerInfo) => void;
  onUp?: (p: PointerInfo) => void;
  onLeave?: () => void;
}

interface Props extends CanvasHandlers {
  grid: MapGrid | null;
  onReady?: (r: Renderer, o: Overlay) => void;
  cursor?: string;
}

/** Hosts the WebGL renderer and the 2D overlay; handles pan and zoom. */
export function EditorCanvas(props: Props) {
  const glRef = useRef<HTMLCanvasElement>(null);
  const ovRef = useRef<HTMLCanvasElement>(null);
  const rRef = useRef<Renderer | null>(null);
  const handlers = useRef<Props>(props);
  handlers.current = props;

  useEffect(() => {
    const r = new Renderer(glRef.current!);
    const o = new Overlay(ovRef.current!, r);
    r.onFrame = () => o.redraw();
    rRef.current = r;
    handlers.current.onReady?.(r, o);
    const ro = new ResizeObserver(() => r.requestDraw());
    ro.observe(glRef.current!);
    return () => {
      ro.disconnect();
      r.destroy();
    };
  }, []);

  useEffect(() => {
    if (props.grid && rRef.current && rRef.current.grid !== props.grid) rRef.current.setMap(props.grid);
  }, [props.grid]);

  useEffect(() => {
    const el = ovRef.current!;
    let panning: { x: number; y: number } | null = null;
    const info = (e: PointerEvent | MouseEvent): PointerInfo => {
      const b = el.getBoundingClientRect();
      const m = rRef.current!.screenToMap(e.clientX - b.left, e.clientY - b.top);
      return { x: m.x, y: m.y, buttons: e.buttons, shift: e.shiftKey, alt: e.altKey };
    };
    const down = (e: PointerEvent) => {
      el.setPointerCapture(e.pointerId);
      if (e.button === 1 || handlers.current.wantsPan?.(e)) {
        panning = { x: e.clientX, y: e.clientY };
        e.preventDefault();
        return;
      }
      if (e.button === 0) handlers.current.onDown?.(info(e));
    };
    const move = (e: PointerEvent) => {
      const r = rRef.current!;
      if (panning) {
        r.camera.x -= (e.clientX - panning.x) / r.camera.zoom;
        r.camera.y -= (e.clientY - panning.y) / r.camera.zoom;
        panning = { x: e.clientX, y: e.clientY };
        r.cameraChanged();
      }
      handlers.current.onMove?.(info(e));
    };
    const up = (e: PointerEvent) => {
      if (panning) panning = null;
      else handlers.current.onUp?.(info(e));
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = rRef.current!;
      const b = el.getBoundingClientRect();
      const sx = e.clientX - b.left, sy = e.clientY - b.top;
      const before = r.screenToMap(sx, sy);
      const factor = Math.exp(-e.deltaY * 0.0015);
      r.camera.zoom = Math.min(64, Math.max(0.02, r.camera.zoom * factor));
      const after = r.screenToMap(sx, sy);
      r.camera.x += before.x - after.x;
      r.camera.y += before.y - after.y;
      r.cameraChanged();
      handlers.current.onMove?.(info(e));
    };
    const leave = () => handlers.current.onLeave?.();
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointerleave', leave);
    el.addEventListener('wheel', wheel, { passive: false });
    el.addEventListener('auxclick', (e) => e.preventDefault());
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointerleave', leave);
      el.removeEventListener('wheel', wheel);
    };
  }, []);

  return (
    <div style={{ position: 'relative', flex: 1, minWidth: 0, minHeight: 0, background: 'var(--stage)' }}>
      <canvas ref={glRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
      <canvas
        ref={ovRef}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', cursor: props.cursor ?? 'default', touchAction: 'none' }}
      />
    </div>
  );
}
