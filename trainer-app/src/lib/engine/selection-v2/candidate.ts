/**
 * Candidate Building: Convert exercises into scored candidates
 *
 * Core logic for indirect volume accounting and multi-objective scoring.
 */

import type { Exercise, Muscle } from "../types";
import { getEffectiveStimulusByMuscle } from "../stimulus";
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
  scoreCompoundSlotProfileAlignment,
} from "./scoring";
import { getGoalRepRanges, getGoalSetMultiplier } from "../rules";
import { getRestSeconds, REST_SECONDS } from "../prescription";

const COMPOUND_SLOT_PROFILE_ALIGNMENT_WEIGHT = 0.18;

function buildDeficitScoringContribution(
  exercise: Exercise,
  contribution: VolumeContribution,
  objective: SelectionObjective
): VolumeContribution {
  // Pull intent: prioritize primary-muscle deficits only.
  // This prevents forearm-focused hangs from scoring on secondary lat/back spillover.
  if (objective.sessionIntent !== "pull") {
    return contribution;
  }

  const filtered: VolumeContribution = new Map();
  for (const muscle of exercise.primaryMuscles ?? []) {
    const effective = contribution.get(muscle) ?? 0;
    if (effective <= 0) {
      continue;
    }
    filtered.set(muscle, effective);
  }

  // Shrug-style trap isolation should not drive pull-session deficit targeting.
  const isTrapIsolation =
    !(exercise.isCompound ?? false) &&
    (exercise.movementPatterns ?? []).includes("isolation") &&
    (exercise.primaryMuscles ?? []).length === 1 &&
    (exercise.primaryMuscles ?? [])[0] === "Upper Back";
  if (isTrapIsolation) {
    filtered.delete("Upper Back");
  }

  return filtered;
}

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
  const deficitContribution = buildDeficitScoringContribution(exercise, volumeContribution, objective);

  // Compute multi-objective scores
  const scores: CandidateScores = {
    deficitFill: scoreDeficitFill(deficitContribution, objective.volumeContext),
    rotationNovelty: scoreRotationNovelty(exercise, objective.rotationContext),
    sfrScore: scoreSFR(exercise),
    lengthenedScore: scoreLengthened(exercise),
    movementNovelty: scoreMovementNovelty(exercise, objective, []),
    sraAlignment: scoreSRAAlignment(exercise, objective.sraContext),
    userPreference: scoreUserPreference(exercise, objective.preferences),
    slotProfileAlignment: scoreCompoundSlotProfileAlignment(exercise, objective.slotProfile),
  };

  // Compute weighted total score
  const totalScore =
    scores.deficitFill * objective.weights.volumeDeficitFill +
    scores.rotationNovelty * objective.weights.rotationNovelty +
    scores.sfrScore * objective.weights.sfrEfficiency +
    scores.lengthenedScore * objective.weights.lengthenedBias +
    scores.movementNovelty * objective.weights.movementDiversity +
    scores.sraAlignment * objective.weights.sraReadiness +
    scores.userPreference * objective.weights.userPreference +
    (scores.slotProfileAlignment ?? 0) * COMPOUND_SLOT_PROFILE_ALIGNMENT_WEIGHT;

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
  return getEffectiveStimulusByMuscle(exercise, sets);
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

  for (const [muscle, effective] of contribution) {
    const current = merged.get(muscle) ?? 0;
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
  const DEFAULT_SETS = 3;
  const isMainLift =
    (exercise.isMainLiftEligible ?? false) &&
    !(objective.constraints.demotedFromMainLift?.has(exercise.id) ?? false);
  const lifecycleSetTarget = objective.constraints.lifecycleSetTargets
    ? isMainLift
      ? objective.constraints.lifecycleSetTargets.main
      : objective.constraints.lifecycleSetTargets.accessory
    : undefined;
  const supplementalPlannerProfile = objective.constraints.supplementalPlannerProfile === true;

  // G2: Training-age-aware set cap (KB §8)
  // Beginner 6-10 sets/week → smaller per-exercise cap; Advanced 16-25+ → larger cap
  const MAX_SETS_BY_AGE: Record<string, number> = { beginner: 4, intermediate: 5, advanced: 6 };
  const MAX_SETS = MAX_SETS_BY_AGE[objective.trainingAge ?? "intermediate"] ?? 5;

  // G3: Fat-loss goal multiplier (KB §8: reduce volume ~20-33% during caloric deficit)
  const goalMultiplier = objective.goals?.primary
    ? getGoalSetMultiplier(objective.goals.primary)
    : 1;
  const primaryDeficits = (exercise.primaryMuscles ?? []).map((muscle) => {
    const target = objective.volumeContext.weeklyTarget.get(muscle) ?? 0;
    const actual = objective.volumeContext.effectiveActual.get(muscle) ?? 0;
    return Math.max(0, target - actual);
  });
  const maxDeficit = Math.max(0, ...primaryDeficits);
  const resolveSupplementalSetCap = () => {
    if (!supplementalPlannerProfile) {
      return undefined;
    }
    if (isMainLift) {
      return maxDeficit <= 1.5 ? 1 : 2;
    }
    if (maxDeficit <= 1.5) {
      return 1;
    }
    if (maxDeficit <= 3.5) {
      return 2;
    }
    return 3;
  };
  const supplementalSetCap = resolveSupplementalSetCap();

  if (lifecycleSetTarget !== undefined) {
    if (supplementalPlannerProfile) {
      return Math.max(1, Math.min(supplementalSetCap ?? lifecycleSetTarget, lifecycleSetTarget));
    }
    return Math.max(MIN_SETS, lifecycleSetTarget);
  }

  // Find largest deficit among primary muscles
  // If no deficit, default to 3 sets (with goal multiplier)
  if (maxDeficit === 0) {
    const defaultSets = Math.max(MIN_SETS, Math.round(DEFAULT_SETS * goalMultiplier));
    if (supplementalPlannerProfile) {
      return Math.max(1, Math.min(supplementalSetCap ?? defaultSets, defaultSets));
    }
    return defaultSets;
  }

  // Propose sets proportional to deficit, apply goal multiplier, clamp to [MIN_SETS, MAX_SETS]
  // The C1b per-session per-muscle direct-set ceiling (SESSION_DIRECT_SET_CEILING = 12)
  // in beam-search.ts acts as the natural per-session cap.
  const rawSets = Math.max(MIN_SETS, Math.min(MAX_SETS, Math.ceil(maxDeficit / 2)));
  const proposedSets = Math.max(MIN_SETS, Math.round(rawSets * goalMultiplier));
  if (supplementalPlannerProfile) {
    return Math.max(1, Math.min(supplementalSetCap ?? proposedSets, proposedSets));
  }
  return proposedSets;
}

/**
 * Estimate time contribution for a single exercise.
 * Accounts for warmup sets (main lifts), rep-aware rest periods, and work time.
 */
function estimateExerciseMinutes(
  exercise: Exercise,
  sets: number,
  isMainLift: boolean,
  targetReps?: number
): number {
  if (sets <= 0) return 0;

  const workSeconds = exercise.timePerSetSec ?? (isMainLift ? 60 : 40);
  const repAwareWorkSeconds =
    targetReps !== undefined ? Math.max(20, Math.min(90, targetReps * 2 + 10)) : undefined;
  const finalWorkSeconds = repAwareWorkSeconds ?? workSeconds;
  const restSeconds = getRestSeconds(exercise, isMainLift, targetReps);
  const workingSeconds = (finalWorkSeconds + restSeconds) * sets;

  let warmupSeconds = 0;
  if (isMainLift) {
    warmupSeconds = 3 * (30 + REST_SECONDS.warmup);
  }

  return Math.round((workingSeconds + warmupSeconds) / 60);
}
