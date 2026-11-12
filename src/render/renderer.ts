import { DEPTH_CAP, deriveRect } from '../core/derive';
import type { ExportSimulation } from '../core/generator';
import type { MapGrid, Rect } from '../core/grid';
import { SEGMENT, SegmentScheduler, segmentCols, segmentRect, segmentsCovering } from '../core/segments';
import { FRAG, VERT } from './shaders';

export type ViewMode = 'game' | 'elevation' | 'export';
export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 64;
const VIEW_INDEX: Record<ViewMode, number> = { game: 0, elevation: 1, export: 2 };

interface Layer {
  grid: MapGrid;
  shore: Uint8Array;
  depth: Uint8Array;
  textures: (WebGLTexture | null)[];
}

/**
 * Draws a map as 256x256 segment textures. Edits call `invalidate`; affected segments
 * are re-derived and re-uploaded through the scheduler, nearest the view centre first.
 */
export class Renderer {
  readonly gl: WebGL2RenderingContext;
  camera = { x: 0, y: 0, zoom: 1 };
  scheduler: SegmentScheduler | null = null;
  /** Called every animation frame (overlay redraws hook in here). */
  onFrame: (() => void) | null = null;
  /** Called whenever the camera moves or zooms. */
  onCamera: ((zoom: number) => void) | null = null;

  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private main: Layer | null = null;
  private exp: Layer | null = null;
  private removed: Uint8Array | null = null;
  private removedCells: number[] = [];
  private view: ViewMode = 'game';
  private dirty = true;
  private raf = 0;
  private staging = new Uint8Array(SEGMENT * SEGMENT * 4);
  private maxTexDim = 0;

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true, alpha: false });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.gl = gl;
    this.program = link(gl, VERT, FRAG);
    for (const name of ['u_rect', 'u_cam', 'u_zoom', 'u_view', 'u_tex', 'u_mode'])
      this.u[name] = gl.getUniformLocation(this.program, name);
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(this.program, 'a_unit');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.loop();
  }

  get grid() {
    return this.main?.grid ?? null;
  }

  setMap(g: MapGrid) {
    this.disposeLayer(this.main);
    this.disposeLayer(this.exp);
    this.exp = null;
    this.removed = null;
    this.removedCells = [];
    this.main = this.makeLayer(g);
    this.scheduler = new SegmentScheduler(g.width, g.height);
    this.fit();
    this.enqueueAll();
  }

  /** Mark cells the generator removes (red in game/elevation) and keep its result for the export view. */
  setExportSim(sim: ExportSimulation | null) {
    const g = this.main?.grid;
    if (!g) return;
    const cols = segmentCols(g.width);
    const changed = new Set<number>();
    const segOf = (c: number) => Math.floor(c / g.width / SEGMENT) * cols + Math.floor((c % g.width) / SEGMENT);
    const prev = this.removedCells;
    for (const c of prev) changed.add(segOf(c));
    this.disposeLayer(this.exp);
    this.exp = null;
    this.removed = null;
    this.removedCells = [];
    if (sim) {
      const removed = new Uint8Array(g.width * g.height);
      for (const b of [...sim.removedIslands, ...sim.removedLakes])
        for (const c of b.cells) {
          removed[c] = 1;
          this.removedCells.push(c);
          changed.add(segOf(c));
        }
      this.removed = removed;
      this.exp = this.makeLayer(sim.grid);
    }
    // Only segments whose red marks changed need re-uploading; the export layer is rebuilt lazily.
    for (const seg of changed) this.enqueueSeg(this.main!, seg, 'main');
    if (this.view === 'export') this.enqueueAll();
  }

  setView(v: ViewMode) {
    this.view = v;
    if (v === 'export') this.enqueueAll();
    this.dirty = true;
  }

  getView() {
    return this.view;
  }

  /** Re-derive and re-upload everything `r` (plus the depth halo) can influence. */
  invalidate(r: Rect) {
    const g = this.main?.grid;
    if (!g || !this.scheduler) return;
    const halo = DEPTH_CAP + 1;
    const grown = { x: r.x - halo, y: r.y - halo, w: r.w + 2 * halo, h: r.h + 2 * halo };
    for (const seg of segmentsCovering(g.width, g.height, grown)) this.enqueueSeg(this.main!, seg, 'main');
  }

  screenToMap(px: number, py: number) {
    const { x, y, zoom } = this.camera;
    return { x: x + (px - this.cssWidth / 2) / zoom, y: y + (py - this.cssHeight / 2) / zoom };
  }

  mapToScreen(mx: number, my: number) {
    const { x, y, zoom } = this.camera;
    return { x: (mx - x) * zoom + this.cssWidth / 2, y: (my - y) * zoom + this.cssHeight / 2 };
  }

  /** Fit the whole map into the view. */
  fit() {
    const g = this.main?.grid;
    if (!g) return;
    const zoom = Math.min(this.cssWidth / g.width, this.cssHeight / g.height) * 0.95;
    this.camera = { x: g.width / 2, y: g.height / 2, zoom: zoom || 1 };
    this.cameraChanged();
  }

  cameraChanged() {
    this.dirty = true;
    this.scheduler?.setFocus(this.camera.x, this.camera.y);
    this.onCamera?.(this.camera.zoom);
  }

  /** Zoom about the centre of the view by `factor`. */
  zoomBy(factor: number) {
    this.camera.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.camera.zoom * factor));
    this.cameraChanged();
  }

  requestDraw() {
    this.dirty = true;
  }

  maxTextureDim() {
    return this.maxTexDim;
  }

  /** Colour drawn at a map coordinate (tests and dev tools). */
  readMapPixel(mx: number, my: number): [number, number, number] {
    this.draw();
    const s = this.mapToScreen(mx + 0.5, my + 0.5);
    const dpr = this.canvas.width / this.cssWidth;
    const px = Math.floor(s.x * dpr);
    const py = this.canvas.height - 1 - Math.floor(s.y * dpr);
    const out = new Uint8Array(4);
    this.gl.readPixels(px, py, 1, 1, this.gl.RGBA, this.gl.UNSIGNED_BYTE, out);
    return [out[0], out[1], out[2]];
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    // Nothing pumps the queue any more, so release anything waiting on it.
    this.scheduler?.clear();
    this.disposeLayer(this.main);
    this.disposeLayer(this.exp);
    this.main = this.exp = null;
    // Browsers cap live WebGL contexts; free this one now instead of waiting for GC.
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }

  private get cssWidth() {
    return this.canvas.clientWidth || this.canvas.width;
  }

  private get cssHeight() {
    return this.canvas.clientHeight || this.canvas.height;
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    if (this.scheduler?.pending) this.scheduler.pump();
    if (this.dirty) this.draw();
    this.onFrame?.();
  };

  private makeLayer(g: MapGrid): Layer {
    const n = g.width * g.height;
    const segs = segmentCols(g.width) * Math.ceil(g.height / SEGMENT);
    return { grid: g, shore: new Uint8Array(n), depth: new Uint8Array(n), textures: new Array(segs).fill(null) };
  }

  private disposeLayer(l: Layer | null) {
    if (!l) return;
    for (const t of l.textures) if (t) this.gl.deleteTexture(t);
  }

  /** Upload every segment that has no texture yet (main layer, and the export layer in export view). */
  private enqueueAll() {
    const g = this.main?.grid;
    if (!g || !this.scheduler) return;
    for (const seg of segmentsCovering(g.width, g.height, { x: 0, y: 0, w: g.width, h: g.height })) {
      if (!this.main!.textures[seg]) this.enqueueSeg(this.main!, seg, 'main');
      if (this.exp && this.view === 'export' && !this.exp.textures[seg]) this.enqueueSeg(this.exp, seg, 'export');
    }
  }

  private enqueueSeg(layer: Layer, seg: number, kind: string) {
    this.scheduler!.enqueue(kind, seg, () => {
      if (layer !== this.main && layer !== this.exp) return; // stale job
      const g = layer.grid;
      const r = segmentRect(g.width, g.height, seg);
      deriveRect(g, r, layer.shore, layer.depth);
      this.upload(layer, seg, r, layer === this.main ? this.removed : null);
      this.dirty = true;
    });
  }

  private upload(layer: Layer, seg: number, r: Rect, removed: Uint8Array | null) {
    const gl = this.gl;
    const g = layer.grid;
    const buf = this.staging;
    let k = 0;
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        const i = y * g.width + x;
        buf[k++] = g.terrain[i];
        buf[k++] = g.mag[i];
        buf[k++] = layer.depth[i];
        buf[k++] = layer.shore[i] | (removed && removed[i] ? 2 : 0);
      }
    }
    let tex = layer.textures[seg];
    if (!tex) {
      tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8UI, r.w, r.h);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      layer.textures[seg] = tex;
      this.maxTexDim = Math.max(this.maxTexDim, r.w, r.h);
    }
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, r.w, r.h, gl.RGBA_INTEGER, gl.UNSIGNED_BYTE, buf.subarray(0, r.w * r.h * 4));
  }

  draw() {
    this.dirty = false;
    const gl = this.gl;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(this.cssWidth * dpr));
    const h = Math.max(1, Math.round(this.cssHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.clearColor(22 / 255, 22 / 255, 22 / 255, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const layer = this.view === 'export' && this.exp ? this.exp : this.main;
    if (!layer) return;
    const g = layer.grid;
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.uniform2f(this.u.u_cam, this.camera.x, this.camera.y);
    gl.uniform1f(this.u.u_zoom, this.camera.zoom);
    gl.uniform2f(this.u.u_view, this.cssWidth, this.cssHeight);
    gl.uniform1i(this.u.u_mode, VIEW_INDEX[this.view]);
    gl.uniform1i(this.u.u_tex, 0);
    gl.activeTexture(gl.TEXTURE0);
    const tl = this.screenToMap(0, 0);
    const br = this.screenToMap(this.cssWidth, this.cssHeight);
    const visible = segmentsCovering(g.width, g.height, { x: tl.x, y: tl.y, w: br.x - tl.x + 1, h: br.y - tl.y + 1 });
    for (const seg of visible) {
      const tex = layer.textures[seg];
      if (!tex) continue;
      const r = segmentRect(g.width, g.height, seg);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform4f(this.u.u_rect, r.x, r.y, r.w, r.h);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
  }
}

function link(gl: WebGL2RenderingContext, vs: string, fs: string) {
  const compile = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader error');
    return s;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link error');
  return p;
}
