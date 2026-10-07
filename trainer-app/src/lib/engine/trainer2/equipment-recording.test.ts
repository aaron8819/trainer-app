import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { browseCatalog, catalog, catalogExercise, swapPrescription } from './catalog';
import { normalizeCatalogEntry, catalogSources } from './catalog-adapter';
import { createHypertrophyPlan, expandWorkoutDefaults, setEquipmentSetup } from './plan-builder';
import { readSavedDocument, validateWorkoutDefaults } from './planning';
import { reviewPlan } from './plan-review';
import { compatibleCatalogResult, compatibleLoggingLoad, sameLoggingExercise } from './logging-prefill';
import { compatiblePrevious } from '../../api/trainer2/previous-performance';
import { draftDocument, exercise as exerciseSchema } from '../../trainer2-contracts/draft';
import { initialPrescription } from '../../trainer2-contracts/execution';
import { performedResult } from '../../trainer2-contracts/set-results';
import { replacementContent } from './exercise-swap';
import type { ExecutionRead } from '../../trainer2-contracts/execution';

const ids = ['hack-squat-plates-added', 'seated-calf-raise-plates-added', 'smith-machine-standing-calf-raise-plates-added', 'iso-lateral-low-row-plates-per-arm'];
const snapshot = (id: string) => {
  const e = catalogExercise(catalog.find(e => e.id === `t2:${id}`)!);
  if (e.kind !== 'catalogSnapshot') throw Error('Missing snapshot');
  return e;
};
function fixture(id = ids[0], value: string | null = '0.000000') {
  let doc = createHypertrophyPlan();
  const row = doc.builder!.workouts[0].rows[0];
  row.exercise = snapshot(id);
  if (id === ids[0]) row.exercise.equipmentSetup = { label: 'Identified hack machine', startingResistance: { value: '105', unit: 'lb' } };
  row.prescription.measurement = value === null ? null : { kind: 'externalLoad', value, unit: 'lb',
    convention: row.exercise.convention as 'machineAddedPlatesTotal' | 'smithPlatesTotal' | 'machinePlatesPerArm', zeroMeaning: 'validZero' };
  doc = expandWorkoutDefaults(doc);
  return doc;
}
describe('Trainer2 equipment recording', () => {
  it.each(ids)('qualifies only the reviewed Trainer2 tuple: %s', id => {
    const e = snapshot(id), source = catalogSources.find(s => `t2:${s.catalogKey}` === e.catalogId)!;
    expect(e.repBasis).toBe('total'); expect(e.catalogFacts?.externalZeroMeaning).toBe('validZero');
    expect(e).not.toHaveProperty('equipmentSetup');
    expect(normalizeCatalogEntry(source, true).selectable).toBe(true);
    expect(normalizeCatalogEntry({ ...source, zeroLoadMeaning: null }, true).selectable).toBe(false);
    expect(normalizeCatalogEntry({ ...source, measurementProfile: 'REPS_ASSISTED' }, true).selectable).toBe(false);
    const doc = draftDocument.parse(fixture(id));
    expect(() => validateWorkoutDefaults(doc)).not.toThrow(); expect(reviewPlan(doc)).toEqual([]);
  });
  it('preserves specific equipment facts and exact zero through saved plan and START snapshots', () => {
    const doc = fixture(), before = structuredClone(doc);
    expect(readSavedDocument(JSON.parse(JSON.stringify(doc)))).toEqual(before);
    const occurrence = doc.occurrences[0], executionId = randomUUID();
    const start = initialPrescription.parse({ schemaVersion: 1, kind: 'START', provenance: 'VERIFIED_START', policyVersion: 'trainer2-start-v1',
      accountId: 'disposable', executionId, planId: randomUUID(), revisionId: randomUUID(), sourceContentHash: 'a'.repeat(64),
      startedAt: new Date().toISOString(), stage: doc.stages[0], occurrence, progression: doc.progression,
      instructions: { epoch: 0, revisionId: null, contentHash: 'b'.repeat(64), document: { version: 1, restrictions: [], exceptions: [] } },
      positions: occurrence.positions.map(p => ({ id: randomUUID(), sourcePositionId: p.id, targets: p.targets.map(t => ({ id: randomUUID(), sourceTargetId: t.id })) })) });
    expect(start.occurrence.positions[0].exercise).toEqual(before.occurrences[0].positions[0].exercise);
    expect(start.occurrence.positions[0].targets[0].measurement).toMatchObject({ value: '0.000000', convention: 'machineAddedPlatesTotal' });
    expect(snapshot(ids[0])).not.toHaveProperty('equipmentSetup');
    const bad = structuredClone(doc); bad.occurrences[0].positions[0].exercise.name = 'Invented';
    expect(() => validateWorkoutDefaults(bad)).toThrow('INVALID_DOCUMENT');
    expect(exerciseSchema.safeParse({ ...snapshot('hack-squat'), equipmentSetup: { label: 'Machine', startingResistance: { value: '105', unit: 'lb' } } }).success).toBe(false);
  });
  it.each(ids)('keeps blank distinct from explicit zero and records per-arm amounts without doubling: %s', id => {
    const p = fixture(id, id === ids[3] ? '45' : '0').occurrences[0].positions[0];
    const result = performedResult.parse({ reps: { value: 10, basis: 'total' }, measurement: p.targets[0].measurement, rir: '2' });
    expect(result.measurement).toEqual(p.targets[0].measurement);
    expect(compatibleCatalogResult(result, p.exercise)).toBe(true);
    expect(fixture(id, null).occurrences[0].positions[0].targets[0].measurement).toBeNull();
    expect(compatibleCatalogResult({ ...result, measurement: { ...result.measurement as Extract<NonNullable<typeof result.measurement>, { kind: 'externalLoad' }>, convention: 'machineDisplayed' } }, p.exercise)).toBe(false);
  });
  it('bars values from other identities, conventions and machine setups', () => {
    const p = fixture().occurrences[0].positions[0];
    const actual = { reps: { value: 10, basis: 'total' as const }, measurement: p.targets[0].measurement, rir: '2' };
    expect(sameLoggingExercise(p.exercise, structuredClone(p.exercise))).toBe(true);
    expect(compatiblePrevious(p, structuredClone(p), actual)).toBe(true);
    for (const id of ['hack-squat', ids[1], ids[3], 'chest-supported-machine-row-stack']) {
      const next = snapshot(id);
      expect(sameLoggingExercise(p.exercise, next)).toBe(false);
      expect(compatiblePrevious(p, { ...p, exercise: next }, actual)).toBe(false);
      expect(swapPrescription(p.exercise, next, p.targets[0]).measurement).toBeNull();
    }
    const next = snapshot(ids[0]); next.equipmentSetup = { label: 'Another machine', startingResistance: { value: '105', unit: 'lb' } };
    expect(sameLoggingExercise(p.exercise, next)).toBe(false);
    expect(compatiblePrevious(p, { ...p, exercise: next }, actual)).toBe(false);
    expect(compatibleLoggingLoad({ kind: 'externalLoad', value: '45', unit: 'lb', convention: 'machinePlatesPerArm', zeroMeaning: 'validZero' }, p.targets[0], p.exercise)).toBe(false);
  });
  it('retains required swap choices and clears session prescriptions and equipment metadata', () => {
    expect(browseCatalog('', [], snapshot('chest-supported-machine-row-stack')).map(e => e.id)).toContain(`t2:${ids[3]}`);
    expect(browseCatalog('', [], snapshot(ids[2])).map(e => e.id)).toContain('t2:selectorized-standing-calf-raise');
    expect(snapshot('chest-supported-machine-high-row-plates-per-arm').convention).toBe('machinePlatesPerArm');
    const p = fixture().occurrences[0].positions[0], owned = randomUUID();
    const execution = { initial: { occurrence: { positions: [p] }, positions: [{ id: owned, sourcePositionId: p.id, targets: p.targets.map(t => ({ id: randomUUID(), sourceTargetId: t.id })) }] } } as unknown as ExecutionRead;
    const swap = replacementContent(execution, owned, catalog.find(e => e.id === `t2:${ids[1]}`)!);
    expect(swap.targets.every(t => t.measurement === null)).toBe(true);
    expect(swap.exercise).not.toHaveProperty('equipmentSetup');
    expect(replacementContent(execution, owned, null).exercise).toEqual(p.exercise);
  });
});

it('equipment-only week edits preserve every individual authored measurement and other weeks', () => {
  const doc = fixture(), o = doc.occurrences[0], p = o.positions[0];
  p.targets[1].measurement = { ...p.targets[0].measurement as Extract<NonNullable<typeof p.targets[0]['measurement']>, { kind: 'externalLoad' }>, value: '12.500000' };
  o.overrides = { removed: [], order: false, fields: {}, targets: { [p.targets[1].id]: ['measurement'] } };
  const before = structuredClone(doc), setup = { label: 'Other identified hack', startingResistance: { value: '90', unit: 'lb' as const } };
  const changed = setEquipmentSetup(doc, { occurrenceId: o.id, workoutKey: o.workoutKey!, key: p.id }, setup);
  expect(changed.occurrences[0].positions[0].targets).toEqual(before.occurrences[0].positions[0].targets);
  expect(changed.occurrences[4]).toEqual(before.occurrences[4]);
  expect(readSavedDocument(changed)).toEqual(changed); expect(() => validateWorkoutDefaults(changed)).not.toThrow();
});
