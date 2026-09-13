import { describe, expect, it } from 'vitest';
import { draftDocument, progressionIntent, type DraftDocument, type EditDraftCommand } from '../../trainer2-contracts/draft';
import { createHypertrophyPlan, expandWorkoutDefaults, newRow, markOverride, repairBuilderMetadata } from './plan-builder';
import { readSavedDocument, editDocument, identities } from './planning';
import { reviewPlan } from './plan-review';
import { draftEdits } from '../../../components/trainer2/draft-edits';

function apply(before: DraftDocument, after: DraftDocument) {
  return editDocument(before, { intent: { operations: draftEdits(before, after) } } as EditDraftCommand, new Set(identities(before).map(i => i.id)));
}
describe('versioned authored progression and review', () => {
  it('requires explicit metadata repair and preserves historical prescriptions and intent', () => {
    const doc = createHypertrophyPlan(); const o = doc.occurrences[8];
    markOverride(o, o.positions[0].id, ['rir'], { rir: '0' });
    const old = expandWorkoutDefaults(doc);
    old.occurrences[8].overrides!.values![crypto.randomUUID()] = { rir: '7' };
    const bytes = JSON.stringify(old);
    expect(reviewPlan(readSavedDocument(old)).map(i => i.code)).toContain('INVALID_SAVED_STRUCTURE');
    const repaired = apply(old, repairBuilderMetadata(old));
    expect(reviewPlan(repaired)).toEqual([]);
    expect(repaired.progression).toEqual(old.progression);
    expect(repaired.occurrences[8].positions).toEqual(old.occurrences[8].positions);
    expect(JSON.stringify(old)).toBe(bytes);
  });
  it('initializes explicit intent and reviews actual defaults without a second deload reduction', () => {
    const doc = createHypertrophyPlan(); const snapshot = JSON.stringify(doc);
    expect(doc.progression).toEqual({ version: 1, mode: 'plannedPrescriptions', scope: 'wholePlan', parameters: {} });
    expect(doc.builder!.weeks.map(w => w.rir)).toEqual(['3', '3', '2', '1', '4']);
    expect(reviewPlan(doc)).toEqual([]);
    expect(JSON.stringify(doc)).toBe(snapshot);
    expect(doc.occurrences[16].positions[0].targets).toHaveLength(2);
  });
  it.each([
    { version: 2, mode: 'plannedPrescriptions', scope: 'wholePlan', parameters: {} },
    { version: 1, mode: 'doubleProgression', scope: 'wholePlan', parameters: {} },
    { version: 1, mode: 'plannedPrescriptions', scope: 'wholePlan', parameters: { increment: 5 } },
    { version: 1, mode: 'plannedPrescriptions', scope: 'wholePlan', parameters: {}, targetIds: [crypto.randomUUID()] },
    { version: 1, mode: 'plannedPrescriptions', scope: 'exercise', parameters: {} },
  ])('rejects unsupported or invented progression meaning %j', progression => {
    expect(progressionIntent.safeParse(progression).success).toBe(false);
    expect(draftDocument.safeParse({ ...createHypertrophyPlan(), progression }).success).toBe(false);
  });
  it('keeps historical absence through read and rename, selects and clears through named edits', () => {
    const old = createHypertrophyPlan(); delete old.progression;
    const bytes = JSON.stringify(old);
    expect(readSavedDocument(old).progression).toBeUndefined();
    expect(apply(old, { ...old, name: 'Renamed' }).progression).toBeUndefined();
    expect(reviewPlan(old).map(i => i.code)).toContain('PROGRESSION_INTENT_REQUIRED');
    const selected = apply(old, { ...old, progression: createHypertrophyPlan().progression });
    expect(readSavedDocument(JSON.parse(JSON.stringify(selected)))).toEqual(selected);
    expect(reviewPlan(selected)).toEqual([]);
    expect(apply(selected, old).progression).toBeUndefined();
    expect(JSON.stringify(old)).toBe(bytes);
  });
  it('covers custom additions and older independent sessions without performance references', () => {
    const before = createHypertrophyPlan(); const doc = structuredClone(before);
    doc.occurrences[0].weekOverride = true;
    doc.occurrences[0].positions.push({ id: crypto.randomUUID(), exercise: { kind: 'authoredDescription', name: 'My exercise', variation: '' }, targets: [{ ...doc.occurrences[0].positions[0].targets[0], id: crypto.randomUUID(), measurement: null }] });
    doc.builder!.workouts[1].rows.push(newRow('Custom row'));
    expect(reviewPlan(apply(before, expandWorkoutDefaults(doc)))).toEqual([]);
    const independent = { ...doc, builder: undefined, occurrences: doc.occurrences.slice(0, 1).map(o => ({ id: o.id, name: o.name, stageId: o.stageId, positions: o.positions.map(p => ({ id: p.id, exercise: p.exercise, targets: p.targets })) })) };
    expect(reviewPlan(draftDocument.parse(independent))).toEqual([]);
  });
  it('blocks empty and unnamed work, permits unknown weights and optional effort/rest', () => {
    const doc = createHypertrophyPlan(undefined, true);
    expect(reviewPlan(doc).map(i => i.code)).toContain('NO_EXECUTABLE_TRAINING');
    const full = createHypertrophyPlan();
    expect(reviewPlan(full)).toEqual([]);
    delete full.builder;
    full.occurrences = [{ id: crypto.randomUUID(), stageId: full.stages[0].id, name: 'Custom', positions: [{ id: crypto.randomUUID(), exercise: { kind: 'authoredDescription', name: ' ', variation: '' }, targets: [] }] }];
    expect(reviewPlan(full).map(i => i.code)).toEqual(expect.arrayContaining(['UNNAMED_EXERCISE', 'NO_TARGETS']));
  });
});
