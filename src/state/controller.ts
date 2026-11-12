import { LAND, type MapGrid, type Rect } from '../core/grid';
import { History } from '../core/history';
import { segmentRect, segmentsCovering } from '../core/segments';
import { selectionFromCorners } from '../core/selection';
import { brushFootprint, linePoints, paintStroke } from '../core/tools/brush';
import { floodFill, pickAt } from '../core/tools/fill';
import { raiseAt, smoothAt } from '../core/tools/sculpt';
import { textureAt, textureRect } from '../core/tools/texture';
import type { Overlay } from '../render/overlay';
import type { Renderer } from '../render/renderer';
import type { PointerInfo } from '../ui/editor/EditorCanvas';
import {
  brushDiameter, busy, canRedo, canUndo, paint, raiseAmount, revision, selection, spacePan, textureOpts, tool,
} from './store';

const FOOTPRINT_TOOLS = new Set(['brush', 'raise', 'smooth', 'texture']);

/**
 * Glue between pointer input, tools, history and the renderer. One per open map.
 */
export class EditorController {
  readonly history: History;
  renderer: Renderer | null = null;
  overlay: Overlay | null = null;
  /** Cells of the brush outline last drawn (dev/test hook). */
  lastBrushCells: Int16Array | null = null;
  private hover: { x: number; y: number } | null = null;
  private stroke: { last: { x: number; y: number }; seed: number } | null = null;
  private selectStart: { x: number; y: number } | null = null;

  constructor(readonly grid: MapGrid) {
    this.history = new History(grid);
  }

  attach(r: Renderer, o: Overlay) {
    this.renderer = r;
    this.overlay = o;
    o.add((ctx) => this.drawSelection(ctx));
    o.add((ctx) => this.drawCursor(ctx));
  }

  get cursor(): string {
    const t = tool.value;
    if (t === 'pan' || spacePan.value) return 'grab';
    if (FOOTPRINT_TOOLS.has(t)) return this.hover ? 'none' : 'default';
    return 'crosshair';
  }

  updateCursor() {
    if (this.overlay) this.overlay.canvas.style.cursor = this.cursor;
  }

  wantsPan = (e: PointerEvent) => tool.value === 'pan' || spacePan.value || e.button === 1;

  onDown = (p: PointerInfo) => {
    if (busy.value) return;
    const c = cell(p);
    const t = tool.value;
    const g = this.grid;
    if (t === 'select') {
      this.selectStart = c;
      selection.value = selectionFromCorners(c.x, c.y, c.x, c.y, g.width, g.height);
      return;
    }
    if (!inMap(g, c)) return;
    if (t === 'eyedropper') {
      const picked = pickAt(g, c.x, c.y);
      paint.value = picked.terrain === LAND ? picked : { terrain: picked.terrain, mag: 0 };
      tool.value = 'brush';
      return;
    }
    if (t === 'fill') {
      this.history.begin('Fill');
      this.invalidate(floodFill(g, this.history, selection.value, c.x, c.y, paint.value));
      this.commit();
      return;
    }
    if (FOOTPRINT_TOOLS.has(t)) {
      this.history.begin(t);
      this.stroke = { last: c, seed: (Math.random() * 1e9) | 0 };
      this.dab(c.x, c.y, p.alt);
    }
  };

  onMove = (p: PointerInfo) => {
    const c = cell(p);
    this.hover = c;
    if (this.selectStart) {
      selection.value = selectionFromCorners(this.selectStart.x, this.selectStart.y, c.x, c.y, this.grid.width, this.grid.height);
    } else if (this.stroke && p.buttons & 1) {
      const t = tool.value;
      if (t === 'brush') {
        this.invalidate(paintStroke(this.grid, this.history, selection.value, this.stroke.last, c, brushDiameter.value, paint.value));
      } else {
        const spacing = Math.max(1, Math.floor(brushDiameter.value / 4));
        const pts = linePoints(this.stroke.last, c);
        for (let k = spacing; k < pts.length; k += spacing) this.dab(pts[k][0], pts[k][1], p.alt);
        if (pts.length <= spacing) return; // keep `last` until we've moved far enough
      }
      this.stroke.last = c;
    }
    this.updateCursor();
    this.renderer?.requestDraw();
  };

  onUp = () => {
    if (this.selectStart) {
      this.selectStart = null;
      const s = selection.value;
      if (s && s.w === 1 && s.h === 1) selection.value = null;
      return;
    }
    if (this.stroke) {
      this.stroke = null;
      this.commit();
    }
  };

  onLeave = () => {
    this.hover = null;
    this.updateCursor();
  };

  undo() {
    if (busy.value) return;
    this.invalidateSegs(this.history.undo());
    this.afterChange();
  }

  redo() {
    if (busy.value) return;
    this.invalidateSegs(this.history.redo());
    this.afterChange();
  }

  /** Texture over the current selection, segment by segment, nearest the view first. */
  textureSelection() {
    const sel = selection.value;
    const r = this.renderer;
    if (!sel || !r?.scheduler || busy.value) return;
    const g = this.grid;
    const opts = { ...textureOpts.value, seed: (Math.random() * 1e9) | 0 };
    busy.value = true;
    this.history.begin('Texture selection');
    for (const seg of segmentsCovering(g.width, g.height, sel)) {
      r.scheduler.enqueue('texture', seg, () => {
        const sr = segmentRect(g.width, g.height, seg);
        const x0 = Math.max(sr.x, sel.x), y0 = Math.max(sr.y, sel.y);
        const x1 = Math.min(sr.x + sr.w, sel.x + sel.w), y1 = Math.min(sr.y + sr.h, sel.y + sel.h);
        this.invalidate(textureRect(g, this.history, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, opts));
      });
    }
    r.scheduler.whenIdle().then(() => {
      busy.value = false;
      this.commit();
    });
  }

  private dab(x: number, y: number, alt: boolean) {
    const g = this.grid, h = this.history, sel = selection.value, d = brushDiameter.value;
    switch (tool.value) {
      case 'brush':
        this.invalidate(paintStroke(g, h, sel, { x, y }, { x, y }, d, paint.value));
        break;
      case 'raise':
        this.invalidate(raiseAt(g, h, sel, x, y, d, alt ? -raiseAmount.value : raiseAmount.value));
        break;
      case 'smooth':
        this.invalidate(smoothAt(g, h, sel, x, y, d));
        break;
      case 'texture':
        this.invalidate(textureAt(g, h, sel, x, y, d, { ...textureOpts.value, seed: this.stroke?.seed ?? 1 }));
        break;
    }
  }

  private commit() {
    this.history.commit();
    this.afterChange();
  }

  private afterChange() {
    canUndo.value = this.history.canUndo;
    canRedo.value = this.history.canRedo;
    revision.value++;
  }

  private invalidate(r: Rect) {
    if (r.w > 0 && r.h > 0) this.renderer?.invalidate(r);
  }

  private invalidateSegs(segs: number[]) {
    for (const s of segs) this.invalidate(segmentRect(this.grid.width, this.grid.height, s));
  }

  private drawCursor(ctx: CanvasRenderingContext2D) {
    const r = this.renderer;
    const c = this.hover;
    if (!r || !c || spacePan.value) return;
    const t = tool.value;
    let cells: Int16Array;
    if (FOOTPRINT_TOOLS.has(t)) cells = brushFootprint(brushDiameter.value);
    else if (t === 'fill' || t === 'eyedropper') cells = Int16Array.of(0, 0);
    else return;
    this.lastBrushCells = cells;
    const set = new Set<number>();
    const key = (dx: number, dy: number) => (dx + 512) * 1024 + (dy + 512);
    for (let k = 0; k < cells.length; k += 2) set.add(key(cells[k], cells[k + 1]));
    const pt = (mx: number, my: number) => {
      const s = r.mapToScreen(mx, my);
      return [Math.round(s.x) + 0.5, Math.round(s.y) + 0.5];
    };
    ctx.beginPath();
    for (let k = 0; k < cells.length; k += 2) {
      const dx = cells[k], dy = cells[k + 1];
      const x = c.x + dx, y = c.y + dy;
      const edge = (ax: number, ay: number, bx: number, by: number) => {
        const [sx, sy] = pt(ax, ay);
        const [ex, ey] = pt(bx, by);
        ctx.moveTo(sx, sy);
        ctx.lineTo(ex, ey);
      };
      if (!set.has(key(dx, dy - 1))) edge(x, y, x + 1, y);
      if (!set.has(key(dx, dy + 1))) edge(x, y + 1, x + 1, y + 1);
      if (!set.has(key(dx - 1, dy))) edge(x, y, x, y + 1);
      if (!set.has(key(dx + 1, dy))) edge(x + 1, y, x + 1, y + 1);
    }
    ctx.lineCap = 'square';
    ctx.strokeStyle = 'rgba(0,0,0,.55)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  private drawSelection(ctx: CanvasRenderingContext2D) {
    const r = this.renderer;
    const s = selection.value;
    if (!r || !s) return;
    const a = r.mapToScreen(s.x, s.y);
    const b = r.mapToScreen(s.x + s.w, s.y + s.h);
    const x = Math.round(a.x) + 0.5, y = Math.round(a.y) + 0.5;
    const w = Math.round(b.x - a.x), h = Math.round(b.y - a.y);
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(0,0,0,.6)';
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = '#fff';
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
  }
}

const cell = (p: { x: number; y: number }) => ({ x: Math.floor(p.x), y: Math.floor(p.y) });
const inMap = (g: MapGrid, c: { x: number; y: number }) => c.x >= 0 && c.y >= 0 && c.x < g.width && c.y < g.height;
