import type { z } from 'zod';
import type { savedDraftDocument, occurrence } from '../../trainer2-contracts/draft';
import { AMENDMENT_POLICY, type AmendmentContent, type amendmentPosition } from '../../trainer2-contracts/plan-exercise-amendment';
import { catalog, catalogExercise } from './catalog';
export const BODYWEIGHT_BACK_EXTENSION = 't2:bodyweight-45-degree-back-extension';
export function amendedOccurrence(original: z.infer<typeof occurrence>, amendments: AmendmentContent[]) {
  return { ...original, positions: original.positions.map(p => {
    const replacement = amendments.flatMap(a => a.replacements).filter(r => r.occurrenceId === original.id && r.positionId === p.id).at(-1);
    return replacement ? { ...p, exercise: replacement.exercise, targets: replacement.targets } : p;
  }) };
}
export function pendingBackExtensionPositions(document: z.infer<typeof savedDraftDocument>, unavailable: Set<string>) {
  return document.occurrences.flatMap(o => unavailable.has(o.id) ? [] : o.positions.filter(p =>
    p.exercise.kind === 'catalogSnapshot' && p.exercise.catalogId === BODYWEIGHT_BACK_EXTENSION).map(p => ({ occurrenceId: o.id, positionId: p.id })));
}
export function backExtensionAmendment(document: z.infer<typeof savedDraftDocument>, positions: z.infer<typeof amendmentPosition>[]): AmendmentContent {
  const exercise = catalogExercise(catalog.find(e => e.id === 't2:45-degree-back-extension')!);
  return { policyVersion: AMENDMENT_POLICY, replacements: positions.map(selected => {
    const p = document.occurrences.find(o => o.id === selected.occurrenceId)?.positions.find(p => p.id === selected.positionId);
    if (!p || p.exercise.kind !== 'catalogSnapshot' || p.exercise.catalogId !== BODYWEIGHT_BACK_EXTENSION) throw new Error('INVALID_AMENDMENT_POSITION');
    return { ...selected, exercise, targets: p.targets.map(t => ({ ...t, measurement: null })) };
  }) };
}
