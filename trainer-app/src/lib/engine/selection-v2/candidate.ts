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
    movementNovelty: scoreMovementNovelty(exercise, objective),
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
 * Estimate time contribution for an exercise
 *
 * Time = (work seconds + rest seconds) × sets / 60
 *
 * Rest periods based on block context intensity (if available)
 *
 * @param exercise - Exercise to evaluate
 * @param sets - Number of sets
 * @param objective - Selection objective (for block context)
 * @returns Estimated time in minutes
 */
function estimateTimeContribution(
  exercise: Exercise,
  sets: number,
  objective: SelectionObjective
): number {
  if (sets <= 0) return 0;

  // Work time per set
  const workSeconds = exercise.timePerSetSec ?? 40;

  // Rest time depends on block intensity
  const restSeconds = getRestSeconds(exercise, objective);

  // Total time
  return ((workSeconds + restSeconds) * sets) / 60;
}

/**
 * Get rest seconds based on exercise and block context
 *
 * Default rest periods:
 * - Strength (high intensity): 180-240s
 * - Hypertrophy (moderate): 90-120s
 * - Endurance (low): 60s
 *
 * @param exercise - Exercise to evaluate
 * @param objective - Selection objective (for block context)
 * @returns Rest seconds
 */
function getRestSeconds(exercise: Exercise, objective: SelectionObjective): number {
  // If block context available, use block-specific rest periods
  if (objective.blockContext) {
    const blockType = objective.blockContext.block.blockType;

    // Accumulation/Intensification: moderate-high rest
    if (blockType === "accumulation" || blockType === "intensification") {
      return 120; // 2 minutes
    }

    // Realization: high rest (peaking)
    if (blockType === "realization") {
      return 180; // 3 minutes
    }

    // Deload: low rest
    if (blockType === "deload") {
      return 60; // 1 minute
    }
  }

  // Default: moderate rest
  return 90; // 1.5 minutes
}

/**
 * Compute proposed sets for an exercise based on volume deficit
 *
 * Heuristic: Propose sets proportional to largest deficit among primary muscles
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
  const proposedSets = Math.ceil(maxDeficit / 2); // Heuristic: deficit / 2
  return Math.max(MIN_SETS, Math.min(MAX_SETS, proposedSets));
}
