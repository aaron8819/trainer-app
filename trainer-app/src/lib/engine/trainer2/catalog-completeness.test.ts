import { describe, expect, it } from 'vitest';
import shared from '../../../../prisma/exercises_comprehensive.json';
import program from './program-catalog.json';
import { catalog, catalogExercise, library } from './catalog';
import { compatibleCatalogResult, sameLoggingExercise } from './logging-prefill';

const variants = [
  ['straight-bar-curl', 'barbell-curl', 'BARBELL_TOTAL', 'barbellTotal'],
  ['simultaneous-incline-dumbbell-curl', 'incline-dumbbell-curl',
    'IMPLEMENT_WEIGHT', 'perImplement'],
  ['two-hand-single-dumbbell-overhead-extension', 'overhead-dumbbell-extension',
    'IMPLEMENT_WEIGHT', 'perImplement'],
  ['ez-bar-skull-crusher', 'lying-triceps-extension-skull-crusher',
    'BARBELL_TOTAL', 'barbellTotal'],
] as const;

describe('bounded common gym variants', () => {
  it.each(variants)('%s captures explicit execution and inherited source facts',
    (key, sourceKey, convention, normalized) => {
      const source = shared.exercises.find(e => e.catalogKey === sourceKey)!;
      const variant = program.find(e => e.catalogKey === key)!;
      const entry = catalog.find(e => e.id === `t2:${key}`)!;
      expect(variant.loadConvention).toBe(convention);
      expect(variant.repBasis).toBe('TOTAL');
      expect(variant.primaryMuscles).toEqual(source.primaryMuscles);
      expect(variant.secondaryMuscles).toEqual(source.secondaryMuscles);
      expect(variant.movementPatterns).toEqual(source.movementPatterns);
      expect(variant.repRangeRecommendation).toEqual(source.repRangeRecommendation);
      expect(entry.convention).toBe(normalized);
      expect(entry.repBasis).toBe('total');
      expect(entry.catalogFacts?.externalZeroMeaning).toBe('notAllowed');
      expect(entry.name).not.toMatch(/\b(weight|pounds|plates|total|per arm)\b/i);
      // Generic ambiguous sources stay excluded rather than acquiring guessed semantics.
      expect(library.find(e => e.catalogKey === sourceKey)?.selectable).toBe(false);
      const snapshot = catalogExercise(entry);
      if (snapshot.kind !== 'catalogSnapshot') throw new Error('Expected catalog snapshot');
      const result = { reps: { value: 10, basis: 'total' as const }, rir: null,
        measurement: { kind: 'externalLoad' as const, convention: entry.convention as
          'barbellTotal' | 'perImplement', zeroMeaning: 'notAllowed' as const,
        value: '25', unit: 'lb' as const } };
      expect(compatibleCatalogResult(result, snapshot)).toBe(true);
      expect(compatibleCatalogResult({ ...result, reps: { value: 10, basis: 'perSide' } },
        snapshot)).toBe(false);
      expect(compatibleCatalogResult({ ...result, measurement: {
        ...result.measurement, convention: 'machineDisplayed' } }, snapshot)).toBe(false);
      expect(sameLoggingExercise(snapshot, { ...snapshot, catalogId: `t2:${sourceKey}` }))
        .toBe(false);
    });

  it('has unique stable keys and complete selectable muscle metadata', () => {
    expect(new Set(library.map(e => e.catalogId)).size).toBe(library.length);
    for (const entry of catalog.filter(e => e.catalogFacts)) {
      expect(entry.catalogFacts!.primaryMuscles.length).toBeGreaterThan(0);
      expect(new Set(entry.equipment).size).toBe(entry.equipment.length);
      expect(new Set(entry.catalogFacts!.primaryMuscles).size)
        .toBe(entry.catalogFacts!.primaryMuscles.length);
    }
  });
});
