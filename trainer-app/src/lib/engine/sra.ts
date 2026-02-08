import type { Exercise, WorkoutHistoryEntry } from "./types";
import { VOLUME_LANDMARKS } from "./volume-landmarks";

export type MuscleRecoveryState = {
  muscle: string;
  lastTrainedHoursAgo: number | null;
  sraWindowHours: number;
  isRecovered: boolean;
  recoveryPercent: number;
};

export type SraWarning = {
  muscle: string;
  lastTrainedHoursAgo: number;
  sraWindowHours: number;
  recoveryPercent: number;
};

export function buildMuscleRecoveryMap(
  history: WorkoutHistoryEntry[],
  exerciseLibrary: Exercise[],
  now?: Date
): Map<string, MuscleRecoveryState> {
  const nowMs = (now ?? new Date()).getTime();
  const byId = new Map(exerciseLibrary.map((e) => [e.id, e]));

  // Find last trained time for each muscle
  const lastTrained = new Map<string, number>();

  for (const entry of history) {
    if (!entry.completed) continue;
    const entryMs = new Date(entry.date).getTime();

    for (const ex of entry.exercises) {
      const exercise = byId.get(ex.exerciseId);
      if (!exercise) continue;

      const muscles = [
        ...(exercise.primaryMuscles ?? []),
        ...(ex.primaryMuscles ?? []),
      ];
      const uniqueMuscles = [...new Set(muscles)];

      for (const muscle of uniqueMuscles) {
        const prev = lastTrained.get(muscle);
        if (!prev || entryMs > prev) {
          lastTrained.set(muscle, entryMs);
        }
      }
    }
  }

  const recoveryMap = new Map<string, MuscleRecoveryState>();

  for (const [muscle, landmark] of Object.entries(VOLUME_LANDMARKS)) {
    const lastMs = lastTrained.get(muscle);
    const hoursAgo = lastMs !== undefined ? (nowMs - lastMs) / (1000 * 60 * 60) : null;
    const sraWindow = landmark.sraHours;

    let recoveryPercent = 100;
    if (hoursAgo !== null) {
      recoveryPercent = Math.min(100, Math.round((hoursAgo / sraWindow) * 100));
    }

    recoveryMap.set(muscle, {
      muscle,
      lastTrainedHoursAgo: hoursAgo !== null ? Math.round(hoursAgo) : null,
      sraWindowHours: sraWindow,
      isRecovered: recoveryPercent >= 100,
      recoveryPercent,
    });
  }

  return recoveryMap;
}

export function generateSraWarnings(
  recoveryMap: Map<string, MuscleRecoveryState>,
  targetMuscles: string[]
): SraWarning[] {
  const warnings: SraWarning[] = [];

  for (const muscle of targetMuscles) {
    const state = recoveryMap.get(muscle);
    if (!state || state.isRecovered || state.lastTrainedHoursAgo === null) continue;

    warnings.push({
      muscle: state.muscle,
      lastTrainedHoursAgo: state.lastTrainedHoursAgo,
      sraWindowHours: state.sraWindowHours,
      recoveryPercent: state.recoveryPercent,
    });
  }

  return warnings;
}
