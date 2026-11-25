import { signal } from '@preact/signals';
import { createGrid, type MapGrid } from '../core/grid';
import { newNationId } from '../core/nations';
import type { ProjectState } from '../core/project';
import { analysis, analysisPending } from './analysis';
import { acceptedChecks, NO_ACCEPTED } from './checks';
import { canRedo, canUndo, meta, nations, project, selectedNation, selection, sources, view } from './store';

export type Screen = 'start' | 'earth' | 'editor';
export const screen = signal<Screen>('start');

const snap4 = (v: number) => Math.max(4, Math.floor(v / 4) * 4);

/** Load a project into the editor and switch to it. */
export function openInEditor(s: ProjectState) {
  analysis.value = null;
  analysisPending.value = true;
  selection.value = null;
  selectedNation.value = null;
  canUndo.value = false;
  canRedo.value = false;
  view.value = 'game';
  meta.value = s.meta;
  acceptedChecks.value = s.accepted ?? NO_ACCEPTED;
  nations.value = s.nations;
  sources.value = s.earth ? ['osm', 'terrain-tiles', 'geoboundaries', 'natural-earth', 'geonames'] : [];
  project.value = { id: s.id, grid: s.grid, earth: s.earth, camera: s.camera };
  screen.value = 'editor';
}

/** A new all-water map, size snapped to multiples of 4. */
export function newBlankMap(width: number, height: number) {
  openInEditor({
    id: newNationId(),
    grid: createGrid(snap4(width), snap4(height)),
    meta: { name: 'Untitled map', categories: [] },
    nations: [],
  });
}

/** Open a map made on the start screen (generated or from a heightmap). */
export function openNewGrid(grid: MapGrid, name: string) {
  openInEditor({ id: newNationId(), grid, meta: { name, categories: [] }, nations: [] });
}

export function backToStart() {
  screen.value = 'start';
  project.value = null;
}
