/**
 * Scoring Functions: Multi-objective candidate evaluation
 *
 * Each function returns a normalized score 0-1 where:
 * - 1.0 = optimal
 * - 0.0 = worst
 */

import type { Exercise, Muscle } from "../types";
import { INDIRECT_SET_MULTIPLIER } from "../volume-constants";
import type {
  VolumeContribution,
  SelectionVolumeContext,
  RotationContext,
  SRAContext,
  SelectionPreferences,
  SelectionObjective,
} from "./types";

/**
 * Score how well this exercise fills volume deficits
 *
 * Uses EFFECTIVE volume (direct + 0.3 × indirect) to account for indirect work.
 *
 * Example:
 * - Chest deficit: 4 sets
 * - Front delt deficit: 5.6 sets (after bench filled 2.4 indirect)
 * - Side delt deficit: 8 sets
 *
 * - OHP contributes: 3 front delts (direct), 0.9 side delts (indirect)
 *   → Fills 3/5.6 = 53.6% of front delt deficit
 *   → Fills 0.9/8 = 11.25% of side delt deficit
 *   → Total: (3 + 0.9) / (5.6 + 8) = 28.7%
 *
 * - Lateral Raise contributes: 3 side delts (direct)
 *   → Fills 3/8 = 37.5% of side delt deficit
 *   → Higher score → selected first
 *
 * @param contribution - Volume contribution (direct + indirect per muscle)
 * @param volumeContext - Current volume state (targets, actuals)
 * @returns Score 0-1 (proportion of total deficit filled)
 */
export function scoreDeficitFill(
  contribution: VolumeContribution,
  volumeContext: SelectionVolumeContext
): number {
  let totalFilled = 0;
  let totalDeficit = 0;

  for (const [muscle, { direct, indirect }] of contribution) {
    const target = volumeContext.weeklyTarget.get(muscle) ?? 0;
    const actual = volumeContext.effectiveActual.get(muscle) ?? 0;
    const deficit = Math.max(0, target - actual);

    if (deficit === 0) continue; // No deficit to fill

    // Effective contribution (direct + 0.3 × indirect)
    const effectiveContribution = direct + indirect * INDIRECT_SET_MULTIPLIER;

    // How much of this deficit can we fill?
    const filled = Math.min(effectiveContribution, deficit);

    totalFilled += filled;
    totalDeficit += deficit;
  }

  // Return proportion of total deficit filled
  return totalDeficit > 0 ? totalFilled / totalDeficit : 0;
}

/**
 * Score rotation novelty (prefer exercises not recently used)
 *
 * Formula: min(1.0, weeksAgo / targetCadence)
 * - targetCadence = 3 weeks (rotate accessories every 3-4 weeks)
 * - weeksAgo = 0 → score 0.0 (used today, penalize heavily)
 * - weeksAgo = 1 → score 0.33
 * - weeksAgo = 3 → score 1.0 (optimal, not used for 3+ weeks)
 * - weeksAgo = infinity (never used) → score 1.0
 *
 * @param exercise - Exercise to score
 * @param rotationContext - Exercise exposure history
 * @returns Score 0-1 (1.0 = max novelty)
 */
export function scoreRotationNovelty(
  exercise: Exercise,
  rotationContext: RotationContext
): number {
  // CRITICAL: RotationContext is keyed by exerciseName, not exerciseId
  // (ExerciseExposure table uses exerciseName as the tracking key)
  const exposure = rotationContext.get(exercise.name);

  // Never used → maximum novelty
  if (!exposure) return 1.0;

  // Target rotation cadence (weeks)
  const TARGET_CADENCE = 3;

  // Novelty score based on weeks since last use
  const novelty = Math.min(1.0, exposure.weeksAgo / TARGET_CADENCE);

  return novelty;
}

/**
 * Score SFR (Stimulus-to-Fatigue Ratio)
 *
 * Higher SFR = more muscle stimulus per unit fatigue
 *
 * SFR scale (1-5):
 * - 5 = excellent (e.g., leg press, machine flyes)
 * - 3 = moderate (e.g., bench press, squat)
 * - 1 = poor (e.g., deadlift, heavy compounds)
 *
 * @param exercise - Exercise to score
 * @returns Score 0-1 (exercise.sfrScore / 5)
 */
export function scoreSFR(exercise: Exercise): number {
  const sfrScore = exercise.sfrScore ?? 3; // Default: moderate
  return sfrScore / 5; // Normalize to 0-1
}

/**
 * Score lengthened position loading
 *
 * Lengthened-bias exercises show superior hypertrophy (Maeo 2023, Kassiano 2023):
 * - +40% growth for triceps (overhead extension vs pushdown)
 * - +20% growth for hamstrings (nordic vs leg curl)
 *
 * Length position scale (1-5):
 * - 5 = excellent lengthened bias (e.g., overhead extension, RDL)
 * - 3 = moderate (e.g., bench press, squat)
 * - 1 = poor (e.g., pushdown, leg extension)
 *
 * @param exercise - Exercise to score
 * @returns Score 0-1 (exercise.lengthPositionScore / 5)
 */
export function scoreLengthened(exercise: Exercise): number {
  const lengthenedScore = exercise.lengthPositionScore ?? 3; // Default: moderate
  return lengthenedScore / 5; // Normalize to 0-1
}

/**
 * Score movement pattern novelty
 *
 * Penalizes exercises with movement patterns already selected.
 * This prevents redundant patterns (e.g., 3 OHP variations in one workout).
 *
 * When called with `alreadySelected`, computes overlap with the current
 * beam state and returns lower scores for exercises that repeat patterns
 * already covered.
 *
 * Example:
 * - Already selected: Bench Press (horizontal push)
 * - Candidate: Incline DB Press (horizontal push + vertical push)
 * - Overlap: 50% of patterns are duplicates
 * - Score: 0.5
 *
 * @param exercise - Exercise to score
 * @param objective - Selection objective
 * @param alreadySelected - Exercises already selected in current beam state
 * @returns Score 0-1 (1.0 = all patterns novel, 0.0 = all patterns already covered)
 */
export function scoreMovementNovelty(
  exercise: Exercise,
  objective: SelectionObjective,
  alreadySelected: Exercise[] = []
): number {
  const myPatterns = new Set(exercise.movementPatterns ?? []);
  if (myPatterns.size === 0) return 0.5;

  const usedPatterns = new Set(alreadySelected.flatMap((e) => e.movementPatterns ?? []));
  const overlap = [...myPatterns].filter((p) => usedPatterns.has(p)).length;
  const novelPatterns = myPatterns.size - overlap;
  return novelPatterns / myPatterns.size;
}

/**
 * Score SRA (Stimulus-Recovery-Adaptation) alignment
 *
 * Prefer exercises targeting recovered muscles.
 *
 * SRA readiness (0-1):
 * - 1.0 = fully recovered (48+ hours since last hit)
 * - 0.5 = partially recovered (24-48 hours)
 * - 0.0 = not recovered (< 24 hours)
 *
 * Score = average SRA readiness across primary muscles
 *
 * @param exercise - Exercise to score
 * @param sraContext - Muscle recovery map
 * @returns Score 0-1 (avg SRA readiness of primary muscles)
 */
export function scoreSRAAlignment(
  exercise: Exercise,
  sraContext: SRAContext
): number {
  const primaryMuscles = exercise.primaryMuscles ?? [];

  if (primaryMuscles.length === 0) return 1.0; // No primary muscles → always ready

  // Average SRA readiness across primary muscles
  const readinessScores = primaryMuscles.map((muscle) => sraContext.get(muscle) ?? 1.0);
  const avgReadiness = readinessScores.reduce((sum, r) => sum + r, 0) / readinessScores.length;

  return avgReadiness;
}

/**
 * Score user preference
 *
 * - Favorite: 1.0
 * - Neutral: 0.5
 * - Avoided: 0.0
 *
 * @param exercise - Exercise to score
 * @param preferences - User preferences
 * @returns Score 0-1
 */
export function scoreUserPreference(
  exercise: Exercise,
  preferences: SelectionPreferences
): number {
  // Avoided exercises should be filtered out by hard constraints
  // But if somehow they reach here, score 0
  if (preferences.avoidExerciseIds.has(exercise.id)) {
    return 0.0;
  }

  // Favorites get bonus
  if (preferences.favoriteExerciseIds.has(exercise.id)) {
    return 1.0;
  }

  // Neutral
  return 0.5;
}
