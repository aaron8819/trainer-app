/**
 * Session Context Explanation
 *
 * Phase 4.2: Generate macro-level "Why this workout today?" explanation
 *
 * Explains session context at three levels:
 * 1. Block phase and periodization goal
 * 2. Volume status across muscle groups
 * 3. Readiness overlay and autoregulation adaptations
 */

import type {
  SessionContext,
  BlockPhaseContext,
  VolumeStatus,
  ReadinessStatus,
  ProgressionContext,
  FilteredExerciseSummary,
} from "./types";
import type { BlockContext } from "../periodization/types";
import type { FatigueScore, AutoregulationModification } from "../readiness/types";
import type { RejectedExercise } from "../selection-v2/types";
import { VOLUME_LANDMARKS, MUSCLE_SPLIT_MAP, type VolumeLandmarks } from "../volume-landmarks";
import { formatBlockPhase, formatWeekInMesocycle, pluralize } from "./utils";
import type { CycleContextSnapshot } from "@/lib/evidence/types";

/**
 * Generate complete session context explanation
 *
 * @param blockContext - Current periodization block context
 * @param volumeByMuscle - Current weekly volume by muscle group (sets/week)
 * @param fatigueScore - Current fatigue score from autoregulation (optional)
 * @param modifications - Autoregulation modifications applied (optional)
 * @param signalAge - Days since last readiness check-in (optional)
 * @returns Complete session context explanation
 */
export function explainSessionContext(params: {
  blockContext: BlockContext | null;
  cycleContext?: CycleContextSnapshot;
  volumeByMuscle: Map<string, number>;
  fatigueScore?: FatigueScore;
  modifications?: AutoregulationModification[];
  signalAge?: number;
  hasRecentReadinessSignal?: boolean;
  sessionIntent?: "push" | "pull" | "legs";
}): SessionContext {
  const {
    blockContext,
    cycleContext,
    volumeByMuscle,
    fatigueScore,
    modifications,
    signalAge,
    hasRecentReadinessSignal,
    sessionIntent,
  } = params;

  // Build block phase context
  const blockPhase = describeBlockGoal(blockContext, cycleContext);

  // Build volume status (today's target muscles shown first)
  const volumeStatus = describeVolumeProgress(volumeByMuscle, sessionIntent);

  // Build readiness status
  const readinessStatus = describeReadinessStatus({
    fatigueScore,
    modifications,
    signalAge,
    hasRecentReadinessSignal,
  });

  // Build progression context
  const progressionContext = describeProgressionContext(blockContext, cycleContext);

  // Generate narrative summary
  const narrative = generateSessionNarrative({
    blockPhase,
    volumeStatus,
    readinessStatus,
    progressionContext,
  });

  return {
    blockPhase,
    volumeStatus,
    readinessStatus,
    progressionContext,
    cycleSource: cycleContext?.source ?? (blockContext ? "computed" : "none"),
    narrative,
  };
}

/**
 * Describe block phase goal
 *
 * @param blockContext - Current block context (null if no macro cycle)
 * @returns Block phase description
 */
export function describeBlockGoal(
  blockContext: BlockContext | null,
  cycleContext?: CycleContextSnapshot
): BlockPhaseContext {
  const goalMap: Record<BlockPhaseContext["blockType"], string> = {
    accumulation: "Build work capacity and muscle mass with progressive volume",
    intensification: "Convert fitness into strength with increased intensity",
    realization: "Peak strength and performance with max specificity",
    deload: "Recover and dissipate fatigue while maintaining adaptations",
  };

  if (cycleContext) {
    return {
      blockType: cycleContext.blockType,
      weekInBlock: cycleContext.weekInBlock,
      totalWeeksInBlock: 4,
      primaryGoal: goalMap[cycleContext.blockType],
    };
  }

  if (!blockContext) {
    // No macro cycle -> default accumulation week 1
    return {
      blockType: "accumulation",
      weekInBlock: 1,
      totalWeeksInBlock: 4,
      primaryGoal: "Build work capacity and muscle mass with progressive volume",
    };
  }

  const { block, weekInBlock } = blockContext;
  return {
    blockType: block.blockType,
    weekInBlock,
    totalWeeksInBlock: block.durationWeeks,
    primaryGoal: goalMap[block.blockType],
  };
}
/**
 * Describe volume progress across muscle groups
 *
 * @param volumeByMuscle - Current weekly volume by muscle group (sets/week)
 * @returns Volume status with muscle-level breakdown
 */
export function describeVolumeProgress(
  volumeByMuscle: Map<string, number>,
  sessionIntent?: "push" | "pull" | "legs"
): VolumeStatus {
  type MuscleStatus = {
    currentSets: number;
    targetRange: { min: number; max: number };
    status: "below_mev" | "at_mev" | "optimal" | "approaching_mrv" | "at_mrv";
  };

  // Build status entries for muscles with accumulated volume
  const statusByMuscle = new Map<string, MuscleStatus>();
  let atTargetCount = 0;

  for (const [muscle, sets] of volumeByMuscle.entries()) {
    const landmarks = VOLUME_LANDMARKS[muscle];
    if (!landmarks) continue;

    const status = determineVolumeStatus(sets, landmarks);
    statusByMuscle.set(muscle, {
      currentSets: sets,
      targetRange: { min: landmarks.mev, max: landmarks.mav },
      status,
    });

    if (status === "optimal" || status === "at_mev") {
      atTargetCount++;
    }
  }

  // If session intent is known, prepend today's targeted muscles (even if 0 sets)
  // so the grid reads as a preview of what this session is working on.
  const muscleStatuses = new Map<string, MuscleStatus>();

  if (sessionIntent) {
    for (const [muscle, split] of Object.entries(MUSCLE_SPLIT_MAP)) {
      if (split !== sessionIntent) continue;
      const landmarks = VOLUME_LANDMARKS[muscle];
      if (!landmarks) continue;

      if (statusByMuscle.has(muscle)) {
        muscleStatuses.set(muscle, statusByMuscle.get(muscle)!);
      } else {
        // Include 0-set entry for muscles targeted today but not yet trained
        const status = determineVolumeStatus(0, landmarks);
        muscleStatuses.set(muscle, {
          currentSets: 0,
          targetRange: { min: landmarks.mev, max: landmarks.mav },
          status,
        });
        // Count 0-set muscles against totals for accurate summary
        if (status === "optimal" || status === "at_mev") {
          atTargetCount++;
        }
      }
    }
  }

  // Append remaining muscles (not already added)
  for (const [muscle, entry] of statusByMuscle.entries()) {
    if (!muscleStatuses.has(muscle)) {
      muscleStatuses.set(muscle, entry);
    }
  }

  const totalMuscles = muscleStatuses.size;
  const overallSummary =
    totalMuscles === 0
      ? "No volume data available"
      : `${atTargetCount} of ${totalMuscles} muscle groups near target volume`;

  return {
    muscleStatuses,
    overallSummary,
  };
}

/**
 * Describe readiness status and autoregulation adaptations
 *
 * @param params - Fatigue score, modifications, signal age
 * @returns Readiness status description
 */
export function describeReadinessStatus(params: {
  fatigueScore?: FatigueScore;
  modifications?: AutoregulationModification[];
  signalAge?: number;
  hasRecentReadinessSignal?: boolean;
}): ReadinessStatus {
  const { fatigueScore, modifications = [], signalAge = 0, hasRecentReadinessSignal = false } = params;

  if (!fatigueScore) {
    if (!hasRecentReadinessSignal) {
      const hasAnySignal = Number.isFinite(signalAge) && signalAge > 0;
      return {
        overall: "moderate",
        signalAge: hasAnySignal ? signalAge : 0,
        availability: hasAnySignal ? "stale" : "missing",
        label: hasAnySignal ? `Stale readiness (${signalAge}d old)` : "No recent readiness",
        perMuscleFatigue: new Map(),
        adaptations: [],
      };
    }

    return {
      overall: "moderate",
      signalAge,
      availability: "recent",
      label: signalAge > 0 ? `Recent readiness (${signalAge}d old)` : "Recent readiness",
      perMuscleFatigue: new Map(),
      adaptations: [],
    };
  }

  const overall = classifyReadiness(fatigueScore.overall);

  const perMuscleFatigue = new Map<string, number>();
  for (const [muscle, fatigue] of Object.entries(fatigueScore.perMuscle)) {
    perMuscleFatigue.set(muscle, Math.round((1 - fatigue) * 10));
  }

  const adaptations = summarizeAdaptations(modifications);

  return {
    overall,
    signalAge,
    availability: "recent",
    label: signalAge > 0 ? `Readiness: ${overall} (${signalAge}d old)` : `Readiness: ${overall}`,
    perMuscleFatigue,
    adaptations,
  };
}
/**
 * Describe progression context
 *
 * @param blockContext - Current block context (null if no macro)
 * @returns Progression context description
 */
export function describeProgressionContext(
  blockContext: BlockContext | null,
  cycleContext?: CycleContextSnapshot
): ProgressionContext {
  if (cycleContext) {
    const volumeProgression = getVolumeProgression(cycleContext.blockType);
    const intensityProgression = getIntensityProgression(cycleContext.blockType);
    const nextMilestone = getNextMilestone(cycleContext.blockType, cycleContext.weekInBlock, 4);
    return {
      weekInMesocycle: cycleContext.weekInMeso,
      volumeProgression,
      intensityProgression,
      nextMilestone,
    };
  }

  if (!blockContext) {
    return {
      weekInMesocycle: 1,
      volumeProgression: "building",
      intensityProgression: "ramping",
      nextMilestone: "Continue building volume over next 3 weeks",
    };
  }

  const { block, weekInBlock, weekInMeso } = blockContext;
  const volumeProgression = getVolumeProgression(block.blockType);
  const intensityProgression = getIntensityProgression(block.blockType);
  const nextMilestone = getNextMilestone(block.blockType, weekInBlock, block.durationWeeks);

  return {
    weekInMesocycle: weekInMeso,
    volumeProgression,
    intensityProgression,
    nextMilestone,
  };
}
/**
 * Generate session narrative summary
 *
 * Combines all context into a human-readable paragraph
 */
function generateSessionNarrative(params: {
  blockPhase: BlockPhaseContext;
  volumeStatus: VolumeStatus;
  readinessStatus: ReadinessStatus;
  progressionContext: ProgressionContext;
}): string {
  const { blockPhase, volumeStatus, readinessStatus, progressionContext } = params;

  const blockName = formatBlockPhase(blockPhase.blockType);
  const weekDesc = formatWeekInMesocycle(blockPhase.weekInBlock, blockPhase.totalWeeksInBlock);

  let narrative = `${blockName} ${weekDesc}: ${blockPhase.primaryGoal}.`;

  // Add volume context
  narrative += ` ${volumeStatus.overallSummary}.`;

  // Add readiness context
  if (readinessStatus.adaptations.length > 0) {
    narrative += ` ${readinessStatus.adaptations.join("; ")}.`;
  }

  // Add progression milestone
  if (progressionContext.nextMilestone) {
    narrative += ` ${progressionContext.nextMilestone}.`;
  }

  return narrative;
}

/**
 * Determine volume status for a muscle group
 */
function determineVolumeStatus(
  currentSets: number,
  landmarks: VolumeLandmarks
): "below_mev" | "at_mev" | "optimal" | "approaching_mrv" | "at_mrv" {
  if (currentSets < landmarks.mev) return "below_mev";
  if (currentSets === landmarks.mev) return "at_mev";
  if (currentSets >= landmarks.mrv) return "at_mrv";
  if (currentSets >= landmarks.mav && currentSets < landmarks.mrv) return "approaching_mrv";
  return "optimal"; // Between MEV and MAV
}

/**
 * Classify overall readiness level
 */
function classifyReadiness(fatigueScore: number): "fresh" | "moderate" | "fatigued" {
  if (fatigueScore >= 0.75) return "fresh";
  if (fatigueScore >= 0.5) return "moderate";
  return "fatigued";
}

/**
 * Summarize autoregulation adaptations
 */
function summarizeAdaptations(modifications: AutoregulationModification[]): string[] {
  const adaptations: string[] = [];

  let volumeCuts = 0;
  let intensityScaleDown = 0;
  let intensityScaleUp = 0;

  for (const mod of modifications) {
    if (mod.type === "volume_reduction" && mod.setsCut) {
      volumeCuts += mod.setsCut;
    } else if (mod.type === "intensity_scale") {
      if (mod.direction === "down") intensityScaleDown++;
      if (mod.direction === "up") intensityScaleUp++;
    } else if (mod.type === "deload_trigger") {
      adaptations.push("Triggered deload due to elevated fatigue");
    }
  }

  if (volumeCuts > 0) {
    adaptations.push(`Reduced volume by ${pluralize(volumeCuts, "set")}`);
  }
  if (intensityScaleDown > 0) {
    adaptations.push(`Scaled down ${pluralize(intensityScaleDown, "exercise", "exercises")}`);
  }
  if (intensityScaleUp > 0) {
    adaptations.push(`Scaled up ${pluralize(intensityScaleUp, "exercise", "exercises")}`);
  }

  if (adaptations.length === 0) {
    adaptations.push("No adaptations needed - proceeding as planned");
  }

  return adaptations;
}

/**
 * Get volume progression based on block type
 */
function getVolumeProgression(
  blockType: BlockPhaseContext["blockType"]
): "building" | "maintaining" | "deloading" {
  if (blockType === "deload") return "deloading";
  if (blockType === "accumulation") return "building";
  return "maintaining"; // Intensification and realization
}

/**
 * Get intensity progression based on block type
 */
function getIntensityProgression(
  blockType: BlockPhaseContext["blockType"]
): "ramping" | "peak" | "reduced" {
  if (blockType === "deload") return "reduced";
  if (blockType === "realization") return "peak";
  return "ramping"; // Accumulation and intensification
}

/**
 * Get next milestone description
 */
function getNextMilestone(
  blockType: BlockPhaseContext["blockType"],
  weekInBlock: number,
  totalWeeks: number
): string {
  const weeksRemaining = totalWeeks - weekInBlock;

  if (weeksRemaining === 0) {
    // Last week of block
    if (blockType === "accumulation") return "Entering intensification block next week";
    if (blockType === "intensification") return "Entering realization block next week";
    if (blockType === "realization") return "Deload week next";
    return "New training block begins next week";
  }

  if (weeksRemaining === 1) {
    return `Final ${blockType} week next, then transition to next block`;
  }

  if (blockType === "deload") {
    return `Resume progressive training in ${pluralize(weeksRemaining, "week")}`;
  }

  return `Continue ${blockType} phase for ${pluralize(weeksRemaining, "more week")}`;
}

/**
 * Summarize filtered exercises for explainability
 *
 * Converts rejected exercises into user-friendly summaries grouped by rejection reason.
 * Used to show users why exercises were filtered (pain conflicts, user avoids, equipment).
 *
 * @param rejected - Array of rejected exercises from SelectionResult
 * @returns Array of filtered exercise summaries with user-friendly messages
 *
 * @example
 * ```typescript
 * const filtered = summarizeFilteredExercises(result.rejected);
 * // [
 * //   { exerciseId: "123", exerciseName: "Incline Dumbbell Curl",
 * //     reason: "user_avoided", userFriendlyMessage: "Avoided per your preferences" },
 * //   { exerciseId: "456", exerciseName: "Bench Press",
 * //     reason: "pain_conflict", userFriendlyMessage: "Excluded due to recent pain signals" }
 * // ]
 * ```
 */
export function summarizeFilteredExercises(
  rejected: RejectedExercise[]
): FilteredExerciseSummary[] {
  return rejected.map((item) => {
    const exerciseName = item.exercise.name;
    const exerciseId = item.exercise.id;

    let userFriendlyMessage: string;
    switch (item.reason) {
      case "user_avoided":
        userFriendlyMessage = "Avoided per your preferences";
        break;
      case "pain_conflict":
        userFriendlyMessage = "Excluded due to recent pain signals";
        break;
      case "contraindicated":
        userFriendlyMessage = "Contraindicated"; // Generic fallback
        break;
      default: {
        // Handle string reasons not in the current RejectionReason union
        // Other rejection reasons (SRA, volume ceiling, etc.) - not surfaced in UI
        userFriendlyMessage = `Filtered (${item.reason})`;
      }
    }

    return {
      exerciseId,
      exerciseName,
      reason: item.reason,
      userFriendlyMessage,
    };
  });
}




