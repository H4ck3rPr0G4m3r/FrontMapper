import Ajv2020 from 'ajv/dist/2020';
import schema from '../data/info.schema.json';
import { createGrid, type MapGrid, type Rect } from './grid';
import type { Nation, Transform } from './nations';

/** Editable map details that end up in info.json. */
export interface MapMeta {
  /** What the user typed; may contain characters the canonical name can't. */
  name: string;
  displayName?: string;
  author?: string;
  description?: string;
  categories: string[];
  themes?: string[];
  location?: { lat: number; lon: number };
}

export interface MapIds {
  id: string;
  folder: string;
  translationKey: string;
  canonicalName: string;
}

const NAME_MAX = 29;

export const CATEGORIES: string[] = (schema as any).properties.categories.items.enum;
export const THEMES: string[] = (schema as any).properties.themes.items.enum;

/** Ids and the schema-safe canonical name, derived from whatever the user typed. */
export function deriveIds(name: string): MapIds {
  const ascii = name.normalize('NFD').replace(/[̀-ͯ]/g, '');
  const canonicalName = ascii
    .replace(/[^a-zA-Z0-9\s().-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX)
    .trimEnd();
  const words = ascii.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  let id = words.map((w) => w[0].toUpperCase() + w.slice(1)).join('');
  if (!id || /^[0-9]/.test(id)) id = `Map${id}`;
  const folder = id.toLowerCase();
  return { id, folder, translationKey: `map.${folder}`, canonicalName };
}

/** info.json content, keys in OpenFront's usual order. */
export function buildInfoJson(meta: MapMeta, nations: Nation[]): object {
  const ids = deriveIds(meta.name);
  const display = (meta.displayName ?? meta.name).trim();
  const info: Record<string, unknown> = {
    $schema: '../../../info.schema.json',
    id: ids.id,
    name: ids.canonicalName,
    translation_key: ids.translationKey,
  };
  if (display && display !== ids.canonicalName) info.display_name = display;
  if (meta.author?.trim()) info.author = meta.author.trim();
  if (meta.description?.trim()) info.description = meta.description.trim();
  info.categories = meta.categories;
  if (meta.location) info.location = { lat: round(meta.location.lat, 4), lon: round(meta.location.lon, 4) };
  if (meta.themes?.length) info.themes = meta.themes;
  info.nations = nations.map((n) => {
    const out: Record<string, unknown> = { coordinates: [n.x, n.y], name: n.name };
    if (n.flag) out.flag = n.flag;
    return out;
  });
  return info;
}

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validate = ajv.compile(schema as object);

const FIELD: Record<string, string> = {
  '/name': 'Map name',
  '/id': 'Map id',
  '/categories': 'Categories',
  '/translation_key': 'Translation key',
};

/** Human-readable schema errors; empty when valid. */
export function validateInfo(info: object): string[] {
  if (validate(info)) return [];
  const nations = (info as { nations?: { name?: string }[] }).nations ?? [];
  const out = (validate.errors ?? []).map((e) => {
    const path = e.instancePath || '';
    const nation = /^\/nations\/(\d+)\/(\w+)/.exec(path);
    if (nation) {
      const who = nations[+nation[1]]?.name?.trim() ? `Nation "${nations[+nation[1]].name!.trim()}"` : `Nation ${+nation[1] + 1}`;
      if (nation[2] === 'name') return `${who}: needs a name`;
      if (nation[2] === 'coordinates') return `${who}: is outside the map`;
      return `${who}: ${nation[2]} ${e.message}`;
    }
    const field = FIELD[path] ?? (path ? path.slice(1).replace(/\//g, ' ') : 'info.json');
    if (e.keyword === 'required') return `${field}: missing ${(e.params as { missingProperty: string }).missingProperty}`;
    if (path === '/categories' && e.keyword === 'minItems') return 'Categories: pick at least one';
    if (path === '/name' && e.keyword === 'minLength') return 'Map name: required';
    return `${field}: ${e.message}`;
  });
  return [...new Set(out)];
}

const snap4 = (v: number) => Math.max(4, Math.floor(v / 4) * 4);

/** Crop to `r` (size snapped down to multiples of 4). */
export function cropGrid(g: MapGrid, r: Rect): { grid: MapGrid; transform: Transform } {
  const x0 = Math.max(0, Math.round(r.x)), y0 = Math.max(0, Math.round(r.y));
  const w = snap4(Math.min(r.w, g.width - x0)), h = snap4(Math.min(r.h, g.height - y0));
  const out = createGrid(w, h);
  for (let y = 0; y < h; y++) {
    const src = (y0 + y) * g.width + x0;
    out.terrain.set(g.terrain.subarray(src, src + w), y * w);
    out.mag.set(g.mag.subarray(src, src + w), y * w);
  }
  return { grid: out, transform: { sx: 1, sy: 1, ox: -x0, oy: -y0 } };
}

/** Nearest-neighbour resize to (width, height) snapped down to multiples of 4. */
export function resizeGrid(g: MapGrid, width: number, height: number): { grid: MapGrid; transform: Transform } {
  const w = snap4(width), h = snap4(height);
  const out = createGrid(w, h);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(g.height - 1, Math.floor(((y + 0.5) * g.height) / h));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(g.width - 1, Math.floor(((x + 0.5) * g.width) / w));
      out.terrain[y * w + x] = g.terrain[sy * g.width + sx];
      out.mag[y * w + x] = g.mag[sy * g.width + sx];
    }
  }
  return { grid: out, transform: { sx: w / g.width, sy: h / g.height, ox: 0, oy: 0 } };
}
