import { signal } from '@preact/signals';
import type { MapGrid } from '../core/grid';
import type { Nation } from '../core/nations';
import type { MapMeta } from '../core/info';
import type { EarthSource } from '../core/project';
import type { SourceId } from '../core/credits';
import type { Selection, WandOpts } from '../core/selection';
import type { Symmetry } from '../core/symmetry';
import type { RiverReport } from '../core/tools/rivers';
import type { Paint } from '../core/tools/common';
import type { TextureOpts } from '../core/tools/texture';
import type { ViewMode } from '../render/renderer';

export type Tool = 'pan' | 'select' | 'wand' | 'brush' | 'fill' | 'river' | 'raise' | 'smooth' | 'texture' | 'eyedropper' | 'spawn';

export interface EditorProject {
  /** Stable id used for autosave. */
  id: string;
  grid: MapGrid;
  /** Present for maps converted from Earth data (re-framing, credits). */
  earth?: EarthSource;
  /** Camera to restore when the project is reopened. */
  camera?: { x: number; y: number; zoom: number };
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
/** Magic wand matching rules. */
export const wandOpts = signal<WandOpts>({ tolerance: 30, contiguous: true });
/** True while a moved, flipped or pasted piece of map floats above the map, not yet placed. */
export const floating = signal(false);
/** Something has been copied and can be pasted. */
export const canPaste = signal(false);
/** Mirror painting across the map's centre. */
export const symmetry = signal<Symmetry>('off');
/** River tool width in pixels. */
export const riverWidth = signal(1);
/** Whether the river drawn last survives export (null until one is drawn). */
export const riverStatus = signal<{ stays: boolean; size: number } | null>(null);
/** What Grow rivers would change, shown on the map before it is applied. */
export const riverPreview = signal<RiverReport | null>(null);

/** Bumped after every committed edit, undo and redo (drives re-analysis). */
export const revision = signal(0);
export const canUndo = signal(false);
export const canRedo = signal(false);
/** True while the user holds Space (temporary pan). */
export const spacePan = signal(false);

/** Current editor zoom (screen px per map px), mirrored from the renderer for the UI. */
export const zoom = signal(1);

/** True while a segmented job (e.g. texture over selection) is still running. */
export const busy = signal(false);

/** Nations of the open map, and the one selected in the list or on the map. */
export const nations = signal<Nation[]>([]);
export const selectedNation = signal<string | null>(null);

/** info.json details of the open map. */
export const meta = signal<MapMeta>({ name: 'Untitled map', categories: [] });

/** Open data sources used to build the current map (drives CREDITS.md lines). */
export const sources = signal<SourceId[]>([]);
