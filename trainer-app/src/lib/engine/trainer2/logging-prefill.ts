import type { DraftDocument } from '../../trainer2-contracts/draft';
import type { PerformedResult } from '../../trainer2-contracts/set-results';
import { canonicalJson } from '../../trainer2-contracts/canonical-json';
type Position = DraftDocument['occurrences'][number]['positions'][number];
// New catalog definitions carry their reviewed recording policy. Legacy snapshots
// and authored descriptions retain the released free-evidence behavior.
export function compatibleCatalogResult(result: PerformedResult | null, exercise: Position['exercise']) {
  if (!result || exercise.kind !== 'catalogSnapshot' || !exercise.catalogFacts) return true;
  const m = result.measurement;
  return (!result.reps || result.reps.basis === exercise.repBasis) && (!m ||
    (m.kind === exercise.loadKind && m.convention === exercise.convention &&
      (m.kind !== 'externalLoad' || m.zeroMeaning === exercise.catalogFacts.externalZeroMeaning)));
}
export function sameLoggingExercise(a: Position['exercise'], b: Position['exercise']) {
  return a.kind === 'catalogSnapshot' && b.kind === 'catalogSnapshot' &&
    a.catalogId === b.catalogId && a.catalogVersion === b.catalogVersion && a.variation === b.variation &&
    a.loadKind === b.loadKind && a.convention === b.convention && a.repBasis === b.repBasis &&
    a.catalogFacts?.externalZeroMeaning === b.catalogFacts?.externalZeroMeaning &&
    canonicalJson(a.equipmentSetup ?? null) === canonicalJson(b.equipmentSetup ?? null) &&
    JSON.stringify([...a.equipment].sort()) === JSON.stringify([...b.equipment].sort());
}
export function compatibleLoggingLoad(m: PerformedResult['measurement'], target: Position['targets'][number], exercise: Position['exercise']) {
  if (!m) return false;
  const expected = target.measurement;
  if (expected) return m.kind === expected.kind && m.convention === expected.convention &&
    (m.kind !== 'externalLoad' || expected.kind !== 'externalLoad' || m.zeroMeaning === expected.zeroMeaning);
  return exercise.kind === 'catalogSnapshot' && m.kind === exercise.loadKind && m.convention === exercise.convention &&
    (m.kind !== 'externalLoad' || m.zeroMeaning === (exercise.catalogFacts?.externalZeroMeaning ?? 'validZero'));
}
// Suggestions only: use unrounded mass for the nearest-five calculation; positive ties round up.
export function startingPounds(m: NonNullable<PerformedResult['measurement']>) {
  return 'value' in m ? String(Math.round((Number(m.value) / (m.unit === 'kg' ? 0.45359237 : 1)) / 5) * 5) : null;
}
