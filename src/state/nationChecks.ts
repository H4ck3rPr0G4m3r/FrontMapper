import { computed, signal } from '@preact/signals';
import { crowdedExtras, nationIssues, type Nation, type NationIssue } from '../core/nations';
import { analysis } from './analysis';
import { flagCodes } from './flags';
import { nations, project, selectedNation } from './store';

const flagSet = computed(() => (flagCodes.value ? new Set(flagCodes.value) : null));

/** Issues for the current nations; re-evaluated after nations change or a new analysis lands. */
export const currentNationIssues = computed<NationIssue[]>(() => {
  const p = project.value;
  if (!p) return [];
  analysis.value; // grid edits surface through analysis revisions
  return nationIssues(nations.value, p.grid, analysis.value?.sim ?? null, flagSet.value);
});

export const issuesByNation = computed(() => {
  const m = new Map<string, NationIssue[]>();
  for (const i of currentNationIssues.value) m.set(i.nationId, [...(m.get(i.nationId) ?? []), i]);
  return m;
});

/** Auto-placed nations that "Remove crowded" would delete. */
export const crowdedIds = computed(() => crowdedExtras(nations.value));

/** The last "Remove crowded", undoable while the nation list is still exactly what it left. */
const lastRemoval = signal<{ before: Nation[]; after: Nation[]; count: number } | null>(null);
export const crowdedRemoval = computed(() => {
  const r = lastRemoval.value;
  return r && nations.value === r.after ? r : null;
});

/** Delete auto-placed nations so no two nations sit closer than the minimum distance. */
export function removeCrowded() {
  const drop = new Set(crowdedIds.value);
  if (!drop.size) return;
  const before = nations.value;
  nations.value = before.filter((n) => !drop.has(n.id));
  if (selectedNation.value && drop.has(selectedNation.value)) selectedNation.value = null;
  lastRemoval.value = { before, after: nations.value, count: drop.size };
}

export function undoRemoveCrowded() {
  const r = crowdedRemoval.value;
  if (r) nations.value = r.before;
  lastRemoval.value = null;
}
