/**
 * Candidate Building: Convert exercises into scored candidates
 *
 * Core logic for indirect volume accounting and multi-objective scoring.
 */

import type { Exercise, Muscle } from "../types";
import { INDIRECT_SET_MULTIPLIER } from "../volume-constants";
import type {
  SelectionObjective,
  SelectionCandidate,
  VolumeContribution,
  CandidateScores,
} from "./types";
import {
  scoreDeficitFill,
  scoreRotationNovelty,
  scoreSFR,
  scoreLengthened,
  scoreMovementNovelty,
  scoreSRAAlignment,
  scoreUserPreference,
} from "./scoring";
import { estimateExerciseMinutes } from "../timeboxing";
import { getGoalRepRanges } from "../rules";

/**
 * Build a scored candidate from an exercise
 *
 * @param exercise - Exercise to evaluate
 * @param objective - Selection objective with context
 * @param proposedSets - Number of sets to propose (default: 3)
 * @returns Fully scored selection candidate
 */
export function buildCandidate(
  exercise: Exercise,
  objective: SelectionObjective,
  proposedSets: number = 3
): SelectionCandidate {
  // Compute volume contribution (direct + indirect)
  const volumeContribution = computeVolumeContribution(exercise, proposedSets);

  // Estimate time contribution
  const timeContribution = estimateTimeContribution(exercise, proposedSets, objective);

  // Compute multi-objective scores
  const scores: CandidateScores = {
    deficitFill: scoreDeficitFill(volumeContribution, objective.volumeContext),
    rotationNovelty: scoreRotationNovelty(exercise, objective.rotationContext),
    sfrScore: scoreSFR(exercise),
    lengthenedScore: scoreLengthened(exercise),
    movementNovelty: scoreMovementNovelty(exercise, objective, []),
    sraAlignment: scoreSRAAlignment(exercise, objective.sraContext),
    userPreference: scoreUserPreference(exercise, objective.preferences),
  };

  // Compute weighted total score
  const totalScore =
    scores.deficitFill * objective.weights.volumeDeficitFill +
    scores.rotationNovelty * objective.weights.rotationNovelty +
    scores.sfrScore * objective.weights.sfrEfficiency +
    scores.lengthenedScore * objective.weights.lengthenedBias +
    scores.movementNovelty * objective.weights.movementDiversity +
    scores.sraAlignment * objective.weights.sraReadiness +
    scores.userPreference * objective.weights.userPreference;

  return {
    exercise,
    proposedSets,
    volumeContribution,
    timeContribution,
    scores,
    totalScore,
  };
}

/**
 * Compute volume contribution (direct + indirect) for an exercise
 *
 * This is the core of indirect volume accounting:
 * - Primary muscles receive DIRECT sets
 * - Secondary muscles receive INDIRECT sets (× 0.3 multiplier)
 *
 * Example: Bench Press (8 sets)
 * - Chest: 8 direct
 * - Front Delts: 2.4 indirect (8 × 0.3)
 * - Triceps: 2.4 indirect (8 × 0.3)
 *
 * @param exercise - Exercise to evaluate
 * @param sets - Number of sets
 * @returns Volume contribution map per muscle
 */
export function computeVolumeContribution(
  exercise: Exercise,
  sets: number
): VolumeContribution {
  const contribution: VolumeContribution = new Map();

  // Direct volume from primary muscles
  for (const muscle of exercise.primaryMuscles ?? []) {
    const existing = contribution.get(muscle) ?? { direct: 0, indirect: 0 };
    contribution.set(muscle, {
      ...existing,
      direct: existing.direct + sets,
    });
  }

  // Indirect volume from secondary muscles
  for (const muscle of exercise.secondaryMuscles ?? []) {
    const existing = contribution.get(muscle) ?? { direct: 0, indirect: 0 };
    contribution.set(muscle, {
      ...existing,
      indirect: existing.indirect + sets,
    });
  }

  return contribution;
}

/**
 * Merge volume contribution into existing volume map
 *
 * Converts { direct, indirect } → effective volume (direct + 0.3 × indirect)
 *
 * @param existing - Current effective volume map
 * @param contribution - Volume contribution to add
 * @returns Merged effective volume map
 */
export function mergeVolume(
  existing: Map<Muscle, number>,
  contribution: VolumeContribution
): Map<Muscle, number> {
  const merged = new Map(existing);

  for (const [muscle, { direct, indirect }] of contribution) {
    const current = merged.get(muscle) ?? 0;
    const effective = direct + indirect * INDIRECT_SET_MULTIPLIER;
    merged.set(muscle, current + effective);
  }

  return merged;
}

/**
 * Estimate time contribution for an exercise (used in beam search)
 *
 * Uses the same estimation logic as estimateWorkoutMinutes() for accuracy.
 * Accounts for:
 * - Warmup sets (if main lift)
 * - Rep-aware rest periods
 * - Exercise-specific work time
 *
 * @param exercise - Exercise to evaluate
 * @param sets - Number of sets
 * @param objective - Selection objective (for determining rep ranges and main lift status)
 * @returns Estimated time in minutes
 */
function estimateTimeContribution(
  exercise: Exercise,
  sets: number,
  objective: SelectionObjective
): number {
  if (sets <= 0) return 0;

  // Determine if this would be a main lift based on exercise metadata
  const isMainLift = exercise.isMainLiftEligible ?? false;

  // Estimate target reps based on training goal (for rep-aware rest)
  const goalRepRanges = objective.goals ? getGoalRepRanges(objective.goals.primary) : undefined;
  const targetReps = goalRepRanges
    ? isMainLift
      ? Math.floor((goalRepRanges.main[0] + goalRepRanges.main[1]) / 2)
      : Math.floor((goalRepRanges.accessory[0] + goalRepRanges.accessory[1]) / 2)
    : undefined;

  return estimateExerciseMinutes(exercise, sets, isMainLift, targetReps);
}

/**
 * Compute proposed sets for an exercise based on volume deficit
 *
 * Heuristic: Propose sets proportional to largest deficit among primary muscles
 * With tight time budgets, propose fewer sets for accessories to fit more exercises
 *
 * @param exercise - Exercise to evaluate
 * @param objective - Selection objective
 * @returns Proposed number of sets (2-5)
 */
export function computeProposedSets(
  exercise: Exercise,
  objective: SelectionObjective
): number {
  const MIN_SETS = 2;
  const MAX_SETS = 5;
  const DEFAULT_SETS = 3;
  const TIGHT_BUDGET_THRESHOLD = 40; // Minutes
  const TIGHT_BUDGET_ACCESSORY_CAP = 3; // Cap accessories at 3 sets when time is tight

  // Find largest deficit among primary muscles
  let maxDeficit = 0;
  for (const muscle of exercise.primaryMuscles ?? []) {
    const target = objective.volumeContext.weeklyTarget.get(muscle) ?? 0;
    const actual = objective.volumeContext.effectiveActual.get(muscle) ?? 0;
    const deficit = Math.max(0, target - actual);
    maxDeficit = Math.max(maxDeficit, deficit);
  }

  // If no deficit, default to 3 sets
  if (maxDeficit === 0) return DEFAULT_SETS;

  // Propose sets proportional to deficit (but clamped 2-5)
  let proposedSets = Math.ceil(maxDeficit / 2); // Heuristic: deficit / 2
  proposedSets = Math.max(MIN_SETS, Math.min(MAX_SETS, proposedSets));

  // Time-aware adjustment: With tight budgets, cap accessory sets to fit more exercises
  const timeBudget = objective.constraints.timeBudget;
  const isTightBudget = timeBudget < TIGHT_BUDGET_THRESHOLD;
  const isMainLift = exercise.isMainLiftEligible ?? false;

  if (isTightBudget && !isMainLift) {
    // Cap accessories at 3 sets to leave room for more exercises
    proposedSets = Math.min(proposedSets, TIGHT_BUDGET_ACCESSORY_CAP);
  }

  return proposedSets;
}
