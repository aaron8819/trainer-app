import type { DraftDocument, EditDraftCommand } from "@/lib/trainer2-contracts/draft";

type Operations = EditDraftCommand["intent"]["operations"];
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const ids = (items: { id: string }[]) => items.map(item => item.id);

// Form adapter only: identity comes from explicit add/remove controls, never values.
// Planning still validates and applies the complete operation batch atomically.
export function draftEdits(before: DraftDocument, after: DraftDocument): Operations {
  const ops: Operations = [];
  if (after.builder && !same(before.builder, after.builder)) ops.push({ op: "editWorkoutDefaults", builder: after.builder });
  if (before.name !== after.name) ops.push({ op: "renamePlan", name: after.name });
  for (const stage of after.stages) {
    const old = before.stages.find(s => s.id === stage.id);
    if (!old) ops.push({ op: "addStage", stage });
    else if (old.name !== stage.name) ops.push({ op: "renameStage", stageId: stage.id, name: stage.name });
  }
  for (const o of before.occurrences) if (!after.occurrences.some(n => n.id === o.id)) ops.push({ op: "removeOccurrence", occurrenceId: o.id });
  for (const o of after.occurrences) {
    const old = before.occurrences.find(n => n.id === o.id);
    if (!old) { ops.push({ op: "addOccurrence", occurrence: o }); continue; }
    if (o.weekOverride !== undefined && old.weekOverride !== o.weekOverride) ops.push({ op: "setWeekOverride", occurrenceId: o.id, weekOverride: o.weekOverride });
    if (old.name !== o.name || old.stageId !== o.stageId) ops.push({ op: "editOccurrence", occurrenceId: o.id, name: o.name, stageId: o.stageId });
    for (const p of old.positions) if (!o.positions.some(n => n.id === p.id)) ops.push({ op: "removePosition", positionId: p.id });
    for (const p of o.positions) {
      const previous = old.positions.find(n => n.id === p.id);
      if (!previous) { ops.push({ op: "addPosition", occurrenceId: o.id, position: p }); continue; }
      if (!same(previous.exercise, p.exercise)) ops.push({ op: "editExercise", positionId: p.id, exercise: p.exercise });
      if (!same(previous.targets, p.targets)) ops.push({ op: "editPositionTargets", positionId: p.id, targets: p.targets });
    }
    if (!same(ids(old.positions), ids(o.positions))) ops.push({ op: "reorderPositions", occurrenceId: o.id, positionIds: ids(o.positions) });
  }
  // Reassignment/removal of sessions precedes removal of their stage.
  for (const s of before.stages) if (!after.stages.some(n => n.id === s.id)) ops.push({ op: "removeStage", stageId: s.id });
  if (!same(ids(before.stages), ids(after.stages))) ops.push({ op: "reorderStages", stageIds: ids(after.stages) });
  if (!same(ids(before.occurrences), ids(after.occurrences))) ops.push({ op: "reorderOccurrences", occurrenceIds: ids(after.occurrences) });
  return ops;
}
