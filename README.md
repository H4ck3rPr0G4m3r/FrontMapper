# FrontMapper Studio

A map maker for [OpenFront](https://openfront.io). Pick countries, provinces or a drawn area on a satellite view and convert it, or start from a blank map. Then touch it up with the editor's tools, check what the game's generator will delete, place nations, and export a zip ready for `map-generator/assets/maps/`.

It is a static web app (GitHub Pages). Playing locally and opening the pull request are handled by FrontMapper Companion, a separate download.

## Development

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (Vitest); BENCH=1 also runs the large-map benchmarks
npm run e2e        # browser tests (Playwright, uses the installed Chromium channel)
npm run build      # type check and production build into dist/
```

Dev-only extras:

- `?fixture=render&editor=1` opens the editor on a generated test map.
- `npm run data` rebuilds `public/data/` from Natural Earth and OpenFront (needs network).
- `npm run verify:generator` checks that the Checks tab predicts exactly what OpenFront's Go
  map generator removes. It needs git and Go (on `PATH`, or unpacked into `.cache/go`), keeps a
  shallow OpenFrontIO checkout in `.cache/ofio`, runs 5 fixture maps and exits 1 on any
  mismatch. Add `-- --zip path/to/export.zip` to check an exported map too.

Some machines intercept TLS. The npm scripts that reach the network run Node with `--use-system-ca`, so it trusts the Windows/macOS certificate store; they never turn verification off.

## Deploy

`.github/workflows/pages.yml` tests, builds with `PAGES_BASE=/FrontMapper/` and deploys `dist/` to GitHub Pages on every push to `main`.

`.github/workflows/generator-drift.yml` runs `npm run verify:generator` against the latest OpenFrontIO
every Monday (and on pull requests that touch `src/core/generator.ts`). When the Checks tab stops
matching the Go generator it opens an issue, and closes it once they match again.

## Offline

The production build ships a service worker (`scripts/pwa/`, generated at build time with every
built file in its precache list). After one visit the editor, the start screen, map generation and
heightmap import work without a connection; Earth conversion still needs one (satellite imagery,
elevation tiles and detailed borders load on demand). Dev mode has no service worker.

## How Earth conversion works

1. **Coastlines:** water polygons from the OpenFreeMap `water` layer (OpenStreetMap), rasterised at the map's resolution.
2. **Elevation:** AWS Terrain Tiles (Terrarium), mapped to OpenFront magnitudes with the curve in the picker. The defaults are plains up to 300 m, highlands up to 1500 m, and mountains above that, peaking at 4000 m.
3. **Borders:** geoBoundaries (CGAZ) country and province shapes, labelled with Natural Earth's ids, names and
   flags. Territories geoBoundaries folds into their sovereign (Puerto Rico, the Faroe Islands...) are split
   back out; ones on a shared mainland (Hong Kong, Gibraltar...) keep Natural Earth outlines. Land the borders
   miss, such as small islands, goes to the nearest country.
4. Selected land becomes land. Other land in the frame becomes impassable void, and water stays water.
   Small lakes and river pieces that touch only void become void too: the generator would fill them
   with void anyway, so they would only clutter the Checks tab.

Rivers narrower than a pixel come out as broken pieces, which the generator fills in as small lakes.
**Grow rivers** on the Checks tab first shows what it would change, then keeps rivers with as few new
water pixels as possible: it closes corner-only joints, bridges gaps of up to 3 px (or up to 10 px
straight on from a river's end to the sea or a lake), and only widens a river that reaches nothing,
evenly from its downstream end and never past 3 px on average. Round ponds are never touched. The
**River** tool draws new edge-connected rivers and says whether they stay on export.

A tile that fails to download after 3 retries stops the conversion with a Retry. It never becomes land, water or 0 m.

## Data and credits

| Data | Source | Licence |
| --- | --- | --- |
| Coastlines, lakes | © OpenStreetMap contributors, via OpenFreeMap / OpenMapTiles | ODbL |
| Elevation | AWS Terrain Tiles (Mapzen Terrarium) | see the [attribution list](https://github.com/tilezen/joerd/blob/master/docs/attribution.md) |
| Borders, provinces | [geoBoundaries](https://www.geoboundaries.org) CGAZ (Runfola et al. 2020) | CC BY 4.0 / ODbL |
| Country ids and names, some territories, cities | Natural Earth 10m | public domain |
| Satellite imagery (display only) | Esri, Maxar, Earthstar Geographics | display in the picker only |
| Flags, `info.json` schema | OpenFrontIO | AGPL-3.0 |

Exports include a `CREDITS.md.snippet` with the lines to merge into OpenFront's `CREDITS.md`. `public/data/SOURCES.md` records the exact data versions.
