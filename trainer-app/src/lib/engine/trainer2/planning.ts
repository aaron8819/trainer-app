import { draftDocument, type DraftDocument, type EditDraftCommand, type DraftError } from "../../trainer2-contracts/draft";

export class DraftFailure extends Error {
  constructor(public readonly code: DraftError) { super(code); }
}
export type Identity = { id: string; kind: "Stage" | "Occurrence" | "Position" | "Target"; parentId: string | null };
export function identities(doc: DraftDocument): Identity[] {
  return [
    ...doc.stages.map(s => ({ id: s.id, kind: "Stage" as const, parentId: null })),
    ...doc.occurrences.flatMap(o => [
      { id: o.id, kind: "Occurrence" as const, parentId: null },
      ...o.positions.flatMap(p => [{ id: p.id, kind: "Position" as const, parentId: o.id },
        ...p.targets.map(t => ({ id: t.id, kind: "Target" as const, parentId: p.id }))]),
    ]),
  ];
}
function requireItem<T>(value: T | undefined): T {
  if (!value) throw new DraftFailure("INVALID_OPERATION");
  return value;
}
function reorder<T extends { id: string }>(items: T[], ids: string[]): T[] {
  if (ids.length !== items.length || new Set(ids).size !== ids.length) throw new DraftFailure("INVALID_OPERATION");
  return ids.map(id => requireItem(items.find(x => x.id === id)));
}
export function editDocument(previous: DraftDocument, command: EditDraftCommand, historicalIds: Set<string>): DraftDocument {
  const doc = structuredClone(previous);
  // Includes removed IDs and additions earlier in this same command.
  const used = new Set(historicalIds);
  const claim = (ids: string[]) => {
    for (const id of ids) { if (used.has(id)) throw new DraftFailure("IDENTITY_REUSED"); used.add(id); }
  };
  const findPosition = (id: string) => requireItem(doc.occurrences.flatMap(o => o.positions).find(p => p.id === id));
  for (const op of command.intent.operations) {
    switch (op.op) {
      case "renamePlan": doc.name = op.name; break;
      case "addStage": claim([op.stage.id]); doc.stages.push(op.stage); break;
      case "renameStage": requireItem(doc.stages.find(s => s.id === op.stageId)).name = op.name; break;
      case "removeStage": requireItem(doc.stages.find(s => s.id === op.stageId)); doc.stages = doc.stages.filter(s => s.id !== op.stageId); break;
      case "reorderStages": doc.stages = reorder(doc.stages, op.stageIds); break;
      case "addOccurrence": claim([op.occurrence.id, ...op.occurrence.positions.flatMap(p => [p.id, ...p.targets.map(t => t.id)])]); doc.occurrences.push(op.occurrence); break;
      case "editOccurrence": Object.assign(requireItem(doc.occurrences.find(o => o.id === op.occurrenceId)), { name: op.name, stageId: op.stageId }); break;
      case "removeOccurrence": requireItem(doc.occurrences.find(o => o.id === op.occurrenceId)); doc.occurrences = doc.occurrences.filter(o => o.id !== op.occurrenceId); break;
      case "reorderOccurrences": doc.occurrences = reorder(doc.occurrences, op.occurrenceIds); break;
      case "addPosition": claim([op.position.id, ...op.position.targets.map(t => t.id)]); requireItem(doc.occurrences.find(o => o.id === op.occurrenceId)).positions.push(op.position); break;
      case "editExercise": findPosition(op.positionId).exercise = op.exercise; break;
      case "removePosition": findPosition(op.positionId); for (const o of doc.occurrences) o.positions = o.positions.filter(p => p.id !== op.positionId); break;
      case "reorderPositions": { const o = requireItem(doc.occurrences.find(o => o.id === op.occurrenceId)); o.positions = reorder(o.positions, op.positionIds); break; }
      case "addTarget": claim([op.target.id]); findPosition(op.positionId).targets.push(op.target); break;
      case "editTarget": { const p = requireItem(doc.occurrences.flatMap(o => o.positions).find(p => p.targets.some(t => t.id === op.target.id))); p.targets = p.targets.map(t => t.id === op.target.id ? op.target : t); break; }
      case "removeTarget": { const p = requireItem(doc.occurrences.flatMap(o => o.positions).find(p => p.targets.some(t => t.id === op.targetId))); p.targets = p.targets.filter(t => t.id !== op.targetId); break; }
      case "reorderTargets": { const p = findPosition(op.positionId); p.targets = reorder(p.targets, op.targetIds); break; }
    }
  }
  const parsed = draftDocument.safeParse(doc);
  if (!parsed.success) throw new DraftFailure("INVALID_DOCUMENT");
  return parsed.data;
}
