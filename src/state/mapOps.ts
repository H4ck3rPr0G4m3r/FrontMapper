import { computed } from '@preact/signals';
import { buildInfoJson, cropGrid, resizeGrid, validateInfo } from '../core/info';
import type { Rect } from '../core/grid';
import type { FrameSize } from '../earth/types';
import { remapNations } from '../core/nations';
import { transformPins } from '../earth/georef';
import { analysis, analysisPending } from './analysis';
import { meta, nations, project, selection } from './store';

/** Schema errors for the current info.json. */
export const infoErrors = computed(() => validateInfo(buildInfoJson(meta.value, nations.value)));

/** The last analysis describes the old grid; drop it until the new grid has been checked. */
function gridReplaced() {
  analysis.value = null;
  analysisPending.value = true;
  selection.value = null;
}

/** Crop or resize the open map, moving nations with it. Starts a fresh undo history. */
export function cropTo(r: Rect) {
  const p = project.value;
  if (!p) return;
  const { grid, transform } = cropGrid(p.grid, r);
  nations.value = remapNations(nations.value, transform, grid.width, grid.height);
  gridReplaced();
  const earth = p.earth && { ...p.earth, frameSize: croppedFrame(p.earth.frameSize, r, grid.width, grid.height) };
  project.value = { ...p, grid, earth, georef: transformPins(p.georef, transform), camera: undefined };
}

/** The Earth frame of a crop: same scale, shifted to the crop's corner. */
function croppedFrame(fs: FrameSize, r: Rect, width: number, height: number): FrameSize {
  const x0 = fs.frame.x0 + r.x * fs.mPerPx, y0 = fs.frame.y0 + r.y * fs.mPerPx;
  return { frame: { x0, y0, x1: x0 + width * fs.mPerPx, y1: y0 + height * fs.mPerPx }, width, height, mPerPx: fs.mPerPx };
}

/** The Earth frame of a resize: same west, north and east edges, scale from the new width. */
function resizedFrame(fs: FrameSize, width: number, height: number): FrameSize {
  const mPerPx = (fs.frame.x1 - fs.frame.x0) / width;
  return { frame: { ...fs.frame, y1: fs.frame.y0 + height * mPerPx }, width, height, mPerPx };
}

export function resizeTo(width: number, height: number) {
  const p = project.value;
  if (!p) return;
  const { grid, transform } = resizeGrid(p.grid, width, height);
  nations.value = remapNations(nations.value, transform, grid.width, grid.height);
  gridReplaced();
  const earth = p.earth && { ...p.earth, frameSize: resizedFrame(p.earth.frameSize, grid.width, grid.height) };
  project.value = { ...p, grid, earth, georef: transformPins(p.georef, transform), camera: undefined };
}
