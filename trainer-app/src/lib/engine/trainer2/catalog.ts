import snapshot from './catalog-snapshot.json';
import type { DraftDocument } from '../../trainer2-contracts/draft';
type Exercise = DraftDocument['occurrences'][number]['positions'][number]['exercise'];
type Prescription = Omit<DraftDocument['occurrences'][number]['positions'][number]['targets'][number], 'id'>;
export type CatalogExercise = typeof snapshot[number];
export const catalog = snapshot;
export const equipmentOptions = [...new Set(catalog.flatMap(e => e.equipment))].sort();
export function catalogExercise(entry: CatalogExercise): Exercise {
  return { kind: 'catalogSnapshot', catalogVersion: 1, catalogId: entry.id, name: entry.name,
    variation: entry.equipment.join(' + '), equipment: [...entry.equipment], purpose: entry.purpose,
    repBasis: entry.repBasis as 'total' | 'perSide', loadKind: entry.loadKind as 'externalLoad' | 'bodyweight' | 'addedLoad' | 'assistance',
    convention: entry.convention as 'barbellTotal' | 'perImplement' | 'machineDisplayed' | 'bodyweightOnly' | 'addedExternal' | 'displayedAssistance' };
}
export function browseCatalog(query: string, equipment: string[], current?: Exercise) {
  const search = query.toLowerCase().replace(/[^a-z0-9]/g, '');
  return catalog.filter(e => (!equipment.length || e.equipment.every(x => equipment.includes(x))) &&
    [e.name, ...e.aliases].some(s => s.toLowerCase().replace(/[^a-z0-9]/g, '').includes(search)) &&
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
    const entry = catalog.find(e => e.id === next.catalogId);
    result.reps = { min: entry?.reps.min ?? 8, max: entry?.reps.max ?? 12, basis: next.repBasis };
  }
  return result;
}
