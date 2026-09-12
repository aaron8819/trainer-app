import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { draftDocument, editDraftCommand, type DraftDocument } from '../../trainer2-contracts/draft';
import { createHypertrophyPlan, expandWorkoutDefaults, newRow, restoreWeek } from './plan-builder';
import { editDocument, identities, validateWorkoutDefaults } from './planning';
import { draftEdits } from '../../../components/trainer2/draft-edits';
function apply(before: DraftDocument, after: DraftDocument, history = new Set(identities(before).map(i => i.id))) {
  const command = editDraftCommand.parse({ schemaVersion: 1, commandType: 'EditDraft', actionId: randomUUID(), originatingAccountId: 'test', deviceId: randomUUID(), ownershipEpoch: 0, dependsOn: [], target: { planId: randomUUID() }, expected: { planRevisionId: randomUUID() }, intent: { operations: draftEdits(before, after) } });
  return editDocument(before, command, history);
}
function populated() { const d = createHypertrophyPlan(); d.builder!.workouts[0].rows.push(newRow('Squat')); return expandWorkoutDefaults(d); }
describe('plan-owned hypertrophy defaults', () => {
  it('starts with 5 weeks and 20 independently identified ordered workouts without dates or invented exercises', () => {
    const d = draftDocument.parse(createHypertrophyPlan());
    expect(d.stages).toHaveLength(5); expect(d.occurrences).toHaveLength(20);
    expect(d.occurrences.slice(0, 4).map(o => o.name)).toEqual(['Lower A', 'Upper A', 'Lower B', 'Upper B']);
    expect(d.occurrences.every(o => !o.positions.length)).toBe(true);
    expect(new Set(identities(d).map(i => i.id)).size).toBe(25);
    validateWorkoutDefaults(d);
  });
  it('expands prescriptions, keeps rep ranges, optional weight and actual reduced deload sets', () => {
    const before = createHypertrophyPlan(); const edited = structuredClone(before);
    edited.builder!.workouts[0].rows.push(newRow('Squat'));
    const d = apply(before, expandWorkoutDefaults(edited));
    expect(d.occurrences.filter(o => o.name === 'Lower A').map(o => [o.positions[0].targets.length, o.positions[0].targets[0].rir])).toEqual([[3,'3'],[3,'3'],[3,'2'],[3,'1'],[2,'4']]);
    expect(d.occurrences[0].positions[0].targets[0]).toMatchObject({ reps: { min: 8, max: 12 }, measurement: null });
    expect(expandWorkoutDefaults(d)).toEqual(d);
  });
  it('preserves explicit week-only work through shared edits and round trips, including week 1', () => {
    const d = populated();
    for (const index of [0, 4]) { d.occurrences[index].weekOverride = true; d.occurrences[index].positions[0].targets[0].reps.min = 9; }
    const before = draftDocument.parse(JSON.parse(JSON.stringify(d)));
    d.builder!.workouts[0].rows[0].exercise.name = 'Front squat';
    const saved = apply(before, expandWorkoutDefaults(d));
    expect(saved.occurrences[0]).toEqual(before.occurrences[0]); expect(saved.occurrences[4]).toEqual(before.occurrences[4]);
    expect(saved.occurrences[8].positions[0].exercise.name).toBe('Front squat');
    expect(identities(saved)).toEqual(identities(before));
    const restored = apply(saved, restoreWeek(saved, saved.occurrences[4].id));
    expect(restored.occurrences[4].positions[0].exercise.name).toBe('Front squat');
    expect(restored.occurrences[4].positions[0].id).toBe(saved.occurrences[4].positions[0].id);
  });
  it('reorders repeated same-name exercises by explicit source keys; removed targets never return with old IDs', () => {
    const before = populated(), changed = structuredClone(before);
    changed.builder!.workouts[0].rows.push(newRow('Squat'));
    const two = apply(before, expandWorkoutDefaults(changed));
    const reordered = structuredClone(two); reordered.builder!.workouts[0].rows.reverse();
    const saved = apply(two, expandWorkoutDefaults(reordered));
    expect(saved.occurrences[0].positions.map(p => p.id)).toEqual(two.occurrences[0].positions.map(p => p.id).reverse());
    const fewer = structuredClone(saved); fewer.builder!.workouts[0].rows[0].sets = 1;
    const reduced = apply(saved, expandWorkoutDefaults(fewer));
    const more = structuredClone(reduced); more.builder!.workouts[0].rows[0].sets = 3;
    const regrown = apply(reduced, expandWorkoutDefaults(more), new Set(identities(saved).map(i => i.id)));
    expect(regrown.occurrences[0].positions[0].targets[1].id).not.toBe(saved.occurrences[0].positions[0].targets[1].id);
  });
  it('rejects forged counterpart structure and inconsistent materialization at the domain boundary', () => {
    const d = populated(); d.occurrences[4].workoutKey = d.occurrences[5].workoutKey;
    expect(draftDocument.safeParse(d).success).toBe(false);
    const wrong = populated(); wrong.occurrences[0].positions[0].targets[0].rir = '9';
    expect(() => validateWorkoutDefaults(wrong)).toThrow('INVALID_DOCUMENT');
    const wrongOrder = populated(); wrongOrder.occurrences.reverse();
    expect(draftDocument.safeParse(wrongOrder).success).toBe(false);
    const wrongDeload = populated(); wrongDeload.builder!.weeks[0].deload = true;
    expect(draftDocument.safeParse(wrongDeload).success).toBe(false);
  });
  it('saves a fully populated supported plan atomically within the bounded batch', () => {
    const before = populated(), d = structuredClone(before);
    d.builder!.workouts.forEach(w => { w.rows = Array.from({length:20}, () => newRow('Exercise')); });
    const full = apply(before, expandWorkoutDefaults(d));
    const next = structuredClone(full); next.builder!.weeks[0].rir = '2';
    expect(apply(full, expandWorkoutDefaults(next)).occurrences).toHaveLength(20);
  });
});
