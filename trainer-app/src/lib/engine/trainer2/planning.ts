import { draftDocument, savedDraftDocument, type DraftDocument, type EditDraftCommand, type DraftError } from "../../trainer2-contracts/draft";
import { expandWorkoutDefaults, repairBuilderMetadata } from "./plan-builder";
import { catalog, catalogExercise } from './catalog';

export class DraftFailure extends Error {
  constructor(public readonly code: DraftError) { super(code); }
}
// Stored revisions can be opened unchanged only if the narrow repair yields a
// valid document. Incoming commands never use this compatibility reader.
export function readSavedDocument(input: unknown): DraftDocument {
  const doc = savedDraftDocument.parse(input);
  const repaired = draftDocument.parse(repairBuilderMetadata(doc));
  validateWorkoutDefaults(repaired);
  return doc;
}
export function validateWorkoutDefaults(doc: DraftDocument) {
  for (const e of [...doc.occurrences.flatMap(o => o.positions.map(p => p.exercise)), ...(doc.builder?.workouts.flatMap(w => w.rows.map(r => r.exercise)) ?? [])]) {
    if (e.kind !== 'catalogSnapshot') continue;
    const entry = catalog.find(c => c.id === e.catalogId);
    if (!entry || JSON.stringify(e) !== JSON.stringify(catalogExercise(entry))) {
      // Compare parsed values in canonical schema order, independent of JSON key order.
      const expected = entry && catalogExercise(entry);
      if (!expected || Object.keys(expected).some(key => JSON.stringify(e[key as keyof typeof e]) !== JSON.stringify(expected[key as keyof typeof expected]))) throw new DraftFailure('INVALID_DOCUMENT');
    }
  }
  if (!doc.builder) return;
  try {
    const expanded = expandWorkoutDefaults(doc, () => { throw new Error("Missing counterpart"); });
    if (JSON.stringify(draftDocument.parse(expanded)) !== JSON.stringify(draftDocument.parse(doc))) throw new Error("Prescription differs from authored defaults");
  } catch { throw new DraftFailure("INVALID_DOCUMENT"); }
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
      case 'setWeekEdits': { const o = requireItem(doc.occurrences.find(o => o.id === op.occurrenceId)); if (op.overrides) o.overrides = op.overrides; else delete o.overrides; break; }
      case 'editPositionRole': { const p = findPosition(op.positionId); if (op.role) p.role = op.role; else delete p.role; break; }
      case "editWorkoutDefaults": doc.builder = op.builder; break;
      case "setWeekOverride": requireItem(doc.occurrences.find(o => o.id === op.occurrenceId)).weekOverride = op.weekOverride; break;
      case "editPositionTargets": {
        const p = findPosition(op.positionId);
        const current = new Set(p.targets.map(t => t.id));
        claim(op.targets.filter(t => !current.has(t.id)).map(t => t.id));
        p.targets = op.targets;
        break;
      }
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
  validateWorkoutDefaults(parsed.data);
  return parsed.data;
}
