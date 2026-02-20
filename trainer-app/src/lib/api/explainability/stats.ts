import { VOLUME_LANDMARKS } from "@/lib/engine/volume-landmarks";

export const SECONDARY_VOLUME_MULTIPLIER = 0.3;
export const MRV_WARNING_THRESHOLD = 0.9;

export function computeVolumeSpikePercent(currentEffectiveSets: number, baselineEffectiveSets: number[]): number | undefined {
  if (!Number.isFinite(currentEffectiveSets) || baselineEffectiveSets.length === 0) {
    return undefined;
  }
  const baselineAverage =
    baselineEffectiveSets.reduce((sum, value) => sum + value, 0) / baselineEffectiveSets.length;
  if (baselineAverage <= 0) {
    return undefined;
  }
  return Math.round(((currentEffectiveSets - baselineAverage) / baselineAverage) * 100);
}

export function computeMusclesApproachingMRV(
  weeklyEffectiveVolumeByMuscle: Map<string, number>,
  threshold: number = MRV_WARNING_THRESHOLD
): string[] {
  const approaching: string[] = [];
  for (const [muscle, effectiveSets] of weeklyEffectiveVolumeByMuscle.entries()) {
    const landmarks = VOLUME_LANDMARKS[muscle];
    if (!landmarks || landmarks.mrv <= 0) {
      continue;
    }
    if (effectiveSets / landmarks.mrv >= threshold) {
      approaching.push(muscle);
    }
  }
  return approaching.sort((a, b) => a.localeCompare(b));
}

export function hasPRPotential(
  plannedByExercise: Map<string, { maxLoad: number | null; maxReps: number | null }>,
  historyMaxByExercise: Map<string, { maxLoad: number | null; maxReps: number | null }>
): boolean {
  for (const [exerciseId, planned] of plannedByExercise.entries()) {
    const historical = historyMaxByExercise.get(exerciseId);
    if (!historical) {
      continue;
    }

    if (
      planned.maxLoad != null &&
      historical.maxLoad != null &&
      planned.maxLoad >= historical.maxLoad * 0.97
    ) {
      return true;
    }
    if (
      planned.maxLoad == null &&
      planned.maxReps != null &&
      historical.maxReps != null &&
      planned.maxReps > historical.maxReps
    ) {
      return true;
    }
  }
  return false;
}
