import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { ElevationCurve, FrameSize, SelOp } from '../earth/types';
import { decodeImagePng } from './encode';
import { createGrid, cropToMultipleOf4, type MapGrid } from './grid';
import type { MapMeta } from './info';
import { newNationId, type Nation } from './nations';

export interface EarthSource {
  ops: SelOp[];
  frameSize: FrameSize;
  curve: ElevationCurve;
}

export interface ProjectState {
  id: string;
  grid: MapGrid;
  meta: MapMeta;
  nations: Nation[];
  earth?: EarthSource;
  camera?: { x: number; y: number; zoom: number };
}

const VERSION = 1;

/** `.frontmap` file: a zip of `grid.bin` (terrain bytes then magnitude bytes) and `project.json`. */
export function saveProject(s: ProjectState): Uint8Array {
  const n = s.grid.width * s.grid.height;
  const bin = new Uint8Array(n * 2);
  bin.set(s.grid.terrain, 0);
  bin.set(s.grid.mag, n);
  const json = {
    version: VERSION,
    id: s.id,
    width: s.grid.width,
    height: s.grid.height,
    meta: s.meta,
    nations: s.nations,
    earth: s.earth,
    camera: s.camera,
  };
  return zipSync({ 'grid.bin': bin, 'project.json': strToU8(JSON.stringify(json)) }, { level: 6 });
}

export function openProject(bytes: Uint8Array): ProjectState {
  const files = unzipSync(bytes);
  if (!files['project.json'] || !files['grid.bin']) throw new Error('Not a FrontMapper project file.');
  const json = JSON.parse(strFromU8(files['project.json']));
  if (json.version !== VERSION) throw new Error(`Unsupported project version ${json.version}.`);
  const { width, height } = json;
  const bin = files['grid.bin'];
  const n = width * height;
  if (bin.length !== n * 2) throw new Error('Project file is damaged (grid size mismatch).');
  const grid = createGrid(width, height);
  grid.terrain.set(bin.subarray(0, n));
  grid.mag.set(bin.subarray(n));
  return { id: json.id, grid, meta: json.meta, nations: json.nations ?? [], earth: json.earth, camera: json.camera };
}

/**
 * Open an existing OpenFront map (`image.png` + `info.json`). Nations without coordinates
 * (random spawns) are skipped because the editor places every nation explicitly.
 */
export function importOpenFrontMap(png: Uint8Array, infoJson: string): ProjectState {
  const grid = cropToMultipleOf4(decodeImagePng(png));
  const info = JSON.parse(infoJson);
  const meta: MapMeta = {
    name: info.display_name ?? info.name ?? 'Imported map',
    categories: Array.isArray(info.categories) ? info.categories : [],
  };
  if (info.author) meta.author = info.author;
  if (info.description) meta.description = info.description;
  if (info.themes) meta.themes = info.themes;
  if (info.location) meta.location = info.location;
  const nations: Nation[] = (info.nations ?? [])
    .filter((n: any) => Array.isArray(n.coordinates))
    .map((n: any) => ({ id: newNationId(), name: n.name, x: n.coordinates[0], y: n.coordinates[1], flag: n.flag ?? '', source: 'custom' as const }));
  return { id: newNationId(), grid, meta, nations };
}
