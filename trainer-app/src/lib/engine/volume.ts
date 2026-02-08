import type {
  Exercise,
  FatigueState,
  SessionCheckIn,
  WorkoutExercise,
  WorkoutHistoryEntry,
} from "./types";
import { buildAccessoryMuscleCounts, scoreAccessoryRetention } from "./timeboxing";
import { VOLUME_LANDMARKS, type VolumeLandmarks } from "./volume-landmarks";

export type VolumeContext = {
  recent: Record<string, number>;
  previous: Record<string, number>;
};

export type MuscleVolumeState = {
  weeklyDirectSets: number;
  weeklyIndirectSets: number;
  plannedSets: number;
  landmark: VolumeLandmarks;
};

export type EnhancedVolumeContext = VolumeContext & {
  muscleVolume: Record<string, MuscleVolumeState>;
  mesocycleWeek: number;
  mesocycleLength: number;
};

const INDIRECT_VOLUME_WEIGHT = 0.5;

export function buildVolumeContext(
  history: WorkoutHistoryEntry[],
  exerciseLibrary: Exercise[],
  mesocycleOptions?: { week: number; length: number }
): VolumeContext | EnhancedVolumeContext {
  const byId = new Map(exerciseLibrary.map((exercise) => [exercise.id, exercise]));
  const now = Date.now();
  const windowMs = 7 * 24 * 60 * 60 * 1000;

  const recent: Record<string, number> = {};
  const previous: Record<string, number> = {};
  const weeklyDirect: Record<string, number> = {};
  const weeklyIndirect: Record<string, number> = {};

  for (const entry of history) {
    const entryTime = new Date(entry.date).getTime();
    const delta = now - entryTime;
    const isRecent = delta <= windowMs;
    const isPrevious = !isRecent && delta <= windowMs * 2;
    if (!isRecent && !isPrevious) continue;

    const target = isRecent ? recent : previous;

    for (const exerciseEntry of entry.exercises) {
      const exercise = byId.get(exerciseEntry.exerciseId);
      if (!exercise) continue;

      const primaryMuscles = exercise.primaryMuscles ?? [];
      const secondaryMuscles = exercise.secondaryMuscles ?? [];
      const setsCount = exerciseEntry.sets.length;

      for (const muscle of primaryMuscles) {
        target[muscle] = (target[muscle] ?? 0) + setsCount;
        if (isRecent) {
          weeklyDirect[muscle] = (weeklyDirect[muscle] ?? 0) + setsCount;
        }
      }

      if (isRecent) {
        for (const muscle of secondaryMuscles) {
          weeklyIndirect[muscle] = (weeklyIndirect[muscle] ?? 0) + setsCount;
        }
      }
    }
  }

  const base: VolumeContext = { recent, previous };

  if (!mesocycleOptions) return base;

  const muscleVolume: Record<string, MuscleVolumeState> = {};
  for (const [muscle, landmark] of Object.entries(VOLUME_LANDMARKS)) {
    muscleVolume[muscle] = {
      weeklyDirectSets: weeklyDirect[muscle] ?? 0,
      weeklyIndirectSets: weeklyIndirect[muscle] ?? 0,
      plannedSets: 0,
      landmark,
    };
  }

  return {
    ...base,
    muscleVolume,
    mesocycleWeek: mesocycleOptions.week,
    mesocycleLength: mesocycleOptions.length,
  };
}

export function getTargetVolume(
  landmark: VolumeLandmarks,
  mesocycleWeek: number,
  mesocycleLength: number
): number {
  if (mesocycleLength <= 1) return landmark.mav;
  const t = mesocycleWeek / (mesocycleLength - 1);
  return landmark.mev + (landmark.mav - landmark.mev) * t;
}

export function enforceVolumeCaps(
  accessories: WorkoutExercise[],
  mainLifts: WorkoutExercise[],
  volumeContext: VolumeContext | EnhancedVolumeContext
) {
  if (accessories.length === 0) return accessories;

  const enhanced = isEnhancedVolumeContext(volumeContext);

  const buildPlannedVolume = (currentAccessories: WorkoutExercise[]) => {
    const planned: Record<string, number> = { ...volumeContext.recent };
    const addExercise = (exercise: WorkoutExercise) => {
      const muscles = exercise.exercise.primaryMuscles ?? [];
      if (muscles.length === 0) return;
      for (const muscle of muscles) {
        planned[muscle] = (planned[muscle] ?? 0) + exercise.sets.length;
      }
    };
    [...mainLifts, ...currentAccessories].forEach(addExercise);
    return planned;
  };

  const exceedsCap = (planned: Record<string, number>) => {
    if (enhanced) {
      return Object.entries(planned).some(([muscle, sets]) => {
        const landmark = VOLUME_LANDMARKS[muscle];
        if (!landmark) return false;
        return sets > landmark.mrv;
      });
    }
    return Object.entries(planned).some(([muscle, sets]) => {
      const baseline = volumeContext.previous[muscle];
      if (!baseline || baseline <= 0) return false;
      return sets > baseline * 1.2;
    });
  };

  const adjusted = [...accessories];
  while (adjusted.length > 0) {
    const planned = buildPlannedVolume(adjusted);
    if (!exceedsCap(planned)) break;

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

export function deriveFatigueState(
  history: WorkoutHistoryEntry[],
  checkIn?: SessionCheckIn
): FatigueState {
  const last = history[history.length - 1];
  return {
    readinessScore: (checkIn?.readiness ?? last?.readinessScore ?? 3) as 1 | 2 | 3 | 4 | 5,
    sorenessNotes: last?.sorenessNotes,
    missedLastSession: last ? last.status === "SKIPPED" : false,
    painFlags: checkIn?.painFlags ?? last?.painFlags,
  };
}

export function effectiveWeeklySets(state: MuscleVolumeState): number {
  return state.weeklyDirectSets + state.weeklyIndirectSets * INDIRECT_VOLUME_WEIGHT;
}

function isEnhancedVolumeContext(
  ctx: VolumeContext | EnhancedVolumeContext
): ctx is EnhancedVolumeContext {
  return "muscleVolume" in ctx;
}
