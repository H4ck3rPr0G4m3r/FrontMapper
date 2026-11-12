import { strToU8, zipSync } from 'fflate';
import { encode } from 'fast-png';
import { tileColor } from './colors';
import { creditsSnippet, type SourceId } from './credits';
import { deriveRect } from './derive';
import { encodeImagePng } from './encode';
import { simulateExport } from './generator';
import { createGrid, type MapGrid } from './grid';
import { buildInfoJson, deriveIds, validateInfo, type MapMeta } from './info';
import type { Nation } from './nations';

export interface ExportInput {
  grid: MapGrid;
  meta: MapMeta;
  nations: Nation[];
  sources: SourceId[];
  toolVersion: string;
}

export const PREVIEW_MAX_WIDTH = 1200;

/** Build the export zip: `<folder>/image.png`, `<folder>/info.json`, credits, manifest and preview. */
export async function buildExportZip(p: ExportInput): Promise<Uint8Array> {
  const info = buildInfoJson(p.meta, p.nations);
  const errors = validateInfo(info);
  if (errors.length) throw new Error(`info.json is not valid: ${errors.join('; ')}`);
  const ids = deriveIds(p.meta.name);
  const sim = simulateExport(p.grid);
  const display = (p.meta.displayName ?? p.meta.name).trim() || ids.canonicalName;
  const manifest = {
    format: 1,
    tool: 'FrontMapper Studio',
    toolVersion: p.toolVersion,
    folder: ids.folder,
    id: ids.id,
    width: p.grid.width,
    height: p.grid.height,
    landTiles: sim.landTiles,
    removed: { islands: sim.removedIslands.length, lakes: sim.removedLakes.length },
    nations: p.nations.length,
    sources: p.sources,
    createdAt: new Date().toISOString(),
  };
  return zipSync(
    {
      [`${ids.folder}/image.png`]: [encodeImagePng(p.grid), { level: 0 }],
      [`${ids.folder}/info.json`]: strToU8(JSON.stringify(info, null, 2) + '\n'),
      'CREDITS.md.snippet': strToU8(creditsSnippet(p.sources, display)),
      'frontmapper.json': strToU8(JSON.stringify(manifest, null, 2) + '\n'),
      'preview.png': [renderPreview(sim.grid), { level: 0 }],
    },
    { level: 6 },
  );
}

/** "After export" render, downsampled first so it stays cheap on huge maps. */
export function renderPreview(g: MapGrid, maxWidth = PREVIEW_MAX_WIDTH): Uint8Array {
  const scale = Math.min(1, maxWidth / g.width);
  const w = Math.max(1, Math.round(g.width * scale));
  const h = Math.max(1, Math.round(g.height * scale));
  const small = createGrid(w, h);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(g.height - 1, Math.floor(((y + 0.5) * g.height) / h));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(g.width - 1, Math.floor(((x + 0.5) * g.width) / w));
      small.terrain[y * w + x] = g.terrain[sy * g.width + sx];
      small.mag[y * w + x] = g.mag[sy * g.width + sx];
    }
  }
  const shore = new Uint8Array(w * h);
  const depth = new Uint8Array(w * h);
  deriveRect(small, { x: 0, y: 0, w, h }, shore, depth);
  const rgb = new Uint8Array(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    const [r, gg, b] = tileColor(small.terrain[i], small.mag[i], shore[i] === 1, depth[i]);
    rgb[i * 3] = r;
    rgb[i * 3 + 1] = gg;
    rgb[i * 3 + 2] = b;
  }
  return encode({ width: w, height: h, data: rgb, channels: 3, depth: 8 });
}
