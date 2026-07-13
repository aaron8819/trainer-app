import type { Exercise, WorkoutHistoryEntry } from "./types";
import {
  DEFAULT_UNKNOWN_MUSCLE_SRA_HOURS,
  MUSCLE_POLICIES,
} from "./muscle-policy";
import { PERFORMED_WORKOUT_STATUSES } from "@/lib/workout-status";

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
  const defaultSraWindows = buildDefaultSraWindows();

  // Find last trained time for each muscle
  const lastTrained = new Map<string, number>();
  const muscleLabels = new Map<string, string>();

  for (const entry of history) {
    const isPerformed =
      entry.status != null
        ? (PERFORMED_WORKOUT_STATUSES as readonly string[]).includes(entry.status)
        : entry.completed;
    if (!isPerformed) continue;
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
        const key = normalizeMuscleKey(muscle);
        if (!muscleLabels.has(key)) {
          muscleLabels.set(key, muscle);
        }
        const prev = lastTrained.get(key);
        if (!prev || entryMs > prev) {
          lastTrained.set(key, entryMs);
        }
      }
    }
  }

  const allMuscleKeys = new Set<string>([
    ...defaultSraWindows.keys(),
    ...lastTrained.keys(),
  ]);

  const recoveryMap = new Map<string, MuscleRecoveryState>();

  for (const muscleKey of allMuscleKeys) {
    const defaultSraWindow = defaultSraWindows.get(muscleKey);
    const muscle =
      muscleLabels.get(muscleKey) ??
      defaultSraWindow?.muscle ??
      muscleKey;
    const lastMs = lastTrained.get(muscleKey);
    const hoursAgo = lastMs !== undefined ? (nowMs - lastMs) / (1000 * 60 * 60) : null;
    const sraWindow =
      defaultSraWindow?.hours ?? DEFAULT_UNKNOWN_MUSCLE_SRA_HOURS;

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
  const recoveryByMuscleKey = new Map<string, MuscleRecoveryState>(
    Array.from(recoveryMap.values()).map((state) => [normalizeMuscleKey(state.muscle), state])
  );

  for (const muscle of targetMuscles) {
    const state = recoveryMap.get(muscle) ?? recoveryByMuscleKey.get(normalizeMuscleKey(muscle));
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

function buildDefaultSraWindows() {
  return new Map<string, { muscle: string; hours: number }>(
    MUSCLE_POLICIES.map((policy) => [
      normalizeMuscleKey(policy.displayName),
      { muscle: policy.displayName, hours: policy.defaultSraHours },
    ])
  );
}

function normalizeMuscleKey(muscle: string) {
  return muscle.trim().toLowerCase();
}
