/**
 * Coach Messages - Encouragement, Warnings, Milestones, Tips
 *
 * Phase 4.5: Generate coach-like messages based on workout context
 *
 * Message types:
 * - encouragement: Positive reinforcement for progress/milestones
 * - warning: Alerts for high fatigue/SRA violations/volume spikes
 * - milestone: Celebrating achievements (block completion, PRs, etc.)
 * - tip: Actionable coaching advice
 */

import type { CoachMessage, SessionContext, ReadinessStatus } from "./types";
import type { BlockContext } from "../periodization/types";
import { pluralize } from "./utils";

/**
 * Generate coach messages for a workout
 *
 * Analyzes session context and generates 0-5 messages:
 * - High priority: Warnings (fatigue, volume spikes, SRA violations)
 * - Medium priority: Milestones (block completion, progression milestones)
 * - Low priority: Encouragement, tips
 *
 * @param sessionContext - Complete session context
 * @param blockContext - Block context (for deeper block analysis)
 * @param workoutStats - Optional workout characteristics (volume, PR potential, etc.)
 * @returns Array of coach messages (sorted by priority: high -> medium -> low)
 */
export function generateCoachMessages(params: {
  sessionContext: SessionContext;
  blockContext: BlockContext | null;
  workoutStats?: {
    totalSets: number;
    hasPRPotential?: boolean;
    volumeSpikePercent?: number; // % increase from last week
    musclesApproachingMRV?: string[];
  };
}): CoachMessage[] {
  const { sessionContext, blockContext, workoutStats } = params;
  const messages: CoachMessage[] = [];

  // 1. Warnings (high priority)
  messages.push(...generateWarnings(sessionContext, workoutStats));

  // 2. Milestones (medium priority)
  messages.push(...generateMilestones(sessionContext, blockContext));

  // 3. Encouragement (low priority)
  messages.push(...generateEncouragement(sessionContext, workoutStats));

  // 4. Tips (low priority)
  messages.push(...generateTips(sessionContext, blockContext));

  // Sort by priority: high -> medium -> low
  return messages.sort((a, b) => {
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    return priorityOrder[a.priority] - priorityOrder[b.priority];
  });
}

/**
 * Generate warning messages
 *
 * Triggers:
 * - High fatigue (readiness = fatigued)
 * - Volume spike > 20% from last week
 * - Multiple muscles approaching MRV
 * - Stale readiness signal (> 7 days)
 */
function generateWarnings(
  sessionContext: SessionContext,
  workoutStats?: {
    totalSets: number;
    volumeSpikePercent?: number;
    musclesApproachingMRV?: string[];
  }
): CoachMessage[] {
  const warnings: CoachMessage[] = [];
  const { readinessStatus } = sessionContext;

  // High fatigue warning
  if (readinessStatus.overall === "fatigued") {
    warnings.push({
      type: "warning",
      priority: "high",
      message: `High fatigue detected (${readinessStatus.signalAge} ${pluralize(readinessStatus.signalAge, "day")} ago). Workout adjusted to reduce volume and maintain intensity. Consider extra recovery if symptoms persist.`,
    });
  }

  // Stale readiness signal
  if (readinessStatus.signalAge > 7) {
    warnings.push({
      type: "warning",
      priority: "high",
      message: `Readiness data is ${readinessStatus.signalAge} days old. Update your readiness check-in for more accurate workout adjustments.`,
    });
  }

  // Volume spike warning
  if (workoutStats?.volumeSpikePercent && workoutStats.volumeSpikePercent > 20) {
    warnings.push({
      type: "warning",
      priority: "high",
      message: `Volume increased ${Math.round(workoutStats.volumeSpikePercent)}% from last week. Monitor recovery closely and reduce volume if fatigue accumulates.`,
    });
  }

  // Muscles approaching MRV
  if (workoutStats?.musclesApproachingMRV && workoutStats.musclesApproachingMRV.length > 0) {
    const muscles = workoutStats.musclesApproachingMRV.join(", ");
    const verb = workoutStats.musclesApproachingMRV.length === 1 ? "is" : "are";
    warnings.push({
      type: "warning",
      priority: "medium",
      message: `${muscles} ${verb} approaching maximum recoverable volume. Consider deloading these muscle groups next week if recovery stalls.`,
    });
  }

  return warnings;
}

/**
 * Generate milestone messages
 *
 * Triggers:
 * - Block completion (last week of block)
 * - Deload week milestone
 * - Mesocycle progression milestones
 */
function generateMilestones(
  sessionContext: SessionContext,
  blockContext: BlockContext | null
): CoachMessage[] {
  const milestones: CoachMessage[] = [];
  const { blockPhase, progressionContext } = sessionContext;

  // Last week of block
  if (blockPhase.weekInBlock === blockPhase.totalWeeksInBlock) {
    const blockTypeLabel = blockPhase.blockType.charAt(0).toUpperCase() + blockPhase.blockType.slice(1);
    milestones.push({
      type: "milestone",
      priority: "medium",
      message: `Final week of ${blockTypeLabel} block! ${getMilestoneMessage(blockPhase.blockType)}`,
    });
  }

  // Deload week
  if (blockPhase.blockType === "deload") {
    milestones.push({
      type: "milestone",
      priority: "medium",
      message: `Deload week — reduced volume and intensity to promote recovery and supercompensation. Trust the process!`,
    });
  }

  // Progression milestones (every 4 weeks)
  if (progressionContext.weekInMesocycle % 4 === 0 && progressionContext.weekInMesocycle > 0) {
    milestones.push({
      type: "milestone",
      priority: "medium",
      message: `Week ${progressionContext.weekInMesocycle} milestone reached! Consistent training builds long-term progress. Keep it up!`,
    });
  }

  return milestones;
}

/**
 * Generate encouragement messages
 *
 * Triggers:
 * - Fresh readiness (optimal training conditions)
 * - PR potential exercises
 * - Accumulation week 1-2 (volume building phase)
 */
function generateEncouragement(
  sessionContext: SessionContext,
  workoutStats?: { hasPRPotential?: boolean }
): CoachMessage[] {
  const encouragement: CoachMessage[] = [];
  const { readinessStatus, blockPhase, progressionContext } = sessionContext;

  // Fresh readiness
  if (readinessStatus.overall === "fresh") {
    encouragement.push({
      type: "encouragement",
      priority: "low",
      message: "Feeling fresh! Great conditions for a productive session. Push hard on main lifts.",
    });
  }

  // PR potential
  if (workoutStats?.hasPRPotential) {
    encouragement.push({
      type: "encouragement",
      priority: "low",
      message: "PR potential today! Load progression suggests you're ready to hit new rep PRs. Trust your training.",
    });
  }

  // Accumulation phase encouragement
  if (blockPhase.blockType === "accumulation" && blockPhase.weekInBlock <= 2) {
    encouragement.push({
      type: "encouragement",
      priority: "low",
      message: "Volume building phase — focus on quality reps and progressive overload. Strength will come!",
    });
  }

  // Intensification phase encouragement
  if (blockPhase.blockType === "intensification") {
    encouragement.push({
      type: "encouragement",
      priority: "low",
      message: "Intensification block — converting fitness into strength. Push intensity on main lifts!",
    });
  }

  return encouragement;
}

/**
 * Generate tip messages
 *
 * Triggers:
 * - Block-specific coaching cues
 * - Readiness-based recovery tips
 * - Progression strategy tips
 */
function generateTips(
  sessionContext: SessionContext,
  blockContext: BlockContext | null
): CoachMessage[] {
  const tips: CoachMessage[] = [];
  const { blockPhase, readinessStatus, progressionContext } = sessionContext;

  // Accumulation tips
  if (blockPhase.blockType === "accumulation") {
    tips.push({
      type: "tip",
      priority: "low",
      message: "Accumulation focus: Prioritize technique and full ROM. Leave 1-2 reps in reserve to build volume tolerance.",
    });
  }

  // Intensification tips
  if (blockPhase.blockType === "intensification") {
    tips.push({
      type: "tip",
      priority: "low",
      message: "Intensification focus: Push closer to failure on main lifts (0-1 RIR). Rest fully between sets (3-4 min).",
    });
  }

  // Realization tips
  if (blockPhase.blockType === "realization") {
    tips.push({
      type: "tip",
      priority: "low",
      message: "Realization focus: Test strength peaks with low volume, high intensity. Recovery is critical this week.",
    });
  }

  // Moderate fatigue tip
  if (readinessStatus.overall === "moderate" && readinessStatus.signalAge <= 3) {
    tips.push({
      type: "tip",
      priority: "low",
      message: "Moderate fatigue detected. Prioritize sleep (7-9 hours) and protein intake (0.8g/lb bodyweight) for recovery.",
    });
  }

  // Volume progression tip
  if (progressionContext.volumeProgression === "building") {
    tips.push({
      type: "tip",
      priority: "low",
      message: "Volume is building week-to-week. If recovery feels challenging, add a low-intensity cardio session to promote blood flow.",
    });
  }

  // Cap at 1 tip — block-specific tip is most actionable; additional tips read as noise
  return tips.slice(0, 1);
}

/**
 * Get block-specific milestone message
 */
function getMilestoneMessage(blockType: string): string {
  switch (blockType) {
    case "accumulation":
      return "Volume capacity built. Ready for intensification phase next!";
    case "intensification":
      return "Strength gains consolidated. Time for deload and recovery!";
    case "realization":
      return "Peak strength tested. Great job pushing your limits!";
    case "deload":
      return "Recovery complete. Ready to start the next block fresh!";
    default:
      return "Block complete!";
  }
}
