import { library, matchesCatalogSearch } from '@/lib/engine/trainer2/catalog';
import { isSingleArmRecording, recordingFamily } from './recording-display';

export function swapOptions(currentId: string | undefined, query: string, equipment: string) {
  const current = library.find(e => e.catalogId === currentId);
  const family = recordingFamily(currentId ?? '');
  const score = (entry: typeof library[number]) => current ?
    entry.movementPatterns.filter(m => current.movementPatterns.includes(m)).length * 100 +
    entry.primaryMuscles.filter(m => current.primaryMuscles.includes(m)).length * 10 +
    entry.secondaryMuscles.filter(m => current.secondaryMuscles.includes(m)).length * 2 +
    entry.equipment.filter(m => current.equipment.includes(m)).length : 0;
  const sameFamily = (id: string) => !!family && recordingFamily(id) === family;
  return library.filter(e => e.catalogId !== currentId && matchesCatalogSearch(e, query) &&
    (!equipment || e.equipment.includes(equipment)))
    .sort((a, b) => Number(b.selectable) - Number(a.selectable) ||
      score(b) - score(a) ||
      Number(sameFamily(b.catalogId)) - Number(sameFamily(a.catalogId)) ||
      (sameFamily(a.catalogId) && sameFamily(b.catalogId) ?
        Number(isSingleArmRecording(b.catalogId)) - Number(isSingleArmRecording(a.catalogId)) : 0) ||
      a.name.localeCompare(b.name) || a.catalogId.localeCompare(b.catalogId));
}
