import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createDraftCommand, draftDocument, editDraftCommand, type DraftDocument } from '../../trainer2-contracts/draft';
import { changeSetCount, createHypertrophyPlan, expandWorkoutDefaults, markOverride, removeBuilderRow, repairBuilderMetadata, resetField, SetCountConflict } from './plan-builder';
import { editDocument, identities, readSavedDocument, validateWorkoutDefaults } from './planning';
import { draftEdits } from '../../../components/trainer2/draft-edits';
import { prescriptionSummary } from '../../../components/trainer2/prescription-summary';

const envelope = () => ({ schemaVersion: 1, actionId: randomUUID(), originatingAccountId: 'test', deviceId: randomUUID(), ownershipEpoch: 0, dependsOn: [], target: { planId: randomUUID() } });
function edit(before: DraftDocument, after: DraftDocument) {
  return editDocument(before, editDraftCommand.parse({ ...envelope(), commandType: 'EditDraft', expected: { planRevisionId: randomUUID() }, intent: { operations: draftEdits(before, after) } }), new Set(identities(before).map(i => i.id)));
}
describe('R1 count reset and reduction', () => {
  it('reports discarded edited sets without mutation; confirmation preserves surviving IDs, values and unrelated edits', () => {
    const before = createHypertrophyPlan(), o = before.occurrences[8], p = o.positions[0];
    const scope = { occurrenceId: o.id, key: p.id };
    const d = changeSetCount(before, scope, 5), week = d.occurrences[8], row = week.positions[0];
    row.targets[4].restSeconds = '123.00'; row.targets[0].rir = '0';
    week.overrides!.targets = { [row.targets[4].id]: ['restSeconds'], [row.targets[0].id]: ['rir'] };
    const saved = edit(before, d); saved.name = 'Unrelated pending name';
    const bytes = JSON.stringify(saved);
    expect(() => resetField(saved, o.id, p.id, 'sets')).toThrow(SetCountConflict);
    expect(() => changeSetCount(saved, scope, 3)).toThrow(SetCountConflict);
    expect(JSON.stringify(saved)).toBe(bytes);
    const reset = changeSetCount(saved, scope, null, true);
    expect(reset.occurrences[8].positions[0].targets).toEqual(row.targets.slice(0, 3));
    expect(reset.occurrences[8].overrides!.targets).toEqual({ [row.targets[0].id]: ['rir'] });
    expect(reset.name).toBe(saved.name);
    expect(edit(saved, reset)).toEqual(draftDocument.parse(reset));
  });
  it('resets to current inherited count without repeated deload halving, and uses classification consistently', () => {
    let d = createHypertrophyPlan(); const o = d.occurrences[16], p = o.positions[0];
    const scope = { occurrenceId: o.id, key: p.id };
    d = changeSetCount(d, scope, 5);
    d.builder!.workouts[0].rows[0].sets = 7;
    d = changeSetCount(expandWorkoutDefaults(d), scope, null);
    expect(d.occurrences[16].positions[0].targets).toHaveLength(4);
    expect(changeSetCount(d, scope, null)).toEqual(d);
    expect(expandWorkoutDefaults(d)).toEqual(d);
    d.builder!.workouts[0].rows[0].prescription.classification = 'preparation';
    d = expandWorkoutDefaults(d);
    expect(changeSetCount(d, { workoutKey: o.workoutKey, key: p.sourceKey! }, 3).occurrences[16].positions[0].targets).toHaveLength(3);
  });
});
describe('R2 value relationships and recovery', () => {
  it('removes only the selected position and dependent metadata in both scopes', () => {
    for (const shared of [true, false]) {
      const d = createHypertrophyPlan(), o = d.occurrences[8], p = o.positions[0], other = o.positions[1];
      markOverride(o, p.id, ['reps'], { reps: { min: 7, max: 10, basis: 'total' } });
      markOverride(o, other.id, ['rir'], { rir: '0' });
      p.targets[1].restSeconds = '123.00'; o.overrides!.targets = { [p.targets[1].id]: ['restSeconds'] };
      const before = expandWorkoutDefaults(d), bytes = JSON.stringify(before);
      const result = removeBuilderRow(before, shared ? { workoutKey: o.workoutKey, key: p.sourceKey! } : { occurrenceId: o.id, key: p.id });
      expect(JSON.stringify(before)).toBe(bytes);
      expect(result.occurrences[8].overrides!.values).toEqual({ [other.id]: { rir: '0' } });
      expect(result.occurrences[8].overrides!.targets).toEqual({});
      expect(edit(before, result)).toEqual(draftDocument.parse(result));
    }
  });
  it.each(['unknown', 'foreign', 'unmasked', 'unsupported', 'malformed', 'wrongBasis'])('rejects %s values on create and atomic edit', kind => {
    const before = createHypertrophyPlan(), d = structuredClone(before), o = d.occurrences[8], p = o.positions[0];
    const key = kind === 'unknown' ? randomUUID() : kind === 'foreign' ? d.occurrences[0].positions[0].id : p.id;
    o.overrides = { removed: [], order: false, fields: kind === 'unmasked' ? {} : { [p.id]: ['rir', 'reps'] }, values: { [key]: { rir: '7' } } };
    if (kind === 'unsupported') Object.assign(o.overrides.values![key], { sets: 5 });
    if (kind === 'malformed') o.overrides.values![key].rir = '-1';
    if (kind === 'wrongBasis') o.overrides.values![key] = { reps: { min: 6, max: 10, basis: 'perSide' } };
    expect(createDraftCommand.safeParse({ ...envelope(), commandType: 'CreateDraft', expected: {}, intent: d }).success).toBe(false);
    d.name = 'Must not partially apply';
    expect(() => edit(before, d)).toThrow(); expect(before.name).toBe('My hypertrophy plan');
  });
  it('retains explicit equal-valued and older mask-only overrides', () => {
    for (const values of [true, false]) {
      const d = createHypertrophyPlan(), o = d.occurrences[8], p = o.positions[0];
      markOverride(o, p.id, ['reps'], values ? { reps: p.targets[0].reps } : undefined);
      expect(draftDocument.safeParse(d).success).toBe(true); validateWorkoutDefaults(d);
      d.builder!.workouts[0].rows[0].prescription.reps.min = 7;
      expect(expandWorkoutDefaults(d).occurrences[8].positions[0].targets[0].reps.min).toBe(6);
    }
  });
  it('opens old orphan metadata unchanged, requires explicit repair, and never repairs foreign references', () => {
    const d = createHypertrophyPlan(), o = d.occurrences[8], p = o.positions[0];
    markOverride(o, p.id, ['rir'], { rir: '0' });
    const old = expandWorkoutDefaults(d); old.occurrences[8].overrides!.values![randomUUID()] = { rir: '7' };
    const bytes = JSON.stringify(old);
    expect(readSavedDocument(old)).toEqual(old); expect(draftDocument.safeParse(old).success).toBe(false);
    expect(() => edit(old, { ...old, name: 'Cannot silently repair' })).toThrow();
    const repaired = repairBuilderMetadata(old);
    expect(edit(old, repaired)).toEqual(draftDocument.parse(repaired));
    expect(repaired.occurrences[8].positions).toEqual(old.occurrences[8].positions);
    expect(repaired.occurrences[8].overrides!.values).toEqual({ [p.id]: { rir: '0' } });
    expect(JSON.stringify(old)).toBe(bytes);
    old.occurrences[8].overrides!.values![old.occurrences[0].positions[0].id] = { rir: '7' };
    expect(() => readSavedDocument(old)).toThrow();
  });
});
it('U1 independent additions retain authored targets and never acquire inheritance masks', () => {
  const d = createHypertrophyPlan(), o = d.occurrences[8], p = structuredClone(o.positions[0]);
  p.id = randomUUID(); delete p.sourceKey; p.targets.forEach(t => { t.id = randomUUID(); t.reps.min = 7; }); o.positions.push(p);
  markOverride(o, p.id, ['reps'], { reps: p.targets[0].reps });
  expect(o.overrides).toBeUndefined(); expect(expandWorkoutDefaults(d)).toEqual(d);
  o.overrides = { removed: [], order: false, fields: { [p.id]: ['reps'] }, values: { [p.id]: { reps: p.targets[0].reps } }, targets: { [p.targets[1].id]: ['rir'] } };
  expect(readSavedDocument(d)).toEqual(d);
  const repaired = repairBuilderMetadata(d);
  expect(repaired.occurrences[8].positions).toEqual(d.occurrences[8].positions);
  expect(draftDocument.safeParse(repaired).success).toBe(true);
});
it('U3 summaries reflect mixed reps, zero effort, per-side basis and homogeneous effective prescriptions', () => {
  const targets = createHypertrophyPlan().occurrences[8].positions[0].targets;
  expect(prescriptionSummary(targets)).toBe('3 × 6–10 · 2 left');
  targets[1].reps = { min: 15, max: 20, basis: 'total' }; targets[1].rir = '0';
  expect(prescriptionSummary(targets)).toBe('Mixed sets · Set 1: 6–10 · 2 left; Set 2: 15–20 · 0 left; Set 3: 6–10 · 2 left');
  targets.forEach(t => { t.reps = { min: 8, max: 12, basis: 'perSide' }; t.rir = '0'; });
  expect(prescriptionSummary(targets)).toBe('3 × 8–12 per side · 0 left');
});
