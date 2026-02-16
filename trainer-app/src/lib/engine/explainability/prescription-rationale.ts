/**
 * Prescription Rationale - Per-Set/Rep/Load/RIR/Rest Explanation
 *
 * Phase 4.4: Generate human-readable rationale for prescription parameters
 *
 * Provides:
 * - Set count explanation (block phase, accumulation vs intensification)
 * - Rep target explanation (training goal, exercise constraints)
 * - Load choice explanation (progression type, % change from last)
 * - RIR target explanation (week in mesocycle, training age)
 * - Rest period explanation (exercise type, rep range)
 */

import type {
  PrescriptionRationale,
  SetRationale,
  RepRationale,
  LoadRationale,
  RirRationale,
  RestRationale,
} from "./types";
import type { Exercise, WorkoutSet, Goals, UserProfile } from "../types";
import type { PeriodizationModifiers } from "../rules";
import { getCitationsByTopic } from "./knowledge-base";

/**
 * Input context for prescription rationale
 */
export type PrescriptionRationaleContext = {
  exercise: Exercise;
  sets: WorkoutSet[];
  isMainLift: boolean;
  goals: Goals;
  profile: Pick<UserProfile, "trainingAge">;
  periodization?: PeriodizationModifiers;
  weekInMesocycle?: number;
  lastSessionLoad?: number;
  lastSessionReps?: number;
  restSeconds?: number;
  exerciseRepRange?: { min: number; max: number };
};

/**
 * Explain prescription rationale for an exercise
 *
 * @param context - Prescription context with exercise, sets, goals, etc.
 * @returns Complete prescription rationale with KB citations
 */
export function explainPrescriptionRationale(
  context: PrescriptionRationaleContext
): PrescriptionRationale {
  const { exercise, sets, isMainLift, goals, profile, periodization, weekInMesocycle } = context;

  // Get top set for representative prescription
  const topSet = sets.find((s) => s.setIndex === 1) ?? sets[0];
  if (!topSet) {
    throw new Error("No sets provided for prescription rationale");
  }

  // Build rationale components
  const setRationale = explainSetCount(
    sets.length,
    isMainLift,
    profile.trainingAge,
    periodization
  );

  const repRationale = explainRepTarget(
    topSet.targetReps ?? topSet.targetRepRange?.min ?? 8,
    goals.primary,
    isMainLift,
    context.exerciseRepRange
  );

  const loadRationale = explainLoadChoice(
    topSet.targetLoad,
    context.lastSessionLoad,
    context.lastSessionReps,
    topSet.targetReps ?? topSet.targetRepRange?.min,
    profile.trainingAge,
    periodization
  );

  const rirRationale = explainRirTarget(
    topSet.targetRpe,
    weekInMesocycle,
    profile.trainingAge,
    goals.primary,
    isMainLift,
    periodization
  );

  const restRationale = explainRestPeriod(
    context.restSeconds,
    exercise,
    isMainLift,
    topSet.targetReps ?? topSet.targetRepRange?.min
  );

  // Build overall narrative
  const reps = topSet.targetReps ?? topSet.targetRepRange?.min ?? 8;
  const load = topSet.targetLoad ? `${topSet.targetLoad}kg` : "BW";
  const rir = topSet.targetRpe ? 10 - topSet.targetRpe : 2;
  const rest = context.restSeconds ? `${Math.round(context.restSeconds / 60)} min` : "2 min";

  const overallNarrative = `${sets.length}×${reps} @ ${load}, ${rir} RIR, ${rest} rest — ${setRationale.blockContext.toLowerCase()}`;

  return {
    exerciseName: exercise.name,
    sets: setRationale,
    reps: repRationale,
    load: loadRationale,
    rir: rirRationale,
    rest: restRationale,
    overallNarrative,
  };
}

/**
 * Explain set count
 *
 * @param count - Number of sets
 * @param isMainLift - Whether this is a main lift
 * @param trainingAge - User training age
 * @param periodization - Periodization modifiers
 * @returns Set count rationale with block context
 */
export function explainSetCount(
  count: number,
  isMainLift: boolean,
  trainingAge: UserProfile["trainingAge"],
  periodization?: PeriodizationModifiers
): SetRationale {
  const exerciseType = isMainLift ? "main lift" : "accessory";

  // Block context
  const blockPhase = determineBlockPhase(periodization);
  const blockContext = formatBlockContext(blockPhase, periodization);

  // Build reason string
  let reason = `${count} sets for ${exerciseType}`;

  if (periodization?.isDeload) {
    reason += " (deload week — reduced volume to promote recovery)";
  } else if (blockPhase === "accumulation") {
    reason += " (accumulation phase — building volume and work capacity)";
  } else if (blockPhase === "intensification") {
    reason += ` (intensification phase — higher intensity, ${count >= 4 ? "maintained" : "slightly reduced"} volume)`;
  } else {
    // Standard progression
    const baseSetCount = isMainLift ? 4 : 3;
    const ageModifier =
      trainingAge === "advanced" ? "advanced" : trainingAge === "beginner" ? "beginner" : null;

    if (ageModifier) {
      reason += ` (${ageModifier} trainee: ${ageModifier === "advanced" ? "+15%" : "-15%"} base volume)`;
    } else {
      reason += ` (standard ${baseSetCount}-set protocol for ${exerciseType})`;
    }
  }

  return {
    count,
    reason,
    blockContext,
  };
}

/**
 * Explain rep target
 *
 * @param target - Target reps
 * @param goal - Primary training goal
 * @param isMainLift - Whether this is a main lift
 * @param exerciseConstraints - Exercise-specific rep range constraints
 * @returns Rep target rationale
 */
export function explainRepTarget(
  target: number,
  goal: Goals["primary"],
  isMainLift: boolean,
  exerciseConstraints?: { min: number; max: number }
): RepRationale {
  const exerciseType = isMainLift ? "main lift" : "accessory";

  // Goal-specific rep ranges
  const goalRanges: Record<
    Goals["primary"],
    { main: [number, number]; accessory: [number, number]; label: string }
  > = {
    hypertrophy: { main: [6, 10], accessory: [10, 15], label: "muscle growth" },
    strength: { main: [3, 6], accessory: [6, 10], label: "maximal strength" },
    fat_loss: { main: [8, 12], accessory: [12, 20], label: "metabolic stress" },
    athleticism: { main: [4, 8], accessory: [8, 12], label: "power and athleticism" },
    general_health: { main: [8, 12], accessory: [10, 15], label: "general fitness" },
  };

  const goalConfig = goalRanges[goal];
  const goalRange = isMainLift ? goalConfig.main : goalConfig.accessory;
  const [rangeMin, rangeMax] = goalRange;

  let reason = `${target} reps for ${goalConfig.label}`;

  // Check if target is within standard goal range
  if (target >= rangeMin && target <= rangeMax) {
    reason += ` (${rangeMin}-${rangeMax} rep range optimal for ${goal})`;
  } else if (exerciseConstraints) {
    // Exercise-constrained
    if (target < rangeMin) {
      reason += ` (exercise works better in ${exerciseConstraints.min}-${exerciseConstraints.max} rep range)`;
    } else {
      reason += ` (adjusted for exercise constraints: ${exerciseConstraints.min}-${exerciseConstraints.max} reps)`;
    }
  }

  return {
    target,
    reason,
    exerciseConstraints: exerciseConstraints
      ? `Exercise works best in ${exerciseConstraints.min}-${exerciseConstraints.max} rep range`
      : undefined,
  };
}

/**
 * Explain load choice
 *
 * @param load - Prescribed load (kg)
 * @param lastLoad - Last session load
 * @param lastReps - Last session reps
 * @param targetReps - Target reps for this session
 * @param trainingAge - User training age
 * @param periodization - Periodization modifiers
 * @returns Load rationale with progression context
 */
export function explainLoadChoice(
  load: number | undefined,
  lastLoad: number | undefined,
  lastReps: number | undefined,
  targetReps: number | undefined,
  trainingAge: UserProfile["trainingAge"],
  periodization?: PeriodizationModifiers
): LoadRationale {
  if (!load) {
    return {
      load: 0,
      progressionType: "autoregulated",
      reason: "Bodyweight exercise (no external load)",
    };
  }

  // Determine progression type
  const progressionType = determineProgressionType(trainingAge, lastLoad, lastReps, targetReps);

  // Calculate load change
  if (!lastLoad) {
    return {
      load,
      progressionType,
      reason: "Initial working weight (baseline or estimated from body weight)",
    };
  }

  const loadChange = load - lastLoad;
  const loadChangePct = (loadChange / lastLoad) * 100;

  let reason: string;

  if (periodization?.isDeload) {
    const deloadPct = ((lastLoad - load) / lastLoad) * 100;
    reason = `Reduced from ${lastLoad}kg (${deloadPct.toFixed(0)}% deload for recovery)`;
  } else if (Math.abs(loadChange) < 0.5) {
    reason = `Maintained at ${load}kg (same as last session)`;
  } else if (loadChange > 0) {
    reason = `Increased from ${lastLoad}kg (+${loadChangePct.toFixed(1)}%)`;

    if (progressionType === "linear") {
      const increment = loadChange;
      reason += ` — linear progression (+${increment}kg/session)`;
    } else if (progressionType === "double") {
      reason += ` — double progression (add reps → add weight)`;
    } else {
      reason += ` — autoregulated based on performance`;
    }
  } else {
    reason = `Reduced from ${lastLoad}kg (${loadChangePct.toFixed(1)}%) to manage fatigue`;
  }

  const progressionContext = periodization
    ? formatProgressionContext(periodization)
    : undefined;

  return {
    load,
    progressionType,
    reason,
    progressionContext,
  };
}

/**
 * Explain RIR target
 *
 * @param targetRpe - Target RPE (10 = failure, 7 = 3 RIR)
 * @param weekInMesocycle - Week number in mesocycle (1-indexed)
 * @param trainingAge - User training age
 * @param goal - Primary training goal
 * @param isMainLift - Whether this is a main lift
 * @param periodization - Periodization modifiers
 * @returns RIR rationale with citations
 */
export function explainRirTarget(
  targetRpe: number | undefined,
  weekInMesocycle: number | undefined,
  trainingAge: UserProfile["trainingAge"],
  goal: Goals["primary"],
  isMainLift: boolean,
  periodization?: PeriodizationModifiers
): RirRationale {
  const rpe = targetRpe ?? 7.5;
  const rir = 10 - rpe;

  let reason: string;

  // Deload
  if (periodization?.isDeload) {
    reason = `${rir} RIR (deload week — reduced intensity for recovery)`;
  }
  // Mesocycle progression
  else if (weekInMesocycle !== undefined) {
    const phase = weekInMesocycle <= 1 ? "early" : weekInMesocycle >= 3 ? "late" : "middle";

    if (phase === "early") {
      reason = `${rir} RIR (week ${weekInMesocycle} — conservative intensity to build volume tolerance)`;
    } else if (phase === "middle") {
      reason = `${rir} RIR (week ${weekInMesocycle} — moderate intensity, accumulating fatigue)`;
    } else {
      reason = `${rir} RIR (week ${weekInMesocycle} — peak intensity before deload)`;
    }
  }
  // Standard intensity by goal
  else {
    const goalIntensity: Record<Goals["primary"], string> = {
      hypertrophy: "moderate-high intensity (effective for hypertrophy)",
      strength: "high intensity (required for strength adaptation)",
      fat_loss: "moderate intensity (balance fatigue with metabolic demand)",
      athleticism: "moderate-high intensity (build power and speed)",
      general_health: "moderate intensity (sustainable for health goals)",
    };

    reason = `${rir} RIR (${goalIntensity[goal]})`;
  }

  // Training age context
  const trainingAgeNote =
    trainingAge === "advanced"
      ? "Advanced: Can accurately gauge proximity to failure"
      : trainingAge === "beginner"
        ? "Beginner: Conservative RIR targets to build technique"
        : "Intermediate: Can gauge RIR with moderate accuracy";

  return {
    target: rir,
    reason,
    trainingAge: trainingAgeNote,
  };
}

/**
 * Explain rest period
 *
 * @param seconds - Rest period in seconds
 * @param exercise - Exercise metadata
 * @param isMainLift - Whether this is a main lift
 * @param targetReps - Target reps (for rep-aware rest)
 * @returns Rest period rationale
 */
export function explainRestPeriod(
  seconds: number | undefined,
  exercise: Exercise,
  isMainLift: boolean,
  targetReps: number | undefined
): RestRationale {
  const restSec = seconds ?? 120;
  const restMin = Math.round(restSec / 60);

  const fatigueCost = exercise.fatigueCost ?? 3;
  const isCompound = exercise.isCompound ?? false;
  const reps = targetReps ?? (isMainLift ? 5 : 10);

  // Determine exercise type classification
  let exerciseType: "heavy_compound" | "moderate_compound" | "isolation";
  let reason: string;

  // Heavy compound (main lifts, low reps)
  if (isMainLift && reps <= 5) {
    exerciseType = "heavy_compound";
    reason =
      fatigueCost >= 4
        ? `${restMin} min for heavy compound (high CNS demand, full recovery needed)`
        : `${restMin} min for heavy compound (neurological recovery)`;
  }
  // Main lifts moderate rep range
  else if (isMainLift) {
    exerciseType = "heavy_compound";
    reason =
      fatigueCost >= 4
        ? `${restMin} min for compound (high systemic fatigue)`
        : `${restMin} min for compound (balance recovery and efficiency)`;
  }
  // Compound accessories
  else if (isCompound) {
    exerciseType = "moderate_compound";
    reason =
      reps <= 8
        ? `${restMin} min for compound accessory (moderate fatigue, strength focus)`
        : `${restMin} min for compound accessory (higher reps, less rest needed)`;
  }
  // Isolation
  else {
    exerciseType = "isolation";
    reason = `${restMin} min for isolation (local fatigue, faster recovery)`;
  }

  return {
    seconds: restSec,
    reason,
    exerciseType,
  };
}

// --- Helper Functions ---

/**
 * Determine block phase from periodization modifiers
 */
function determineBlockPhase(
  periodization?: PeriodizationModifiers
): "accumulation" | "intensification" | "deload" | "standard" {
  if (!periodization) return "standard";
  if (periodization.isDeload) return "deload";

  // Accumulation: high volume (setMultiplier > 1.1), moderate intensity (rpeOffset < 0)
  // Intensification: moderate volume (setMultiplier ~1.0), high intensity (rpeOffset >= 0)
  const isAccumulation = periodization.setMultiplier > 1.1 && periodization.rpeOffset < 0;
  const isIntensification = periodization.setMultiplier <= 1.1 && periodization.rpeOffset >= 0;

  if (isAccumulation) return "accumulation";
  if (isIntensification) return "intensification";
  return "standard";
}

/**
 * Format block context for display
 */
function formatBlockContext(
  phase: "accumulation" | "intensification" | "deload" | "standard",
  periodization?: PeriodizationModifiers
): string {
  if (phase === "deload") {
    return "Deload week";
  }

  if (phase === "accumulation") {
    const setMult = periodization?.setMultiplier ?? 1.0;
    const volumeIncrease = Math.round((setMult - 1) * 100);
    return `Accumulation (${volumeIncrease > 0 ? `+${volumeIncrease}% volume` : "building volume"})`;
  }

  if (phase === "intensification") {
    const rpeOffset = periodization?.rpeOffset ?? 0;
    return `Intensification (${rpeOffset > 0 ? `+${rpeOffset.toFixed(1)} RPE` : "peak intensity"})`;
  }

  return "Standard progression";
}

/**
 * Determine progression type
 */
function determineProgressionType(
  trainingAge: UserProfile["trainingAge"],
  lastLoad: number | undefined,
  lastReps: number | undefined,
  targetReps: number | undefined
): "linear" | "double" | "autoregulated" {
  // Beginners use linear progression
  if (trainingAge === "beginner" && lastLoad !== undefined) {
    return "linear";
  }

  // Double progression if reps changed (add reps → add weight)
  if (
    lastReps !== undefined &&
    targetReps !== undefined &&
    lastLoad !== undefined &&
    targetReps !== lastReps
  ) {
    return "double";
  }

  // Otherwise autoregulated
  return "autoregulated";
}

/**
 * Format progression context
 */
function formatProgressionContext(periodization: PeriodizationModifiers): string {
  if (periodization.isDeload) {
    return "Deload week (50% volume reduction)";
  }

  const setMult = periodization.setMultiplier;
  const rpeOffset = periodization.rpeOffset;

  if (setMult > 1.1) {
    return `Volume accumulation (+${Math.round((setMult - 1) * 100)}% sets)`;
  }

  if (rpeOffset > 0) {
    return `Intensity progression (+${rpeOffset.toFixed(1)} RPE)`;
  }

  return "Standard progression";
}
