import type { CatalogExercise } from '@/lib/engine/trainer2/catalog';

type RecordingExercise = Pick<CatalogExercise, 'repBasis' | 'convention' | 'loadKind'> & {
  id?: string;
  catalogId?: string;
};

// Presentation groups for the three reviewed iso-lateral machines, not exercise identity.
const families: Readonly<Record<string, readonly string[]>> = {
  low: [
    't2:single-arm-iso-lateral-low-row',
    't2:bilateral-iso-lateral-low-row-total-plates',
    't2:iso-lateral-low-row-plates-per-arm',
  ],
  front: [
    't2:single-arm-iso-lateral-front-lat-pulldown',
    't2:bilateral-iso-lateral-front-lat-pulldown-total-plates',
  ],
  high: [
    't2:single-arm-iso-lateral-high-row',
    't2:bilateral-iso-lateral-high-row-total-plates',
    't2:chest-supported-machine-high-row-plates-per-arm',
  ],
};

export function recordingFamily(id: string): string | undefined {
  return Object.keys(families).find(key => families[key].includes(id));
}

export function isSingleArmRecording(id: string): boolean {
  return Object.values(families).some(ids => ids[0] === id);
}

export function recordingSubtitle(exercise: RecordingExercise): string {
  const load = exercise.loadKind === 'bodyweight' ? 'Bodyweight' :
    exercise.loadKind === 'addedLoad' ? 'Added load' :
    exercise.loadKind === 'assistance' ? 'Displayed assistance' :
    {
      barbellTotal: 'Barbell total',
      perImplement: 'Per implement',
      machineDisplayed: 'Stack setting',
      machinePlatesPerArm: 'Plates per arm',
      machineAddedPlatesTotal: 'Combined plates',
      smithPlatesTotal: 'Total Smith plates',
      bodyweightOnly: 'Bodyweight',
      addedExternal: 'Added load',
      displayedAssistance: 'Displayed assistance',
    }[exercise.convention];
  const reps = exercise.repBasis === 'perSide' ?
    isSingleArmRecording(exercise.catalogId ?? exercise.id ?? '') ?
      'Reps per arm' : 'Reps per side' : 'Total reps';
  return `${load} · ${reps}`;
}

export function recordingTip(exercise: RecordingExercise): string | undefined {
  const id = exercise.catalogId ?? exercise.id ?? '';
  if (!recordingFamily(id)) return undefined;
  if (exercise.convention === 'machinePlatesPerArm') {
    return exercise.repBasis === 'perSide' ?
      'Enter plates on one arm: 45 lb on the working arm → enter 45 lb. Exclude starting resistance.' :
      'Enter plates per arm: 45 lb on each arm → enter 45 lb. Exclude starting resistance.';
  }
  if (exercise.convention === 'machineAddedPlatesTotal') {
    return 'Enter plates across both arms: 45 lb on each arm → enter 90 lb. Exclude starting resistance.';
  }
  return undefined;
}

export function unavailableRecordingCopy(reason: string | null): string {
  if (reason?.includes('Duration or distance')) return 'Timed and distance logging is not available.';
  return 'Not available for logging yet. Choose a reviewed variant from the results above.';
}

// Reorder only the slots already occupied by each family. Unrelated results stay in place.
export function orderRecordingVariants(entries: CatalogExercise[]): CatalogExercise[] {
  const result = [...entries];
  for (const family of Object.keys(families)) {
    const indices = entries.flatMap((e, i) => recordingFamily(e.id) === family ? [i] : []);
    const ordered = indices.map(i => entries[i])
      .sort((a, b) => Number(isSingleArmRecording(b.id)) - Number(isSingleArmRecording(a.id)));
    indices.forEach((index, i) => { result[index] = ordered[i]; });
  }
  return result;
}
