import type { Renderer } from './renderer';

/**
 * 2D canvas layered over the WebGL map for things that follow the cursor or sit on top
 * of terrain: the brush footprint, nation pins and the editor selection.
 */
export class Overlay {
  readonly ctx: CanvasRenderingContext2D;
  private drawers: ((ctx: CanvasRenderingContext2D, r: Renderer) => void)[] = [];

  constructor(readonly canvas: HTMLCanvasElement, private renderer: Renderer) {
    this.ctx = canvas.getContext('2d')!;
  }

  /** Register something drawn on every redraw, in order. */
  add(draw: (ctx: CanvasRenderingContext2D, r: Renderer) => void) {
    this.drawers.push(draw);
  }

  redraw() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const d of this.drawers) d(ctx, this.renderer);
  }
}
