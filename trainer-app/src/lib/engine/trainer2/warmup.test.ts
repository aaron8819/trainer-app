import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { draftDocument, editDraftCommand, type DraftDocument } from '../../trainer2-contracts/draft';
import { draftEdits } from '../../../components/trainer2/draft-edits';
import { createHypertrophyPlan, expandWorkoutDefaults } from './plan-builder';
import { editDocument, identities, readSavedDocument } from './planning';
import { canonicalJson } from '../../trainer2-contracts/canonical-json';

const text = 'Supported Cossack squats\nUse support for balance.';

function persistEdit(before: DraftDocument, after: DraftDocument) {
  const command = editDraftCommand.parse({
    schemaVersion: 1, commandType: 'EditDraft', actionId: randomUUID(),
    originatingAccountId: 'test', deviceId: randomUUID(), ownershipEpoch: 0, dependsOn: [],
    target: { planId: randomUUID() }, expected: { planRevisionId: randomUUID() },
    intent: { operations: draftEdits(before, after) },
  });
  return editDocument(before, command, new Set(identities(before).map(i => i.id)));
}

it('round-trips warm-ups across all weeks without changing identities or logged targets', () => {
  const before = createHypertrophyPlan();
  const changed = structuredClone(before);
  changed.builder!.workouts[0].warmup = text;
  // Independent legacy week prescriptions still receive the workout warm-up.
  changed.occurrences[16].weekOverride = true;
  const after = expandWorkoutDefaults(changed);
  const saved = persistEdit(before, after);
  expect(saved).toEqual(after);
  expect(readSavedDocument(saved)).toEqual(saved);
  expect(saved.occurrences.filter(o => o.workoutKey === saved.builder!.workouts[0].key)
    .map(o => o.warmup)).toEqual(Array(5).fill(text));
  expect(saved.occurrences.filter(o => o.workoutKey !== saved.builder!.workouts[0].key)
    .every(o => o.warmup === undefined)).toBe(true);
  expect(identities(saved)).toEqual(identities(before));
  expect(saved.occurrences.map(o => o.positions)).toEqual(before.occurrences.map(o => o.positions));
  expect(canonicalJson(saved)).not.toBe(canonicalJson(before));
  const cleared = structuredClone(saved);
  delete cleared.builder!.workouts[0].warmup;
  const savedClear = persistEdit(saved, expandWorkoutDefaults(cleared));
  expect(savedClear.occurrences.every(o => !('warmup' in o))).toBe(true);
  expect(readSavedDocument(savedClear)).toEqual(savedClear);
  expect(identities(savedClear)).toEqual(identities(saved));
  expect(saved.occurrences[0].warmup).toBe(text);
  expect(before.occurrences.every(o => !('warmup' in o))).toBe(true);
});

it('adds, edits and clears independent workout warm-ups through persisted draft operations', () => {
  const before = createHypertrophyPlan();
  delete before.builder;
  before.occurrences = before.occurrences.slice(0, 2).map(o => ({
    id: o.id, stageId: o.stageId, name: o.name,
    positions: o.positions.map(p => ({ id: p.id, exercise: p.exercise, targets: p.targets })),
  }));
  let saved = readSavedDocument(before);
  for (const warmup of [text, 'Cossack squats, then an easy ramp-up.', undefined]) {
    const after = structuredClone(saved);
    if (warmup === undefined) delete after.occurrences[0].warmup;
    else after.occurrences[0].warmup = warmup;
    saved = persistEdit(saved, after);
    expect(readSavedDocument(saved)).toEqual(after);
    expect(saved.occurrences[0].warmup).toBe(warmup);
    expect(saved.occurrences[1]).toEqual(before.occurrences[1]);
    expect(saved.occurrences.map(o => o.positions)).toEqual(before.occurrences.map(o => o.positions));
    expect(identities(saved)).toEqual(identities(before));
  }
  expect(saved).toEqual(before);
});

it('rejects occurrence warm-ups that disagree with the shared workout defaults', () => {
  const before = createHypertrophyPlan();
  const after = structuredClone(before);
  after.occurrences[0].warmup = text;
  expect(() => persistEdit(before, after)).toThrow('INVALID_DOCUMENT');
  expect(before.occurrences.every(o => !('warmup' in o))).toBe(true);
});

it('keeps old documents byte-equivalent and rejects blank or oversized warm-up text', () => {
  const old = createHypertrophyPlan();
  expect(canonicalJson(readSavedDocument(old))).toBe(canonicalJson(old));
  for (const warmup of ['', '  ', 'x'.repeat(2001)]) {
    const doc = structuredClone(old);
    doc.occurrences[0].warmup = warmup;
    expect(draftDocument.safeParse(doc).success).toBe(false);
  }
});
