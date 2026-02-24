/**
 * Optimizer: Main entry point for multi-objective exercise selection
 *
 * Orchestrates:
 * 1. Hard constraint filtering (isFeasible)
 * 2. Candidate building with scoring
 * 3. Beam search optimization
 * 4. Result validation
 */

import type { Exercise } from "../types";
import type {
  SelectionObjective,
  SelectionResult,
  SelectionCandidate,
  RejectionReason,
  BeamSearchConfig,
} from "./types";
import { DEFAULT_BEAM_CONFIG, COLD_START_BEAM_CONFIGS } from "./types";
import { buildCandidate, computeProposedSets } from "./candidate";
import { beamSearch } from "./beam-search";
import { generateRationale } from "./rationale";
import { INDIRECT_SET_MULTIPLIER } from "../volume-constants";

function isMainLiftExercise(
  exercise: Exercise,
  objective: SelectionObjective
): boolean {
  if (!(exercise.isMainLiftEligible ?? false)) {
    return false;
  }
  const demoted = objective.constraints.demotedFromMainLift;
  return !(demoted?.has(exercise.id) ?? false);
}

/**
 * Select exercises using multi-objective beam search optimization
 *
 * Main public API for selection-v2 module.
 *
 * @param pool - Available exercises
 * @param objective - Selection objective with constraints and weights
 * @param config - Optional beam search config (defaults to width=5, depth=8)
 * @returns Optimized selection result
 */
export function selectExercisesOptimized(
  pool: Exercise[],
  objective: SelectionObjective,
  config?: Partial<BeamSearchConfig>
): SelectionResult {
  // Resolve beam config (with cold start support)
  const beamConfig = resolveBeamConfig(objective, config);

  // Phase 1: Filter hard constraints
  const { feasible, rejected } = filterHardConstraints(pool, objective);

  // Early exit if no feasible exercises
  if (feasible.length === 0) {
    return {
      selected: [],
      rejected: rejected.map((ex) => ({
        exercise: ex.exercise,
        reason: ex.reason,
      })),
      volumeFilled: new Map(),
      volumeDeficit: objective.volumeContext.weeklyTarget,
      timeUsed: 0,
      constraintsSatisfied: false,
      rationale: {
        overallStrategy: "No feasible exercises available after constraint filtering.",
        perExercise: new Map(),
      },
    };
  }

  // Phase 2: Build scored candidates
  const candidates = feasible.map((exercise) => {
    const proposedSets = computeProposedSets(exercise, objective);
    const continuityMinSets =
      objective.constraints.continuityMinSetsByExerciseId?.get(exercise.id) ?? 0;
    const continuityProgressionIncrement =
      continuityMinSets > 0 ? objective.constraints.continuitySetProgressionIncrement ?? 0 : 0;
    const continuityProgressionFloor = Math.min(12, continuityMinSets + continuityProgressionIncrement);
    const isRequiredMuscleAccessory =
      !isMainLiftExercise(exercise, objective) &&
      (objective.constraints.requiredMuscles ?? []).some((muscle) =>
        (exercise.primaryMuscles ?? []).includes(muscle)
      );
    const normalizedSets = Math.max(
      continuityProgressionFloor,
      isRequiredMuscleAccessory && proposedSets < 3 ? 3 : proposedSets
    );
    return buildCandidate(exercise, objective, normalizedSets);
  });
  const minAccessoryProposedSets = objective.constraints.minAccessoryProposedSets ?? 0;
  const qualityFilteredCandidates =
    minAccessoryProposedSets <= 0
      ? candidates
      : candidates.filter(
          (candidate) =>
            isMainLiftExercise(candidate.exercise, objective) ||
            candidate.proposedSets >= minAccessoryProposedSets ||
            (objective.constraints.preferredContinuityExerciseIds?.has(candidate.exercise.id) ??
              false) ||
            (objective.constraints.requiredMuscles ?? []).some((muscle) =>
              (candidate.exercise.primaryMuscles ?? []).includes(muscle)
            )
        );
  const candidatesForSearch =
    qualityFilteredCandidates.length >= objective.constraints.minExercises
      ? qualityFilteredCandidates
      : candidates;

  // Sort so higher-stretch exercises are evaluated first within each tier.
  // Main lifts first (structural priority), then within non-main-lifts sort by
  // lengthPositionScore DESC. This ensures that when two isolations compete for
  // the same slot (same movementPattern + primaryMuscle), the one with superior
  // stretch stimulus wins — e.g. overhead cable extension (5/5) beats skull
  // crusher (3/5) and the isolation-duplicate filter then correctly blocks the
  // lower-quality option as "dominated_by_better_option".
  candidatesForSearch.sort((a, b) => {
    const aQualityTier = isMainLiftExercise(a.exercise, objective) || a.scores.deficitFill > 0 ? 1 : 0;
    const bQualityTier = isMainLiftExercise(b.exercise, objective) || b.scores.deficitFill > 0 ? 1 : 0;
    if (aQualityTier !== bQualityTier) return bQualityTier - aQualityTier;
    const aIsMain = isMainLiftExercise(a.exercise, objective) ? 1 : 0;
    const bIsMain = isMainLiftExercise(b.exercise, objective) ? 1 : 0;
    if (aIsMain !== bIsMain) return bIsMain - aIsMain;
    const aLen = a.exercise.lengthPositionScore ?? 3;
    const bLen = b.exercise.lengthPositionScore ?? 3;
    return bLen - aLen;
  });

  // Phase 3: Beam search optimization
  const result = beamSearch(candidatesForSearch, objective, beamConfig);

  // Phase 3.5: Post-beam stretch upgrade
  // Swap any selected isolation that is strictly dominated by an available
  // alternative (same muscle + pattern, higher lengthPositionScore, equal or
  // better sfrScore, passes hard constraints, fits time budget).
  const upgraded = applyStretchUpgrades(result, candidatesForSearch, objective);

  // Phase 4: Merge rejected exercises
  const allRejected = [
    ...rejected.map((ex) => ({ exercise: ex.exercise, reason: ex.reason })),
    ...upgraded.rejected,
  ];

  return {
    ...upgraded,
    rejected: allRejected,
  };
}

/**
 * Filter exercises by hard constraints
 *
 * Returns { feasible, rejected } where rejected includes reason
 *
 * Hard constraints:
 * 1. Pain conflicts
 * 2. User avoids
 *
 * @param pool - Full exercise pool
 * @param objective - Selection objective
 * @returns Feasible and rejected exercises
 */
function filterHardConstraints(
  pool: Exercise[],
  objective: SelectionObjective
): {
  feasible: Exercise[];
  rejected: { exercise: Exercise; reason: RejectionReason }[];
} {
  const feasible: Exercise[] = [];
  const rejected: { exercise: Exercise; reason: RejectionReason }[] = [];

  for (const exercise of pool) {
    const rejectionReason = checkHardConstraints(exercise, objective);

    if (rejectionReason) {
      rejected.push({ exercise, reason: rejectionReason });
    } else {
      feasible.push(exercise);
    }
  }

  return { feasible, rejected };
}

/**
 * Check if exercise passes all hard constraints
 *
 * @param exercise - Exercise to check
 * @param objective - Selection objective
 * @returns Rejection reason if failed, undefined if passed
 */
function checkHardConstraints(
  exercise: Exercise,
  objective: SelectionObjective
): RejectionReason | undefined {
  // 1. Pain conflicts (check first to distinguish from user avoids)
  if (objective.constraints.painConflicts.has(exercise.id)) {
    return "pain_conflict";
  }

  // 2. User avoids (explicit user preferences)
  if (objective.constraints.userAvoids.has(exercise.id)) {
    return "user_avoided";
  }

  return undefined; // Passed all constraints
}

/**
 * Resolve beam search config
 *
 * Supports cold start: reduce beam width/depth for new users
 *
 * @param objective - Selection objective
 * @param configOverride - Optional config override
 * @returns Resolved beam config
 */
function resolveBeamConfig(
  objective: SelectionObjective,
  configOverride?: Partial<BeamSearchConfig>
): BeamSearchConfig {
  // Check for cold start context (would be passed in objective)
  // For now, use default config
  const baseConfig = DEFAULT_BEAM_CONFIG;

  // Apply overrides
  return {
    beamWidth: configOverride?.beamWidth ?? baseConfig.beamWidth,
    maxDepth: configOverride?.maxDepth ?? baseConfig.maxDepth,
  };
}

/**
 * Post-beam stretch upgrade pass
 *
 * After beam search selects exercises, scan selected isolations for strictly
 * dominated alternatives. If a better-stretch isolation exists for the same
 * muscle + movement slot (higher lengthPositionScore, equal/better sfrScore,
 * passes hard constraints, not already selected), swap it in.
 *
 * This corrects beam path-competition artifacts where a lower-quality isolation
 * wins a beam state due to multi-exercise cumulative scoring dynamics, not
 * individual merit.
 */
function applyStretchUpgrades(
  result: SelectionResult,
  candidates: SelectionCandidate[],
  objective: SelectionObjective
): SelectionResult {
  const selectedIds = new Set(result.selected.map((c) => c.exercise.id));
  const newSelected = [...result.selected];
  let newRejected = [...result.rejected];
  let newTimeUsed = result.timeUsed;
  const newVolumeFilled = new Map(result.volumeFilled);

  let modified = false;

  for (let i = 0; i < newSelected.length; i++) {
    const current = newSelected[i];
    const ex = current.exercise;

    // Only upgrade isolation accessories (not main lifts, not compounds)
    if (isMainLiftExercise(ex, objective) || ex.isCompound) continue;

    const currentLen = ex.lengthPositionScore ?? 3;
    const currentSfr = ex.sfrScore ?? 3;

    let bestAlt: SelectionCandidate | null = null;
    let bestLen = currentLen;
    let bestSfr = currentSfr;

    for (const candidate of candidates) {
      const alt = candidate.exercise;

      // Skip if already in the (evolving) selected set
      if (selectedIds.has(alt.id)) continue;
      if (alt.id === ex.id) continue;

      // Must also be an isolation
      if (isMainLiftExercise(alt, objective) || alt.isCompound) continue;

      // Must be strictly better in lengthPositionScore
      const altLen = alt.lengthPositionScore ?? 3;
      if (altLen <= currentLen) continue;

      // Must be equal or better in sfrScore
      const altSfr = alt.sfrScore ?? 3;
      if (altSfr < currentSfr) continue;

      // Must share at least one movement pattern (same slot)
      const sharedPattern = (ex.movementPatterns ?? []).some((p) =>
        (alt.movementPatterns ?? []).includes(p)
      );
      if (!sharedPattern) continue;

      // Must share at least one primary muscle (same slot)
      const sharedMuscle = (ex.primaryMuscles ?? []).some((m) =>
        (alt.primaryMuscles ?? []).includes(m)
      );
      if (!sharedMuscle) continue;

      // Must pass hard constraints
      if (objective.constraints.painConflicts.has(alt.id)) continue;
      if (objective.constraints.userAvoids.has(alt.id)) continue;

      // Best upgrade = highest lengthPositionScore, then highest sfrScore
      if (altLen > bestLen || (altLen === bestLen && altSfr > bestSfr)) {
        bestAlt = candidate;
        bestLen = altLen;
        bestSfr = altSfr;
      }
    }

    if (bestAlt) {
      modified = true;

      // Swap in the better exercise
      newSelected[i] = bestAlt;
      selectedIds.delete(ex.id);
      selectedIds.add(bestAlt.exercise.id);

      // Update time used
      newTimeUsed =
        newTimeUsed - current.timeContribution + bestAlt.timeContribution;

      // Update volumeFilled: subtract displaced contribution, add replacement
      for (const [muscle, { direct, indirect }] of current.volumeContribution) {
        const prev = newVolumeFilled.get(muscle) ?? 0;
        newVolumeFilled.set(
          muscle,
          Math.max(0, prev - (direct + indirect * INDIRECT_SET_MULTIPLIER))
        );
      }
      for (const [muscle, { direct, indirect }] of bestAlt.volumeContribution) {
        const prev = newVolumeFilled.get(muscle) ?? 0;
        newVolumeFilled.set(muscle, prev + direct + indirect * INDIRECT_SET_MULTIPLIER);
      }

      // Update rejected: remove alt (no longer rejected), add displaced exercise
      newRejected = newRejected.filter((r) => r.exercise.id !== bestAlt!.exercise.id);
      newRejected.push({ exercise: ex, reason: "dominated_by_better_option" });
    }
  }

  if (!modified) return result;

  // Regenerate rationale to reflect the updated selection
  const newRationale = generateRationale(newSelected, newRejected, objective);

  return {
    ...result,
    selected: newSelected,
    rejected: newRejected,
    timeUsed: newTimeUsed,
    volumeFilled: newVolumeFilled,
    rationale: newRationale,
  };
}
