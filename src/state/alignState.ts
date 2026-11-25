import { computed, signal } from '@preact/signals';
import { newNationId } from '../core/nations';
import { fitGeoref, type GeoPin } from '../earth/georef';
import type { LonLat } from '../earth/types';
import { project } from './store';

/**
 * Lining a map up with Earth: pins are edited here and only reach the project on Save, so
 * backing out leaves the map as it was.
 */

export type AlignSide = 'map' | 'earth';

/** The alignment screen is open (it sits over the editor, which keeps its undo history). */
export const alignOpen = signal(false);
export const alignPins = signal<GeoPin[]>([]);
/** First half of a pin: a spot clicked on one side, waiting for the same spot on the other. */
export const alignPending = signal<{ side: AlignSide; at: [number, number] } | null>(null);
export const alignSelected = signal<string | null>(null);
/** Show the map warped onto the satellite view. */
export const alignOverlay = signal(true);
export const alignOpacity = signal(0.9);
/** The project had pins when the screen opened (so saving none removes the alignment). */
export const alignHadPins = signal(false);

export const alignFit = computed(() => fitGeoref(alignPins.value));

export function openAlign() {
  const pins = project.value?.georef?.pins ?? [];
  alignPins.value = pins.map((p) => ({ ...p, px: [...p.px], lonLat: [...p.lonLat] }) as GeoPin);
  alignHadPins.value = pins.length > 0;
  alignPending.value = null;
  alignSelected.value = null;
  alignOpen.value = true;
}

export function closeAlign() {
  alignOpen.value = false;
  alignPending.value = null;
  alignSelected.value = null;
}

export function saveAlign() {
  const p = project.value;
  if (!p) return;
  const pins = alignPins.value;
  project.value = { ...p, georef: pins.length ? { pins } : undefined };
  closeAlign();
}

/**
 * A click on one side. With a spot already waiting on the other side, the two make a pin;
 * otherwise this spot waits (a second click on the same side moves it).
 */
export function clickSide(side: AlignSide, at: [number, number]) {
  const pend = alignPending.value;
  alignSelected.value = null;
  if (pend && pend.side !== side) {
    const px = (side === 'map' ? at : pend.at) as [number, number];
    const lonLat = (side === 'earth' ? at : pend.at) as LonLat;
    const pin: GeoPin = { id: newNationId(), px, lonLat };
    alignPins.value = [...alignPins.value, pin];
    alignPending.value = null;
    alignSelected.value = pin.id;
    return;
  }
  alignPending.value = { side, at };
}

export function movePin(id: string, side: AlignSide, at: [number, number]) {
  alignPins.value = alignPins.value.map((p) => (p.id !== id ? p : side === 'map' ? { ...p, px: at } : { ...p, lonLat: at as LonLat }));
}

export function deletePin(id: string) {
  alignPins.value = alignPins.value.filter((p) => p.id !== id);
  if (alignSelected.value === id) alignSelected.value = null;
}
