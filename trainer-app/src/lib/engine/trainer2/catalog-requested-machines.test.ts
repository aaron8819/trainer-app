import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import shared from '../../../../prisma/exercises_comprehensive.json';
import { exerciseTitle } from '../../../components/trainer2/exercise-title';
import { browseCatalog, catalog, catalogExercise, swapPrescription } from './catalog';
import {
  compatibleCatalogResult, compatibleLoggingLoad, sameLoggingExercise,
} from './logging-prefill';
import type { PerformedResult } from '../../trainer2-contracts/set-results';

function load(value: string, convention: 'machinePlatesPerArm' | 'machineAddedPlatesTotal'):
  Extract<NonNullable<PerformedResult['measurement']>, { kind: 'externalLoad' }> {
  return { kind: 'externalLoad', value, unit: 'lb', convention, zeroMeaning: 'validZero' };
}

const movements = ['low-row', 'front-lat-pulldown', 'high-row'] as const;

describe('requested iso-lateral execution identities', () => {
  it.each(movements)('%s keeps single-arm and combined bilateral records distinct', movement => {
    const source = shared.exercises.find(e => e.catalogKey === `iso-lateral-${movement}`)!;
    const singleEntry = catalog.find(e => e.id === `t2:single-arm-iso-lateral-${movement}`)!;
    const bothEntry = catalog.find(e =>
      e.id === `t2:bilateral-iso-lateral-${movement}-total-plates`)!;
    const single = catalogExercise(singleEntry), both = catalogExercise(bothEntry);
    if (single.kind !== 'catalogSnapshot' || both.kind !== 'catalogSnapshot') {
      throw new Error('Expected catalog snapshots');
    }
    expect(single.repBasis).toBe('perSide');
    expect(single.convention).toBe('machinePlatesPerArm');
    expect(both.repBasis).toBe('total');
    expect(both.convention).toBe('machineAddedPlatesTotal');
    for (const entry of [singleEntry, bothEntry]) {
      expect(entry.equipment).toEqual(['Machine']);
      expect(entry.catalogFacts?.movementPatterns).toEqual(source.movementPatterns);
      expect(entry.catalogFacts?.primaryMuscles).toEqual(source.primaryMuscles);
      expect(entry.catalogFacts?.secondaryMuscles).toEqual(source.secondaryMuscles);
      expect(entry.reps).toEqual(source.repRangeRecommendation);
      expect(entry.catalogFacts?.externalZeroMeaning).toBe('validZero');
      expect(exerciseTitle(entry)).not.toMatch(/plates|weight|per arm/i);
    }
    expect(single.variation).toContain('Count reps per arm');
    expect(both.variation).toContain('one bilateral rep');
    const target = { id: randomUUID(), classification: 'working' as const, required: true,
      reps: { min: 8, max: 10, basis: 'perSide' as const },
      measurement: load('45', 'machinePlatesPerArm'), rir: '2', restSeconds: null };
    expect(compatibleCatalogResult({ reps: { value: 8, basis: 'perSide' },
      measurement: target.measurement, rir: '2' }, single)).toBe(true);
    expect(compatibleCatalogResult({ reps: { value: 8, basis: 'total' },
      measurement: load('90', 'machineAddedPlatesTotal'), rir: '2' }, both)).toBe(true);
    expect(compatibleLoggingLoad(target.measurement, { ...target, measurement: null }, both))
      .toBe(false);
    expect(compatibleLoggingLoad(load('90', 'machineAddedPlatesTotal'),
      { ...target, measurement: null }, single)).toBe(false);
    expect(sameLoggingExercise(single, both)).toBe(false);
    const swapped = swapPrescription(single, both, target);
    expect(swapped.measurement).toBeNull();
    expect(swapped.reps).toEqual({ ...source.repRangeRecommendation, basis: 'total' });
    for (const snapshot of [single, both]) {
      expect(compatibleCatalogResult({ reps: { value: 8, basis: snapshot.repBasis },
        measurement: load('0', snapshot.convention as
          'machinePlatesPerArm' | 'machineAddedPlatesTotal'), rir: null }, snapshot)).toBe(true);
    }
  });

  it('retains released bilateral per-arm row definitions without reinterpreting them', () => {
    for (const [existingId, newId] of [
      ['t2:iso-lateral-low-row-plates-per-arm', 't2:single-arm-iso-lateral-low-row'],
      ['t2:chest-supported-machine-high-row-plates-per-arm',
        't2:single-arm-iso-lateral-high-row'],
    ]) {
      const old = catalogExercise(catalog.find(e => e.id === existingId)!);
      const current = catalogExercise(catalog.find(e => e.id === newId)!);
      if (old.kind !== 'catalogSnapshot') throw new Error('Expected catalog snapshot');
      expect(old.repBasis).toBe('total');
      expect(old.convention).toBe('machinePlatesPerArm');
      expect(sameLoggingExercise(old, current)).toBe(false);
    }
  });
});

it('reuses the stack row for diverging-row search rather than duplicating its identity', () => {
  expect(browseCatalog('diverging seated row', ['Machine']).map(e => e.id))
    .toEqual(['t2:chest-supported-machine-row-stack']);
  const row = catalog.find(e => e.id === 't2:chest-supported-machine-row-stack')!;
  expect(row.convention).toBe('machineDisplayed');
  expect(row.repBasis).toBe('total');
  expect(row.catalogFacts?.movementPatterns).toEqual(['horizontal_pull']);
});

it('defines the machine glute bridge independently from floor bodyweight work', () => {
  const entry = catalog.find(e => e.id === 't2:plate-loaded-glute-bridge-trainer')!;
  const source = shared.exercises.find(e => e.catalogKey === 'machine-hip-thrust')!;
  expect(entry.name).toBe('Glute Bridge Trainer');
  expect(entry.equipment).toEqual(['Machine']);
  expect(entry.repBasis).toBe('total');
  expect(entry.convention).toBe('machineAddedPlatesTotal');
  expect(entry.catalogFacts?.movementPatterns).toEqual(['hinge']);
  expect(entry.catalogFacts?.primaryMuscles).toEqual(source.primaryMuscles);
  expect(entry.catalogFacts?.secondaryMuscles).toEqual(source.secondaryMuscles);
  expect(entry.reps).toEqual(source.repRangeRecommendation);
  expect(entry.catalogFacts?.externalZeroMeaning).toBe('validZero');
  expect(browseCatalog('machine glute bridge', ['Machine']).map(e => e.id)).toEqual([entry.id]);
  expect(browseCatalog('machine glute bridge', ['Bodyweight'])).toEqual([]);
  const machine = catalogExercise(entry);
  const floor = catalogExercise(catalog.find(e => e.id === 't2:bodyweight-glute-bridge')!);
  expect(sameLoggingExercise(machine, floor)).toBe(false);
  expect(compatibleCatalogResult({ reps: { value: 8, basis: 'total' },
    measurement: { kind: 'bodyweight', convention: 'bodyweightOnly' }, rir: null }, machine))
    .toBe(false);
});
