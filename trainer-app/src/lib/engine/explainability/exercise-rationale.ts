/**
 * Exercise Rationale - Per-Exercise Selection Explanation
 *
 * Phase 4.3: Generate human-readable rationale for why each exercise was selected
 *
 * Provides:
 * - Multi-objective scoring breakdown
 * - Research-backed citations (KB integration)
 * - Alternative exercise suggestions
 * - Volume contribution summary
 */

import type {
  ExerciseRationale,
  SelectionFactorBreakdown,
  AlternativeExercise,
} from "./types";
import type { SelectionCandidate, SelectionObjective } from "../selection-v2/types";
import type { Exercise } from "../types";
import { getCitationsByExercise } from "./knowledge-base";

/**
 * Explain why an exercise was selected
 *
 * @param candidate - Selected exercise candidate with scores
 * @param objective - Selection objective (for context)
 * @param exerciseLibrary - Full exercise library (for alternatives)
 * @returns Complete exercise rationale with KB citations and alternatives
 */
export function explainExerciseRationale(
  candidate: SelectionCandidate,
  objective: SelectionObjective,
  exerciseLibrary: Exercise[]
): ExerciseRationale {
  // Build selection factor breakdown
  const selectionFactors = buildSelectionFactorBreakdown(candidate, objective);

  // Extract primary reasons (top 2-3 scoring factors with score > 0.6)
  const primaryReasons = extractPrimaryReasons(selectionFactors);

  // Get research citations
  const citations = getCitationsByExercise(
    candidate.exercise.name,
    candidate.exercise.lengthPositionScore
  );

  // Suggest alternatives
  const alternatives = suggestAlternatives(candidate.exercise, exerciseLibrary, 3);

  // Build volume contribution summary
  const volumeContribution = buildVolumeContributionSummary(candidate);

  return {
    exerciseName: candidate.exercise.name,
    primaryReasons,
    selectionFactors,
    citations,
    alternatives,
    volumeContribution,
  };
}

/**
 * Build selection factor breakdown
 *
 * Explains each multi-objective scoring factor with score + explanation
 *
 * @param candidate - Exercise candidate with scores
 * @param objective - Selection objective (for context)
 * @returns Breakdown of all selection factors
 */
export function buildSelectionFactorBreakdown(
  candidate: SelectionCandidate,
  objective: SelectionObjective
): SelectionFactorBreakdown {
  const scores = candidate.scores;

  return {
    deficitFill: {
      score: scores.deficitFill,
      explanation: explainDeficitFill(candidate, objective),
    },
    rotationNovelty: {
      score: scores.rotationNovelty,
      explanation: explainRotationNovelty(scores.rotationNovelty),
    },
    sfrEfficiency: {
      score: scores.sfrScore,
      explanation: explainSfrEfficiency(candidate.exercise),
    },
    lengthenedPosition: {
      score: scores.lengthenedScore,
      explanation: explainLengthenedPosition(candidate.exercise),
    },
    sraAlignment: {
      score: scores.sraAlignment,
      explanation: explainSraAlignment(scores.sraAlignment),
    },
    userPreference: {
      score: scores.userPreference,
      explanation: explainUserPreference(scores.userPreference),
    },
    movementNovelty: {
      score: scores.movementNovelty,
      explanation: explainMovementNovelty(scores.movementNovelty),
    },
  };
}

/**
 * Suggest alternative exercises
 *
 * Finds similar exercises ranked by similarity score
 *
 * @param exercise - Selected exercise
 * @param library - Full exercise library
 * @param limit - Max number of alternatives (default 3)
 * @returns Alternative exercise suggestions
 */
export function suggestAlternatives(
  exercise: Exercise,
  library: Exercise[],
  limit: number = 3
): AlternativeExercise[] {
  const alternatives: AlternativeExercise[] = [];

  for (const candidate of library) {
    // Skip the exercise itself
    if (candidate.id === exercise.id) continue;

    // Calculate similarity score
    const similarity = calculateSimilarity(exercise, candidate);

    // Only include if similarity > 0.3
    if (similarity > 0.3) {
      alternatives.push({
        exerciseName: candidate.name,
        similarity,
        reason: buildAlternativeReason(exercise, candidate),
      });
    }
  }

  // Sort by similarity (descending) and take top N
  return alternatives.sort((a, b) => b.similarity - a.similarity).slice(0, limit);
}

// ============================================================================
// Helper Functions: Factor Explanations
// ============================================================================

/**
 * Explain deficit fill score
 */
function explainDeficitFill(candidate: SelectionCandidate, objective: SelectionObjective): string {
  const score = candidate.scores.deficitFill;

  if (score < 0.2) {
    return "Minimal volume deficit fill (other priorities stronger)";
  }

  // Find which muscle(s) this fills the most deficit for
  const deficitContributions: Array<{ muscle: string; fillAmount: number }> = [];

  for (const [muscle, contribution] of candidate.volumeContribution) {
    const target = objective.volumeContext.weeklyTarget.get(muscle) ?? 0;
    const actual = objective.volumeContext.weeklyActual.get(muscle) ?? 0;
    const deficit = Math.max(0, target - actual);

    if (deficit > 0 && contribution.direct > 0) {
      const fillAmount = contribution.direct / deficit;
      deficitContributions.push({ muscle, fillAmount });
    }
  }

  if (deficitContributions.length === 0) {
    return "No active volume deficits targeted";
  }

  // Sort by fill amount and take top muscle
  const topFill = deficitContributions.sort((a, b) => b.fillAmount - a.fillAmount)[0];
  const percentage = Math.round(topFill.fillAmount * 100);

  return `Fills ${percentage}% of ${topFill.muscle.toLowerCase()} volume deficit`;
}

/**
 * Explain rotation novelty score
 */
function explainRotationNovelty(score: number): string {
  if (score >= 1.0) {
    return "Never used before or not used in 3+ weeks";
  }
  if (score >= 0.7) {
    const weeksAgo = Math.ceil((1 - score) * 3);
    return `Last used ${weeksAgo} week${weeksAgo > 1 ? "s" : ""} ago`;
  }
  if (score >= 0.4) {
    return "Used recently (within past 2 weeks)";
  }
  return "Used very recently (within past week)";
}

/**
 * Explain SFR efficiency score
 */
function explainSfrEfficiency(exercise: Exercise): string {
  const sfr = exercise.sfrScore ?? 3;

  if (sfr >= 4) {
    return `High stimulus-to-fatigue ratio (${sfr}/5) — efficient muscle builder`;
  }
  if (sfr >= 3) {
    return `Moderate stimulus-to-fatigue ratio (${sfr}/5) — balanced efficiency`;
  }
  return `Lower stimulus-to-fatigue ratio (${sfr}/5) — more fatiguing per stimulus`;
}

/**
 * Explain lengthened position score
 */
function explainLengthenedPosition(exercise: Exercise): string {
  const lengthened = exercise.lengthPositionScore ?? 3;

  if (lengthened >= 4) {
    return `Loads muscle at long length (${lengthened}/5) — superior hypertrophy stimulus`;
  }
  if (lengthened >= 3) {
    return `Moderate muscle stretch (${lengthened}/5) — balanced ROM`;
  }
  return `Less emphasis on lengthened position (${lengthened}/5)`;
}

/**
 * Explain SRA alignment score
 */
function explainSraAlignment(score: number): string {
  if (score >= 0.8) {
    return "Targets fully recovered muscle groups (optimal timing)";
  }
  if (score >= 0.6) {
    return "Targets mostly recovered muscle groups";
  }
  if (score >= 0.4) {
    return "Some target muscles still recovering";
  }
  return "Target muscles not fully recovered (lower priority)";
}

/**
 * Explain user preference score
 */
function explainUserPreference(score: number): string {
  if (score >= 1.0) {
    return "Marked as user favorite";
  }
  if (score >= 0.7) {
    return "User prefers this exercise";
  }
  if (score >= 0.5) {
    return "Neutral user preference";
  }
  if (score >= 0.3) {
    return "User slightly dislikes this exercise";
  }
  return "User marked to avoid (overridden by other factors)";
}

/**
 * Explain movement novelty score
 */
function explainMovementNovelty(score: number): string {
  if (score >= 0.8) {
    return "Novel movement pattern (high variety)";
  }
  if (score >= 0.5) {
    return "Moderate movement pattern variety";
  }
  return "Similar movement pattern to other exercises in session";
}

// ============================================================================
// Helper Functions: Alternative Exercises
// ============================================================================

/**
 * Calculate similarity between two exercises
 *
 * Similarity factors:
 * - Shared primary muscles (0.5 weight)
 * - Similar movement patterns (0.2 weight)
 * - Similar equipment (0.1 weight)
 * - Lower fatigue cost (0.2 weight)
 *
 * @returns Similarity score (0-1)
 */
function calculateSimilarity(exercise: Exercise, candidate: Exercise): number {
  let similarity = 0;

  // Shared primary muscles (most important factor)
  const exercisePrimary = exercise.primaryMuscles ?? [];
  const candidatePrimary = candidate.primaryMuscles ?? [];
  const sharedPrimary = exercisePrimary.filter((m) => candidatePrimary.includes(m)).length;
  const maxPrimary = Math.max(exercisePrimary.length, candidatePrimary.length);
  if (maxPrimary > 0) {
    similarity += (sharedPrimary / maxPrimary) * 0.5;
  }

  // Similar movement patterns
  const sharedPatterns = exercise.movementPatterns.filter((p) =>
    candidate.movementPatterns.includes(p)
  ).length;
  const maxPatterns = Math.max(exercise.movementPatterns.length, candidate.movementPatterns.length);
  if (maxPatterns > 0) {
    similarity += (sharedPatterns / maxPatterns) * 0.2;
  }

  // Similar equipment
  const exerciseEquipment = exercise.equipment ?? [];
  const candidateEquipment = candidate.equipment ?? [];
  const sharedEquipment = exerciseEquipment.filter((e) => candidateEquipment.includes(e)).length;
  const maxEquipment = Math.max(exerciseEquipment.length, candidateEquipment.length);
  if (maxEquipment > 0) {
    similarity += (sharedEquipment / maxEquipment) * 0.1;
  }

  // Fatigue cost delta (reward lower fatigue alternatives)
  const exerciseFatigue = exercise.fatigueCost ?? 3;
  const candidateFatigue = candidate.fatigueCost ?? 3;
  const fatigueDelta = Math.max(0, exerciseFatigue - candidateFatigue); // 0-5 range
  similarity += (fatigueDelta / 5) * 0.2;

  return Math.min(similarity, 1.0); // Cap at 1.0
}

/**
 * Build reason string for alternative exercise
 */
function buildAlternativeReason(original: Exercise, alternative: Exercise): string {
  const reasons: string[] = [];

  // Primary muscle overlap
  const originalPrimary = original.primaryMuscles ?? [];
  const altPrimary = alternative.primaryMuscles ?? [];
  const sharedMuscles = originalPrimary.filter((m) => altPrimary.includes(m));
  if (sharedMuscles.length > 0) {
    reasons.push(`Similar muscle targets (${sharedMuscles.join(", ").toLowerCase()})`);
  }

  // Fatigue comparison
  const originalFatigue = original.fatigueCost ?? 3;
  const altFatigue = alternative.fatigueCost ?? 3;
  if (altFatigue < originalFatigue) {
    reasons.push("lower fatigue");
  } else if (altFatigue > originalFatigue) {
    reasons.push("higher fatigue");
  }

  // Equipment difference
  const originalEquipment = original.equipment ?? [];
  const altEquipment = alternative.equipment ?? [];
  const differentEquipment = altEquipment.filter((e) => !originalEquipment.includes(e));
  if (differentEquipment.length > 0) {
    reasons.push(`uses ${differentEquipment[0].toLowerCase().replace("_", " ")}`);
  }

  return reasons.join(", ") || "similar exercise characteristics";
}

// ============================================================================
// Helper Functions: Primary Reasons & Volume Summary
// ============================================================================

/**
 * Extract primary reasons (top 2-3 scoring factors with score > 0.6)
 */
function extractPrimaryReasons(breakdown: SelectionFactorBreakdown): string[] {
  const factors = [
    { name: "deficit fill", score: breakdown.deficitFill.score, text: breakdown.deficitFill.explanation },
    { name: "rotation novelty", score: breakdown.rotationNovelty.score, text: breakdown.rotationNovelty.explanation },
    { name: "SFR efficiency", score: breakdown.sfrEfficiency.score, text: breakdown.sfrEfficiency.explanation },
    { name: "lengthened position", score: breakdown.lengthenedPosition.score, text: breakdown.lengthenedPosition.explanation },
    { name: "SRA alignment", score: breakdown.sraAlignment.score, text: breakdown.sraAlignment.explanation },
    { name: "user preference", score: breakdown.userPreference.score, text: breakdown.userPreference.explanation },
    { name: "movement novelty", score: breakdown.movementNovelty.score, text: breakdown.movementNovelty.explanation },
  ];

  // Sort by score (descending) and filter for significant factors (score > 0.6)
  // Exclude "No active volume deficits targeted" — omitting it lets positive reasons speak for themselves
  const significant = factors
    .filter((f) => f.score > 0.6 && f.text !== "No active volume deficits targeted")
    .sort((a, b) => b.score - a.score);

  // Take top 3 (or fewer if < 3 significant factors)
  return significant.slice(0, 3).map((f) => f.text);
}

/**
 * Build volume contribution summary
 *
 * Example: "3 sets chest, 0.9 indirect front delts"
 */
function buildVolumeContributionSummary(candidate: SelectionCandidate): string {
  const parts: string[] = [];

  for (const [muscle, { direct, indirect }] of candidate.volumeContribution) {
    if (direct > 0) {
      parts.push(`${direct} sets ${muscle.toLowerCase()}`);
    }
    if (indirect > 0) {
      parts.push(`${indirect.toFixed(1)} indirect ${muscle.toLowerCase()}`);
    }
  }

  if (parts.length === 0) {
    return "No volume contribution"; // Should never happen for selected exercises
  }

  return parts.join(", ");
}
