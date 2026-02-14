/**
 * Explainability: Generate human-readable selection rationale
 *
 * Phase 2: Minimal MVP rationale (strings only)
 * Phase 4: Full explainability with KB citations and UI
 */

import type { SelectionCandidate, RejectedExercise, SelectionObjective, SelectionRationale } from "./types";

/**
 * Generate selection rationale
 *
 * @param selected - Selected exercises
 * @param rejected - Rejected exercises
 * @param objective - Selection objective
 * @returns Human-readable rationale
 */
export function generateRationale(
  selected: SelectionCandidate[],
  rejected: RejectedExercise[],
  objective: SelectionObjective
): SelectionRationale {
  // Overall strategy description
  const overallStrategy = generateOverallStrategy(selected, objective);

  // Per-exercise justification
  const perExercise = new Map<string, string>();
  for (const candidate of selected) {
    const rationale = generateExerciseRationale(candidate);
    perExercise.set(candidate.exercise.id, rationale);
  }

  // Alternative exercises (Phase 4 - deferred)
  const alternativesConsidered = undefined;

  return {
    overallStrategy,
    perExercise,
    alternativesConsidered,
  };
}

/**
 * Generate overall strategy description
 *
 * Example: "Accumulation (Week 2): Hypertrophy focus.
 *           Prioritizing: volume deficit fill (40%), rotation novelty (25%), SFR efficiency (15%)."
 *
 * @param selected - Selected exercises
 * @param objective - Selection objective
 * @returns Strategy description
 */
function generateOverallStrategy(
  selected: SelectionCandidate[],
  objective: SelectionObjective
): string {
  const parts: string[] = [];

  // Block context (if available)
  if (objective.blockContext) {
    const blockType = formatBlockType(objective.blockContext.block.blockType);
    const weekInBlock = objective.blockContext.weekInBlock; // Already 1-indexed
    parts.push(`${blockType} (Week ${weekInBlock})`);
  }

  // Number of exercises selected
  parts.push(`${selected.length} exercises selected`);

  // Top priorities (weights > 0.15)
  const priorities: string[] = [];
  if (objective.weights.volumeDeficitFill >= 0.15) {
    priorities.push(`volume deficit fill (${Math.round(objective.weights.volumeDeficitFill * 100)}%)`);
  }
  if (objective.weights.rotationNovelty >= 0.15) {
    priorities.push(`rotation novelty (${Math.round(objective.weights.rotationNovelty * 100)}%)`);
  }
  if (objective.weights.sfrEfficiency >= 0.15) {
    priorities.push(`SFR efficiency (${Math.round(objective.weights.sfrEfficiency * 100)}%)`);
  }

  if (priorities.length > 0) {
    parts.push(`Prioritizing: ${priorities.join(", ")}`);
  }

  return parts.join(". ") + ".";
}

/**
 * Generate per-exercise rationale
 *
 * Example: "Overhead Extension: Fills 4-set triceps deficit (67% fill).
 *           Loads at long length (score 5/5). Haven't used in 3 weeks (novelty 1.0)."
 *
 * @param candidate - Exercise candidate with scores
 * @returns Rationale string
 */
function generateExerciseRationale(candidate: SelectionCandidate): string {
  const reasons: string[] = [];

  // Top 2 scoring factors
  const sortedScores = Object.entries(candidate.scores)
    .map(([key, value]) => ({ key, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 2);

  for (const { key, value } of sortedScores) {
    if (value > 0.6) {
      // Only include if score is significant
      const reason = formatScoreReason(key, value, candidate);
      if (reason) reasons.push(reason);
    }
  }

  // Volume contribution summary
  const volumeSummary = formatVolumeContribution(candidate);
  if (volumeSummary) reasons.push(volumeSummary);

  return reasons.join(". ") + ".";
}

/**
 * Format score reason into human-readable text
 *
 * @param key - Score key (e.g., "deficitFill")
 * @param value - Score value (0-1)
 * @param candidate - Exercise candidate
 * @returns Human-readable reason
 */
function formatScoreReason(key: string, value: number, candidate: SelectionCandidate): string {
  const percentage = Math.round(value * 100);

  switch (key) {
    case "deficitFill":
      return `Fills volume gap (${percentage}% of deficit)`;

    case "rotationNovelty":
      if (value >= 1.0) return "Haven't used this exercise recently";
      if (value >= 0.7) return `Not used in ${Math.ceil(value * 3)} weeks`;
      return "";

    case "sfrScore":
      const sfr = candidate.exercise.sfrScore ?? 3;
      return `High stimulus-to-fatigue ratio (${sfr}/5)`;

    case "lengthenedScore":
      const lengthened = candidate.exercise.lengthPositionScore ?? 3;
      return `Loads muscle at long length (score ${lengthened}/5)`;

    case "sraAlignment":
      if (value >= 0.8) return "Targets recovered muscle groups";
      return "";

    case "userPreference":
      if (value >= 1.0) return "User marked as favorite";
      return "";

    case "movementNovelty":
      if (value >= 0.7) return "Novel movement pattern";
      return "";

    default:
      return "";
  }
}

/**
 * Format volume contribution into summary text
 *
 * Example: "3 sets chest, 0.9 indirect front delts"
 *
 * @param candidate - Exercise candidate
 * @returns Volume contribution summary
 */
function formatVolumeContribution(candidate: SelectionCandidate): string {
  const parts: string[] = [];

  for (const [muscle, { direct, indirect }] of candidate.volumeContribution) {
    if (direct > 0) {
      parts.push(`${direct} sets ${muscle.toLowerCase()}`);
    }
    if (indirect > 0) {
      parts.push(`${indirect.toFixed(1)} indirect ${muscle.toLowerCase()}`);
    }
  }

  if (parts.length === 0) return "";

  return `Contributes: ${parts.join(", ")}`;
}

/**
 * Format block type into readable text
 */
function formatBlockType(blockType: string): string {
  switch (blockType) {
    case "accumulation":
      return "Accumulation";
    case "intensification":
      return "Intensification";
    case "realization":
      return "Realization";
    case "deload":
      return "Deload";
    default:
      return blockType.charAt(0).toUpperCase() + blockType.slice(1);
  }
}
