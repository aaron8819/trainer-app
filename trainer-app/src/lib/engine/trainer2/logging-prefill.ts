import type { DraftDocument } from '../../trainer2-contracts/draft';
import type { PerformedResult } from '../../trainer2-contracts/set-results';
type Position = DraftDocument['occurrences'][number]['positions'][number];
export function sameLoggingExercise(a: Position['exercise'], b: Position['exercise']) {
  return a.kind === 'catalogSnapshot' && b.kind === 'catalogSnapshot' &&
    a.catalogId === b.catalogId && a.catalogVersion === b.catalogVersion && a.variation === b.variation &&
    a.loadKind === b.loadKind && a.convention === b.convention && a.repBasis === b.repBasis &&
    JSON.stringify([...a.equipment].sort()) === JSON.stringify([...b.equipment].sort());
}
export function compatibleLoggingLoad(m: PerformedResult['measurement'], target: Position['targets'][number], exercise: Position['exercise']) {
  if (!m) return false;
  const expected = target.measurement;
  if (expected) return m.kind === expected.kind && m.convention === expected.convention &&
    (m.kind !== 'externalLoad' || expected.kind !== 'externalLoad' || m.zeroMeaning === expected.zeroMeaning);
  return exercise.kind === 'catalogSnapshot' && m.kind === exercise.loadKind && m.convention === exercise.convention &&
    (m.kind !== 'externalLoad' || m.zeroMeaning === 'validZero');
}
// Suggestions only: use unrounded mass for the nearest-five calculation; positive ties round up.
export function startingPounds(m: NonNullable<PerformedResult['measurement']>) {
  return 'value' in m ? String(Math.round((Number(m.value) / (m.unit === 'kg' ? 0.45359237 : 1)) / 5) * 5) : null;
}
