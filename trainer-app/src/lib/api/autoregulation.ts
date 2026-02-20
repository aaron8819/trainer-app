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

  // 2. Compute fatigue score from readiness signal (or use defaults if expired/missing)
  // Phase 3.5: Expired signals (> 48 hours) return null, triggering default 0.7 fatigue
  const fatigueScore: FatigueScore = signal
    ? computeFatigueScore(signal)
    : {
        overall: 0.7, // Default "recovered" score when no signal available
        perMuscle: {},
        weights: { whoop: 0, subjective: 0, performance: 0 },
        components: {
          whoopContribution: 0,
          subjectiveContribution: 0,
          performanceContribution: 0,
        },
      };

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

  // 4.5. Add signal age indicator to rationale (Phase 3.5)
  let rationale = baseRationale;
  if (signal) {
    const signalAge = getSignalAgeHours(signal);
    if (signalAge > 24) {
      // Stale: 24-48 hours old
      rationale += ` (⚠️ using ${formatSignalAge(signalAge)} data - consider fresh check-in)`;
    } else if (signalAge > 4) {
      // Aging: 4-24 hours old
      rationale += ` (using ${formatSignalAge(signalAge)} data)`;
    }
    // Fresh: < 4 hours old - no note needed
  } else {
    // No signal or expired (> 48 hours)
    rationale += " (using default readiness score - no recent check-in available)";
  }

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
  };
}
