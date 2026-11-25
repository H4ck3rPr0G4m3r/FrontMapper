import { lonLatOf } from '../earth/earthNations';
import { LAND, WATER, cloneGrid, type MapGrid, type Rect } from '../core/grid';
import { History } from '../core/history';
import { segmentRect, segmentsCovering } from '../core/segments';
import { combineSelections, inSelection, selectionFromCorners, selectionOutline, trim, wandSelect, type SelectOp, type Selection } from '../core/selection';
import { withSymmetry, type Symmetry } from '../core/symmetry';
import { extractPatch, fillSelection, patchSelection, stampPatch, surroundingPaint, transformPatch, transformPoint, type Patch, type PatchTransform } from '../core/transform';
import { brushFootprint, linePoints, paintStroke } from '../core/tools/brush';
import { floodFill, pickAt } from '../core/tools/fill';
import { raiseAt, smoothAt } from '../core/tools/sculpt';
import { textureAt, textureRect } from '../core/tools/texture';
import { growIsland } from '../core/tools/grow';
import { growRivers } from '../core/tools/rivers';
import { riverStroke, waterStays } from '../core/tools/river';
import { elevationColor, tileColor } from '../core/colors';
import type { Overlay } from '../render/overlay';
import type { AnalysisClient } from './analysis';
import { issuesByNation } from './nationChecks';
import type { Renderer } from '../render/renderer';
import type { PointerInfo } from '../ui/editor/EditorCanvas';
import { newNationId, type Nation } from '../core/nations';
import {
  brushDiameter, busy, canPaste, canRedo, canUndo, floating, nations, paint, project, raiseAmount, revision, riverPreview, riverStatus, riverWidth,
  selectedNation, selection, spacePan, symmetry, textureOpts, tool, view, wandOpts, zoom,
} from './store';

const FOOTPRINT_TOOLS = new Set(['brush', 'raise', 'smooth', 'texture', 'river']);

/** A piece of map lifted off (moved, flipped, rotated) or pasted, floating until it is placed. */
interface Float {
  patch: Patch;
  x: number;
  y: number;
  /** Nations riding along, by position inside the patch. */
  riders: { id: string; px: number; py: number }[];
  /** Nations as they were before lifting, to put back on cancel. */
  nationsBefore: Nation[];
}

/**
 * Glue between pointer input, tools, history and the renderer. One per open map.
 */
export class EditorController {
  readonly history: History;
  /** Set by the editor; runs export analysis off-thread. */
  analysis: AnalysisClient | null = null;
  renderer: Renderer | null = null;
  overlay: Overlay | null = null;
  /** Cells of the brush outline last drawn (dev/test hook). */
  lastBrushCells: Int16Array | null = null;
  private hover: { x: number; y: number } | null = null;
  private stroke: { last: { x: number; y: number }; seed: number; start: { x: number; y: number } } | null = null;
  private selectDrag: { start: { x: number; y: number }; base: Selection; op: SelectOp } | null = null;
  private dragNation: string | null = null;
  private float: Float | null = null;
  private floatDrag: { start: { x: number; y: number }; x: number; y: number } | null = null;
  private clipboard: Patch | null = null;
  private outlineCache: { sel: Selection; runs: Float32Array } | null = null;
  private patchImage: { patch: Patch; mode: string; canvas: HTMLCanvasElement } | null = null;

  /** On Earth maps, nations remember where they are on Earth so a re-convert keeps them in place. */
  private earthPos(x: number, y: number): { lonLat?: [number, number] } {
    const fs = project.value?.earth?.frameSize;
    return fs ? { lonLat: lonLatOf(fs, x, y) } : {};
  }
  /** Called when a nation is placed or picked on the map (opens the Nations tab). */
  onNationPicked: (() => void) | null = null;

  constructor(readonly grid: MapGrid) {
    this.history = new History(grid);
    floating.value = false;
    canPaste.value = false;
    riverPreview.value = null;
    riverStatus.value = null;
  }

  attach(r: Renderer, o: Overlay) {
    this.renderer = r;
    this.overlay = o;
    r.onCamera = (z) => (zoom.value = z);
    o.add((ctx) => this.drawRiverPreview(ctx));
    o.add((ctx) => this.drawFloat(ctx));
    o.add((ctx) => this.drawSymmetry(ctx));
    o.add((ctx) => this.drawSelection(ctx));
    o.add((ctx) => this.drawNations(ctx));
    o.add((ctx) => this.drawCursor(ctx));
  }

  get cursor(): string {
    const t = tool.value;
    if (t === 'pan' || spacePan.value) return 'grab';
    if (this.floatDrag) return 'grabbing';
    if (t === 'select' && this.hover && (this.overFloat(this.hover) || (!this.float && inSelection(selection.value, this.hover.x, this.hover.y) && selection.value))) return 'move';
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
    if (this.float) {
      if (t === 'select' && this.overFloat(c)) {
        this.floatDrag = { start: c, x: this.float.x, y: this.float.y };
        return;
      }
      this.placeFloat();
    }
    if (t === 'select') {
      const sel = selection.value;
      if (sel && !p.shift && !p.alt && inSelection(sel, c.x, c.y)) {
        // Drag the selection: moves it, or with Ctrl drags out a copy.
        this.lift(p.ctrl ? 'Duplicate selection' : 'Move selection', !p.ctrl);
        if (this.float) this.floatDrag = { start: c, x: this.float.x, y: this.float.y };
        return;
      }
      const op: SelectOp = p.shift ? 'add' : p.alt ? 'subtract' : 'replace';
      this.selectDrag = { start: c, base: sel, op };
      selection.value = combineSelections(sel, selectionFromCorners(c.x, c.y, c.x, c.y, g.width, g.height), op);
      return;
    }
    if (t === 'wand') {
      if (!inMap(g, c)) return;
      const op: SelectOp = p.shift ? 'add' : p.alt ? 'subtract' : 'replace';
      selection.value = combineSelections(selection.value, wandSelect(g, c.x, c.y, wandOpts.value), op);
      this.renderer?.requestDraw();
      return;
    }
    if (t === 'spawn') {
      const hit = this.nationAt(p);
      this.dragNation = null;
      if (hit) {
        selectedNation.value = hit;
        this.dragNation = hit;
      } else if (inMap(g, c)) {
        const id = newNationId();
        const list = nations.value;
        let k = list.length + 1;
        while (list.some((n) => n.name === `Nation ${k}`)) k++;
        nations.value = [...list, { id, name: `Nation ${k}`, x: c.x, y: c.y, flag: '', source: 'custom', ...this.earthPos(c.x, c.y) }];
        selectedNation.value = id;
        this.dragNation = id;
      }
      if (this.dragNation) this.onNationPicked?.();
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
      this.invalidate(this.mirrored(() => floodFill(g, this.history, selection.value, c.x, c.y, paint.value)));
      this.commit();
      return;
    }
    if (FOOTPRINT_TOOLS.has(t)) {
      this.history.begin(t === 'river' ? 'River' : t);
      this.stroke = { last: c, seed: (Math.random() * 1e9) | 0, start: c };
      if (t === 'river') this.invalidate(this.mirrored(() => riverStroke(g, this.history, selection.value, c, c, riverWidth.value)));
      else this.dab(c.x, c.y, p.alt);
    }
  };

  onMove = (p: PointerInfo) => {
    const c = cell(p);
    this.hover = c;
    if (this.floatDrag && this.float && p.buttons & 1) {
      const f = this.float;
      const nx = this.floatDrag.x + c.x - this.floatDrag.start.x, ny = this.floatDrag.y + c.y - this.floatDrag.start.y;
      if (nx !== f.x || ny !== f.y) {
        f.x = nx;
        f.y = ny;
        this.syncFloat();
      }
    } else if (this.dragNation && p.buttons & 1) {
      const id = this.dragNation;
      const x = Math.max(0, Math.min(this.grid.width - 1, c.x)), y = Math.max(0, Math.min(this.grid.height - 1, c.y));
      nations.value = nations.value.map((n) => (n.id === id && (n.x !== x || n.y !== y) ? { ...n, x, y, ...this.earthPos(x, y) } : n));
    } else if (this.selectDrag) {
      const d = this.selectDrag;
      selection.value = combineSelections(d.base, selectionFromCorners(d.start.x, d.start.y, c.x, c.y, this.grid.width, this.grid.height), d.op);
    } else if (this.stroke && p.buttons & 1) {
      const t = tool.value;
      if (t === 'brush') {
        const last = this.stroke.last;
        this.invalidate(this.mirrored(() => paintStroke(this.grid, this.history, selection.value, last, c, brushDiameter.value, paint.value)));
      } else if (t === 'river') {
        const last = this.stroke.last;
        this.invalidate(this.mirrored(() => riverStroke(this.grid, this.history, selection.value, last, c, riverWidth.value)));
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
    if (this.floatDrag) {
      this.floatDrag = null;
      this.updateCursor();
      return;
    }
    if (this.dragNation) {
      this.dragNation = null;
      return;
    }
    if (this.selectDrag) {
      const { start, op } = this.selectDrag;
      this.selectDrag = null;
      const s = selection.value;
      // A click without a drag clears a plain selection.
      if (op === 'replace' && s && s.w === 1 && s.h === 1 && s.x === start.x && s.y === start.y) selection.value = null;
      return;
    }
    if (this.stroke) {
      const s = this.stroke;
      this.stroke = null;
      this.commit();
      if (tool.value === 'river') {
        const g = this.grid;
        const at = [s.start, s.last].find((c) => inMap(g, c) && g.terrain[c.y * g.width + c.x] === WATER);
        riverStatus.value = at ? waterStays(g, at.x, at.y) : null;
      }
    }
  };

  onLeave = () => {
    this.hover = null;
    this.updateCursor();
  };

  /** Nation pin under the pointer (within 9 screen px), if any. */
  nationAt(p: { x: number; y: number }): string | null {
    const r = this.renderer;
    if (!r) return null;
    const s = r.mapToScreen(p.x, p.y);
    let best: string | null = null;
    let bestD = 9;
    for (const n of nations.value) {
      const q = r.mapToScreen(n.x + 0.5, n.y + 0.5);
      const d = Math.hypot(q.x - s.x, q.y - s.y);
      if (d < bestD) {
        bestD = d;
        best = n.id;
      }
    }
    return best;
  }

  /** Abandon whatever the pointer was doing (pointer cancelled, window lost focus). */
  cancelPointer() {
    this.dragNation = null;
    this.selectDrag = null;
    this.floatDrag = null;
    if (this.stroke) {
      this.stroke = null;
      this.commit();
    }
  }

  /** Centre the camera on a nation without changing zoom (unless zoomed far out). */
  focusNation(id: string) {
    const r = this.renderer;
    const n = nations.value.find((v) => v.id === id);
    if (!r || !n) return;
    r.camera = { x: n.x + 0.5, y: n.y + 0.5, zoom: Math.max(r.camera.zoom, 2) };
    r.cameraChanged();
  }

  undo() {
    if (busy.value) return;
    if (this.float) {
      // Undo while something floats puts it back where it came from.
      this.cancelFloat();
      return;
    }
    this.invalidateSegs(this.history.undo());
    this.afterChange();
  }

  redo() {
    if (busy.value) return;
    this.placeFloat();
    this.invalidateSegs(this.history.redo());
    this.afterChange();
  }

  /** Grow every given island to the generator's minimum size, as one undo step. */
  growIslands(bodies: Int32Array[]) {
    if (busy.value || !bodies.length) return;
    this.placeFloat();
    this.history.begin('Grow islands');
    for (const cells of bodies) this.invalidate(growIsland(this.grid, this.history, cells));
    this.commit();
  }

  /** Work out what Grow rivers would change, without changing the map. */
  previewRivers() {
    if (busy.value) return;
    this.placeFloat();
    const report = growRivers(cloneGrid(this.grid), null);
    riverPreview.value = report;
    this.renderer?.requestDraw();
  }

  clearRiverPreview() {
    riverPreview.value = null;
    this.renderer?.requestDraw();
  }

  /** Join river pieces and widen waterways so the generator keeps them (one undo step). */
  growRivers() {
    if (busy.value) return;
    this.placeFloat();
    this.history.begin('Grow rivers');
    this.invalidate(growRivers(this.grid, this.history).rect);
    riverPreview.value = null;
    this.commit();
  }

  /** Centre and zoom the camera on a set of cells. */
  focusCells(cells: ArrayLike<number>) {
    const r = this.renderer;
    if (!r || !cells.length) return;
    const w = this.grid.width;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let k = 0; k < cells.length; k++) {
      const c = cells[k];
      const x = c % w, y = (c - x) / w;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x);
      y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    const span = Math.max(x1 - x0 + 1, y1 - y0 + 1, 24);
    const canvas = r.canvas;
    r.camera = {
      x: (x0 + x1 + 1) / 2,
      y: (y0 + y1 + 1) / 2,
      zoom: Math.min(32, Math.min(canvas.clientWidth, canvas.clientHeight) / (span * 3)),
    };
    r.cameraChanged();
  }

  /** Texture over the current selection, segment by segment, nearest the view first. */
  textureSelection() {
    const sel = selection.value;
    const r = this.renderer;
    if (!sel || !r?.scheduler || busy.value) return;
    this.placeFloat();
    const g = this.grid;
    const opts = { ...textureOpts.value, seed: (Math.random() * 1e9) | 0 };
    busy.value = true;
    this.history.begin('Texture selection');
    for (const seg of segmentsCovering(g.width, g.height, sel)) {
      r.scheduler.enqueue('texture', seg, () => {
        const sr = segmentRect(g.width, g.height, seg);
        const x0 = Math.max(sr.x, sel.x), y0 = Math.max(sr.y, sel.y);
        const x1 = Math.min(sr.x + sr.w, sel.x + sel.w), y1 = Math.min(sr.y + sr.h, sel.y + sel.h);
        this.invalidate(textureRect(g, this.history, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, opts, sel));
      });
    }
    r.scheduler.whenIdle().then(() => {
      busy.value = false;
      this.commit();
    });
  }

  // ---- Selection: copy, paste, move, flip, rotate, clear ----

  /** Copy the selected cells. */
  copy() {
    const sel = selection.value;
    if (this.float) {
      this.clipboard = this.float.patch;
    } else if (sel) {
      this.clipboard = extractPatch(this.grid, sel);
    } else return;
    canPaste.value = true;
  }

  cut() {
    if (!selection.value || this.float) return;
    this.copy();
    this.clearSelection();
  }

  /** Paste what was copied, centred in the view, floating so it can be dragged into place. */
  paste() {
    const p = this.clipboard;
    const r = this.renderer;
    if (!p || busy.value) return;
    this.placeFloat();
    const cx = r ? Math.floor(r.camera.x) : this.grid.width >> 1, cy = r ? Math.floor(r.camera.y) : this.grid.height >> 1;
    this.history.begin('Paste');
    this.float = { patch: p, x: cx - (p.w >> 1), y: cy - (p.h >> 1), riders: [], nationsBefore: nations.value };
    tool.value = 'select';
    this.syncFloat();
  }

  /** Fill the selection with what surrounds it (an island lifted from the sea leaves sea). */
  clearSelection() {
    const sel = selection.value;
    if (!sel || busy.value) return;
    if (this.float) {
      this.cancelFloat();
      return;
    }
    this.history.begin('Clear selection');
    this.invalidate(fillSelection(this.grid, this.history, sel, surroundingPaint(this.grid, sel)));
    this.commit();
  }

  /** Flip or turn the selection (lifting it first), or the floating piece. */
  transform(kind: PatchTransform) {
    if (busy.value) return;
    if (!this.float) this.lift(TRANSFORM_LABEL[kind], true);
    const f = this.float;
    if (!f) return;
    const before = f.patch;
    const cx = f.x + before.w / 2, cy = f.y + before.h / 2;
    f.patch = transformPatch(before, kind);
    f.x = Math.round(cx - f.patch.w / 2);
    f.y = Math.round(cy - f.patch.h / 2);
    f.riders = f.riders.map((n) => {
      const [px, py] = transformPoint(before, kind, n.px, n.py);
      return { id: n.id, px, py };
    });
    this.syncFloat();
  }

  get hasFloat() {
    return !!this.float;
  }

  /** Put the floating piece down for good (one undo step with the lift). */
  placeFloat() {
    const f = this.float;
    if (!f) return;
    this.float = null;
    this.floatDrag = null;
    floating.value = false;
    this.invalidate(stampPatch(this.grid, this.history, f.patch, f.x, f.y));
    selection.value = clipSelection(patchSelection(f.patch, f.x, f.y), this.grid);
    this.commit();
  }

  /** Drop the floating piece and put the map back as it was. */
  cancelFloat() {
    const f = this.float;
    if (!f) return;
    this.float = null;
    this.floatDrag = null;
    floating.value = false;
    nations.value = f.nationsBefore;
    this.invalidateSegs(this.history.abort());
    this.afterChange();
  }

  /** Lift the selected cells into a floating piece, leaving what surrounds them behind (or nothing, for a copy). */
  private lift(label: string, leaveHole: boolean) {
    const sel = selection.value;
    if (!sel || this.float) return;
    const g = this.grid;
    const patch = extractPatch(g, sel);
    this.history.begin(label);
    if (leaveHole) this.invalidate(fillSelection(g, this.history, sel, surroundingPaint(g, sel)));
    const riders = leaveHole
      ? nations.value.filter((n) => inSelection(sel, n.x, n.y)).map((n) => ({ id: n.id, px: n.x - sel.x, py: n.y - sel.y }))
      : [];
    this.float = { patch, x: sel.x, y: sel.y, riders, nationsBefore: nations.value };
    this.syncFloat();
  }

  /** After the floating piece moved or turned: move its nations along and redraw. */
  private syncFloat() {
    const f = this.float;
    floating.value = !!f;
    if (!f) return;
    canUndo.value = true; // undo puts a floating piece back
    selection.value = patchSelection(f.patch, f.x, f.y);
    if (f.riders.length) {
      const pos = new Map(f.riders.map((n) => [n.id, n]));
      const g = this.grid;
      nations.value = nations.value.map((n) => {
        const r = pos.get(n.id);
        if (!r) return n;
        const x = Math.max(0, Math.min(g.width - 1, f.x + r.px)), y = Math.max(0, Math.min(g.height - 1, f.y + r.py));
        return { ...n, x, y, ...this.earthPos(x, y) };
      });
    }
    this.renderer?.requestDraw();
  }

  private overFloat(c: { x: number; y: number }) {
    const f = this.float;
    if (!f) return false;
    const px = c.x - f.x, py = c.y - f.y;
    return px >= 0 && py >= 0 && px < f.patch.w && py < f.patch.h && f.patch.mask[py * f.patch.w + px] === 1;
  }

  /** Run an edit and copy what it changed to the mirror positions of the current symmetry. */
  private mirrored(fn: () => Rect): Rect {
    return withSymmetry(this.grid, this.history, symmetry.value, fn, selection.value);
  }

  private dab(x: number, y: number, alt: boolean) {
    const g = this.grid, h = this.history, sel = selection.value, d = brushDiameter.value;
    switch (tool.value) {
      case 'brush':
        this.invalidate(this.mirrored(() => paintStroke(g, h, sel, { x, y }, { x, y }, d, paint.value)));
        break;
      case 'raise':
        this.invalidate(this.mirrored(() => raiseAt(g, h, sel, x, y, d, alt ? -raiseAmount.value : raiseAmount.value)));
        break;
      case 'smooth':
        this.invalidate(this.mirrored(() => smoothAt(g, h, sel, x, y, d)));
        break;
      case 'texture':
        this.invalidate(this.mirrored(() => textureAt(g, h, sel, x, y, d, { ...textureOpts.value, seed: this.stroke?.seed ?? 1 })));
        break;
    }
  }

  private commit() {
    this.history.commit();
    this.afterChange();
  }

  private afterChange() {
    riverPreview.value = null; // the map changed under it
    canUndo.value = this.history.canUndo || !!this.float;
    canRedo.value = this.history.canRedo;
    revision.value++;
  }

  private invalidate(r: Rect) {
    if (r.w > 0 && r.h > 0) this.renderer?.invalidate(r);
  }

  private invalidateSegs(segs: number[]) {
    for (const s of segs) this.invalidate(segmentRect(this.grid.width, this.grid.height, s));
  }

  // ---- Overlay drawing ----

  private drawCursor(ctx: CanvasRenderingContext2D) {
    const r = this.renderer;
    const c = this.hover;
    if (!r || !c || spacePan.value) return;
    const t = tool.value;
    let cells: Int16Array;
    if (t === 'river') cells = brushFootprint(riverWidth.value);
    else if (FOOTPRINT_TOOLS.has(t)) cells = brushFootprint(brushDiameter.value);
    else if (t === 'fill' || t === 'eyedropper' || t === 'wand') cells = Int16Array.of(0, 0);
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
    const mirror = t === 'eyedropper' || t === 'wand' ? 'off' : symmetry.value;
    for (const o of cursorCopies(mirror, this.grid, c, t === 'river' ? riverWidth.value : FOOTPRINT_TOOLS.has(t) ? brushDiameter.value : 1)) {
      for (let k = 0; k < cells.length; k += 2) {
        const dx = cells[k], dy = cells[k + 1];
        const x = o.x + dx, y = o.y + dy;
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
    }
    ctx.lineCap = 'square';
    ctx.strokeStyle = 'rgba(0,0,0,.55)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  private drawNations(ctx: CanvasRenderingContext2D) {
    const r = this.renderer;
    const list = nations.value;
    if (!r || !list.length) return;
    const issues = issuesByNation.value;
    const sel = selectedNation.value;
    const labels = list.length <= 120 || r.camera.zoom >= 0.6;
    ctx.font = '600 11px ui-sans-serif, "Segoe UI", system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    for (const n of list) {
      const s = r.mapToScreen(n.x + 0.5, n.y + 0.5);
      if (s.x < -200 || s.y < -20 || s.x > r.canvas.clientWidth + 20 || s.y > r.canvas.clientHeight + 20) continue;
      const bad = issues.has(n.id);
      if (n.id === sel) {
        ctx.beginPath();
        ctx.arc(s.x, s.y, 8, 0, Math.PI * 2);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(s.x, s.y, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = '#1f1f1f';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(s.x, s.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = bad ? '#ff4f43' : '#ececec';
      ctx.fill();
      if (!labels) continue;
      const w = ctx.measureText(n.name).width;
      ctx.fillStyle = '#ececec';
      ctx.fillRect(Math.round(s.x + 7), Math.round(s.y - 8), Math.ceil(w + 10), 16);
      ctx.fillStyle = '#1f1f1f';
      ctx.fillText(n.name, Math.round(s.x + 12), Math.round(s.y));
    }
  }

  /** Marching ants around the selection (any shape). */
  private drawSelection(ctx: CanvasRenderingContext2D) {
    const r = this.renderer;
    const s = selection.value;
    if (!r || !s) return;
    if (this.outlineCache?.sel !== s) this.outlineCache = { sel: s, runs: selectionOutline(s) };
    const runs = this.outlineCache.runs;
    const tl = r.screenToMap(0, 0), br = r.screenToMap(r.canvas.clientWidth, r.canvas.clientHeight);
    ctx.beginPath();
    for (let k = 0; k < runs.length; k += 4) {
      const x0 = runs[k], y0 = runs[k + 1], x1 = runs[k + 2], y1 = runs[k + 3];
      if (Math.max(x0, x1) < tl.x || Math.min(x0, x1) > br.x || Math.max(y0, y1) < tl.y || Math.min(y0, y1) > br.y) continue;
      const a = r.mapToScreen(x0, y0), b = r.mapToScreen(x1, y1);
      ctx.moveTo(Math.round(a.x) + 0.5, Math.round(a.y) + 0.5);
      ctx.lineTo(Math.round(b.x) + 0.5, Math.round(b.y) + 0.5);
    }
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(0,0,0,.6)';
    ctx.stroke();
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /** The floating piece, drawn in the colours of the current view. */
  private drawFloat(ctx: CanvasRenderingContext2D) {
    const r = this.renderer;
    const f = this.float;
    if (!r || !f) return;
    const mode = view.value === 'elevation' ? 'elevation' : 'game';
    if (this.patchImage?.patch !== f.patch || this.patchImage.mode !== mode) {
      const { w, h, terrain, mag, mask } = f.patch;
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const img = new ImageData(w, h);
      for (let k = 0; k < w * h; k++) {
        if (!mask[k]) continue;
        const [cr, cg, cb] = mode === 'elevation' ? elevationColor(terrain[k], mag[k]) : tileColor(terrain[k], mag[k], false, 6);
        img.data.set([cr, cg, cb, 255], k * 4);
      }
      canvas.getContext('2d')!.putImageData(img, 0, 0);
      this.patchImage = { patch: f.patch, mode, canvas };
    }
    const a = r.mapToScreen(f.x, f.y);
    const z = r.camera.zoom;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.shadowColor = 'rgba(0,0,0,.45)';
    ctx.shadowBlur = 12;
    ctx.drawImage(this.patchImage.canvas, a.x, a.y, f.patch.w * z, f.patch.h * z);
    ctx.restore();
  }

  /** Dashed mirror axes while symmetry painting is on. */
  private drawSymmetry(ctx: CanvasRenderingContext2D) {
    const r = this.renderer;
    const s = symmetry.value;
    if (!r || s === 'off' || !FOOTPRINT_TOOLS.has(tool.value) && tool.value !== 'fill') return;
    const g = this.grid;
    const lines: [number, number, number, number][] = [];
    if (s === 'x' || s === 'xy') lines.push([g.width / 2, 0, g.width / 2, g.height]);
    if (s === 'y' || s === 'xy') lines.push([0, g.height / 2, g.width, g.height / 2]);
    ctx.save();
    ctx.lineWidth = 1;
    for (const [x0, y0, x1, y1] of lines) {
      const a = r.mapToScreen(x0, y0), b = r.mapToScreen(x1, y1);
      ctx.beginPath();
      ctx.moveTo(Math.round(a.x) + 0.5, Math.round(a.y) + 0.5);
      ctx.lineTo(Math.round(b.x) + 0.5, Math.round(b.y) + 0.5);
      ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(0,0,0,.5)';
      ctx.stroke();
      ctx.setLineDash([2, 5]);
      ctx.strokeStyle = 'rgba(237,237,237,.85)';
      ctx.stroke();
    }
    if (s === 'rot') {
      const c = r.mapToScreen(g.width / 2, g.height / 2);
      ctx.beginPath();
      ctx.arc(c.x, c.y, 7, 0, Math.PI * 2);
      ctx.moveTo(c.x - 11, c.y);
      ctx.lineTo(c.x + 11, c.y);
      ctx.moveTo(c.x, c.y - 11);
      ctx.lineTo(c.x, c.y + 11);
      ctx.strokeStyle = 'rgba(0,0,0,.5)';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(237,237,237,.9)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Cells Grow rivers would turn into water, outlined so they read on any terrain. */
  private drawRiverPreview(ctx: CanvasRenderingContext2D) {
    const r = this.renderer;
    const p = riverPreview.value;
    if (!r || !p || !p.carved.length) return;
    const w = this.grid.width;
    const z = r.camera.zoom;
    const tl = r.screenToMap(0, 0), br = r.screenToMap(r.canvas.clientWidth, r.canvas.clientHeight);
    const size = Math.max(z, 2);
    ctx.fillStyle = 'rgba(57,214,255,.9)';
    for (const i of p.carved) {
      const x = i % w, y = (i - x) / w;
      if (x + 1 < tl.x || x > br.x || y + 1 < tl.y || y > br.y) continue;
      const s = r.mapToScreen(x, y);
      ctx.fillRect(s.x, s.y, size, size);
    }
  }
}

const TRANSFORM_LABEL: Record<PatchTransform, string> = {
  flipX: 'Flip selection',
  flipY: 'Flip selection',
  rotateCW: 'Rotate selection',
  rotateCCW: 'Rotate selection',
};

/** A selection limited to the map (pieces placed partly off the map lose those cells). */
function clipSelection(sel: NonNullable<Selection>, g: MapGrid): Selection {
  const x0 = Math.max(0, sel.x), y0 = Math.max(0, sel.y);
  const x1 = Math.min(g.width, sel.x + sel.w), y1 = Math.min(g.height, sel.y + sel.h);
  if (x1 <= x0 || y1 <= y0) return null;
  if (x0 === sel.x && y0 === sel.y && x1 === sel.x + sel.w && y1 === sel.y + sel.h) return sel;
  const w = x1 - x0, h = y1 - y0;
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) mask[y * w + x] = inSelection(sel, x0 + x, y0 + y) ? 1 : 0;
  return trim({ x: x0, y: y0, w, h, mask });
}

/**
 * Where the brush outline is drawn: the cursor and its mirror images. An even-sized brush is
 * centred on a cell corner, so its mirror image lands one cell further along each mirrored axis.
 */
function cursorCopies(s: Symmetry, g: MapGrid, c: { x: number; y: number }, diameter: number) {
  const shift = Math.round(diameter) % 2 === 0 ? 1 : 0;
  const mx = g.width - 1 - c.x + shift, my = g.height - 1 - c.y + shift;
  switch (s) {
    case 'off': return [c];
    case 'x': return [c, { x: mx, y: c.y }];
    case 'y': return [c, { x: c.x, y: my }];
    case 'xy': return [c, { x: mx, y: c.y }, { x: c.x, y: my }, { x: mx, y: my }];
    case 'rot': return [c, { x: mx, y: my }];
  }
}

const cell = (p: { x: number; y: number }) => ({ x: Math.floor(p.x), y: Math.floor(p.y) });
const inMap = (g: MapGrid, c: { x: number; y: number }) => c.x >= 0 && c.y >= 0 && c.x < g.width && c.y < g.height;
