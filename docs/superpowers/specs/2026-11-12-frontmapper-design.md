# FrontMapper: OpenFront Map Maker

Design document, 2026-11-12.

## Why this exists

Peter wanted to make an OpenFront map of the Indonesian islands and found no tooling: the official workflow is "crop a huge world PNG in GIMP and hand-write a JSON file". Thousands of islands, real elevation, nation spawn points and the generator's hidden rules (tiny islands silently deleted) make that impractical by hand.

FrontMapper makes custom OpenFront maps easy to create, check, play locally and submit to the official game. Success looks like: search "Indonesia", click it, convert, touch up in an editor, export, play it against bots, and open a PR, without ever touching GIMP, a JSON file or a terminal.

The Indonesia map is the acceptance test. If that map comes out accurate, playable and submittable, the tool works.

## Two deliverables

1. **FrontMapper Studio** (static web app). Creates and edits maps. Its only output is a **zip file**. Must run on GitHub Pages or any static host: no backend, no accounts, no API keys that need a server.
2. **FrontMapper Companion** (downloadable app, its own GitHub repo with releases). Takes a Studio zip and handles **playing the map locally** and **submitting it to OpenFront** through a UI. The user never types or remembers commands. The Companion may run commands internally; that is fine.

The zip format is the contract between them (see "Export zip"). Build order: Studio first, Companion second.

## Goals

- Create maps from real Earth data (select countries, provinces or freeform areas) or from scratch (paint + noise).
- An editor that always shows what the game will actually get, including what the generator will delete.
- Output that matches OpenFront's map format exactly, passes its `info.json` schema and is ready for a PR.
- Play the map locally against bots and submit it as a PR without using a terminal.
- Polished, coherent UI in the chosen Graphite style (see "Visual style").

## Non-goals

- No backend or accounts for Studio.
- Studio does not open PRs, run the game or run the Go generator.
- Not a general GIS tool or image editor. Only what OpenFront maps need.
- No custom-map hosting service. OpenFront has no custom-map upload; until a map is merged, it is only playable on a local copy of the game (via the Companion).

## Anti-goals (failure even if it technically works)

- Islands, lakes or nations silently disappearing or moving on export.
- Output the official generator rejects, or that needs manual fixing before a PR.
- Using map data whose license can't go into OpenFront's `CREDITS.md` (e.g. Google/Bing satellite imagery as the source of terrain).
- A generic, "AI-default" looking UI. Peter rejected two palettes before choosing Graphite.
- Making the user remember or type commands to play or submit.

## OpenFront facts this design relies on

Verified against the OpenFrontIO repo (`map-generator/README.md`, `map_generator.go`, `info.schema.json`) on 2026-11-12. The builder should re-verify against current `main` before implementing, since the format evolves.

- A map is a folder `map-generator/assets/maps/<foldername>/` with `image.png` and `info.json`. Optional extra layer PNGs exist but are out of scope.
- `image.png` is read by the **blue channel only**:
  - alpha < 20 **or** blue == 106: water
  - pure black `#000000`: impassable void (cannot be owned, attacked or nuked; renders as map background)
  - anything else: land, with magnitude = (clamp(blue, 140, 200) - 140) / 2, so 0..30. Plains < 10, highlands 10..19, mountains >= 20.
- The generator removes land islands < 30 px and water bodies < 200 px (lakes become land). It crops width and height down to multiples of 4. Shorelines and water depth are computed by the generator.
- Size: README recommends 2-3M px, but it is only a log message. Shipped maps: median about 3.3M px; several are 8-11M; `World 10000` is 10000x5000 (14.4M land tiles), and its description jokes that it can't run on mobile. Size is informational, never a hard limit.
- `info.json` (strict schema, unknown keys are errors): required `id` (UpperCamelCase, matches folder name case-insensitively), `name` (<= 29 chars, `[a-zA-Z0-9\s().-]`, never changes after shipping), `translation_key` (`map.<foldername>`), `categories` (from a fixed enum such as `asia`, `oceania`, `europe`, `fictional`...), `nations` (array, may be empty). Useful optional: `display_name`, `author`, `description`, `location {lat, lon}`, `themes`, `additionalNations`, `custom_tribes`.
- Nation: `name` (required), `coordinates [x, y]` (pixels, origin top-left), `flag` (file name in `resources/flags/` without `.svg`; includes ISO country codes and some subdivision codes like `DE-BB`).
- In-game terrain colours (thumbnail approximations used by the editor): plains `rgb(190, 220-2m, 138)`, highlands `rgb(200+2m, 183+2m, 138+2m)`, mountains `rgb(240,240,240)`-ish, shore land `rgb(204,203,158)`, shore water `rgb(100,143,255)`, deep water darkens from `rgb(70,132,180)` with distance from land.
- Submitting: PRs must reference an issue that is **approved and assigned** to the author ("unsolicited PRs will be auto-closed"); the PR template asks for the issue number, a description, screenshots and a Discord username. Map PRs add attribution to `CREDITS.md`. Running the generator also writes `resources/maps/<name>/*` (bins, manifest, thumbnail), `packages/engine-api/src/game/Maps.gen.ts` and the `map` section of `resources/lang/en.json`; these generated files are part of a map PR.
- OpenFront's single-player mode runs in the browser (`src/client/LocalServer.ts`); the local dev setup is `npm run dev` (Vite client + Node server) with Node 24 / npm 12, and the generator needs Go.

## FrontMapper Studio

### Screens

1. **Start**: New blank map (choose size), New from Earth, Open project file, Import existing OpenFront map (`image.png` + `info.json`). Recent projects.
2. **Earth picker**: satellite view for choosing an area.
3. **Editor**: painting, checks, nations, map info, export.

### Earth picker

Prototype: `mockups/mock-earth-v2.html` (Leaflet + Esri imagery + world-atlas borders) was reviewed and liked.

- **Satellite view** with **country outlines always visible**. Countries highlight on hover and are clickable.
- **Search box** (country, and province) zooms to the result and selects it.
- **Selection tools**: Country click (Shift+click adds or removes), Province click (same, at province level), Square, Hand draw (lasso), Circle. Modifier keys add to or subtract from the selection, as in image editors (exact keys are the builder's call).
- **Frame**: dashed rectangle marking the map's edges. Auto-fitted around the selection with a small margin. Edges are draggable.
- **Map size**: editable Width and Height, with a link toggle:
  - Unlinked (default): editing a side keeps the scale and grows or shrinks the frame.
  - Linked: the frame stays, the resolution changes.
  - Values snap to multiples of 4. Shows scale (km/px), pixel count and size tier (Small / Typical / Large / Huge).
- **Date line**: frames and selections crossing ±180° must work (e.g. Fiji, Russia's east, New Zealand's outlying islands). Far-flung parts of a country (e.g. New Zealand's Kermadec or Chatham islands) must not blow the auto-frame up to the whole world; the builder decides how (e.g. frame around the largest connected cluster, with outliers listed as optional additions).
- **Convert to map** builds the terrain and opens the editor:
  - Selected land becomes land, with elevation from open elevation data.
  - Land inside the frame but outside the selection becomes **impassable void**.
  - Water stays water, everywhere in the frame.
  - Land not covered by any border polygon (small islands missed by coarse borders) is assigned to the nearest country, so selecting Indonesia does not turn its own small islands into void.

### Data sources

Satellite imagery is for viewing only. Terrain, coastlines, borders and cities come from openly licensed data, so the map is safe to submit. Export writes the matching `CREDITS.md` lines automatically.

All data must be fetchable by a static site (CORS, no server-side API keys) or preprocessed into static files shipped with the app. Candidates (final choice is the builder's, subject to these constraints):

| Need | Candidates |
| --- | --- |
| Satellite view | Esri World Imagery tiles (attribution shown) |
| Elevation (+ bathymetry) | AWS Terrain Tiles / Terrarium PNG (already credited in OpenFront for the Paris map) |
| Land/water (coastlines, lakes) | OSM-derived water/land polygons, e.g. via a keyless vector-tile service such as OpenFreeMap, or preprocessed and hosted with the app |
| Country and province borders + names | Natural Earth admin-0 / admin-1 (public domain); geoBoundaries if more detail is needed |
| Cities with population | GeoNames (CC BY 4.0) or Natural Earth populated places, preprocessed into a static file |

Borders need enough detail that clicking a country selects its real territory; the 50m world-atlas data in the prototype is only good enough for a prototype.

### Elevation mapping

Real elevation (metres) maps to OpenFront magnitude 0..30 (blue 140..200). The default curve must make lowlands plains, hills highlands and real mountain ranges mountains, rather than a flat or all-white map. It is adjustable at conversion time: at minimum, the sea-level-to-highlands and highlands-to-mountains thresholds. Exact defaults are the builder's call; verify them on Indonesia, which has both lowland and high volcanic terrain.

### Editor

Mockup: `mockups/mock-editor-v4.html` (Graphite).

**Layout.** Top bar holds the map name and size, the view toggle, an **Earth** button (back to the picker to re-frame or re-select) and **Export**. The left tool rail holds the tools. The bottom bar has terrain swatches and brush size. The right panel has the tabs **Checks / Nations / Info**.

**Views**
- **Game**: the map in OpenFront's own terrain colours, shorelines and water depth included.
- **Elevation**: greyscale heightmap.
- **After export**: the map exactly as the generator will leave it. Small islands and lakes are removed, and shorelines and water depth are recalculated from the result (not left over from before removal).

**Tools**
- Pan, Select (rectangle selection that other tools respect).
- Brush, painting a terrain type or exact elevation. Terrain types are Water, Plains, Highlands, Mountains and Void.
- Fill (flood fill).
- Raise / lower elevation.
- Smooth.
- **Texture** (noise filter), for natural-looking terrain, especially on maps not based on Earth. Two modes:
  - Coastline + elevation: roughens shores and terrain together.
  - Elevation only: adds hills and ridges without moving any coastline.

  Controls are strength and grain size. It works as a brush or as a fill over the current selection.
- Eyedropper.
- Nation spawn (click to place).
- Undo / redo for everything.

**Brush cursor.** Snapped to the pixel grid: it outlines exactly the pixels that will be painted (no circle), and resizes with brush size.

**Checks tab**
- "Lost on export": islands < 30 px and lakes < 200 px. Affected pixels are painted **solid red** in the Game and Elevation views (not circled). Per group: Show (cycle and zoom to each), Grow to minimum size (islands), Accept.
- Size: pixels and land tiles with the Small / Typical / Large / Huge tier. Informational only. Huge notes that it runs poorly on mobile.
- Nations: in water or void, too close together, flag code not available in OpenFront.
- `info.json` validity (required fields, name rules).

**Nations tab.** One editable list (rename, move, delete, change flag). Sources can be mixed:
- Custom: placed with the spawn tool.
- Cities above a population threshold the user sets. Named after the city, with the city's country flag, spawning at the city.
- Countries: one per country in the frame, at its capital or a point well inside its land, with its flag.
- Provinces/states: one per province in the frame. Uses a subdivision flag if OpenFront has one, otherwise the country flag.

Spawn coordinates stay correct if the map is later cropped or resized.

**Info tab.** Map name, display name, author, description, categories, themes. `id`, `translation_key` and folder name are derived from the name, and `location {lat, lon}` comes from the Earth frame (left out for maps not based on Earth). The tab validates against the schema rules.

**Large maps: segmented updates (Peter's idea).** Maps from about 3M px up to the 10000x5000 range must be editable, and slower is acceptable on huge ones. The map is stored and rendered in fixed-size segments (tiles). Expensive work is split into per-segment jobs: big fills, texture over a selection, elevation reprocessing, recomputing shorelines, water depth and "After export", and the checks. Jobs run in a queue that starts with the segments **closest to the centre of the view and works outward**, ideally off the main thread. The visible area updates first and the rest fills in progressively, so the map looks responsive on camera even while work continues off-screen. If the view moves, pending jobs are re-prioritised. Checks and Export wait until all jobs are finished, and show that they're waiting. Segment size and worker strategy are the builder's call.

**Projects.** Autosave in the browser, plus Save / Open as a project file. The project file keeps editable state such as the selection, frame and nation sources, which the export zip does not.

### Export zip

A single `.zip` named after the map folder:

```
<foldername>/
  image.png          # exact OpenFront encoding (blue channel), dimensions multiple of 4
  info.json          # schema-valid, includes "$schema": "../../../info.schema.json"
CREDITS.md.snippet   # attribution lines for every data source used
frontmapper.json     # manifest: tool version, map folder name, sources, stats, preview info
preview.png          # rendered "After export" view, for the PR description
```

`image.png` must decode back to exactly the terrain the editor shows. A round-trip test, encoding through the generator's own decoding rules, is part of verification.

### Visual style

**Graphite** is chosen: neutral dark greys (around `#1f1f1f` app, `#2a2a2a` panels, `#3a3a3a` lines), light-grey text, light-grey/white as the only selection and primary-action colour, 4px radius, Phosphor icons. Red is used only for problems. The map itself provides the colour. Rejected: dark plus amber (looked AI-generated), light grey "drafting" (worse), OpenFront navy, Forest green. The mockups are the visual reference, not pixel specs.

### Studio stack (Claude's call, accepted)

TypeScript, a static build (e.g. Vite), deployable to GitHub Pages. The editor renders the map on a canvas (WebGL if needed for 10000x5000 maps). The Earth picker uses Leaflet or similar. In a sandboxed embed, MapLibre's worker-based GeoJSON rendering failed to draw borders, so whatever is used must not depend on that.

## FrontMapper Companion

A downloadable app in its own GitHub repo (with release builds). Its job is to take a Studio zip and **play** it or **submit** it, through a UI. The user drops in or opens the zip; everything else is buttons, progress and plain-language status.

**Setup (automatic).** It keeps its own copy of the OpenFrontIO repo and the tools it needs (Git, Node 24 + npm 12, Go). Missing tools are installed automatically, preferably as private copies inside the Companion's own folder rather than system-wide. An "Update OpenFront" button pulls the latest `main`.

**Play**
1. Copy the map folder into the local checkout's `map-generator/assets/maps/`.
2. Run the generator for that map.
3. Install dependencies if needed.
4. Start the local game.
5. Open the browser at it.

Shows progress and a log, and has a Stop button. The user picks the map in single-player and plays against bots. Multiple imported maps can be kept and played.

**Submit**
1. **Sign in to GitHub** inside the app. Device-flow login (show a code, open github.com) works without a server. Using `gh` if installed is also acceptable.
2. **Approval step.** OpenFront requires an approved, assigned issue. The app helps the user open a map-request issue on OpenFrontIO (pre-filled with preview image, area, size and sources) and/or points them to the Discord maps channel. It then lets them enter or pick the issue number once it's approved. It does not submit a PR without an issue number.
3. **Prepare.** Fork (if needed), create branch `map/<foldername>` from the latest upstream `main`, add the map folder, run the generator, add the generated files, append `CREDITS.md` lines, and commit.
4. **Review.** Show the full PR (title, filled-in template with `Resolves #N`, description, preview screenshot, Discord username field) and the list of changed files. The user can edit before sending.
5. **Open the PR** and show its link and status.

**Companion stack (Claude's call).** Electron, Windows first since that's Peter's machine, with macOS and Linux supported where cheap. Peter only asked for "a download thing (a GitHub repo)" with a UI, so the framework is not his concern. Commit to Electron; no spike needed.

**Submit is a full deliverable** even though the approval step depends on OpenFront maintainers. Acceptance testing runs against a test fork, with a hand-entered issue number standing in for an approved issue.

## Verification

- The Indonesia map end to end: Earth picker → convert → edit → export → Companion Play (map loads in single-player against bots) → Companion Submit against a test fork, without actually opening a PR on upstream.
- Round-trip: exported `image.png` decoded with the generator's rules equals the editor's terrain. Studio carries a TypeScript port of the generator's decode, island/lake removal and multiple-of-4 crop, unit-tested on its own. A separate dev-only job (not required for every build) clones OpenFrontIO, runs the real Go generator on exported fixtures and checks that removal counts match the Checks tab. If the two disagree, the Go generator is right.
- `info.json` validates against the current `info.schema.json`.
- A date-line case (Fiji or New Zealand) and a very large case (about 10000 px wide) behave.
- UI is checked visually in the browser, not just compiled.

## Planning notes (Claude's calls, settled after the builder review)

- **Two plans.** The Studio gets its own implementation plan, built and shipped first. The Companion gets a separate plan in its own repo afterwards. The export zip layout above is frozen as the contract between them; any change to it must be versioned through `frontmapper.json`.
- **Preprocessed data is allowed.** A build-time data pipeline may simplify, tile and ship borders, provinces, cities and land/water data as static files with the app (within GitHub Pages limits: files under 100 MB, site about 1 GB). Large global tile sets (elevation) may be fetched live from keyless CORS sources instead. Prefer whatever gives accurate 1-pixel coastlines at Indonesia scale.
- **Border and city detail.** Ship simplified, tiled or level-of-detail versions, so the first load stays fast and full detail loads only for the area being converted.

## Left to the builder

- Exact datasets within the listed constraints, and how they are preprocessed or hosted.
- Elevation curve defaults, noise algorithm, smoothing kernel.
- Modifier keys, keyboard shortcuts, undo implementation, project file format.
- Segment size, worker setup and GPU versus CPU rendering, within the segmented-update design above.
- Companion internals (process management, how tools are installed, the issue template text).
