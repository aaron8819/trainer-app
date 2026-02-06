import type {
  Exercise,
  FatigueState,
  SessionCheckIn,
  WorkoutExercise,
  WorkoutHistoryEntry,
} from "./types";
import { buildAccessoryMuscleCounts, scoreAccessoryRetention } from "./timeboxing";

export type VolumeContext = {
  recent: Record<string, number>;
  previous: Record<string, number>;
};

export function buildVolumeContext(
  history: WorkoutHistoryEntry[],
  exerciseLibrary: Exercise[]
): VolumeContext {
  const byId = new Map(exerciseLibrary.map((exercise) => [exercise.id, exercise]));
  const now = Date.now();
  const windowMs = 7 * 24 * 60 * 60 * 1000;

  const recent: Record<string, number> = {};
  const previous: Record<string, number> = {};

  for (const entry of history) {
    const entryTime = new Date(entry.date).getTime();
    const delta = now - entryTime;
    const target = delta <= windowMs ? recent : delta <= windowMs * 2 ? previous : undefined;
    if (!target) {
      continue;
    }
    for (const exerciseEntry of entry.exercises) {
      const exercise = byId.get(exerciseEntry.exerciseId);
      if (!exercise) {
        continue;
      }
      const muscles = exercise.primaryMuscles ?? [];
      const setsCount = exerciseEntry.sets.length;
      for (const muscle of muscles) {
        target[muscle] = (target[muscle] ?? 0) + setsCount;
      }
    }
  }

  return { recent, previous };
}

export function enforceVolumeCaps(
  accessories: WorkoutExercise[],
  mainLifts: WorkoutExercise[],
  volumeContext: VolumeContext
) {
  if (accessories.length === 0) {
    return accessories;
  }

  const buildPlannedVolume = (currentAccessories: WorkoutExercise[]) => {
    const planned: Record<string, number> = { ...volumeContext.recent };
    const addExercise = (exercise: WorkoutExercise) => {
      const muscles = exercise.exercise.primaryMuscles ?? [];
      if (muscles.length === 0) {
        return;
      }
      for (const muscle of muscles) {
        planned[muscle] = (planned[muscle] ?? 0) + exercise.sets.length;
      }
    };
    [...mainLifts, ...currentAccessories].forEach(addExercise);
    return planned;
  };

  const exceedsCap = (planned: Record<string, number>) => {
    return Object.entries(planned).some(([muscle, sets]) => {
      const baseline = volumeContext.previous[muscle];
      if (!baseline || baseline <= 0) {
        return false;
      }
      return sets > baseline * 1.2;
    });
  };

  const adjusted = [...accessories];
  while (adjusted.length > 0) {
    const planned = buildPlannedVolume(adjusted);
    if (!exceedsCap(planned)) {
      break;
    }
    const coveredMuscles = new Set(
      mainLifts.flatMap((exercise) => exercise.exercise.primaryMuscles ?? [])
    );
    const muscleCounts = buildAccessoryMuscleCounts(adjusted);
    const scored = adjusted
      .map((exercise, idx) => ({
        idx,
        score: scoreAccessoryRetention(exercise, coveredMuscles, muscleCounts),
      }))
      .sort((a, b) => a.score - b.score);
    adjusted.splice(scored[0].idx, 1);
  }

  return adjusted;
}

export function deriveFatigueState(history: WorkoutHistoryEntry[], checkIn?: SessionCheckIn): FatigueState {
  const last = history[history.length - 1];
  return {
    readinessScore: (checkIn?.readiness ?? last?.readinessScore ?? 3) as 1 | 2 | 3 | 4 | 5,
    sorenessNotes: last?.sorenessNotes,
    missedLastSession: last ? last.status === "SKIPPED" : false,
    painFlags: checkIn?.painFlags ?? last?.painFlags,
  };
}
