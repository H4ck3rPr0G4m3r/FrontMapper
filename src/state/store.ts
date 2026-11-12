import { signal } from '@preact/signals';
import type { MapGrid } from '../core/grid';
import type { Nation } from '../core/nations';
import type { MapMeta } from '../core/info';
import type { Selection } from '../core/selection';
import type { Paint } from '../core/tools/common';
import type { TextureOpts } from '../core/tools/texture';
import type { ViewMode } from '../render/renderer';

export type Tool = 'pan' | 'select' | 'brush' | 'fill' | 'raise' | 'smooth' | 'texture' | 'eyedropper' | 'spawn';

export interface EditorProject {
  grid: MapGrid;
  name: string;
}

/** The map being edited. */
export const project = signal<EditorProject | null>(null);

/** Editor view mode: Game / Elevation / After export. */
export const view = signal<ViewMode>('game');
export const tool = signal<Tool>('brush');
export const paint = signal<Paint>({ terrain: 1, mag: 5 });
export const brushDiameter = signal(12);
/** Magnitude change per raise/lower dab at the brush centre. */
export const raiseAmount = signal(3);
export const textureOpts = signal<TextureOpts>({ mode: 'coast+elevation', strength: 0.6, grain: 12, seed: 1 });
export const selection = signal<Selection>(null);

/** Bumped after every committed edit, undo and redo (drives re-analysis). */
export const revision = signal(0);
export const canUndo = signal(false);
export const canRedo = signal(false);
/** True while the user holds Space (temporary pan). */
export const spacePan = signal(false);

/** True while a segmented job (e.g. texture over selection) is still running. */
export const busy = signal(false);

/** Nations of the open map, and the one selected in the list or on the map. */
export const nations = signal<Nation[]>([]);
export const selectedNation = signal<string | null>(null);

/** info.json details of the open map. */
export const meta = signal<MapMeta>({ name: 'Untitled map', categories: [] });
