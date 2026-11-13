import { computed } from '@preact/signals';
import { nationIssues, type NationIssue } from '../core/nations';
import { analysis } from './analysis';
import { flagCodes } from './flags';
import { nations, project } from './store';

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
