import { computed } from '@preact/signals';
import { buildInfoJson, cropGrid, resizeGrid, validateInfo } from '../core/info';
import type { Rect } from '../core/grid';
import { remapNations } from '../core/nations';
import { meta, nations, project, selection } from './store';

/** Schema errors for the current info.json. */
export const infoErrors = computed(() => validateInfo(buildInfoJson(meta.value, nations.value)));

/** Crop or resize the open map, moving nations with it. Starts a fresh undo history. */
export function cropTo(r: Rect) {
  const p = project.value;
  if (!p) return;
  const { grid, transform } = cropGrid(p.grid, r);
  nations.value = remapNations(nations.value, transform, grid.width, grid.height);
  selection.value = null;
  project.value = { ...p, grid };
}

export function resizeTo(width: number, height: number) {
  const p = project.value;
  if (!p) return;
  const { grid, transform } = resizeGrid(p.grid, width, height);
  nations.value = remapNations(nations.value, transform, grid.width, grid.height);
  selection.value = null;
  project.value = { ...p, grid };
}
