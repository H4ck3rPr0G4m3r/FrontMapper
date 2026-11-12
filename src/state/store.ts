import { signal } from '@preact/signals';
import type { ViewMode } from '../render/renderer';

/** Editor view mode: Game / Elevation / After export. */
export const view = signal<ViewMode>('game');

/** True while the user holds Space (temporary pan). */
export const spacePan = signal(false);
