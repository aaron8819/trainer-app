import { catalog, capturedRepDefaults, matchesCatalogSearch, type CatalogExercise } from './catalog-adapter';
export { catalog, library, matchesCatalogSearch } from './catalog-adapter';
export type { CatalogExercise } from './catalog-adapter';
import type { DraftDocument } from '../../trainer2-contracts/draft';
type Exercise = DraftDocument['occurrences'][number]['positions'][number]['exercise'];
type Prescription = Omit<DraftDocument['occurrences'][number]['positions'][number]['targets'][number], 'id'>;
export const equipmentOptions = [...new Set(catalog.flatMap(e => e.equipment))].sort();
export function catalogExercise(entry: CatalogExercise): Exercise {
  return { kind: 'catalogSnapshot', catalogVersion: 1, catalogId: entry.id, name: entry.name,
    variation: entry.variation ?? entry.equipment.join(' + '), equipment: [...entry.equipment], purpose: entry.purpose,
    repBasis: entry.repBasis as 'total' | 'perSide', loadKind: entry.loadKind as 'externalLoad' | 'bodyweight' | 'addedLoad' | 'assistance',
    convention: entry.convention,
    ...(entry.catalogFacts ? { catalogFacts: structuredClone(entry.catalogFacts) } : {}) };
}
export function browseCatalog(query: string, equipment: string[], current?: Exercise) {
  return catalog.filter(e => (!equipment.length || e.equipment.every(x => equipment.includes(x))) &&
    matchesCatalogSearch(e, query) &&
    (current?.kind !== 'catalogSnapshot' || e.id !== current.catalogId))
    .sort((a, b) => {
      const score = (e: CatalogExercise) => current?.kind === 'catalogSnapshot' && e.purpose === current.purpose ? 10 + Number(e.equipment.join() === current.equipment.join()) : 0;
      return score(b) - score(a) || a.name.localeCompare(b.name);
    });
}
// Values never transfer between exercises, even when their units happen to match.
export function swapPrescription(previous: Exercise, next: Exercise, prescription: Prescription): Prescription {
  const result = structuredClone(prescription);
  result.measurement = next.kind === 'catalogSnapshot' && next.loadKind === 'bodyweight' ? { kind: 'bodyweight', convention: 'bodyweightOnly' } : null;
  if (next.kind === 'catalogSnapshot' && (previous.kind !== 'catalogSnapshot' || previous.repBasis !== next.repBasis || previous.purpose !== next.purpose)) {
    const defaults = capturedRepDefaults(next);
    if (!defaults) throw new Error('UNSUPPORTED_MEASUREMENT');
    result.reps = { ...defaults, basis: next.repBasis };
  }
  return result;
}
