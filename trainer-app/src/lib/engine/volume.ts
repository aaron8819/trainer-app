import type {
  Exercise,
  FatigueState,
  SessionCheckIn,
  WorkoutExercise,
  WorkoutHistoryEntry,
} from "./types";
import { buildAccessoryMuscleCounts, scoreAccessoryRetention } from "./timeboxing";
import { VOLUME_LANDMARKS, type VolumeLandmarks } from "./volume-landmarks";
import {
  getMostRecentHistoryEntry,
  isCompletedHistoryEntry,
} from "./history";
import { INDIRECT_SET_MULTIPLIER } from "./volume-constants";

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

export type VolumePlanByMuscleEntry = {
  target: number;
  planned: number;
  delta: number;
};

export type VolumePlanByMuscle = Record<string, VolumePlanByMuscleEntry>;

const USE_EFFECTIVE_VOLUME_CAPS_ENV = "USE_EFFECTIVE_VOLUME_CAPS";

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
    if (!isCompletedHistoryEntry(entry)) continue;

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
  const useEffectiveVolumeCaps = shouldUseEffectiveVolumeCaps();

  type PlannedVolume = {
    directSets: Record<string, number>;
    indirectSets: Record<string, number>;
  };

  const buildPlannedVolume = (currentAccessories: WorkoutExercise[]) => {
    const directSets: Record<string, number> = { ...volumeContext.recent };
    const indirectSets: Record<string, number> = enhanced
      ? Object.fromEntries(
          Object.entries(volumeContext.muscleVolume)
            .filter(([, state]) => state.weeklyIndirectSets > 0)
            .map(([muscle, state]) => [muscle, state.weeklyIndirectSets])
        )
      : {};

    const addExercise = (exercise: WorkoutExercise) => {
      const primaryMuscles = exercise.exercise.primaryMuscles ?? [];
      const secondaryMuscles = exercise.exercise.secondaryMuscles ?? [];
      const sets = exercise.sets.length;
      for (const muscle of primaryMuscles) {
        directSets[muscle] = (directSets[muscle] ?? 0) + sets;
      }
      for (const muscle of secondaryMuscles) {
        indirectSets[muscle] = (indirectSets[muscle] ?? 0) + sets;
      }
    };
    [...mainLifts, ...currentAccessories].forEach(addExercise);
    return { directSets, indirectSets } satisfies PlannedVolume;
  };

  const exceedsCap = (planned: PlannedVolume) => {
    if (enhanced) {
      if (useEffectiveVolumeCaps) {
        const muscles = new Set<string>([
          ...Object.keys(planned.directSets),
          ...Object.keys(planned.indirectSets),
        ]);
        return Array.from(muscles).some((muscle) => {
          const directSets = planned.directSets[muscle] ?? 0;
          const indirectSets = planned.indirectSets[muscle] ?? 0;
          const landmark = VOLUME_LANDMARKS[muscle];
          const effectiveSets = directSets + indirectSets * INDIRECT_SET_MULTIPLIER;
          const exceedsLandmark = landmark ? effectiveSets > landmark.mrv : false;
          const exceedsSpike = exceedsSpikeCap(directSets, volumeContext.previous[muscle]);
          return exceedsLandmark || exceedsSpike;
        });
      }

      return Object.entries(planned.directSets).some(([muscle, sets]) => {
        const landmark = VOLUME_LANDMARKS[muscle];
        const exceedsLandmark = landmark ? sets > landmark.mrv : false;
        const exceedsSpike = exceedsSpikeCap(sets, volumeContext.previous[muscle]);
        return exceedsLandmark || exceedsSpike;
      });
    }
    return Object.entries(planned.directSets).some(([muscle, sets]) => {
      return exceedsSpikeCap(sets, volumeContext.previous[muscle]);
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
        exercise,
        score: scoreAccessoryRetention(exercise, coveredMuscles, muscleCounts),
      }))
      .sort((a, b) => {
        if (a.score !== b.score) {
          return a.score - b.score;
        }
        const fatigueA = a.exercise.exercise.fatigueCost ?? 3;
        const fatigueB = b.exercise.exercise.fatigueCost ?? 3;
        if (fatigueA !== fatigueB) {
          return fatigueB - fatigueA;
        }
        const nameCompare = a.exercise.exercise.name.localeCompare(b.exercise.exercise.name);
        if (nameCompare !== 0) {
          return nameCompare;
        }
        return a.idx - b.idx;
      });
    adjusted.splice(scored[0].idx, 1);
  }

  return adjusted;
}

export function deriveFatigueState(
  history: WorkoutHistoryEntry[],
  checkIn?: SessionCheckIn
): FatigueState {
  const last = getMostRecentHistoryEntry(history);
  return {
    readinessScore: (checkIn?.readiness ?? last?.readinessScore ?? 3) as 1 | 2 | 3 | 4 | 5,
    sorenessNotes: last?.sorenessNotes,
    missedLastSession: last ? last.status === "SKIPPED" : false,
    painFlags: checkIn?.painFlags ?? last?.painFlags,
  };
}

export function effectiveWeeklySets(state: MuscleVolumeState): number {
  return state.weeklyDirectSets + state.weeklyIndirectSets * INDIRECT_SET_MULTIPLIER;
}

export function buildVolumePlanByMuscle(
  mainLifts: WorkoutExercise[],
  accessories: WorkoutExercise[],
  volumeContext: VolumeContext | EnhancedVolumeContext,
  options?: {
    mesocycleWeek?: number;
    mesocycleLength?: number;
  }
): VolumePlanByMuscle {
  const enhanced = isEnhancedVolumeContext(volumeContext);
  const directSets: Record<string, number> = { ...volumeContext.recent };
  const indirectSets: Record<string, number> = enhanced
    ? Object.fromEntries(
        Object.entries(volumeContext.muscleVolume)
          .filter(([, state]) => state.weeklyIndirectSets > 0)
          .map(([muscle, state]) => [muscle, state.weeklyIndirectSets])
      )
    : {};

  const allExercises = [...mainLifts, ...accessories];
  for (const exercise of allExercises) {
    const sets = exercise.sets.length;
    for (const muscle of exercise.exercise.primaryMuscles ?? []) {
      directSets[muscle] = (directSets[muscle] ?? 0) + sets;
    }
    for (const muscle of exercise.exercise.secondaryMuscles ?? []) {
      indirectSets[muscle] = (indirectSets[muscle] ?? 0) + sets;
    }
  }

  const mesocycleWeek = Math.max(
    0,
    options?.mesocycleWeek ?? (enhanced ? volumeContext.mesocycleWeek : 0)
  );
  const mesocycleLength = Math.max(
    1,
    options?.mesocycleLength ?? (enhanced ? volumeContext.mesocycleLength : 4)
  );

  const plan: VolumePlanByMuscle = {};
  for (const [muscle, landmark] of Object.entries(VOLUME_LANDMARKS)) {
    const target = getTargetVolume(landmark, mesocycleWeek, mesocycleLength);
    const planned =
      (directSets[muscle] ?? 0) + (indirectSets[muscle] ?? 0) * INDIRECT_SET_MULTIPLIER;
    const delta = target - planned;
    plan[muscle] = {
      target: roundVolumeValue(target),
      planned: roundVolumeValue(planned),
      delta: roundVolumeValue(delta),
    };
  }

  return plan;
}

function isEnhancedVolumeContext(
  ctx: VolumeContext | EnhancedVolumeContext
): ctx is EnhancedVolumeContext {
  return "muscleVolume" in ctx;
}

function roundVolumeValue(value: number): number {
  return Math.round(value * 10) / 10;
}

function exceedsSpikeCap(sets: number, baseline: number | undefined) {
  if (!baseline || baseline <= 0) {
    return false;
  }
  return sets > baseline * 1.2;
}

function shouldUseEffectiveVolumeCaps(): boolean {
  const rawValue = process.env[USE_EFFECTIVE_VOLUME_CAPS_ENV];
  if (!rawValue) {
    return false;
  }
  const normalized = rawValue.trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalized);
}
