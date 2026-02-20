// Phase 3: Autoregulation Orchestration

import { computeFatigueScore, autoregulateWorkout } from "@/lib/engine";
import type { WorkoutPlan as EngineWorkoutPlan } from "@/lib/engine/types";
import type {
  AutoregulationPolicy,
  FatigueScore,
  AutoregulationModification,
} from "@/lib/engine/readiness/types";
import { DEFAULT_AUTOREGULATION_POLICY } from "@/lib/engine/readiness/types";
import {
  getLatestReadinessSignal,
  getSignalAgeHours,
  formatSignalAge,
} from "./readiness";

export type AutoregulationResult = {
  original: EngineWorkoutPlan;
  adjusted: EngineWorkoutPlan;
  modifications: AutoregulationModification[];
  fatigueScore: FatigueScore | null;
  rationale: string;
  wasAutoregulated: boolean;
  applied: boolean;
  reason: string;
  signalAgeHours: number | null;
};

/**
 * Apply autoregulation to a workout based on latest readiness signal
 * Orchestrates the full pipeline:
 * 1. Fetch latest readiness signal from DB
 * 2. Compute fatigue score
 * 3. Apply autoregulation (scale intensity, reduce volume, etc.)
 *
 * @param userId - User ID
 * @param workout - Original workout plan to autoregulate
 * @param policy - Autoregulation policy (optional, uses defaults)
 * @returns AutoregulationResult with original, adjusted workout, modifications, and rationale
 */
export async function applyAutoregulation(
  userId: string,
  workout: EngineWorkoutPlan,
  policy: AutoregulationPolicy = DEFAULT_AUTOREGULATION_POLICY
): Promise<AutoregulationResult> {
  // 1. Get latest readiness signal
  const signal = await getLatestReadinessSignal(userId);

  if (!signal) {
    return {
      original: workout,
      adjusted: workout,
      modifications: [],
      fatigueScore: null,
      rationale: "No recent readiness signal. Workout left unchanged.",
      wasAutoregulated: false,
      applied: false,
      reason: "No recent readiness signal. Workout left unchanged.",
      signalAgeHours: null,
    };
  }

  const fatigueScore: FatigueScore = computeFatigueScore(signal);

  // 3. Flatten workout to single exercises array for autoregulation
  const flatExercises = [...workout.warmup, ...workout.mainLifts, ...workout.accessories];
  const flatPlan = {
    exercises: flatExercises.map((ex) => ({
      id: ex.id,
      name: ex.exercise.name,
      isMainLift: ex.isMainLift,
      sets: ex.sets,
    })),
    estimatedMinutes: workout.estimatedMinutes,
    notes: workout.notes,
  };

  // 4. Apply autoregulation
  const autoregPlan: Parameters<typeof autoregulateWorkout>[0] = flatPlan;
  const { adjustedWorkout, modifications, rationale: baseRationale } = autoregulateWorkout(
    autoregPlan,
    fatigueScore,
    policy
  );

  const signalAge = getSignalAgeHours(signal);
  let rationale = `${baseRationale} (signal ${formatSignalAge(signalAge)})`;

  // 5. Map adjusted exercises back to original structure
  const warmupCount = workout.warmup.length;
  const mainLiftsCount = workout.mainLifts.length;

  const adjustedWarmup = workout.warmup.map((ex, idx) => ({
    ...ex,
    sets: adjustedWorkout.exercises[idx]?.sets ?? ex.sets,
  }));

  const adjustedMainLifts = workout.mainLifts.map((ex, idx) => ({
    ...ex,
    sets: adjustedWorkout.exercises[warmupCount + idx]?.sets ?? ex.sets,
  }));

  const adjustedAccessories = workout.accessories.map((ex, idx) => ({
    ...ex,
    sets: adjustedWorkout.exercises[warmupCount + mainLiftsCount + idx]?.sets ?? ex.sets,
  }));

  return {
    original: workout,
    adjusted: {
      ...workout,
      warmup: adjustedWarmup,
      mainLifts: adjustedMainLifts,
      accessories: adjustedAccessories,
      estimatedMinutes: adjustedWorkout.estimatedMinutes,
      notes: adjustedWorkout.notes,
    },
    modifications,
    fatigueScore,
    rationale,
    wasAutoregulated: modifications.length > 0,
    applied: modifications.length > 0,
    reason: rationale,
    signalAgeHours: signalAge,
  };
}
