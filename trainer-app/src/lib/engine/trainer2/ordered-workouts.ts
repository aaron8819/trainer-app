import { savedDraftDocument } from '../../trainer2-contracts/draft';

// Occurrences own sequence. Stages label contiguous runs; a stage may recur.
// Parsing rejects absent order, duplicate identities and inconsistent references.
export function orderedWorkoutGroups(input: unknown) {
  const doc = savedDraftDocument.parse(input);
  const groups: { stage: typeof doc.stages[number]; deload: boolean;
    workouts: { occurrence: typeof doc.occurrences[number]; sequence: number }[] }[] = [];
  doc.occurrences.forEach((occurrence, index) => {
    let group = groups.at(-1);
    if (!group || group.stage.id !== occurrence.stageId) {
      group = { stage: doc.stages.find(s => s.id === occurrence.stageId)!,
        deload: doc.builder?.weeks.some(w => w.stageId === occurrence.stageId && w.deload) ?? false, workouts: [] };
      groups.push(group);
    }
    group.workouts.push({ occurrence, sequence: index + 1 });
  });
  return groups;
}
