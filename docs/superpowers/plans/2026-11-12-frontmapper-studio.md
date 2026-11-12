# FrontMapper Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A static web app (GitHub Pages) that creates OpenFront maps from Earth data or by hand, shows exactly what the game will get, and exports a ready-to-submit zip.

**Architecture:** A pure, DOM-free `core/` (grid, OpenFront encoding, a TypeScript port of the Go generator's removal rules, tools, history, nations, info, export) is unit-tested with Vitest. The editor keeps the map in flat typed arrays on the main thread. It renders 256×256 segments with WebGL2 and runs heavy work as time-sliced segment jobs, nearest-to-view-centre first. Whole-map passes (export simulation and checks) run in a Web Worker on a copy. The Earth picker (Leaflet) builds a selection; `earth/` converts it to a grid using OpenFreeMap vector water and AWS Terrarium elevation tiles, plus Natural Earth borders and cities that a data script has preprocessed into static files.

**Tech Stack:** TypeScript 5, Vite 6, Preact 10 + @preact/signals, Leaflet 1.9.4, WebGL2, Vitest, Playwright, fflate (zip), fast-png (PNG), @mapbox/vector-tile + pbf (MVT), ajv (schema), idb-keyval (autosave), @phosphor-icons/web (icons), mapshaper (data script only).

**Spec:** `docs/superpowers/specs/2026-11-12-frontmapper-design.md` (read it first). Mockups: `docs/superpowers/specs/mockups/mock-editor-v4.html`, `mock-earth-v2.html`. The OpenFront facts in the spec were verified against OpenFrontIO `main` on 2026-11-12. Generator semantics below come from `map-generator/map_generator.go`.

## Global Constraints

- Static hosting only: no backend, no accounts, no API keys. Every runtime fetch must be CORS-enabled and keyless. Verified: `https://tiles.openfreemap.org/planet` (TileJSON, `water` layer, maxzoom 14), `https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png`, and `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}` (viewing only).
- Studio's only output is a zip download. Studio never opens PRs, runs the game or runs Go (except in the dev-only verification script, Task 21).
- `image.png` encoding (exact):
  - water = `rgb(0,0,106)`;
  - void = `rgb(0,0,0)`;
  - land = grey `rgb(b,b,b)` with `b = 140 + 2*mag`, where `mag` is an integer 0..30.
  - Decoding (import): alpha < 20 or blue == 106 means water; else r = g = b = 0 means void; else land with `mag = ceil((clamp(b,140,200) - 140) / 2)`.
- Generator rules to mirror: 4-connectivity; crop to multiples of 4; remove land bodies < 30 first, then every water body except the largest one if < 200. A removed body becomes the majority type among its unique outside 4-neighbours; ties go Water > Impassable > Land; its mag becomes 0.
- Map dimensions are always multiples of 4 inside Studio. Size tiers by pixel count: Small < 2M, Typical < 10M, Large < 25M, Huge ≥ 25M. Tiers are informational only and never block anything.
- `info.json` must validate against OpenFront's `info.schema.json` (vendored in Task 16):
  - `name` ≤ 29 chars matching `^[a-zA-Z0-9\s().-]+$`;
  - `id` matches `^[A-Z][A-Za-z0-9]*$`;
  - `translation_key` = `map.<folder>`;
  - `"$schema": "../../../info.schema.json"`.
- Map data comes only from open sources: OpenStreetMap via OpenFreeMap (ODbL), Terrain Tiles (Mapzen/Tilezen) and Natural Earth (public domain). Esri imagery is only ever displayed, never sampled.
- Graphite theme tokens: `--app:#1f1f1f; --panel:#2a2a2a; --line:#3a3a3a; --txt:#ececec; --dim:#a0a0a0; --btn:#333; --sel:#ececec; --selTxt:#1f1f1f; --warn:#ff4f43; --stage:#161616; --r:4px`. The only colour in the UI is red (`--warn`), and only for problems. The map provides all other colour. Icons come from Phosphor only. No em dashes in UI copy.
- Generated data files are committed and each must be under 100 MB.

## Review Focus

1. **Selections that cross the date line** (Fiji, Russia's east, New Zealand's outer islands): the frame should be a few degrees wide, not 360°, and tiles should wrap correctly. Pinned in Task 17 (`autoFrame` tests) and Task 19 (`tileRangeForFrame` wrap test).
2. **Network failure, offline or rate-limited tiles during conversion:** conversion should stop with a clear error and a Retry. A missing tile must never silently become land, water or zero elevation. Pinned in Task 19 (`fetchTiles` failure test).
3. **Huge maps (10000×5000):** loading, panning and export must not exceed WebGL texture limits or canvas size limits. PNG encoding must not use `<canvas>`. Pinned in Task 6 (segments never larger than 256 px) and Task 14 (`encodeImagePng` 10000×5000 test).
4. **A nation spawning on an island the generator will delete:** Checks must flag it before export. Pinned in Task 12 (`removed-on-export` test).
5. **Non-ASCII or punctuation-heavy map names** ("Kökar", "Bab-el-Mandeb!"): these should produce a valid `id`, folder and `name`, never a schema failure at export. Pinned in Task 13 (`deriveIds` tests).

---

## File Structure

```
index.html, vite.config.ts, tsconfig.json, package.json, playwright.config.ts
.github/workflows/pages.yml           deploy dist/ to GitHub Pages
src/main.tsx                          mounts <App/>
src/ui/theme.css                      Graphite tokens + base styles
src/ui/App.tsx                        screen routing: start | earth | editor
src/ui/start/StartScreen.tsx
src/ui/editor/{Editor,TopBar,ToolRail,BottomBar,SidePanel,ChecksTab,NationsTab,InfoTab}.tsx
src/ui/editor/EditorCanvas.tsx        hosts renderer + overlay + input
src/ui/earth/{EarthPicker,SizePanel,SearchBox,ConvertProgress}.tsx
src/state/store.ts                    app signals: project, view, tool, brush, selection
src/core/grid.ts                      MapGrid, constants, crop
src/core/encode.ts                    blue-channel encode/decode, PNG
src/core/generator.ts                 TS port of island/lake removal (simulateExport)
src/core/derive.ts                    shoreline + water depth per rect
src/core/colors.ts                    game / elevation colours (TS mirror of shader)
src/core/segments.ts                  segment math + SegmentScheduler
src/core/history.ts                   undo/redo segment patches
src/core/selection.ts                 rectangular editor selection mask
src/core/noise.ts                     seeded fbm
src/core/tools/{brush,fill,sculpt,texture,grow}.ts
src/core/nations.ts                   Nation model, checks, remap
src/core/info.ts                      MapMeta, ids, info.json build + validate
src/core/credits.ts                   source ids -> CREDITS.md lines
src/core/exportZip.ts                 zip builder
src/core/project.ts                   .frontmap save/open, autosave, OpenFront import
src/workers/analysis.worker.ts        simulateExport + checks off-thread
src/render/renderer.ts                WebGL2 segment renderer + camera
src/render/shaders.ts
src/render/overlay.ts                 2D overlay: brush footprint, nations, selection
src/earth/projection.ts               mercator, Frame, sizing, autoFrame, date line
src/earth/regions.ts                  load country/province/city data
src/earth/selectionOps.ts             SelOp model + rasterization
src/earth/tiles.ts                    tile maths, fetch with retry
src/earth/water.ts                    OpenFreeMap water -> mask
src/earth/elevation.ts                Terrarium -> metres grid; ElevationCurve
src/earth/convert.ts                  full conversion pipeline
src/earth/earthNations.ts             cities / countries / provinces -> Nation[]
public/data/...                       generated by scripts/data (Task 16)
scripts/data/build-data.mjs
scripts/verify-generator/run.mjs      dev-only Go round-trip
tests/core/*.test.ts, tests/earth/*.test.ts, tests/e2e/*.spec.ts, tests/fixtures/
```

---

### Task 1: Scaffold, theme and Pages deploy

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `playwright.config.ts`, `src/main.tsx`, `src/ui/App.tsx`, `src/ui/theme.css`, `.github/workflows/pages.yml`, `tests/e2e/smoke.spec.ts`, `tests/core/sanity.test.ts`
- Modify: `.gitignore` (add `test-results/`, `playwright-report/`, `.cache/`)

**Interfaces:**
- Produces: npm scripts `dev`, `build`, `test` (vitest run), `e2e` (playwright), `data` (Task 16). `vite.config.ts` uses `base: process.env.PAGES_BASE ?? '/'`. The workflow sets `PAGES_BASE=/FrontMapper/`.

- [ ] **Step 1: Write the failing e2e smoke test.** `tests/e2e/smoke.spec.ts`: open `/` and expect a heading with the text `FrontMapper`. Expect `getComputedStyle(document.body).backgroundColor` to be `rgb(31, 31, 31)`.
- [ ] **Step 2: Run `npm run e2e`.** Expected: FAIL (no app).
- [ ] **Step 3: Implement the scaffold.** Vite + Preact + TS (strict), with `theme.css` holding the Graphite tokens from Global Constraints and a system UI font plus `ui-monospace` for numbers. `App` renders a placeholder start heading. Vitest config: `tests/**/*.test.ts`, node environment. The Pages workflow runs `npm ci && npm test && npm run build`, then `actions/upload-pages-artifact` and `actions/deploy-pages`.
- [ ] **Step 4: Run `npm test && npm run e2e && npm run build`.** Expected: all pass, and `dist/index.html` exists.
- [ ] **Step 5: Commit** with message `chore: scaffold Studio (Vite, Preact, Graphite theme, Pages deploy)`.

### Task 2: Grid model and OpenFront image encoding

**Files:**
- Create: `src/core/grid.ts`, `src/core/encode.ts`, `tests/core/encode.test.ts`

**Interfaces:**
- Produces:
  - `WATER = 0, LAND = 1, VOID = 2`; `type Terrain = 0 | 1 | 2`; `MAX_MAG = 30`
  - `interface MapGrid { width: number; height: number; terrain: Uint8Array; mag: Uint8Array }` (row-major, `i = y*width + x`; mag is 0 for non-land)
  - `createGrid(width: number, height: number, fill?: Terrain): MapGrid`; `cloneGrid(g): MapGrid`; `cropToMultipleOf4(g): MapGrid`
  - `encodeRGB(g): Uint8Array` (3 bytes per pixel); `decodeRGBA(rgba: Uint8Array, width: number, height: number): MapGrid`
  - `encodeImagePng(g): Uint8Array` (fast-png, RGB 8-bit); `decodeImagePng(bytes: Uint8Array): MapGrid`

- [ ] **Step 1: Write failing tests.**
  - `encode water/void/land`: pixel colours are `[0,0,106]`, `[0,0,0]` and `[140,140,140]` for mag 0; `[200,200,200]` for mag 30.
  - `decode rules`: alpha 10 means water; blue 106 with any red means water; `(0,0,0,255)` means void; blue 141 means land mag 1; blue 230 means land mag 30; blue 100 means land mag 0.
  - `round trip`: a random 64×48 grid gives `decodeImagePng(encodeImagePng(g))` deep-equal to `g`.
  - `crop`: 103×58 crops to 100×56, keeping the top-left pixels.
- [ ] **Step 2: Run `npx vitest run tests/core/encode.test.ts`.** Expected: FAIL.
- [ ] **Step 3: Implement** `grid.ts` and `encode.ts` per the signatures and the encoding rules in Global Constraints.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** with message `feat(core): grid model and OpenFront blue-channel encoding`.

### Task 3: Generator port (export simulation)

**Files:**
- Create: `src/core/generator.ts`, `tests/core/generator.test.ts`

**Interfaces:**
- Consumes: `MapGrid`, the terrain constants.
- Produces:
  - `MIN_ISLAND = 30`, `MIN_LAKE = 200`
  - `interface Body { cells: Int32Array; replacement: Terrain }`
  - `interface ExportSimulation { grid: MapGrid; removedIslands: Body[]; removedLakes: Body[]; landTiles: number }`
  - `simulateExport(g: MapGrid): ExportSimulation` (works on a copy; never mutates `g`)

- [ ] **Step 1: Write failing tests** on small hand-built grids (ASCII fixtures: `.` water, `#` land, `X` void):
  - A 29-cell island is removed and becomes water. A 30-cell island is kept.
  - An island touching only void becomes void. An island with 2 water and 2 void unique neighbours becomes water (tie: water wins).
  - A diagonal-only connection does not join bodies (4-connectivity): two 20-cell blobs touching at a corner are both removed.
  - Islands go first: removing a 1-cell island inside a 199-cell lake merges it to 200, and the lake is kept.
  - The largest water body is never removed, even if smaller than 200 (a map that is all land except a 50-cell pond keeps the pond).
  - A 150-cell water body enclosed by void becomes void.
  - Removed cells have mag 0. `landTiles` counts the LAND cells left after removal.
  - Edge cases: an all-water map, an all-void map and a map with no water at all return without throwing, with no removals.
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement `simulateExport`.** Use a BFS labelling with a reusable `Int32Array` queue (no per-cell objects, because it must handle 50M cells). The majority vote counts each unique outside neighbour once.
- [ ] **Step 4: Run the tests.** Expected: PASS. Also run a 10000×5000 random-blob benchmark test tagged `.skipIf(!process.env.BENCH)`.
- [ ] **Step 5: Commit** with message `feat(core): TypeScript port of generator island/lake removal`.

### Task 4: Derived shoreline/depth and colours

**Files:**
- Create: `src/core/derive.ts`, `src/core/colors.ts`, `tests/core/derive.test.ts`

**Interfaces:**
- Produces:
  - `DEPTH_CAP = 20`
  - `interface Rect { x: number; y: number; w: number; h: number }`
  - `deriveRect(g: MapGrid, r: Rect, shore: Uint8Array, depth: Uint8Array): void` writes full-map-indexed arrays for cells in `r`. It reads a halo of `DEPTH_CAP + 1` around `r`.
  - `tileColor(t: Terrain, mag: number, shore: boolean, depth: number): [number, number, number]`
  - `elevationColor(t: Terrain, mag: number): [number, number, number]`

  Semantics: land is shore if a 4-neighbour is water. Water is shore if a 4-neighbour is land, with depth 0. Other water has depth = BFS distance through water from shore water, capped at 20. Water with a void 4-neighbour has depth 20. Unreachable water has depth 20.

  Colours:
  - Shore water `(100,143,255)`.
  - Other water: `adj = 1 - min(depth/2, 10)`, giving `(70+adj, 132+adj, 180+adj)`.
  - Shore land `(204,203,158)`.
  - Mag < 10: `(190, 220-2m, 138)`.
  - Mag < 20: `(200+2m, 183+2m, 138+2m)`.
  - Otherwise `(240,240,240)`.
  - Void `(22,22,22)`.
  - Elevation view: water `(20,26,34)`, void `(0,0,0)`, land grey `60 + m/30*195`.

- [ ] **Step 1: Write failing tests:**
  - On a random 300×300 grid, `deriveRect` over four quadrant rects gives arrays equal to one full-map reference BFS (written in the test) with the cap applied.
  - Water next to void has depth 20.
  - The colour spot-checks listed above.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Use a bounded multi-source BFS within the rect plus its halo.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** with message `feat(core): shoreline/depth derivation and game colours`.

### Task 5: Segment scheduler (Peter's view-centred updates)

**Files:**
- Create: `src/core/segments.ts`, `tests/core/segments.test.ts`

**Interfaces:**
- Produces:
  - `SEGMENT = 256`
  - `segmentsCovering(width, height, r: Rect): number[]` (segment index `sy*cols + sx`)
  - `class SegmentScheduler { constructor(width: number, height: number, budgetMs?: number /* default 8 */); enqueue(kind: string, seg: number, run: () => void): void; setFocus(x: number, y: number): void; get pending(): number; whenIdle(): Promise<void>; pump(now: () => number): void }`

  Rules:
  - Re-enqueueing the same `kind` and `seg` replaces the earlier job.
  - `pump` runs jobs in order of distance from the segment centre to the focus, nearest first, until the budget is spent.
  - `setFocus` re-prioritises pending jobs.
  - In the browser, `pump` is driven by `requestAnimationFrame`.

- [ ] **Step 1: Write failing tests** with a fake clock:
  - With focus at the centre of a 4×4-segment map, the run order starts with the 4 centre segments.
  - Moving the focus to the corner mid-queue makes the corner segment run next.
  - Duplicate enqueue runs once.
  - The budget stops after the expected count (each fake job advances the clock 3 ms with an 8 ms budget, so 3 jobs run per pump).
  - `whenIdle` resolves after the last job.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** (binary heap keyed by squared distance; rebuild the heap on `setFocus`).
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** with message `feat(core): view-centred segment job scheduler`.

### Task 6: WebGL2 segment renderer and editor canvas

**Files:**
- Create: `src/render/renderer.ts`, `src/render/shaders.ts`, `src/render/overlay.ts`, `src/ui/editor/EditorCanvas.tsx`, `src/state/store.ts`, `tests/e2e/render.spec.ts`

**Interfaces:**
- Consumes: `MapGrid`, `deriveRect`, `SEGMENT`, `SegmentScheduler`, `tileColor` (the shader must match it).
- Produces:
  - `type ViewMode = 'game' | 'elevation' | 'export'`
  - `class Renderer { constructor(canvas: HTMLCanvasElement); setMap(g: MapGrid): void; setExportSim(sim: ExportSimulation | null): void; setView(v: ViewMode): void; invalidate(r: Rect): void; camera: { x: number; y: number; zoom: number }; screenToMap(px: number, py: number): { x: number; y: number }; draw(): void }`

  Each segment is one RGBA8 256×256 texture:
  - R = terrain
  - G = mag
  - B = depth
  - A = bit0 shore, bit1 "removed on export"

  The shader colours per `ViewMode`:
  - Removed cells are solid `rgb(255,40,40)` in game and elevation views.
  - The export view samples a texture built from `sim.grid`.

  `invalidate` enqueues derive and upload jobs for the touched segments, plus derive for segments within the halo. `EditorCanvas` handles pan (middle-drag or Pan tool), wheel zoom about the cursor, pixelated sampling and the `--stage` background. It reports the focus (the map coordinate at the view centre) to the scheduler.

- [ ] **Step 1: Write a failing e2e test.**
  - Load a dev route `/?fixture=render` that builds a 1024×512 grid: left half water, a land square with mag 0/15/25 bands, a 10-cell island, and a void strip.
  - Screenshot-sample pixels at known map coordinates (via `window.__fm.mapToScreen`) and assert the `tileColor` values within ±2.
  - In the elevation view, assert the grey values.
  - Assert that a 10-cell island renders `(255,40,40)` after `setExportSim`, and is water in the export view.
  - Separately, assert that a 10000×5000 fixture creates textures no larger than 256.
- [ ] **Step 2: Run `npm run e2e -- render`.** Expected: FAIL.
- [ ] **Step 3: Implement** the renderer, shaders and canvas. Expose `window.__fm` only in dev and test builds.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** with message `feat(render): WebGL2 segment renderer with game/elevation/export views`.

### Task 7: History and editor selection

**Files:**
- Create: `src/core/history.ts`, `src/core/selection.ts`, `tests/core/history.test.ts`

**Interfaces:**
- Produces:
  - `class History { constructor(g: MapGrid, maxBytes?: number /* default 512 MiB */); begin(label: string): void; touch(seg: number): void /* snapshot before first change */; commit(): number[] /* changed segs */; undo(): number[]; redo(): number[]; get canUndo(): boolean; get canRedo(): boolean }`. When over `maxBytes`, the oldest entries are dropped. A new commit clears redo.
  - `interface Selection { x: number; y: number; w: number; h: number } | null`, plus `inSelection(sel, x, y): boolean`

- [ ] **Step 1: Write failing tests:**
  - Paint, commit, undo restores the exact bytes; redo reapplies them.
  - A 3-commit chain undoes in order.
  - Memory cap: with `maxBytes` set to two segments' worth, the third commit drops the first and `undo` ×3 stops at 2.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Store before and after copies of terrain + mag per touched segment.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** with message `feat(core): undo/redo history and editor selection`.

### Task 8: Brush, fill and eyedropper

**Files:**
- Create: `src/core/tools/brush.ts`, `src/core/tools/fill.ts`, `tests/core/tools-basic.test.ts`

**Interfaces:**
- Consumes: `MapGrid`, `History`, `Selection`, `segmentsCovering`.
- Produces:
  - `type Paint = { terrain: Terrain; mag: number }` (mag is ignored for water and void)
  - `brushFootprint(diameter: number): Int16Array` holds `[dx,dy]` pairs. A cell is included if its centre `(dx+.5, dy+.5)` lies within `diameter/2` of the brush centre. The brush centre is the cursor cell's centre for odd diameters and its top-left corner for even ones.
  - `paintAt(g, h: History, sel, x, y, diameter, p: Paint): Rect`
  - `paintStroke(g, h, sel, from: {x,y}, to: {x,y}, diameter, p): Rect` (Bresenham steps, no gaps)
  - `floodFill(g, h, sel, x, y, p): Rect` (4-connected, exact match on terrain and mag, clipped to the selection)
  - `pickAt(g, x, y): Paint`

- [ ] **Step 1: Write failing tests:**
  - Footprint cell counts: diameter 1 gives 1, 2 gives 4, 3 gives 9, 5 gives 21.
  - A fast stroke from (0,0) to (40,0) with diameter 1 paints 41 contiguous cells.
  - The fill is stopped by different terrain and by different mag.
  - The fill is clipped to the selection.
  - Painting outside the map is ignored.
  - Painting water sets mag 0.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Use a scanline flood fill with an `Int32Array` stack.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** with message `feat(tools): brush, flood fill, eyedropper`.

### Task 9: Raise/lower, smooth, texture

**Files:**
- Create: `src/core/noise.ts`, `src/core/tools/sculpt.ts`, `src/core/tools/texture.ts`, `tests/core/tools-terrain.test.ts`

**Interfaces:**
- Produces:
  - `fbm(seed: number, x: number, y: number, grain: number): number` returns a value in [-1,1] (simplex, 5 octaves, deterministic per seed).
  - `raiseAt(g, h, sel, x, y, diameter, amount: number): Rect`. Adds `amount × falloff` to land mag, with linear falloff from 1 at the centre to 0 at the edge. Clamped to 0..30, rounded. Water and void are untouched.
  - `smoothAt(g, h, sel, x, y, diameter): Rect`. A 3×3 mean over land neighbours only, for land cells in the footprint.
  - `type TextureMode = 'coast+elevation' | 'elevation'`
  - `textureAt(g, h, sel, x, y, diameter, opts: { mode: TextureMode; strength: number /*0..1*/; grain: number /*px*/; seed: number }): Rect`
  - `textureRect(g, h, r: Rect, opts): Rect` applies the same algorithm to every cell in `r`. Task 10 runs "texture over selection" as one `SegmentScheduler` job per segment ∩ selection (kind `'texture'`), nearest the view first. All the jobs share one `History` entry, which is committed when the scheduler goes idle.

  Texture algorithm:
  - Elevation: `mag += round(strength * 10 * fbm)` on land, clamped to 0..30.
  - `coast+elevation` additionally does the following. Compute signed distance `d` to the land/water boundary within `R = grain` (positive on land, negative in water, via a local BFS). Each cell with `|d| <= R` becomes land if `d + strength*R*fbm > 0`, otherwise water. New land gets mag 0 plus the elevation noise. New water gets mag 0. Void is never changed and never created.

- [ ] **Step 1: Write failing tests:**
  - `fbm` is deterministic and stays within [-1,1].
  - Raise clamps at 30 and never touches water.
  - Smooth on a 0/30 checkerboard of land converges toward 15.
  - **In `elevation` mode, the terrain array is byte-identical before and after.**
  - In `coast+elevation` mode with strength 1 on a straight coastline, both land→water and water→land cells occur, and void cells are unchanged.
  - Selection texture only touches cells inside the selection.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** with message `feat(tools): raise/lower, smooth, noise texture (coast+elevation, elevation-only)`.

### Task 10: Editor shell UI (Graphite) with pixel-snapped cursor

**Files:**
- Create: `src/ui/editor/{Editor,TopBar,ToolRail,BottomBar,SidePanel}.tsx`
- Modify: `src/render/overlay.ts`, `src/state/store.ts`, `src/ui/App.tsx`
- Test: `tests/e2e/editor-shell.spec.ts`

**Interfaces:**
- Consumes: the Renderer, scheduler, history, and the tools from Tasks 8 and 9.
- Produces:
  - store signals: `tool: 'pan'|'select'|'brush'|'fill'|'raise'|'smooth'|'texture'|'eyedropper'|'spawn'`, `paint: Paint`, `brushDiameter: number /*1..256*/`, `textureOpts`, `view: ViewMode`, `selection`
  - `overlay.drawBrush(cells: Int16Array, cx: number, cy: number)`: draws the outline of the union of footprint cells as pixel-edge segments (1px white over a 3px 55%-black stroke). There is no circle, and the OS cursor is hidden over the map.

  Layout follows `mock-editor-v4.html`:
  - Top bar: name and size, Game/Elevation/After export toggle, Earth button, Export button.
  - Left tool rail with tooltips.
  - Bottom bar: terrain swatches (Water, Plains mag 5, Highlands mag 15, Mountains mag 25, Void) plus a Size slider with a mono value. When raise or texture is active, it also shows an amount/strength + grain + mode control.
  - Right panel tabs: Checks, Nations, Info. Content comes in Tasks 11-13.

  Keyboard: B brush, G fill, R raise, S smooth, T texture, I eyedropper, N spawn, M select, Space-hold pan, `[`/`]` size, Ctrl+Z/Ctrl+Shift+Z.

- [ ] **Step 1: Write failing e2e tests.**
  - On the fixture map, pick the brush with diameter 5 and hover.
  - The overlay's painted outline pixels form a closed 21-cell shape: assert via `window.__fm.lastBrushCells.length === 21`, and that the canvas cursor style is `none`.
  - Paint a stroke, Ctrl+Z, and the pixel is restored.
  - The view toggle switches the `view` signal.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** the components with Graphite tokens and Phosphor classes (`ph ph-hand`, `ph-selection`, `ph-paint-brush`, `ph-paint-bucket`, `ph-mountains`, `ph-wave-sine`, `ph-dots-nine`, `ph-eyedropper`, `ph-flag`).
- [ ] **Step 4: Run, and check the result visually against the mockup in a browser.** Expected: PASS, and it looks right.
- [ ] **Step 5: Commit** with message `feat(ui): Graphite editor shell with pixel-snapped brush cursor`.

### Task 11: Checks tab, analysis worker, Grow to 30

**Files:**
- Create: `src/workers/analysis.worker.ts`, `src/core/tools/grow.ts`, `src/ui/editor/ChecksTab.tsx`, `tests/core/grow.test.ts`, `tests/e2e/checks.spec.ts`

**Interfaces:**
- Consumes: `simulateExport`, `History`, `nationIssues` (Task 12; until then, render the nations section empty).
- Produces:
  - worker message `{ type: 'analyze', width, height, terrain, mag }` → `{ type: 'result', removedIslands: Int32Array[], removedLakes: Int32Array[], landTiles, simGrid }` (transferables). The main thread sends a copy after edits, debounced by 600 ms, and only once `scheduler.pending === 0`.
  - `growIsland(g, h, cells: Int32Array, min = 30): Rect` dilates into 4-neighbouring water, ring by ring (stable order: by y then x), until size ≥ min. New land gets mag 0.
  - `sizeTier(pixels: number): 'Small'|'Typical'|'Large'|'Huge'`

  Checks tab sections:
  - **Lost on export**: island and lake counts, each with a red square, plus Show (cycles the camera through bodies), Grow to 30 (islands only, all at once) and Accept (hides that group's warning until the next change in it).
  - **Size**: pixels, land tiles, tier bar. Huge shows "Large maps run poorly on mobile."
  - **Nations**.
  - **Map info** (errors from Task 13).

  While analysis is pending, the tab shows "Checking…". Export waits for it.

- [ ] **Step 1: Write failing tests.**
  - Unit: `growIsland` on a 12-cell island gives ≥ 30 cells, all connected, and void is not consumed. Tiers: 1.99M is Small, 2M is Typical, 9.99M is Typical, 10M is Large, 50M is Huge.
  - E2E: the fixture with three small islands shows "3 islands under 30 px get deleted". Clicking Grow to 30 leads to "0" after analysis.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** with message `feat(checks): export-loss analysis worker, grow-to-30, size tiers`.

### Task 12: Nations model, spawn tool, Nations tab

**Files:**
- Create: `src/core/nations.ts`, `src/ui/editor/NationsTab.tsx`, `tests/core/nations.test.ts`
- Modify: `src/render/overlay.ts` (nation pins), `src/ui/editor/ChecksTab.tsx`

**Interfaces:**
- Consumes: `MapGrid`, `ExportSimulation`, the flag list (`public/data/flags.json` from Task 16; tests use an inline list).
- Produces:
  - `interface Nation { id: string; name: string; x: number; y: number; flag: string; source: 'custom'|'city'|'country'|'province'; lonLat?: [number, number] }`
  - `type NationIssueKind = 'in-water'|'in-void'|'off-map'|'removed-on-export'|'too-close'|'unknown-flag'|'duplicate-name'`
  - `nationIssues(n: Nation[], g: MapGrid, sim: ExportSimulation | null, flags: Set<string>, minDist = 30): { nationId: string; kind: NationIssueKind }[]`
  - `remapNations(n: Nation[], t: { sx: number; sy: number; ox: number; oy: number }, width: number, height: number): Nation[]` (x' = round(x*sx + ox); out-of-bounds nations are kept but flagged `off-map` by `nationIssues`)

  The spawn tool places a nation on click, selects it, and supports drag to move. The Nations tab has a list with inline rename, a flag picker (searchable over the flag codes, with an SVG preview from `https://raw.githubusercontent.com/openfrontio/OpenFrontIO/main/resources/flags/<code>.svg`), delete, and a per-row issue marker. The source buttons (Cities ≥ N, Countries, Provinces) show only on Earth-based maps and are wired up in Task 20.

- [ ] **Step 1: Write failing tests:**
  - Nations on water, on void and off the map are flagged.
  - **A nation on a 10-cell island is flagged `removed-on-export` when `sim` marks it removed.**
  - Two nations 29 px apart are flagged `too-close`; 30 px apart is fine.
  - Flag `xx` is flagged `unknown-flag`.
  - `remapNations` with `sx=.5` halves the coordinates.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** with message `feat(nations): nation model, checks, spawn tool, Nations tab`.

### Task 13: Map info, ids, schema validation, crop/resize

**Files:**
- Create: `src/core/info.ts`, `src/ui/editor/InfoTab.tsx`, `tests/core/info.test.ts`
- Modify: `src/ui/editor/ChecksTab.tsx`

**Interfaces:**
- Consumes: `public/data/info.schema.json` (vendored in Task 16; tests import it from `tests/fixtures/info.schema.json`, which is a copy), `Nation`, `remapNations`.
- Produces:
  - `interface MapMeta { name: string; displayName?: string; author?: string; description?: string; categories: string[]; themes?: string[]; location?: { lat: number; lon: number } }`
  - `deriveIds(name: string): { id: string; folder: string; translationKey: string; canonicalName: string }`
    - Strip diacritics (NFD), drop chars outside `[a-zA-Z0-9\s().-]`, and trim to 29 characters to get `canonicalName`.
    - `id` = UpperCamelCase of the alphanumeric words, prefixed `Map` if it starts with a digit.
    - `folder` = `id.toLowerCase()`.
  - `buildInfoJson(meta: MapMeta, nations: Nation[]): object` gives the key order `$schema, id, name, translation_key, display_name?, author?, description?, categories, location?, themes?, nations`. Nations become `{ coordinates:[x,y], name, flag }`. `display_name` is included only when it differs from the canonical name.
  - `validateInfo(info: object): string[]` (ajv 2020 against the vendored schema; messages are human-readable)
  - `cropGrid(g, r: Rect): MapGrid` and `resizeGrid(g, w, h): MapGrid` (nearest-neighbour, rounded to multiples of 4). Both return the transform for `remapNations`.

  The Info tab has fields with inline errors, category chips from the schema enum, a read-only folder/id preview, a "Map size" section (Resize, plus Crop to selection when a selection exists) and author. The default author is empty.

- [ ] **Step 1: Write failing tests:**
  - `deriveIds('Kökar')` gives `{ id:'Kokar', folder:'kokar', translationKey:'map.kokar', canonicalName:'Kokar' }`.
  - `deriveIds('Bab-el-Mandeb!')` gives a valid `name` and `id:'BabElMandeb'`.
  - `deriveIds('2 Islands')` gives `id:'Map2Islands'`.
  - A 40-character name trims to 29.
  - `buildInfoJson` output passes `validateInfo` with 0 errors. Removing `categories` produces an error.
  - Crop of 100×100 to rect (10,10,40,40) moves a nation at (30,30) to (20,20).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** with message `feat(info): map metadata, id derivation, schema validation, crop/resize`.

### Task 14: Export zip, credits, project files, autosave, OpenFront import

**Files:**
- Create: `src/core/credits.ts`, `src/core/exportZip.ts`, `src/core/project.ts`, `tests/core/export.test.ts`, `tests/core/project.test.ts`
- Modify: `src/ui/editor/TopBar.tsx` (Export, Save, Open)

**Interfaces:**
- Consumes: `encodeImagePng`, `simulateExport`, `buildInfoJson`, `validateInfo`, `tileColor`, `deriveRect`.
- Produces:
  - `type SourceId = 'osm' | 'terrain-tiles' | 'natural-earth'`
  - `creditsSnippet(ids: SourceId[]): string`. Use the exact Markdown shape of OpenFront's `CREDITS.md` "Map Data" entries:
    - `osm`: `© [OpenStreetMap contributors](https://www.openstreetmap.org/copyright)  \nLicensed under ODbL`, followed by the line `Vector tiles: [OpenFreeMap](https://openfreemap.org) / [OpenMapTiles](https://openmaptiles.org)`
    - `terrain-tiles`: `Elevation data from [Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (Mapzen/Tilezen), used for the <Display Name> map.\nSource attribution: [tilezen/joerd attribution](https://github.com/tilezen/joerd/blob/master/docs/attribution.md)`
    - `natural-earth`: `[Natural Earth](https://www.naturalearthdata.com/)  \nPublic Domain`
  - `buildExportZip(p: { grid: MapGrid; meta: MapMeta; nations: Nation[]; sources: SourceId[]; toolVersion: string }): Promise<Uint8Array>`. The zip contains exactly: `<folder>/image.png`, `<folder>/info.json`, `CREDITS.md.snippet`, `frontmapper.json` and `preview.png`.
    - `frontmapper.json` = `{ format: 1, tool: 'FrontMapper Studio', toolVersion, folder, id, width, height, landTiles, removed: { islands, lakes }, nations: n, sources, createdAt }`.
    - `preview.png` is the export-view render at ≤ 1200 px width, made with `tileColor` in TS (no WebGL).
    - It throws if `validateInfo` returns errors.
  - Project file `.frontmap` (zip): `grid.bin` (terrain then mag, raw) + `project.json` `{ version: 1, meta, nations, earth?: { ops, frameSize, curve }, camera }`. Functions: `saveProject(s): Uint8Array`, `openProject(bytes): ProjectState`.
  - `autosave(s)` stores to IndexedDB key `autosave:<projectId>` and keeps a `recent` list (max 10, with name, size and updatedAt). It runs debounced 2 s after changes and holds at most one write at a time.
  - `importOpenFrontMap(png: Uint8Array, infoJson: string): ProjectState` (`decodeImagePng` + meta + nations)
  - `interface ProjectState { id: string /* uuid */; grid: MapGrid; meta: MapMeta; nations: Nation[]; earth?: { ops: SelOp[]; frameSize: FrameSize; curve: ElevationCurve }; camera?: { x: number; y: number; zoom: number } }`. `SelOp`, `FrameSize` and `ElevationCurve` are type-only imports from Tasks 17-19. Define them here as type stubs if those tasks aren't done yet, and keep the names.

- [ ] **Step 1: Write failing tests:**
  - The zip's entry list equals the five paths. `image.png` decodes to the grid.
  - `info.json` has `$schema` `../../../info.schema.json` and validates.
  - The `CREDITS.md.snippet` for `['osm','terrain-tiles']` contains both headings' text.
  - **10000×5000 export**: `encodeImagePng` of an all-water 10000×5000 grid completes under Node and decodes back to the same dimensions. Tagged `.skipIf(!process.env.BENCH)` locally, but run in CI.
  - Project save/open round-trips bytes and nations.
  - Importing the vendored `southeastasia`-shaped fixture (a small PNG + info in `tests/fixtures/`) gives the expected nations.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** (fflate `zipSync`; download via `URL.createObjectURL`).
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** with message `feat(export): zip export, credits, project save/open, autosave, OpenFront import`.

### Task 15: Start screen and blank maps

**Files:**
- Create: `src/ui/start/StartScreen.tsx`, `tests/e2e/start.spec.ts`
- Modify: `src/ui/App.tsx`

**Interfaces:**
- Consumes: `createGrid`, `openProject`, `importOpenFrontMap`, the autosave `recent` list.
- Produces: the start screen actions:
  - **New blank map**: width and height fields snapping to 4, with presets 2000×1500, 3000×2000 and 4000×2500, all water.
  - **New from Earth**: goes to `earth`.
  - **Open project**: `.frontmap`.
  - **Import OpenFront map**: picks `image.png` + `info.json`.
  - **Recent**: resumes autosaves.

- [ ] **Step 1: Write a failing e2e test.** New blank 3000×2000 opens the editor showing `3000 × 2000`. Reloading lists it under Recent, and clicking it restores it.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** in Graphite style: left-aligned, no hero, a dense list of actions with Phosphor icons.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** with message `feat(ui): start screen, blank maps, recent projects`.

### Task 16: Data pipeline (borders, provinces, cities, flags, schema)

**Files:**
- Create: `scripts/data/build-data.mjs`, `public/data/countries-low.json`, `public/data/countries/<ADM0_A3>.json`, `public/data/provinces/<ADM0_A3>.json`, `public/data/cities.json`, `public/data/flags.json`, `public/data/info.schema.json`, `public/data/SOURCES.md`, `tests/data/data.test.ts`, `tests/fixtures/info.schema.json`

**Interfaces:**
- Produces (consumed by `src/earth/regions.ts`):
  - `countries-low.json`: TopoJSON, object `countries`, simplified for world outlines (target ≤ 3 MB). Feature id = `ADM0_A3`, properties `{ name: NAME, iso2: ISO_A2_EH lowercased }`.
  - `countries/<A3>.json`: full-detail Natural Earth 10m GeoJSON for that country.
  - `provinces/<A3>.json`: GeoJSON of Natural Earth admin-1 for that country, properties `{ id: adm1_code, name, iso3166_2: iso_3166_2 }`.
  - `cities.json`: `[name, lon, lat, pop, iso2, kind]` rows where kind is `'capital'|'admin1'|'city'`. Source: Natural Earth 10m populated places with `POP_MAX ≥ 10000` or a capital. Kind is from `FEATURECLA`/`ADM0CAP`.
  - `flags.json`: string[] of OpenFront flag codes (filenames in `openfrontio/OpenFrontIO/resources/flags` without `.svg`, via the GitHub contents API).
  - `info.schema.json`: copied from `openfrontio/OpenFrontIO/map-generator/info.schema.json` at `main`. `SOURCES.md` records the commit SHAs and download dates.

  `npm run data` runs the script. It downloads the Natural Earth zips from `https://naciscdn.org/naturalearth/10m/cultural/` and processes them with the `mapshaper` CLI. It must **split any ring segment with |Δlon| > 180 at the antimeridian**.

- [ ] **Step 1: Write failing tests** `tests/data/data.test.ts`, run against the committed files:
  - Indonesia (`IDN`) exists with iso2 `id`.
  - Russia's and Fiji's geometries have no consecutive vertices with |Δlon| > 180.
  - `cities.json` contains Jakarta with kind `capital` and pop > 8M.
  - `flags.json` contains `id` and `DE-BB`.
  - `provinces/IDN.json` has ≥ 30 features with names.
  - Every file is < 100 MB, and `countries-low.json` is ≤ 3 MB.
- [ ] **Step 2: Run.** Expected: FAIL (no files).
- [ ] **Step 3: Implement the script, run `npm run data`, and commit the outputs.**
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** with message `feat(data): preprocessed Natural Earth borders, provinces, cities, OpenFront flags and schema`.

### Task 17: Projection, frame sizing, auto-frame and date line

**Files:**
- Create: `src/earth/projection.ts`, `tests/earth/projection.test.ts`

**Interfaces:**
- Produces:
  - `HALF = 20037508.342789244`
  - `lonLatToMerc(lon, lat): { x; y }` (y grows southward); `mercToLonLat(x, y): { lon; lat }` (lon normalised to [-180,180))
  - `interface Frame { x0; y0; x1; y1 }` (mercator metres, `x0 ∈ [-HALF, HALF)`, `x1 > x0` and may exceed HALF when crossing the date line)
  - `interface FrameSize { frame: Frame; width: number; height: number; mPerPx: number }`
  - `fitSize(frame: Frame, width: number): FrameSize` (height = snap4(frameHeight / mPerPx))
  - `setSide(fs: FrameSize, side: 'width'|'height', px: number, linked: boolean): FrameSize`. Linked keeps the frame and changes `mPerPx`. Unlinked keeps `mPerPx` and resizes the frame symmetrically about its centre. Pixel values snap to multiples of 4, minimum 4.
  - `kmPerPx(fs): number` (`mPerPx × cos(centre lat) / 1000`)
  - `interface Part { lonMin; lonMax; latMin; latMax; area: number }`
  - `autoFrame(parts: Part[]): { frame: Frame; outliers: Part[] }`. Algorithm:
    1. Cluster parts whose wrap-aware bboxes, expanded by `gap = max(5°, 0.25 × span of the largest part)`, intersect.
    2. Keep the cluster with the largest total area.
    3. Take its longitude extent as the complement of the largest gap on the circle.
    4. Add margins of 4% (x) and 6% (y), and clamp lat to ±85.
  - `wrapLonNear(lon, centerLon): number` gives lon shifted by ±360 into `[centerLon-180, centerLon+180)` for drawing.

- [ ] **Step 1: Write failing tests:**
  - `lonLatToMerc(180,0).x ≈ HALF`; round trip within 1e-9.
  - Unlinked `setSide` height 2000 keeps `mPerPx` and frame height = 2000 × mPerPx. Linked `setSide` width 8000 halves `mPerPx`.
  - The 4002 input snaps to 4000.
  - **Fiji parts at lon [177,180] and [-180,-178] give a frame width < 8° (in degrees, via `mercToLonLat`) with `x1 > HALF`.**
  - **New Zealand main islands plus the Kermadec part (lon −178, lat −29) and Chathams (lon −176.5, lat −44) give a frame around the main islands, with both listed as outliers.**
  - Indonesia's parts give one cluster and no outliers.
  - `wrapLonNear(-170, 175) === 190`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** with message `feat(earth): mercator frames, linked/unlinked sizing, date-line-aware auto-frame`.

### Task 18: Earth picker UI

**Files:**
- Create: `src/earth/regions.ts`, `src/earth/selectionOps.ts`, `src/ui/earth/{EarthPicker,SizePanel,SearchBox}.tsx`, `tests/earth/selectionOps.test.ts`, `tests/e2e/earth.spec.ts`

**Interfaces:**
- Consumes: the Task 16 data, the Task 17 projection.
- Produces:
  - `loadCountriesLow(): Promise<FeatureCollection>`, `loadCountry(a3)`, `loadProvinces(a3)`, `loadCities()` (cached)
  - `type SelOp = { mode: 'add'|'subtract'; shape: { kind: 'region'; level: 'country'|'province'; id: string } | { kind: 'rect'; a: [lon,lat]; b: [lon,lat] } | { kind: 'circle'; center: [lon,lat]; radiusM: number } | { kind: 'lasso'; points: [lon,lat][] } }`
  - `toggleRegion(ops: SelOp[], level, id, additive: boolean): SelOp[]`. A plain click replaces the selection. Shift+click adds the region, or removes it if it's already added.
  - `selectedRegionIds(ops): { country: Set<string>; province: Set<string> }`

  Picker behaviour, following `mock-earth-v2.html` and built with Leaflet:
  - **Imagery:** the Esri layer with its attribution.
  - **Outlines:** the outline layer uses `L.canvas()`, so no worker is needed. Country outlines are always visible: `#fff` at 0.55 opacity and 0.7 weight. On hover the weight is 1.6. Selected outlines are 2px. Once something is selected, non-selected land is dimmed with 70% black. Province outlines show in Province mode for the countries in view.
  - **Search:** countries and provinces ("Aceh, Indonesia"), with arrow keys and Enter. Choosing a result selects it and flies to it.
  - **Tools:** Country, Province, Square, Hand draw (lasso), Circle. Shift adds and Alt subtracts; with no modifier, a shape replaces the shapes.
  - **Frame:** a dashed rectangle from `autoFrame`, with four draggable edge handles. An outliers notice reads "N far-off parts not included" with "Include".
  - **Size panel:** Width, link toggle, Height, km/px, pixels + tier, and a Terrain group with "Highlands from" (default 300 m) and "Mountains from" (default 1500 m) number fields.
  - **Convert to map** is disabled until there's a selection.
  - **Date line:** geometries are drawn with `wrapLonNear` around the view centre.
  - **Opened from the editor's Earth button:** restores `project.earth` (ops, frame, size, curve). Converting again replaces the terrain, so it first confirms "Replace the current terrain? Hand edits will be lost." Nations with `lonLat` are re-placed (Task 20).

- [ ] **Step 1: Write failing tests.**
  - Unit: `toggleRegion` replace/add/remove behaviour.
  - E2E, with tile requests routed to local fixtures:
    - Typing "indon" + Enter selects Indonesia and shows its tag.
    - Width shows 4000. Changing Height while unlinked keeps km/px.
    - Shift+clicking Malaysia adds a second tag.
    - Dragging the frame's right edge increases Width.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, and check it visually in a browser.** Expected: PASS.
- [ ] **Step 5: Commit** with message `feat(earth): satellite picker with clickable borders, search, selection tools, frame`.

### Task 19: Conversion pipeline (water, elevation, selection → grid)

**Files:**
- Create: `src/earth/tiles.ts`, `src/earth/water.ts`, `src/earth/elevation.ts`, `src/earth/convert.ts`, `src/ui/earth/ConvertProgress.tsx`, `tests/earth/convert.test.ts`, `tests/fixtures/tiles/`

**Interfaces:**
- Consumes: `FrameSize`, `SelOp`, region loaders, `MapGrid`.
- Produces:
  - `pickZoom(mPerPx: number, maxZoom: number, tileSize: number): number` (the smallest z whose tile resolution ≤ mPerPx, clamped)
  - `tileRangeForFrame(frame: Frame, z: number): { z; x0; x1; y0; y1 }`. When computing tile x, wrap it with `((x % n) + n) % n`. Reduce z until the tile count is ≤ 1024.
  - `fetchTiles<T>(urls: string[], decode: (b: ArrayBuffer) => Promise<T>, opts: { retries: 3; concurrency: 8; signal: AbortSignal; onProgress }): Promise<T[]>`. Throws `TileFetchError { failed: string[] }` after the retries. **Never resolves with missing tiles.**
  - `waterMask(fs: FrameSize, fetch): Promise<Uint8Array>` decodes the OpenFreeMap `water` layer (URL template from the TileJSON at `https://tiles.openfreemap.org/planet`). It rasterises the polygons with nonzero fill onto an `OffscreenCanvas` at output resolution (in strips of ≤ 4096 px height), so 1 = water.
  - `elevationGrid(fs: FrameSize, fetch): Promise<Float32Array>`. Terrarium metres = `R*256 + G + B/256 - 32768`, bilinear sampled.
  - `interface ElevationCurve { highlandsFrom: number; mountainsFrom: number; peak: number }`, default `{ 300, 1500, 4000 }`
  - `magFor(m: number, c: ElevationCurve): number`. ≤ 0 m gives 0. 0..highlandsFrom maps linearly to 0..9. ..mountainsFrom maps to 10..19. ..peak maps to 20..30, clamped.
  - `convert(req: { fs: FrameSize; ops: SelOp[]; curve: ElevationCurve }, deps: { fetch: typeof fetch; signal: AbortSignal }, onProgress: (step: string, done: number, total: number) => void): Promise<{ grid: MapGrid; sources: SourceId[]; regionGrid: Int32Array; regionIndex: string[] }>`. Steps:
    1. Water mask.
    2. Elevation.
    3. Region-ID raster: rasterise each country (and province, if any province ops) in the frame with a unique ID. Multi-source BFS assigns **every land pixel** the nearest region ID, so islets missed by the borders belong to the nearest country.
    4. Rasterise the shapes.
    5. Evaluate the ops in order to a selected mask.
    6. Terrain: water stays water; selected land becomes LAND with `magFor`; other land becomes VOID.

    Sources are always `['osm','terrain-tiles','natural-earth']`.
  - Progress UI: steps "Coastlines", "Elevation", "Borders", "Building map" with counts. Errors show the failed-tile count and Retry, and keep the picker state.

- [ ] **Step 1: Write failing tests**, using fixture tiles and a stub fetch:
  - `magFor` at 0/150/300/1500/4000/9000 gives 0/4/10/20/30/30. Pin 150 → 4 by using floor of linear interpolation.
  - **`tileRangeForFrame` for a frame crossing 180° at z=3 gives x values 7 and 0, in that order.**
  - **When `fetchTiles` gets a fetch that fails one URL 4 times, it rejects with `TileFetchError` listing that URL.**
  - Synthetic conversion (two fake countries A and B on one island plus a 3-pixel islet outside both polygons, nearer to A; select A): A's land and the islet are LAND, B's land is VOID, and water stays WATER.
  - Subtracting a rect removes selected land inside it, which becomes VOID.
  - Land below 0 m that the mask says is land becomes LAND with mag 0.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Use a Worker for the rasterisation and BFS if the main thread blocks for more than 100 ms on a 4000 px map.
- [ ] **Step 4: Run.** Expected: PASS. Then convert Indonesia at width 4000 in a real browser and check the coastlines, small islands, Malaysian Borneo and Timor-Leste/PNG as void, and the mountains on Java and Papua look plausible. Tune the curve defaults if not, and update the test expectations if they change.
- [ ] **Step 5: Commit** with message `feat(earth): conversion pipeline (OSM water, Terrarium elevation, region selection)`.

### Task 20: Nations from Earth

**Files:**
- Create: `src/earth/earthNations.ts`, `tests/earth/earthNations.test.ts`
- Modify: `src/ui/editor/NationsTab.tsx`

**Interfaces:**
- Consumes: `cities.json`, region loaders, `convert`'s `regionGrid`/`regionIndex`, `FrameSize`, the flags set.
- Produces:
  - `cityNations(cities, fs, grid, minPop: number, flags): Nation[]`: cities inside the frame on LAND with pop ≥ minPop. Named after the city, with flag = iso2 if it's in the flags set (else `''`), `lonLat` set and source `'city'`.
  - `regionNations(level: 'country'|'province', fs, grid, regionGrid, regionIndex, cities, flags): Nation[]`:
    - One nation per region with ≥ 1 LAND pixel.
    - Spawn at the capital (kind `capital` for countries, `admin1` for provinces, matched by point-in-region) if it lands on that region's LAND. Otherwise at the region's pixel farthest from non-region pixels, via a distance transform.
    - Country flag = iso2. Province flag = `iso3166_2` if it's in the flags set, else the country's iso2.
  - Nations tab source buttons: "Cities over [N]" (default 1,000,000), "Countries" and "Provinces". Each replaces existing nations of that source and keeps custom ones.
  - Re-converting from the Earth button re-places nations that have `lonLat` (custom ones get `lonLat` from the pixel at creation on Earth maps).

- [ ] **Step 1: Write failing tests** on a synthetic 2-region fixture:
  - Cities below the threshold are excluded.
  - A city on void is excluded.
  - A province with no capital spawns inside its own land.
  - A province flag falls back to the country flag.
  - `remapNations` after a re-frame keeps `lonLat`-based positions correct (to ±1 px).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** with message `feat(nations): cities, countries and provinces from Earth data`.

### Task 21: Generator round-trip check and Indonesia acceptance

**Files:**
- Create: `scripts/verify-generator/run.mjs`, `scripts/verify-generator/make-fixtures.ts`, `tests/fixtures/export/README.md`
- Modify: `package.json` (`"verify:generator"`), `README.md` (dev notes, deploy, data credits)

**Interfaces:**
- Consumes: `buildExportZip`, `simulateExport`.
- Produces: `npm run verify:generator` (dev only; needs Go and git). It does the following:
  1. Builds 5 fixture maps (random blobs with small islands, lakes, void-enclosed lakes, an island touching void, a 1000×600 noise map).
  2. Shallow-clones OpenFrontIO into `.cache/ofio` (or pulls).
  3. Copies each fixture folder into `map-generator/assets/maps/`.
  4. Runs `go run . --maps=<names> --log-level=DEBUG --debug-removal`.
  5. Parses `Identified and removed N islands` / `N bodies of water` per map.
  6. Compares with `simulateExport` counts and prints a table. It exits 1 on any mismatch.

- [ ] **Step 1: Write the script and run `npm run verify:generator`.** Expected: all 5 maps match. If any mismatch, fix `generator.ts` (the Go generator is the reference) and add a unit test reproducing the case.
- [ ] **Step 2: Do the Indonesia acceptance run in a real browser:**
  1. Search Indonesia, set width 4000, Convert.
  2. Check: islands look right; Malaysian Borneo, Timor-Leste and Papua New Guinea are void; mountains appear on Java and Papua.
  3. Add Provinces nations and fix any red Checks.
  4. Export.
  5. Unzip into `.cache/ofio/map-generator/assets/maps/` and run the generator: it succeeds, and the removal counts equal the Checks tab.
  6. Record the results in `tests/fixtures/export/README.md`.
- [ ] **Step 3: Run the full suite** (`npm test && npm run e2e && npm run build`). Expected: all pass.
- [ ] **Step 4: Commit** with message `test: Go generator round-trip check and Indonesia acceptance notes`.
