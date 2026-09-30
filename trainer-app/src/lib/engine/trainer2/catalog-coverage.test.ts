import { createHash, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import shared from '../../../../prisma/exercises_comprehensive.json';
import baseline from './qualified-catalog-v1.json';
import { normalizeCatalogEntry } from './catalog-adapter';
import { catalog, library, catalogExercise, browseCatalog, swapPrescription } from './catalog';
import { draftDocument } from '../../trainer2-contracts/draft';
import { readSavedDocument, validateWorkoutDefaults } from './planning';
import { compatibleCatalogResult, compatibleLoggingLoad, sameLoggingExercise, startingPounds } from './logging-prefill';
import { createHypertrophyPlan } from './plan-builder';
import { canonicalJson } from '../../trainer2-contracts/canonical-json';
import { replacementContent } from './exercise-swap';
import type { ExecutionRead } from '../../trainer2-contracts/execution';

const conventions = { BARBELL_TOTAL: 'barbellTotal', IMPLEMENT_WEIGHT: 'perImplement', MACHINE_DISPLAYED: 'machineDisplayed',
  ADDED_EXTERNAL_LOAD: 'addedExternal', DISPLAYED_ASSISTANCE: 'displayedAssistance' };
const kinds = { REPS_EXTERNAL_LOAD: 'externalLoad', REPS_BODYWEIGHT: 'bodyweight', REPS_BODYWEIGHT_PLUS_LOAD: 'addedLoad', REPS_ASSISTED: 'assistance' };

describe('complete canonical catalog integration', () => {
  it('qualifies every reviewed tuple without a second membership list', () => {
    expect(shared.exercises).toHaveLength(150);
    expect(baseline).toHaveLength(48);
    expect(catalog).toHaveLength(91);
    expect(library.filter(e => !e.selectable)).toHaveLength(59);
    expect(new Set(library.map(e => e.catalogId)).size).toBe(150);
    const compatible = shared.exercises.filter(e => 'measurementProfile' in e);
    expect(catalog.map(e => e.id).sort()).toEqual(compatible.map(e => 't2:' + e.catalogKey).sort());
    const future = { ...compatible[0], catalogKey: 'future-reviewed-exercise', name: 'Renamed arbitrary display' };
    expect(normalizeCatalogEntry(future).selectable).toBe(true);
    // Reviewed source metadata, including a formerly excluded key, is authority.
    expect(normalizeCatalogEntry({ ...future, catalogKey: 'landmine-press' }).selectable).toBe(true);
    expect(normalizeCatalogEntry({ ...future, repBasis: 'ALTERNATING_UNKNOWN' }).selectable).toBe(false);
    expect(normalizeCatalogEntry({ ...future, loadConvention: null }).selectable).toBe(false);
    expect(normalizeCatalogEntry({ ...future, repRangeRecommendation: undefined }).selectable).toBe(false);
  });
  it.each(catalog.map(e => [e.id, e] as const))('%s agrees with the canonical recording tuple and prescription', (id, entry) => {
    const source = shared.exercises.find(e => 't2:' + e.catalogKey === id)!;
    expect('measurementProfile' in source).toBe(true);
    const columns = source as unknown as { measurementProfile: keyof typeof kinds; loadConvention: keyof typeof conventions; repBasis: string };
    expect(entry.loadKind).toBe(kinds[columns.measurementProfile]);
    expect(entry.convention).toBe(columns.measurementProfile === 'REPS_BODYWEIGHT' ? 'bodyweightOnly' : conventions[columns.loadConvention]);
    expect(entry.repBasis).toBe(columns.repBasis === 'TOTAL' ? 'total' : 'perSide');
    expect(entry.reps).toEqual(source.repRangeRecommendation);
    if (!baseline.some(e => e.id === id)) {
      expect(entry.equipment).toEqual(source.equipment);
      expect(entry.purpose).toBe(source.movementPatterns.join(' + '));
      expect(entry.catalogFacts).toEqual({ movementPatterns: source.movementPatterns, primaryMuscles: source.primaryMuscles,
        secondaryMuscles: source.secondaryMuscles, externalZeroMeaning: entry.loadKind === 'externalLoad' ? 'notAllowed' : null,
        repDefaults: source.repRangeRecommendation });
    }
    const stageId = randomUUID();
    const target = { id: randomUUID(), classification: 'working' as const, required: true, reps: { ...entry.reps, basis: entry.repBasis },
      measurement: entry.loadKind === 'bodyweight' ? { kind: 'bodyweight' as const, convention: 'bodyweightOnly' as const } : null, rir: null, restSeconds: null };
    const doc = draftDocument.parse({ schemaVersion: 1, name: id, endpoint: 'endOfOrderedOccurrences', stages: [{ id: stageId, name: 'Test' }],
      occurrences: [{ id: randomUUID(), stageId, name: 'Test', positions: [{ id: randomUUID(), exercise: catalogExercise(entry), targets: [target] }] }] });
    expect(() => validateWorkoutDefaults(doc)).not.toThrow();
    expect(compatibleLoggingLoad(target.measurement, target, doc.occurrences[0].positions[0].exercise)).toBe(entry.loadKind === 'bodyweight');
  });
  it('preserves every released snapshot, aliases, defaults and zero interpretation', () => {
    for (const old of baseline) {
      const entry = catalog.find(e => e.id === old.id)!;
      expect(entry).toEqual(old);
      expect(catalogExercise(entry)).toEqual({ kind: 'catalogSnapshot', catalogVersion: 1, catalogId: old.id, name: old.name,
        variation: old.equipment.join(' + '), equipment: old.equipment, purpose: old.purpose,
        repBasis: old.repBasis, loadKind: old.loadKind, convention: old.convention });
    }
    expect(browseCatalog('DB bench', []).map(e => e.id)).toContain('t2:dumbbell-bench-press');
  });
  it('preserves the entire released starter prescription document', () => {
    let sequence = 0;
    const document = createHypertrophyPlan(() => '00000000-0000-4000-8000-' + String(++sequence).padStart(12, '0'));
    // Independently computed from 3a2e057d's plan-builder and frozen catalog.
    expect(createHash('sha256').update(canonicalJson(document)).digest('hex'))
      .toBe('653edd3f4a72220caaed53b5afbf29bb7a80bf7f5a2c40efd69d2ab8e539659b');
  });
  it.each(catalog.map(e => [e.id, e] as const))('%s can replace a position without changing START or target identity', (_id, entry) => {
    const occurrence = createHypertrophyPlan().occurrences[0], original = structuredClone(occurrence);
    const positions = occurrence.positions.map(p => ({ id: randomUUID(), sourcePositionId: p.id,
      targets: p.targets.map(t => ({ id: randomUUID(), sourceTargetId: t.id })) }));
    const execution = { initial: { occurrence, positions } } as Pick<ExecutionRead, 'initial'>;
    const content = replacementContent(execution, positions[0].id, entry);
    expect(content.exercise).toEqual(catalogExercise(entry));
    expect(content.targets.map(t => t.id)).toEqual(positions[0].targets.map(t => t.id));
    expect(content.targets.every(t => t.reps.basis === entry.repBasis)).toBe(true);
    expect(content.targets.every(t => t.measurement === null || entry.loadKind === 'bodyweight')).toBe(true);
    expect(occurrence).toEqual(original);
    expect(replacementContent(execution, positions[0].id, null).targets)
      .toEqual(original.positions[0].targets.map((t, i) => ({ ...t, id: positions[0].targets[i].id })));
  });
  it('reads historical snapshots without replacing them with current catalog data', () => {
    const stageId = randomUUID();
    const frozen = { ...catalogExercise(catalog.find(e => e.id === 't2:decline-barbell-bench-press')!), name: 'Captured historical label' };
    const doc = { schemaVersion: 1, name: 'Frozen', endpoint: 'endOfOrderedOccurrences', stages: [{ id: stageId, name: 'Test' }],
      occurrences: [{ id: randomUUID(), stageId, name: 'Test', positions: [{ id: randomUUID(), exercise: frozen, targets: [] }] }] };
    expect(readSavedDocument(doc)).toEqual(doc);
    expect(() => validateWorkoutDefaults(readSavedDocument(doc))).toThrow('INVALID_DOCUMENT');
  });
  it('expands captured rep defaults independently of a later catalog recommendation', () => {
    const entry = catalog.find(e => e.id === 't2:decline-barbell-bench-press')!;
    const frozen = catalogExercise(entry);
    const old = structuredClone(entry.reps);
    const prescription = createHypertrophyPlan().builder!.workouts[0].rows[0].prescription;
    try {
      entry.reps = { min: 25, max: 30 };
      const swapped = swapPrescription({ kind: 'authoredDescription', name: 'Earlier', variation: '' }, frozen, prescription);
      expect(swapped.reps).toEqual({ ...old, basis: 'total' });
    } finally { entry.reps = old; }
  });
  it('includes decline bench variations and honors stable identity through rename and filters', () => {
    for (const key of ['decline-barbell-bench-press', 'decline-dumbbell-bench-press', 'close-grip-bench-press']) {
      expect(browseCatalog('bench', []).map(e => e.id)).toContain('t2:' + key);
    }
    expect(browseCatalog('decline', ['Dumbbell', 'Bench']).map(e => e.id)).toEqual(['t2:decline-dumbbell-bench-press']);
    const source = shared.exercises.find(e => e.catalogKey === 'decline-dumbbell-bench-press')!;
    expect(normalizeCatalogEntry({ ...source, name: 'Unrelated display text' }).entry?.id).toBe('t2:' + source.catalogKey);
  });
  it('retains load/rep ambiguity barriers and zero policy in snapshots without a catalog lookup', () => {
    const exercise = catalogExercise(catalog.find(e => e.id === 't2:concentration-curl')!);
    expect(exercise.kind).toBe('catalogSnapshot');
    if (exercise.kind !== 'catalogSnapshot') throw new Error();
    const m = { kind: 'externalLoad' as const, value: '22.50', unit: 'kg' as const, convention: 'perImplement' as const, zeroMeaning: 'notAllowed' as const };
    const result = { reps: { value: 8, basis: 'perSide' as const }, measurement: m, rir: '2' };
    const target = { id: randomUUID(), classification: 'working' as const, required: true, reps: { min: 8, max: 15, basis: 'perSide' as const }, measurement: null, rir: null, restSeconds: null };
    expect(compatibleCatalogResult(result, exercise)).toBe(true);
    expect(compatibleCatalogResult({ ...result, reps: { value: 16, basis: 'total' } }, exercise)).toBe(false);
    expect(compatibleLoggingLoad(m, target, exercise)).toBe(true);
    expect(compatibleLoggingLoad({ ...m, convention: 'barbellTotal' }, target, exercise)).toBe(false);
    expect(compatibleLoggingLoad({ ...m, zeroMeaning: 'validZero' }, target, exercise)).toBe(false);
    expect(sameLoggingExercise(exercise, { ...exercise, repBasis: 'total' })).toBe(false);
    expect(sameLoggingExercise(exercise, { ...exercise, catalogFacts: { ...exercise.catalogFacts!, externalZeroMeaning: 'validZero' } })).toBe(false);
    expect(startingPounds(m)).toBe('50');
    expect(m.value).toBe('22.50');
    const assisted = catalogExercise(catalog.find(e => e.id === 't2:machine-assisted-pull-up')!);
    expect(compatibleLoggingLoad({ kind: 'addedLoad', value: '10', unit: 'lb', convention: 'addedExternal', zeroMeaning: 'noAddedLoad' }, target, assisted)).toBe(false);
  });
});
