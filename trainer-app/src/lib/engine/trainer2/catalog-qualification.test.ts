import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { catalog, catalogExercise } from './catalog';
import { editDocument, identities, readSavedDocument, validateWorkoutDefaults } from './planning';
import { createHypertrophyPlan } from './plan-builder';
import { reviewPlan } from './plan-review';
import { draftDocument, exercise, type EditDraftCommand } from '../../trainer2-contracts/draft';
import { swapExerciseCommand, swapPreviewRequest } from '../../trainer2-contracts/exercise-swap';

const legacy = catalogExercise(catalog.find(e => e.id === 't2:barbell-bench-press')!);
const current = catalogExercise(catalog.find(e => e.id === 't2:decline-barbell-bench-press')!);
if (current.kind !== 'catalogSnapshot' || !current.catalogFacts) throw new Error('Missing qualified fixture');
const facts = current.catalogFacts;
const cases = [
  ['invented legacy facts', { ...legacy, catalogFacts: facts }],
  ['omitted current facts', Object.fromEntries(Object.entries(current).filter(([key]) => key !== 'catalogFacts'))],
  ['present undefined legacy facts', { ...legacy, catalogFacts: undefined }],
  ['modified restriction', { ...current, catalogFacts: { ...facts, externalZeroMeaning: 'validZero' } }],
  ['modified primary muscles', { ...current, catalogFacts: { ...facts, primaryMuscles: ['Invented'] } }],
  ['modified secondary muscles', { ...current, catalogFacts: { ...facts, secondaryMuscles: [] } }],
  ['modified movement', { ...current, catalogFacts: { ...facts, movementPatterns: ['Invented'] } }],
  ['modified nested defaults', { ...current, catalogFacts: { ...facts, repDefaults: { min: 900, max: 999 } } }],
  ['modified load convention', { ...legacy, convention: 'perImplement' }],
] as const;
function document(snapshot: unknown) {
  const stageId = randomUUID();
  return draftDocument.parse({ schemaVersion: 1, name: 'qualification', endpoint: 'endOfOrderedOccurrences',
    progression: { version: 1, mode: 'plannedPrescriptions', scope: 'wholePlan', parameters: {} },
    stages: [{ id: stageId, name: 'Test' }], occurrences: [{ id: randomUUID(), stageId, name: 'Test',
      positions: [{ id: randomUUID(), exercise: snapshot, targets: [{ id: randomUUID(), classification: 'working', required: true,
        reps: { min: 8, max: 12, basis: 'total' }, measurement: null, rir: '2', restSeconds: '90' }] }] }] });
}
describe('complete incoming catalog qualification', () => {
  it.each([legacy, current])('accepts unchanged qualified snapshots and preserves saved prescriptions ($catalogId)', snapshot => {
    const doc = document(snapshot);
    validateWorkoutDefaults(doc);
    expect(readSavedDocument(doc)).toEqual(doc);
    expect(reviewPlan(doc)).toEqual([]);
    // Canonical equality must not depend on caller object insertion order.
    doc.occurrences[0].positions[0].exercise = Object.fromEntries(Object.entries(snapshot).reverse()) as typeof snapshot;
    expect(() => validateWorkoutDefaults(doc)).not.toThrow();
  });
  it.each(cases)('rejects %s on create, edit and activation review', (_label, snapshot) => {
    const doc = document(snapshot);
    expect(() => validateWorkoutDefaults(doc)).toThrow('INVALID_DOCUMENT');
    expect(reviewPlan(doc).map(i => i.code)).toContain('INVALID_SAVED_STRUCTURE');
    const original = document(legacy);
    const command: EditDraftCommand = { schemaVersion: 1, commandType: 'EditDraft', actionId: randomUUID(), deviceId: randomUUID(),
      originatingAccountId: randomUUID(), ownershipEpoch: 0, dependsOn: [], target: { planId: randomUUID() },
      expected: { planRevisionId: randomUUID() }, intent: { operations: [{ op: 'editExercise',
        positionId: original.occurrences[0].positions[0].id, exercise: exercise.parse(snapshot) }] } };
    expect(() => editDocument(original, command, new Set(identities(original).map(i => i.id)))).toThrow('INVALID_DOCUMENT');
  });
  it('also rejects injected builder facts even before expansion', () => {
    const doc = createHypertrophyPlan();
    const row = doc.builder!.workouts[0].rows[0];
    row.exercise = exercise.parse({ ...legacy, catalogFacts: facts });
    expect(() => validateWorkoutDefaults(draftDocument.parse(doc))).toThrow('INVALID_DOCUMENT');
  });
  it('preserves historical snapshots on read without enriching or requalifying them', () => {
    const doc = document({ ...current, name: 'Historical name', catalogFacts: { ...facts, repDefaults: { min: 7, max: 9 } } });
    expect(readSavedDocument(doc)).toEqual(doc);
    expect(() => validateWorkoutDefaults(doc)).toThrow('INVALID_DOCUMENT');
    expect(readSavedDocument(document(legacy)).occurrences[0].positions[0].exercise).not.toHaveProperty('catalogFacts');
  });
  it.each([legacy, current])('swap preview and commit accept IDs and reject submitted facts ($catalogId)', snapshot => {
    if (snapshot.kind !== 'catalogSnapshot') throw new Error('Expected catalog snapshot');
    const target = { executionId: randomUUID(), positionId: randomUUID() };
    const intent = { restoreOriginal: false, catalogId: snapshot.catalogId };
    const preview = { ...target, intent };
    const command = { schemaVersion: 1, commandType: 'SwapExercise', actionId: randomUUID(), deviceId: randomUUID(),
      originatingAccountId: randomUUID(), ownershipEpoch: 0, dependsOn: [], target,
      expected: { contentHash: 'a'.repeat(64), effectiveHash: 'b'.repeat(64), instructionEpoch: 0,
        assignment: { positionId: target.positionId, version: 0, actionId: null, contentHash: 'a'.repeat(64) } }, intent };
    expect(swapPreviewRequest.safeParse(preview).success).toBe(true);
    expect(swapExerciseCommand.safeParse(command).success).toBe(true);
    for (const patch of [{ catalogFacts: facts }, { exercise: snapshot }]) {
      expect(swapPreviewRequest.safeParse({ ...preview, intent: { ...intent, ...patch } }).success).toBe(false);
      expect(swapExerciseCommand.safeParse({ ...command, intent: { ...intent, ...patch } }).success).toBe(false);
    }
  });
});
