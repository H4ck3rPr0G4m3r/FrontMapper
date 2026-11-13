import { computed, signal } from '@preact/signals';
import type { AcceptedChecks } from '../core/project';
import { analysis } from './analysis';
import { infoErrors } from './mapOps';
import { currentNationIssues } from './nationChecks';

export type { AcceptedChecks } from '../core/project';
export const NO_ACCEPTED: AcceptedChecks = { islands: false, lakes: false };

/**
 * Removal warnings the user accepted for this map. Accepting is a decision about the map,
 * not about one check result, so it holds through later edits until it is undone.
 */
export const acceptedChecks = signal<AcceptedChecks>(NO_ACCEPTED);

/** Number of problem rows the Checks tab currently shows (accepted warnings do not count). */
export const openChecks = computed(() => {
  const kinds = new Set(currentNationIssues.value.map((i) => i.kind));
  let n = kinds.size + infoErrors.value.length;
  const a = analysis.value;
  if (a) {
    if (a.sim.removedIslands.length && !acceptedChecks.value.islands) n++;
    if (a.sim.removedLakes.length && !acceptedChecks.value.lakes) n++;
  }
  return n;
});
