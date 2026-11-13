# Generator round-trip and Indonesia acceptance

`npm run verify:generator` builds the fixture maps in `scripts/verify-generator/make-fixtures.ts`, exports them through the real export code, runs OpenFront's Go map generator on each one, and compares the generator's removal counts with FrontMapper's `simulateExport`.

## Run on 2026-11-13

- OpenFrontIO at `2f0252d`
- Go 1.27.4, Windows 11

| Map | Islands removed (FrontMapper / Go) | Lakes removed (FrontMapper / Go) | Result |
| --- | --- | --- | --- |
| fmblobs | 47 / 47 | 5 / 5 | match |
| fmlakes | 0 / 0 | 71 / 71 | match |
| fmvoidlakes | 0 / 0 | 22 / 22 | match |
| fmislandtouchingvoid | 13 / 13 | 0 / 0 | match |
| fmnoise (1000×600) | 138 / 138 | 181 / 181 | match |
| indonesia (acceptance export) | 0 / 0 | 3624 / 3624 | match |

## Indonesia acceptance (Chromium, live tiles)

1. Searched "Indonesia" and kept the default width of 4000. The frame came out at 4000 × 1508 px, 1.37 km/px.
2. Converted with live OpenFreeMap and Terrarium tiles in about 6 s.
3. Checked the result:
   - Malaysian Borneo, Peninsular Malaysia, Brunei, Timor-Leste, Papua New Guinea and northern Australia are void.
   - Small islands are kept, because islets missed by the Natural Earth borders were assigned to Indonesia.
   - Java's volcano chain, Sumatra's Barisan range, central Sulawesi and the Papua highlands come out as highlands and mountains with the default curve, so the curve was not changed.
4. Before fixes, Checks showed 1026 islands under 30 px and 3341 lakes under 200 px. Most of the lakes are river fragments.
5. **Provinces** placed 33 nations at their provincial capitals. None were flagged. All use the `id` flag, because OpenFront has no `ID-xx` province flags.
6. **Grow to 30** kept every island, which left 3624 small lakes (accepted). A category was added and `info.json` was valid.
7. Exported `indonesia.zip`, then ran `npm run verify:generator -- --zip indonesia.zip`.
   - The generator built the map without errors.
   - Its counts (0 islands, 3624 lakes) equal the Checks tab and `frontmapper.json`.
