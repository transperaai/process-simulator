// Retired steps (issue #16, docs/PRD.md §4.1 "Stable step IDs"). Splitting or
// replacing a step in the editor keeps the old row in the revision with
// `replaced_by` set to the steps that took over, so a saved scenario aimed at
// the old id can say what replaced it. Such rows are never drawn or
// simulated: whatever loads a revision's steps sorts them out with these.

/** The step was split or replaced: it has `replaced_by` entries. */
export function isRetiredStep(step: { replaced_by?: unknown }): boolean {
  return Array.isArray(step.replaced_by) && step.replaced_by.length > 0;
}

/** A revision's step rows sorted into the ones in use and the retired ones, each in their original order. */
export function partitionSteps<T extends { replaced_by?: unknown }>(rows: readonly T[]): { steps: T[]; retired: T[] } {
  const steps: T[] = [];
  const retired: T[] = [];
  for (const row of rows) (isRetiredStep(row) ? retired : steps).push(row);
  return { steps, retired };
}
