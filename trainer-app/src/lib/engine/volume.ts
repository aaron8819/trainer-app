import type {
  Exercise,
  FatigueState,
  SessionCheckIn,
  WorkoutExercise,
  WorkoutHistoryEntry,
} from "./types";
import { VOLUME_LANDMARKS, type VolumeLandmarks } from "./volume-landmarks";
import { interpolateWeeklyVolumeTarget } from "./volume-targets";
import {
  getMostRecentHistoryEntry,
  isPerformedHistoryEntry,
} from "./history";
import { getEffectiveStimulusByMuscle } from "./stimulus";

export type VolumeContext = {
  recent: Record<string, number>;
  previous: Record<string, number>;
};

export type MuscleVolumeState = {
  weeklyDirectSets: number;
  weeklyIndirectSets: number;
  weeklyEffectiveSets: number;
  plannedSets: number;
  landmark: VolumeLandmarks;
};

export type EnhancedVolumeContext = VolumeContext & {
  muscleVolume: Record<string, MuscleVolumeState>;
  mesocycleWeek: number;
  mesocycleLength: number;
  mesocycleId?: string;
  weeklyTargets?: Record<string, number>;
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
  mesocycleOptions?: { week: number; length: number; mesocycleId?: string; weeklyTargets?: Record<string, number> }
): VolumeContext | EnhancedVolumeContext {
  const byId = new Map(exerciseLibrary.map((exercise) => [exercise.id, exercise]));
  const now = Date.now();
  const windowMs = 7 * 24 * 60 * 60 * 1000;

  const recent: Record<string, number> = {};
  const previous: Record<string, number> = {};
  const weeklyDirect: Record<string, number> = {};
  const weeklyIndirect: Record<string, number> = {};
  const weeklyEffective: Record<string, number> = {};

  for (const entry of history) {
    if (!isPerformedHistoryEntry(entry)) continue;

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
      const effectiveContribution = getEffectiveStimulusByMuscle(exercise, setsCount);

      for (const [muscle, effectiveSets] of effectiveContribution) {
        target[muscle] = (target[muscle] ?? 0) + effectiveSets;
      }

      const snapshot = entry.mesocycleSnapshot;
      const matchesMesocycleWeek =
        mesocycleOptions &&
        snapshot?.week === mesocycleOptions.week &&
        (!mesocycleOptions.mesocycleId ||
          !snapshot?.mesocycleId ||
          snapshot.mesocycleId === mesocycleOptions.mesocycleId);
      if (matchesMesocycleWeek) {
        for (const muscle of primaryMuscles) {
          weeklyDirect[muscle] = (weeklyDirect[muscle] ?? 0) + setsCount;
        }
        for (const muscle of secondaryMuscles) {
          weeklyIndirect[muscle] = (weeklyIndirect[muscle] ?? 0) + setsCount;
        }
        for (const [muscle, effectiveSets] of effectiveContribution) {
          weeklyEffective[muscle] = (weeklyEffective[muscle] ?? 0) + effectiveSets;
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
      weeklyEffectiveSets: weeklyEffective[muscle] ?? 0,
      plannedSets: 0,
      landmark,
    };
  }

  return {
    ...base,
    muscleVolume,
    mesocycleWeek: mesocycleOptions.week,
    mesocycleLength: mesocycleOptions.length,
    mesocycleId: mesocycleOptions.mesocycleId,
    weeklyTargets: mesocycleOptions.weeklyTargets,
  };
}

export function getTargetVolume(
  landmark: VolumeLandmarks,
  mesocycleWeek: number,
  mesocycleLength: number
): number {
  return interpolateWeeklyVolumeTarget(
    {
      mev: landmark.mev,
      mav: landmark.mav,
      mrv: landmark.mrv,
    },
    mesocycleLength,
    mesocycleWeek
  );
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
    effectiveSets: Record<string, number>;
  };

  const effectiveBaseline = enhanced
    ? Object.fromEntries(
        Object.entries(volumeContext.muscleVolume)
          .filter(([, state]) => state.weeklyEffectiveSets > 0)
          .map(([muscle, state]) => [muscle, state.weeklyEffectiveSets])
      )
    : { ...volumeContext.recent };

  const buildPlannedVolume = (currentAccessories: WorkoutExercise[]) => {
    const effectiveSets: Record<string, number> = { ...effectiveBaseline };

    const addExercise = (exercise: WorkoutExercise) => {
      const contribution = getEffectiveStimulusByMuscle(exercise.exercise, exercise.sets.length);
      for (const [muscle, effective] of contribution) {
        effectiveSets[muscle] = (effectiveSets[muscle] ?? 0) + effective;
      }
    };
    [...mainLifts, ...currentAccessories].forEach(addExercise);
    return { effectiveSets } satisfies PlannedVolume;
  };

  const exceedsCap = (planned: PlannedVolume) => {
    if (enhanced) {
      return Object.entries(planned.effectiveSets).some(([muscle, sets]) => {
        const landmark = VOLUME_LANDMARKS[muscle];
        const exceedsLandmark = useEffectiveVolumeCaps && landmark ? sets > landmark.mrv : false;
        const exceedsSpike = exceedsSpikeCap(sets, volumeContext.previous[muscle]);
        return exceedsLandmark || exceedsSpike;
      });
    }
    return Object.entries(planned.effectiveSets).some(([muscle, sets]) => {
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
  return state.weeklyEffectiveSets;
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
  const effectiveSets: Record<string, number> = enhanced
    ? Object.fromEntries(
        Object.entries(volumeContext.muscleVolume)
          .filter(([, state]) => state.weeklyEffectiveSets > 0)
          .map(([muscle, state]) => [muscle, state.weeklyEffectiveSets])
      )
    : { ...volumeContext.recent };

  const allExercises = [...mainLifts, ...accessories];
  for (const exercise of allExercises) {
    const contribution = getEffectiveStimulusByMuscle(exercise.exercise, exercise.sets.length);
    for (const [muscle, effective] of contribution) {
      effectiveSets[muscle] = (effectiveSets[muscle] ?? 0) + effective;
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
    const target = enhanced && volumeContext.weeklyTargets?.[muscle] != null
      ? volumeContext.weeklyTargets[muscle]
      : getTargetVolume(landmark, mesocycleWeek, mesocycleLength);
    const planned = effectiveSets[muscle] ?? 0;
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

// ---------------------------------------------------------------------------
// Accessory scoring helpers (moved from timeboxing.ts)
// ---------------------------------------------------------------------------

export function buildAccessoryMuscleCounts(accessories: WorkoutExercise[]) {
  const counts: Record<string, number> = {};
  for (const accessory of accessories) {
    const primary = accessory.exercise.primaryMuscles ?? [];
    for (const muscle of primary) {
      counts[muscle] = (counts[muscle] ?? 0) + 1;
    }
  }
  return counts;
}

export function scoreAccessoryRetention(
  accessory: WorkoutExercise,
  coveredMuscles: Set<string>,
  muscleCounts: Record<string, number>
) {
  const primary = accessory.exercise.primaryMuscles ?? [];
  const secondary = accessory.exercise.secondaryMuscles ?? [];
  const uncoveredPrimary = primary.filter((muscle) => !coveredMuscles.has(muscle));
  const uncoveredSecondary = secondary.filter((muscle) => !coveredMuscles.has(muscle));
  const muscleCoverageScore = uncoveredPrimary.length + uncoveredSecondary.length * 0.3;
  const redundancyPenalty = primary.reduce((sum, muscle) => {
    const count = muscleCounts[muscle] ?? 0;
    return sum + Math.max(0, count - 1);
  }, 0);
  const fatigueCostPenalty = scoreNormalizePositive((accessory.exercise.fatigueCost ?? 3) - 3, 2);
  const sfrScore = scoreNormalizeCentered(accessory.exercise.sfrScore ?? 3, 3, 2);
  const lengthenedScore = scoreNormalizeCentered(accessory.exercise.lengthPositionScore ?? 3, 3, 2);

  return (
    3.0 * muscleCoverageScore +
    1.2 * sfrScore +
    0.8 * lengthenedScore -
    1.0 * redundancyPenalty -
    1.3 * fatigueCostPenalty
  );
}

function scoreNormalizeCentered(value: number, center: number, range: number): number {
  if (range <= 0) return 0;
  const clamped = Math.max(-1, Math.min(1, (value - center) / range));
  return clamped;
}

function scoreNormalizePositive(value: number, range: number): number {
  if (range <= 0) return 0;
  return Math.max(0, Math.min(1, value / range));
}
