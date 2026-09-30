import shared from '../../../../prisma/exercises_comprehensive.json';
import qualifiedV1 from './qualified-catalog-v1.json';
import { frozenMeasurementSnapshot, assertFrozenMeasurementSnapshotInvariant } from '../../exercise-measurement/semantics';
import { deriveLoadEntryPolicy } from '../../exercise-measurement/load-entry-policy';
import type { DraftDocument } from '../../trainer2-contracts/draft';

type Exercise = Extract<DraftDocument['occurrences'][number]['positions'][number]['exercise'], { kind: 'catalogSnapshot' }>;
export type CatalogExercise = {
  id: string; name: string; equipment: string[]; purpose: string; aliases: string[];
  repBasis: Exercise['repBasis']; loadKind: Exercise['loadKind']; convention: Exercise['convention'];
  reps: { min: number; max: number }; catalogFacts?: Exercise['catalogFacts'];
};
type Source = {
  catalogKey: string; name: string; equipment: string[]; movementPatterns: string[];
  primaryMuscles: string[]; secondaryMuscles: string[];
  repRangeRecommendation?: { min: number; max: number };
  measurementProfile?: string | null; loadConvention?: string | null; repBasis?: string | null;
  zeroLoadMeaning?: string | null;
};
const legacy = new Map(qualifiedV1.map(e => [e.id, e]));
const conventions = {
  BARBELL_TOTAL: 'barbellTotal', IMPLEMENT_WEIGHT: 'perImplement', MACHINE_DISPLAYED: 'machineDisplayed',
  ADDED_EXTERNAL_LOAD: 'addedExternal', DISPLAYED_ASSISTANCE: 'displayedAssistance',
} as const;
const kinds = {
  REPS_EXTERNAL_LOAD: 'externalLoad', REPS_BODYWEIGHT: 'bodyweight',
  REPS_BODYWEIGHT_PLUS_LOAD: 'addedLoad', REPS_ASSISTED: 'assistance',
} as const;
const timedOrDistance = new Set(['copenhagen-plank', 'dead-hang', 'farmers-walk', 'overhead-carry', 'plank',
  'rkc-plank', 'side-plank', 'sled-drag', 'sled-pull', 'sled-push', 'suitcase-carry']);
const angledLoad = new Set(['landmine-press', 'landmine-rotation', 'meadows-row']);

// Only canonical keys establish identity. A missing tuple is never inferred from a name or equipment.
export function normalizeCatalogEntry(source: Source) {
  const id = `t2:${source.catalogKey}`;
  const missing = ['measurementProfile', 'repBasis', ...(source.measurementProfile === 'REPS_BODYWEIGHT' ? [] : ['loadConvention'])]
    .filter(field => source[field as keyof Source] == null);
  let unavailableReason: string | null = missing.length ? `Reviewed measurement definition missing: ${missing.join(', ')}.` : null;
  if (unavailableReason && timedOrDistance.has(source.catalogKey)) unavailableReason = 'Duration or distance recording is not supported.';
  if (unavailableReason && angledLoad.has(source.catalogKey)) unavailableReason = 'Angled-bar load convention is not supported or reviewed.';
  let measurement;
  let externalZeroMeaning: 'validZero' | 'notAllowed' | null = null;
  try {
    const snapshot = assertFrozenMeasurementSnapshotInvariant(frozenMeasurementSnapshot(source));
    measurement = snapshot.measurement;
    if (measurement?.profile === 'REPS_EXTERNAL_LOAD') externalZeroMeaning = deriveLoadEntryPolicy(snapshot).zeroAllowed ? 'validZero' : 'notAllowed';
  } catch { unavailableReason = 'Conflicting or unsupported reviewed measurement definition.'; }
  const reps = source.repRangeRecommendation;
  if (!unavailableReason && (!reps || !Number.isInteger(reps.min) || !Number.isInteger(reps.max) ||
    reps.min < 1 || reps.min > reps.max || reps.max > 1000)) unavailableReason = 'Reviewed rep prescription defaults are missing or invalid.';
  if (!unavailableReason && (!source.equipment.length || !source.movementPatterns.length)) unavailableReason = 'Equipment or movement definition is missing.';
  let entry: CatalogExercise | null = null;
  if (!unavailableReason && measurement && reps) {
    const old = legacy.get(id);
    // The released v1 contract is frozen, including purpose groups and narrower equipment.
    // It is a compatibility overlay, never the membership list for today's catalog.
    entry = old ? { ...old, repBasis: old.repBasis as CatalogExercise['repBasis'],
      loadKind: old.loadKind as CatalogExercise['loadKind'], convention: old.convention as CatalogExercise['convention'] } : {
      id, name: source.name, equipment: [...source.equipment], purpose: source.movementPatterns.join(' + '), aliases: [],
      repBasis: measurement.repBasis === 'PER_SIDE' ? 'perSide' : 'total',
      loadKind: kinds[measurement.profile],
      convention: measurement.profile === 'REPS_BODYWEIGHT' ? 'bodyweightOnly' : conventions[measurement.loadConvention],
      reps: { ...reps },
      catalogFacts: { movementPatterns: [...source.movementPatterns], primaryMuscles: [...source.primaryMuscles],
        secondaryMuscles: [...source.secondaryMuscles],
        externalZeroMeaning, repDefaults: { ...reps } },
    };
  }
  return { catalogKey: source.catalogKey, catalogId: id, name: source.name, equipment: entry?.equipment ?? [...source.equipment],
    movementPatterns: [...source.movementPatterns], primaryMuscles: [...source.primaryMuscles], secondaryMuscles: [...source.secondaryMuscles],
    aliases: entry?.aliases ?? [], selectable: !!entry, unavailableReason, entry };
}
export const library = shared.exercises.map(normalizeCatalogEntry);
export const catalog: CatalogExercise[] = library.flatMap(e => e.entry ? [e.entry] : []);
// Historical builder expansion must not resolve today's defaults.
export function capturedRepDefaults(exercise: Exercise) {
  return exercise.catalogFacts?.repDefaults ?? legacy.get(exercise.catalogId)?.reps;
}
export function matchesCatalogSearch(entry: { name: string; aliases: string[] }, query: string) {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  return [entry.name, ...entry.aliases].some(s => normalize(s).includes(normalize(query)));
}
