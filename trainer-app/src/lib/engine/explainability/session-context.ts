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
} from "./types";
import type { BlockContext } from "../periodization/types";
import type { FatigueScore, AutoregulationModification } from "../readiness/types";
import type { WorkoutPlan } from "../types";
import { VOLUME_LANDMARKS, type VolumeLandmarks } from "../volume-landmarks";
import { formatBlockPhase, formatWeekInMesocycle, pluralize } from "./utils";

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
  volumeByMuscle: Map<string, number>;
  fatigueScore?: FatigueScore;
  modifications?: AutoregulationModification[];
  signalAge?: number;
}): SessionContext {
  const { blockContext, volumeByMuscle, fatigueScore, modifications, signalAge } = params;

  // Build block phase context
  const blockPhase = describeBlockGoal(blockContext);

  // Build volume status
  const volumeStatus = describeVolumeProgress(volumeByMuscle);

  // Build readiness status
  const readinessStatus = describeReadinessStatus({
    fatigueScore,
    modifications,
    signalAge,
  });

  // Build progression context
  const progressionContext = describeProgressionContext(blockContext);

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
    narrative,
  };
}

/**
 * Describe block phase goal
 *
 * @param blockContext - Current block context (null if no macro cycle)
 * @returns Block phase description
 */
export function describeBlockGoal(blockContext: BlockContext | null): BlockPhaseContext {
  if (!blockContext) {
    // No macro cycle → default accumulation week 1
    return {
      blockType: "accumulation",
      weekInBlock: 1,
      totalWeeksInBlock: 4,
      primaryGoal: "Build work capacity and muscle mass with progressive volume",
    };
  }

  const { block, weekInBlock } = blockContext;

  // Map block type to primary goal
  const goalMap: Record<BlockPhaseContext["blockType"], string> = {
    accumulation: "Build work capacity and muscle mass with progressive volume",
    intensification: "Convert fitness into strength with increased intensity",
    realization: "Peak strength and performance with max specificity",
    deload: "Recover and dissipate fatigue while maintaining adaptations",
  };

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
export function describeVolumeProgress(volumeByMuscle: Map<string, number>): VolumeStatus {
  const muscleStatuses = new Map<
    string,
    {
      currentSets: number;
      targetRange: { min: number; max: number };
      status: "below_mev" | "at_mev" | "optimal" | "approaching_mrv" | "at_mrv";
    }
  >();

  let atTargetCount = 0;
  let totalMuscles = 0;

  for (const [muscle, sets] of volumeByMuscle.entries()) {
    const landmarks = VOLUME_LANDMARKS[muscle];
    if (!landmarks) continue; // Skip unknown muscles

    totalMuscles++;

    const status = determineVolumeStatus(sets, landmarks);
    const targetRange = { min: landmarks.mev, max: landmarks.mav };

    muscleStatuses.set(muscle, {
      currentSets: sets,
      targetRange,
      status,
    });

    // Count muscles in optimal range
    if (status === "optimal" || status === "at_mev") {
      atTargetCount++;
    }
  }

  // Generate overall summary
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
}): ReadinessStatus {
  const { fatigueScore, modifications = [], signalAge = 0 } = params;

  if (!fatigueScore) {
    // No readiness data available
    return {
      overall: "moderate",
      signalAge: 0,
      perMuscleFatigue: new Map(),
      adaptations: [],
    };
  }

  // Classify overall readiness
  const overall = classifyReadiness(fatigueScore.overall);

  // Build per-muscle fatigue map (convert 0-1 scale to 0-10)
  const perMuscleFatigue = new Map<string, number>();
  for (const [muscle, fatigue] of Object.entries(fatigueScore.perMuscle)) {
    perMuscleFatigue.set(muscle, Math.round((1 - fatigue) * 10)); // Invert: 1=fresh → 0 fatigue
  }

  // Summarize adaptations from modifications
  const adaptations = summarizeAdaptations(modifications);

  return {
    overall,
    signalAge,
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
  blockContext: BlockContext | null
): ProgressionContext {
  if (!blockContext) {
    // No macro cycle → default progression
    return {
      weekInMesocycle: 1,
      volumeProgression: "building",
      intensityProgression: "ramping",
      nextMilestone: "Continue building volume over next 3 weeks",
    };
  }

  const { block, weekInBlock, weekInMeso } = blockContext;

  // Determine volume progression based on block type
  const volumeProgression = getVolumeProgression(block.blockType, weekInBlock);

  // Determine intensity progression based on block type
  const intensityProgression = getIntensityProgression(block.blockType, weekInBlock);

  // Generate next milestone
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
  blockType: BlockPhaseContext["blockType"],
  weekInBlock: number
): "building" | "maintaining" | "deloading" {
  if (blockType === "deload") return "deloading";
  if (blockType === "accumulation") return "building";
  return "maintaining"; // Intensification and realization
}

/**
 * Get intensity progression based on block type
 */
function getIntensityProgression(
  blockType: BlockPhaseContext["blockType"],
  weekInBlock: number
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
