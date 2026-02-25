/**
 * Beam Search: Multi-Objective Optimization Algorithm
 *
 * Beam search finds near-optimal exercise combinations by:
 * 1. Maintaining top K partial solutions (beam width)
 * 2. Expanding each by adding one exercise
 * 3. Pruning to keep top K
 * 4. Repeating until max depth reached
 *
 * Complexity: O(beamWidth × maxDepth × candidates)
 * - Typical: 5 × 8 × 50 = 2,000 state evaluations
 * - Empirically: ~2-3ms on modern CPU
 */

import type { Muscle } from "../types";
import type {
  SelectionCandidate,
  SelectionObjective,
  BeamState,
  BeamSearchConfig,
  SelectionResult,
  RejectedExercise,
  RejectionReason,
} from "./types";
import { BEAM_TIEBREAKER_EPSILON } from "./types";
import { buildCandidate, mergeVolume } from "./candidate";
import { generateRationale } from "./rationale";
import { scoreMovementNovelty, scoreDeficitFillDynamic } from "./scoring";

function isMainLiftCandidate(
  candidate: SelectionCandidate,
  objective: SelectionObjective
): boolean {
  if (!(candidate.exercise.isMainLiftEligible ?? false)) {
    return false;
  }
  const demoted = objective.constraints.demotedFromMainLift;
  return !(demoted?.has(candidate.exercise.id) ?? false);
}

function hasMovementPattern(candidate: SelectionCandidate, pattern: SelectionCandidate["exercise"]["movementPatterns"][number]): boolean {
  return (candidate.exercise.movementPatterns ?? []).includes(pattern);
}

function getExerciseBaseName(name: string): string {
  return name.split("(")[0].trim().toLowerCase();
}

function sharesBaseExerciseName(
  selected: SelectionCandidate[],
  candidate: SelectionCandidate
): boolean {
  const candidateBase = getExerciseBaseName(candidate.exercise.name);
  if (!candidateBase) {
    return false;
  }
  return selected.some((entry) => {
    const selectedBase = getExerciseBaseName(entry.exercise.name);
    return (
      selectedBase.length > 0 &&
      (selectedBase.startsWith(candidateBase) || candidateBase.startsWith(selectedBase))
    );
  });
}

function isPullCompoundCandidate(candidate: SelectionCandidate): boolean {
  if (!(candidate.exercise.isCompound ?? false)) {
    return false;
  }
  return (
    hasMovementPattern(candidate, "horizontal_pull") ||
    hasMovementPattern(candidate, "vertical_pull")
  );
}

function wouldViolatePullStructure(
  state: BeamState,
  candidate: SelectionCandidate,
  objective: SelectionObjective
): boolean {
  if (objective.sessionIntent !== "pull") {
    return false;
  }

  const candidateIsMainLift = isMainLiftCandidate(candidate, objective);
  if (candidateIsMainLift && hasMovementPattern(candidate, "vertical_pull")) {
    const existingVerticalMainLifts = state.selected.filter(
      (selected) =>
        isMainLiftCandidate(selected, objective) && hasMovementPattern(selected, "vertical_pull")
    ).length;
    if (existingVerticalMainLifts >= 1) {
      return true;
    }
  }

  const projected = [...state.selected, candidate];
  const pullCompoundCount = projected.filter((selected) => isPullCompoundCandidate(selected)).length;
  if (pullCompoundCount < 2) {
    return false;
  }

  const hasHorizontalPull = projected.some((selected) =>
    hasMovementPattern(selected, "horizontal_pull")
  );
  return !hasHorizontalPull;
}

/**
 * Check if beam state satisfies structural constraints (main lifts + accessories)
 *
 * @param state - Current beam state
 * @param newCandidate - Candidate being added
 * @param objective - Selection objective with constraints
 * @returns true if structure constraints would be satisfied, false otherwise
 */
function wouldSatisfyStructure(
  state: BeamState,
  newCandidate: SelectionCandidate,
  objective: SelectionObjective
): boolean {
  const { minMainLifts = 0, maxMainLifts = 99, minAccessories = 0 } = objective.constraints;

  // Count main lifts and accessories in new state
  const newSelected = [...state.selected, newCandidate];
  const mainLiftCount = newSelected.filter((c) => isMainLiftCandidate(c, objective)).length;
  const accessoryCount = newSelected.filter((c) => !isMainLiftCandidate(c, objective)).length;

  // Always enforce maximum constraints
  if (mainLiftCount > maxMainLifts) {
    return false;
  }

  // For minimum constraints, only enforce if we're at a reasonable depth
  // (allow exploration at shallow depths)
  const isNearFinal = newSelected.length >= objective.constraints.minExercises;
  if (isNearFinal) {
    // Check if we can still reach minimums with remaining budget
    const remainingSlots = objective.constraints.maxExercises - newSelected.length;

    // If we're short on main lifts and can't add more, reject
    if (mainLiftCount < minMainLifts) {
      const needMore = minMainLifts - mainLiftCount;
      if (remainingSlots < needMore) {
        return false;
      }
    }

    // If we're short on accessories and can't add more, reject
    if (accessoryCount < minAccessories) {
      const needMore = minAccessories - accessoryCount;
      if (remainingSlots < needMore) {
        return false;
      }
    }
  }

  return true;
}

function getMovementPatternCap(): number {
  return 2;
}

function wouldViolateMovementPatternCap(
  state: BeamState,
  candidate: SelectionCandidate
): boolean {
  const candidatePatterns = candidate.exercise.movementPatterns ?? [];
  return candidatePatterns.some((pattern) => {
    const count = state.selected.filter((s) =>
      (s.exercise.movementPatterns ?? []).includes(pattern)
    ).length;
    return count >= getMovementPatternCap();
  });
}

function shouldRejectLowSetAccessory(
  state: BeamState,
  candidate: SelectionCandidate,
  candidates: SelectionCandidate[],
  objective: SelectionObjective
): boolean {
  const minAccessoryProposedSets = objective.constraints.minAccessoryProposedSets ?? 0;
  const isAccessory = !isMainLiftCandidate(candidate, objective);
  if (minAccessoryProposedSets <= 0 || !isAccessory || candidate.proposedSets >= minAccessoryProposedSets) {
    return false;
  }

  const selectedIds = new Set(state.selected.map((selected) => selected.exercise.id));
  const qualifyingCount = candidates.filter(
    (entry) =>
      !selectedIds.has(entry.exercise.id) &&
      (isMainLiftCandidate(entry, objective) || entry.proposedSets >= minAccessoryProposedSets)
  ).length;
  return qualifyingCount >= objective.constraints.minExercises;
}

function hasRemainingDeficitFillingOption(
  state: BeamState,
  candidates: SelectionCandidate[],
  objective: SelectionObjective,
  excludedCandidateId: string
): boolean {
  if (state.selected.length >= objective.constraints.maxExercises) {
    return false;
  }

  const selectedIds = new Set(state.selected.map((candidate) => candidate.exercise.id));
  for (const candidate of candidates) {
    if (candidate.exercise.id === excludedCandidateId) continue;
    if (selectedIds.has(candidate.exercise.id)) continue;
    if (candidate.scores.deficitFill <= 0) continue;
    if (wouldViolateMovementPatternCap(state, candidate)) continue;
    if (wouldViolatePullStructure(state, candidate, objective)) continue;
    if (!wouldSatisfyStructure(state, candidate, objective)) continue;

    const mergedVolume = mergeVolume(state.volumeFilled, candidate.volumeContribution);
    if (exceedsCeiling(mergedVolume, objective.constraints.volumeCeiling)) continue;

    return true;
  }
  return false;
}

function computeMovementPatternPenalty(
  state: BeamState,
  candidate: SelectionCandidate,
  objective: SelectionObjective
): number {
  if (objective.sessionIntent !== "pull") {
    return 0;
  }

  const hasVerticalPull = (candidate.exercise.movementPatterns ?? []).includes("vertical_pull");
  if (!hasVerticalPull) {
    return 0;
  }

  const existingVerticalPulls = state.selected.filter((selected) =>
    (selected.exercise.movementPatterns ?? []).includes("vertical_pull")
  ).length;
  if (existingVerticalPulls < 2) {
    return 0;
  }

  // Soft-penalize third+ vertical pulls on pull days without hard-blocking them.
  return 0.2 * (existingVerticalPulls - 1);
}

function getMissingRequiredMuscles(
  selected: SelectionCandidate[],
  objective: SelectionObjective
): Muscle[] {
  const required = objective.constraints.requiredMuscles ?? [];
  if (required.length === 0) {
    return [];
  }

  return required.filter(
    (muscle) =>
      !selected.some(
        (entry) =>
          !isMainLiftCandidate(entry, objective) &&
          (entry.exercise.primaryMuscles ?? []).includes(muscle)
      )
  );
}

function candidateSatisfiesRequiredMuscle(
  candidate: SelectionCandidate,
  missingRequiredMuscles: Muscle[],
  objective: SelectionObjective
): boolean {
  if (missingRequiredMuscles.length === 0) {
    return false;
  }
  if (isMainLiftCandidate(candidate, objective)) {
    return false;
  }
  return missingRequiredMuscles.some((muscle) =>
    (candidate.exercise.primaryMuscles ?? []).includes(muscle)
  );
}

function computeMainLiftPatternDuplicatePenalty(
  state: BeamState,
  candidate: SelectionCandidate,
  objective: SelectionObjective
): number {
  const candidateIsMainLift = isMainLiftCandidate(candidate, objective);
  if (!candidateIsMainLift) {
    return 0;
  }

  const candidatePatterns = new Set(candidate.exercise.movementPatterns ?? []);
  if (candidatePatterns.size === 0) {
    return 0;
  }

  const duplicatedMainLiftCount = state.selected.filter((selected) => {
    if (!isMainLiftCandidate(selected, objective)) {
      return false;
    }
    return (selected.exercise.movementPatterns ?? []).some((pattern) =>
      candidatePatterns.has(pattern)
    );
  }).length;

  if (duplicatedMainLiftCount === 0) {
    return 0;
  }

  // Heavy soft-penalty: strongly discourage duplicate main-lift patterns without hard-blocking.
  return 0.9 * duplicatedMainLiftCount;
}

function hasGenuinePrimaryMuscleDeficit(
  state: BeamState,
  candidate: SelectionCandidate,
  objective: SelectionObjective,
  muscle: Muscle
): boolean {
  const target = objective.volumeContext.weeklyTarget.get(muscle) ?? 0;
  const historicalActual = objective.volumeContext.effectiveActual.get(muscle) ?? 0;
  const beamActual = state.volumeFilled.get(muscle) ?? 0;
  const remainingDeficit = Math.max(0, target - (historicalActual + beamActual));

  const candidateDirect = candidate.volumeContribution.get(muscle)?.direct ?? 0;
  if (candidateDirect <= 0) {
    return false;
  }

  // Treat duplicate isolation as warranted only when deficit materially exceeds one direct-isolation dose.
  return remainingDeficit > candidateDirect;
}

/**
 * Execute beam search to find optimal exercise combination
 *
 * @param candidates - Pool of scored candidates
 * @param objective - Selection objective with constraints
 * @param config - Beam search configuration (width, depth)
 * @returns Selection result with best combination found
 */
export function beamSearch(
  candidates: SelectionCandidate[],
  objective: SelectionObjective,
  config: BeamSearchConfig
): SelectionResult {
  // Initialize beam with empty state
  let beam: BeamState[] = [
    {
      selected: [],
      volumeFilled: new Map(),
      timeUsed: 0,
      score: 0,
      favoritesCount: 0,
    },
  ];

  // Track rejected exercises
  const rejectedMap = new Map<string, RejectionReason>();

  // Expand beam depth-by-depth
  for (let depth = 0; depth < config.maxDepth; depth++) {
    const nextBeam: BeamState[] = [];

    // Expand each beam state
    for (const state of beam) {
      // Try adding each candidate
      for (const candidate of candidates) {
        // Check if already selected
        if (state.selected.some((c) => c.exercise.id === candidate.exercise.id)) {
          continue;
        }

        // Accumulate time (display only — not enforced as hard constraint)
        const newTimeUsed = state.timeUsed + candidate.timeContribution;

        // Merge volume
        const newVolumeFilled = mergeVolume(state.volumeFilled, candidate.volumeContribution);

        // Check volume ceiling constraint
        if (exceedsCeiling(newVolumeFilled, objective.constraints.volumeCeiling)) {
          rejectedMap.set(candidate.exercise.id, "volume_ceiling_reached");
          continue;
        }

        // Check max exercises constraint
        if (state.selected.length >= objective.constraints.maxExercises) {
          continue; // Beam state already at max
        }

        // Check structural constraints (main lifts vs accessories balance)
        if (!wouldSatisfyStructure(state, candidate, objective)) {
          rejectedMap.set(candidate.exercise.id, "structure_constraint_violated");
          continue;
        }

        if (shouldRejectLowSetAccessory(state, candidate, candidates, objective)) {
          rejectedMap.set(candidate.exercise.id, "dominated_by_better_option");
          continue;
        }

        const missingRequiredMuscles = getMissingRequiredMuscles(state.selected, objective);
        const candidateSatisfiesRequirement = candidateSatisfiesRequiredMuscle(
          candidate,
          missingRequiredMuscles,
          objective
        );
        const candidateIsMainLift = isMainLiftCandidate(candidate, objective);
        const mainLiftsSelected = state.selected.filter((selected) =>
          isMainLiftCandidate(selected, objective)
        ).length;
        const minMainLifts = objective.constraints.minMainLifts ?? 0;
        const fillsMainLiftRequirement = candidateIsMainLift && mainLiftsSelected < minMainLifts;
        const candidateHasDeficit = candidate.scores.deficitFill > 0 || fillsMainLiftRequirement;
        if (
          !candidateHasDeficit &&
          !candidateSatisfiesRequirement &&
          state.selected.length >= objective.constraints.minExercises
        ) {
          rejectedMap.set(candidate.exercise.id, "dominated_by_better_option");
          continue;
        }
        if (
          !candidateHasDeficit &&
          !candidateSatisfiesRequirement &&
          hasRemainingDeficitFillingOption(state, candidates, objective, candidate.exercise.id)
        ) {
          rejectedMap.set(candidate.exercise.id, "dominated_by_better_option");
          continue;
        }

        if (wouldViolateMovementPatternCap(state, candidate)) {
          continue;
        }
        if (sharesBaseExerciseName(state.selected, candidate)) {
          rejectedMap.set(candidate.exercise.id, "dominated_by_better_option");
          continue;
        }
        if (wouldViolatePullStructure(state, candidate, objective)) {
          rejectedMap.set(candidate.exercise.id, "structure_constraint_violated");
          continue;
        }

        // C1: Per-session triceps isolation cap
        // KB: MRV=18 for triceps accounts for full pressing stimulus. When ≥2 pressing
        // compounds have Triceps as primary, allow only 1 isolation to stay within per-session
        // safe zone (~half of weekly MRV per push session).
        const isDirectTricepsIsolation =
          !isMainLiftCandidate(candidate, objective) &&
          !(candidate.exercise.isCompound ?? false) &&
          (candidate.exercise.primaryMuscles ?? []).includes("Triceps");

        if (isDirectTricepsIsolation) {
          const pressingCompoundsInState = state.selected.filter(
            (c) =>
              (c.exercise.isCompound ?? false) &&
              (c.exercise.primaryMuscles ?? []).includes("Triceps")
          ).length;

          if (pressingCompoundsInState >= 2) {
            const tricepsIsolationsInState = state.selected.filter(
              (c) =>
                !isMainLiftCandidate(c, objective) &&
                !(c.exercise.isCompound ?? false) &&
                (c.exercise.primaryMuscles ?? []).includes("Triceps")
            ).length;

            if (tricepsIsolationsInState >= 1) {
              // Already have 1 triceps isolation with 2+ pressing compounds — block more
              continue;
            }
          }
        }

        // C1b: Per-session per-muscle direct-set ceiling
        // KB: ~10–12 hard sets per muscle per session before diminishing returns dominate.
        // Applies to all muscles — prevents chest/front-delt/triceps over-accumulation on push days.
        const SESSION_DIRECT_SET_CEILING = 12;
        let exceedsSessionMuscle = false;
        for (const [muscle, { direct }] of candidate.volumeContribution) {
          if (direct > 0) {
            const currentDirect = state.selected.reduce(
              (sum, c) => sum + (c.volumeContribution.get(muscle)?.direct ?? 0),
              0
            );
            if (currentDirect + direct > SESSION_DIRECT_SET_CEILING) {
              exceedsSessionMuscle = true;
              break;
            }
          }
        }
        if (exceedsSessionMuscle) {
          rejectedMap.set(candidate.exercise.id, "volume_ceiling_reached");
          continue;
        }

        // W2: Hard-block isolation exercises that duplicate pattern AND primary muscle
        // Engine quality rule: same isolation pattern + same primary muscle = redundant stimulus
        const candidateIsIsolation =
          !isMainLiftCandidate(candidate, objective) &&
          !(candidate.exercise.isCompound ?? false);

        if (candidateIsIsolation) {
          const candidatePatterns = candidate.exercise.movementPatterns ?? [];
          const isolationDuplicate = state.selected.some((selected) => {
            const selectedIsIsolation =
              !isMainLiftCandidate(selected, objective) &&
              !(selected.exercise.isCompound ?? false);
            if (!selectedIsIsolation) return false;

            const samePattern = candidatePatterns.some((pattern) =>
              (selected.exercise.movementPatterns ?? []).includes(pattern)
            );
            const sharedPrimary = (candidate.exercise.primaryMuscles ?? []).filter((muscle) =>
              (selected.exercise.primaryMuscles ?? []).includes(muscle)
            ) as Muscle[];
            if (!samePattern && sharedPrimary.length === 0) {
              return false;
            }

            // Block duplicate isolation-by-primary-muscle unless a meaningful deficit remains.
            return !sharedPrimary.some((muscle) =>
              hasGenuinePrimaryMuscleDeficit(state, candidate, objective, muscle)
            );
          });
          if (isolationDuplicate) {
            rejectedMap.set(candidate.exercise.id, "dominated_by_better_option");
            continue;
          }
        }

        // W3: Suppress direct front delt work when any direct pressing compound already covers them
        // KB: "Front delts: MEV=0, most lifters need zero direct isolation" (KB Section 4 Shoulders)
        // OHP contributes 3.0 direct effective sets → threshold 1.0 catches any session with OHP.
        // Indirect-only sessions (e.g., bench-only with no OHP) reach ~0.45 effective — not blocked.
        const FRONT_DELT_SUPPRESS_THRESHOLD = 1.0;
        const isDirectFrontDelt =
          !isMainLiftCandidate(candidate, objective) &&
          (candidate.exercise.primaryMuscles ?? []).includes("Front Delts");

        if (isDirectFrontDelt) {
          const currentFrontDeltVolume = state.volumeFilled.get("Front Delts") ?? 0;
          if (currentFrontDeltVolume >= FRONT_DELT_SUPPRESS_THRESHOLD) {
            rejectedMap.set(candidate.exercise.id, "volume_ceiling_reached");
            continue;
          }
        }

        // Dynamic movement novelty: re-score based on already-selected exercises
        // so the beam search favors exercises that add new movement patterns.
        const alreadySelected = state.selected.map((c) => c.exercise);
        const dynamicNovelty = scoreMovementNovelty(candidate.exercise, objective, alreadySelected);
        const noveltyAdjustment =
          objective.weights.movementDiversity *
          (dynamicNovelty - candidate.scores.movementNovelty);

        // Dynamic deficit fill: re-score against current beam's volume state so that
        // exercises filling *remaining* deficits score higher than those targeting
        // muscles already covered earlier in this beam path.
        const dynamicDeficitFill = scoreDeficitFillDynamic(
          candidate.volumeContribution,
          objective.volumeContext,
          state.volumeFilled
        );
        const deficitFillAdjustment =
          objective.weights.volumeDeficitFill *
          (dynamicDeficitFill - candidate.scores.deficitFill);
        const movementPatternPenalty = computeMovementPatternPenalty(state, candidate, objective);
        const mainLiftPatternDuplicatePenalty = computeMainLiftPatternDuplicatePenalty(
          state,
          candidate,
          objective
        );

        const adjustedScore =
          candidate.totalScore +
          noveltyAdjustment +
          deficitFillAdjustment -
          movementPatternPenalty -
          mainLiftPatternDuplicatePenalty;

        // Valid expansion - create new beam state
        const isFavorite = objective.preferences.favoriteExerciseIds.has(candidate.exercise.id);
        nextBeam.push({
          selected: [...state.selected, candidate],
          volumeFilled: newVolumeFilled,
          timeUsed: newTimeUsed,
          score: state.score + adjustedScore,
          favoritesCount: state.favoritesCount + (isFavorite ? 1 : 0),
        });
      }
    }

    // Early stopping if no valid expansions
    if (nextBeam.length === 0) {
      break; // Keep previous beam
    }

    // Prune beam: keep top beamWidth states by score.
    // Tiebreaker: when states are within BEAM_TIEBREAKER_EPSILON of each other,
    // prefer the state containing more user-favorite exercises.
    beam = nextBeam
      .sort((a, b) => {
        const scoreDiff = b.score - a.score;
        if (Math.abs(scoreDiff) < BEAM_TIEBREAKER_EPSILON) {
          return b.favoritesCount - a.favoritesCount;
        }
        return scoreDiff;
      })
      .slice(0, config.beamWidth);
  }

  // Select best beam state
  const bestBeam = beam[0] ?? {
    selected: [],
    volumeFilled: new Map(),
    timeUsed: 0,
    score: 0,
    favoritesCount: 0,
  };

  // Enforce minimum exercise constraint if needed
  let finalBeam = enforceMinExercises(bestBeam, candidates, objective, rejectedMap);

  // Enforce structural constraints (main lifts + accessories balance)
  finalBeam = enforceStructuralConstraints(finalBeam, candidates, objective, rejectedMap);

  // Enforce required primary-muscle coverage (e.g., direct biceps on pull sessions)
  finalBeam = enforceRequiredMuscles(finalBeam, candidates, objective, rejectedMap);
  // Enforce continuity from most-recent same-intent performed session when feasible.
  finalBeam = enforceContinuityExercises(finalBeam, candidates, objective, rejectedMap);

  // Build final result
  return buildResult(finalBeam, candidates, objective, rejectedMap);
}

/**
 * Check if volume exceeds ceiling for any muscle
 *
 * @param volumeFilled - Current effective volume
 * @param volumeCeiling - MRV ceiling per muscle
 * @returns True if any muscle exceeds ceiling
 */
function exceedsCeiling(
  volumeFilled: Map<Muscle, number>,
  volumeCeiling: Map<Muscle, number>
): boolean {
  for (const [muscle, filled] of volumeFilled) {
    const ceiling = volumeCeiling.get(muscle);
    if (ceiling !== undefined && filled > ceiling) {
      return true;
    }
  }
  return false;
}

/**
 * Enforce minimum exercise constraint
 *
 * If beam has fewer than minExercises, greedily add more candidates.
 * If blocked by time budget, reduce sets on selected exercises to make room.
 *
 * @param beam - Best beam state
 * @param candidates - Full candidate pool
 * @param objective - Selection objective
 * @param rejectedMap - Rejection tracking
 * @returns Beam state with >= minExercises
 */
function enforceMinExercises(
  beam: BeamState,
  candidates: SelectionCandidate[],
  objective: SelectionObjective,
  rejectedMap: Map<string, RejectionReason>
): BeamState {
  // Check if already satisfies min constraint
  if (beam.selected.length >= objective.constraints.minExercises) {
    return beam;
  }

  // Clone beam for modification
  const augmentedBeam: BeamState = {
    selected: [...beam.selected],
    volumeFilled: new Map(beam.volumeFilled),
    timeUsed: beam.timeUsed,
    score: beam.score,
    favoritesCount: beam.favoritesCount,
  };

  // Greedily add candidates until min constraint satisfied
  const remainingCandidates = candidates
    .filter((c) => !augmentedBeam.selected.some((s) => s.exercise.id === c.exercise.id))
    .sort((a, b) => b.totalScore - a.totalScore); // Sort by score descending

  for (const candidate of remainingCandidates) {
    // Check if min constraint now satisfied
    if (augmentedBeam.selected.length >= objective.constraints.minExercises) {
      break;
    }

    // Merge volume
    const newVolumeFilled = mergeVolume(augmentedBeam.volumeFilled, candidate.volumeContribution);

    // Check volume ceiling
    if (exceedsCeiling(newVolumeFilled, objective.constraints.volumeCeiling)) {
      rejectedMap.set(candidate.exercise.id, "volume_ceiling_reached");
      continue;
    }

    // Add to beam
    augmentedBeam.selected.push(candidate);
    augmentedBeam.volumeFilled = newVolumeFilled;
    augmentedBeam.timeUsed += candidate.timeContribution;
    augmentedBeam.score += candidate.totalScore;
  }

  return augmentedBeam;
}

/**
 * Enforce structural constraints (main lifts + accessories balance)
 *
 * If beam doesn't satisfy minMainLifts/minAccessories, greedily add required exercises.
 * Prioritizes main lifts first, then accessories.
 *
 * @param beam - Best beam state
 * @param candidates - Full candidate pool
 * @param objective - Selection objective
 * @param rejectedMap - Rejection tracking
 * @returns Beam state satisfying structural constraints
 */
function enforceStructuralConstraints(
  beam: BeamState,
  candidates: SelectionCandidate[],
  objective: SelectionObjective,
  rejectedMap: Map<string, RejectionReason>
): BeamState {
  const { minMainLifts = 0, minAccessories = 0 } = objective.constraints;

  // Count current main lifts and accessories
  const mainLiftCount = beam.selected.filter((c) => isMainLiftCandidate(c, objective)).length;
  const accessoryCount = beam.selected.filter((c) => !isMainLiftCandidate(c, objective)).length;

  // Check if already satisfies structural constraints
  if (mainLiftCount >= minMainLifts && accessoryCount >= minAccessories) {
    return beam;
  }


  // Clone beam for modification
  const augmentedBeam: BeamState = {
    selected: [...beam.selected],
    volumeFilled: new Map(beam.volumeFilled),
    timeUsed: beam.timeUsed,
    score: beam.score,
    favoritesCount: beam.favoritesCount,
  };

  // Get remaining candidates (not already selected)
  const selectedIds = new Set(augmentedBeam.selected.map((s) => s.exercise.id));
  const remainingCandidates = candidates.filter((c) => !selectedIds.has(c.exercise.id));

  // Step 1: Add main lifts if needed
  if (mainLiftCount < minMainLifts) {
    const mainLiftCandidates = remainingCandidates
      .filter((c) => isMainLiftCandidate(c, objective))
      .sort((a, b) => b.totalScore - a.totalScore);


    for (const candidate of mainLiftCandidates) {
      const currentMainLifts = augmentedBeam.selected.filter((c) =>
        isMainLiftCandidate(c, objective)
      ).length;
      if (currentMainLifts >= minMainLifts) break;

      const canAdd = canAddCandidate(augmentedBeam, candidate, candidates, objective, rejectedMap);
      if (canAdd) {
        addCandidateToBeam(augmentedBeam, candidate);
      } else {
        // Try swapping out lowest-scoring accessories to make room
        const swapped = trySwapForMainLift(augmentedBeam, candidate, candidates, objective, rejectedMap);
        if (swapped) {
          break; // Successfully added a main lift, check if we need more
        }
      }
    }
  }

  // Step 2: Add accessories if needed
  const currentAccessories = augmentedBeam.selected.filter((c) =>
    !isMainLiftCandidate(c, objective)
  ).length;
  if (currentAccessories < minAccessories) {
    const accessoryCandidates = remainingCandidates
      .filter((c) => !isMainLiftCandidate(c, objective))
      .filter((c) => !augmentedBeam.selected.some((s) => s.exercise.id === c.exercise.id))
      .sort((a, b) => b.totalScore - a.totalScore);

    for (const candidate of accessoryCandidates) {
      const currentAccessoryCount = augmentedBeam.selected.filter((c) =>
        !isMainLiftCandidate(c, objective)
      ).length;
      if (currentAccessoryCount >= minAccessories) break;

      if (!canAddCandidate(augmentedBeam, candidate, candidates, objective, rejectedMap)) {
        continue;
      }

      addCandidateToBeam(augmentedBeam, candidate);
    }
  }

  return augmentedBeam;
}

function enforceRequiredMuscles(
  beam: BeamState,
  candidates: SelectionCandidate[],
  objective: SelectionObjective,
  rejectedMap: Map<string, RejectionReason>
): BeamState {
  const requiredMuscles = objective.constraints.requiredMuscles ?? [];
  if (requiredMuscles.length === 0) {
    return beam;
  }

  const augmentedBeam: BeamState = {
    selected: [...beam.selected],
    volumeFilled: new Map(beam.volumeFilled),
    timeUsed: beam.timeUsed,
    score: beam.score,
    favoritesCount: beam.favoritesCount,
  };

  const updateMissing = () => getMissingRequiredMuscles(augmentedBeam.selected, objective);
  let missing = updateMissing();
  if (missing.length === 0) {
    return augmentedBeam;
  }

  while (
    missing.length > 0 &&
    augmentedBeam.selected.length < objective.constraints.maxExercises
  ) {
    const selectedIds = new Set(augmentedBeam.selected.map((selected) => selected.exercise.id));
    const matchingCandidates = candidates
      .filter((candidate) => !selectedIds.has(candidate.exercise.id))
      .filter((candidate) => candidateSatisfiesRequiredMuscle(candidate, missing, objective))
      .sort((a, b) => b.totalScore - a.totalScore);

    if (matchingCandidates.length === 0) {
      break;
    }

    const chosen = matchingCandidates
      .map((candidate) =>
        candidate.proposedSets >= 3 ? candidate : buildCandidate(candidate.exercise, objective, 3)
      )
      .find((candidate) => canAddCandidate(augmentedBeam, candidate, candidates, objective, rejectedMap));
    if (!chosen) {
      break;
    }

    addCandidateToBeam(augmentedBeam, chosen);
    missing = updateMissing();
  }

  return augmentedBeam;
}

function enforceContinuityExercises(
  beam: BeamState,
  candidates: SelectionCandidate[],
  objective: SelectionObjective,
  rejectedMap: Map<string, RejectionReason>
): BeamState {
  const preferredContinuityExerciseIds = objective.constraints.preferredContinuityExerciseIds;
  if (!preferredContinuityExerciseIds || preferredContinuityExerciseIds.size === 0) {
    return beam;
  }

  const candidateById = new Map(candidates.map((candidate) => [candidate.exercise.id, candidate]));
  const augmentedBeam: BeamState = {
    selected: [...beam.selected],
    volumeFilled: new Map(beam.volumeFilled),
    timeUsed: beam.timeUsed,
    score: beam.score,
    favoritesCount: beam.favoritesCount,
  };

  const continuityCandidates = [...preferredContinuityExerciseIds]
    .map((exerciseId) => candidateById.get(exerciseId))
    .filter((candidate): candidate is SelectionCandidate => Boolean(candidate))
    .sort((a, b) => b.totalScore - a.totalScore);

  for (const continuityCandidate of continuityCandidates) {
    if (augmentedBeam.selected.some((selected) => selected.exercise.id === continuityCandidate.exercise.id)) {
      continue;
    }

    if (
      canAddCandidate(augmentedBeam, continuityCandidate, candidates, objective, rejectedMap, {
        allowNonDeficitCandidate: true,
      })
    ) {
      addCandidateToBeam(augmentedBeam, continuityCandidate);
      continue;
    }

    const nonContinuitySelected = augmentedBeam.selected
      .filter((selected) => !preferredContinuityExerciseIds.has(selected.exercise.id))
      .sort((a, b) => a.totalScore - b.totalScore);

    for (const toReplace of nonContinuitySelected) {
      const tempBeam: BeamState = {
        selected: augmentedBeam.selected.filter(
          (selected) => selected.exercise.id !== toReplace.exercise.id
        ),
        volumeFilled: new Map(),
        timeUsed: 0,
        score: 0,
        favoritesCount: 0,
      };

      for (const selected of tempBeam.selected) {
        tempBeam.volumeFilled = mergeVolume(tempBeam.volumeFilled, selected.volumeContribution);
        tempBeam.timeUsed += selected.timeContribution;
        tempBeam.score += selected.totalScore;
        if (objective.preferences.favoriteExerciseIds.has(selected.exercise.id)) {
          tempBeam.favoritesCount += 1;
        }
      }

      if (
        !canAddCandidate(tempBeam, continuityCandidate, candidates, objective, rejectedMap, {
          allowNonDeficitCandidate: true,
        })
      ) {
        continue;
      }

      addCandidateToBeam(tempBeam, continuityCandidate);
      augmentedBeam.selected = tempBeam.selected;
      augmentedBeam.volumeFilled = tempBeam.volumeFilled;
      augmentedBeam.timeUsed = tempBeam.timeUsed;
      augmentedBeam.score = tempBeam.score;
      augmentedBeam.favoritesCount = tempBeam.favoritesCount;
      rejectedMap.set(toReplace.exercise.id, "dominated_by_better_option");
      break;
    }
  }

  const rebuildBeamState = (selected: SelectionCandidate[]): BeamState => {
    const rebuilt: BeamState = {
      selected,
      volumeFilled: new Map(),
      timeUsed: 0,
      score: 0,
      favoritesCount: 0,
    };
    for (const item of selected) {
      rebuilt.volumeFilled = mergeVolume(rebuilt.volumeFilled, item.volumeContribution);
      rebuilt.timeUsed += item.timeContribution;
      rebuilt.score += item.totalScore;
      if (objective.preferences.favoriteExerciseIds.has(item.exercise.id)) {
        rebuilt.favoritesCount += 1;
      }
    }
    return rebuilt;
  };

  const continuitySelected = new Set(
    augmentedBeam.selected
      .filter((selected) => preferredContinuityExerciseIds.has(selected.exercise.id))
      .map((selected) => selected.exercise.id)
  );
  const allContinuitySelected = continuitySelected.size === preferredContinuityExerciseIds.size;
  if (allContinuitySelected) {
    const continuityPatterns = new Set(
      augmentedBeam.selected
        .filter((selected) => preferredContinuityExerciseIds.has(selected.exercise.id))
        .flatMap((selected) => selected.exercise.movementPatterns ?? [])
    );
    const removableNonContinuity = augmentedBeam.selected
      .filter((selected) => !preferredContinuityExerciseIds.has(selected.exercise.id))
      .filter((selected) =>
        (selected.exercise.movementPatterns ?? []).some((pattern) =>
          continuityPatterns.has(pattern)
        )
      )
      .sort((a, b) => a.totalScore - b.totalScore);

    for (const candidate of removableNonContinuity) {
      if (augmentedBeam.selected.length <= objective.constraints.minExercises) {
        break;
      }

      const nextSelected = augmentedBeam.selected.filter(
        (selected) => selected.exercise.id !== candidate.exercise.id
      );
      const mainLiftCount = nextSelected.filter((item) =>
        isMainLiftCandidate(item, objective)
      ).length;
      const accessoryCount = nextSelected.filter(
        (item) => !isMainLiftCandidate(item, objective)
      ).length;
      const minMainLifts = objective.constraints.minMainLifts ?? 0;
      const minAccessories = objective.constraints.minAccessories ?? 0;
      if (mainLiftCount < minMainLifts || accessoryCount < minAccessories) {
        continue;
      }

      const nextBeam = rebuildBeamState(nextSelected);
      augmentedBeam.selected = nextBeam.selected;
      augmentedBeam.volumeFilled = nextBeam.volumeFilled;
      augmentedBeam.timeUsed = nextBeam.timeUsed;
      augmentedBeam.score = nextBeam.score;
      augmentedBeam.favoritesCount = nextBeam.favoritesCount;
      rejectedMap.set(candidate.exercise.id, "dominated_by_better_option");
    }
  }

  return augmentedBeam;
}

/**
 * Check if a candidate can be added to beam without violating constraints
 */
function canAddCandidate(
  beam: BeamState,
  candidate: SelectionCandidate,
  candidates: SelectionCandidate[],
  objective: SelectionObjective,
  rejectedMap: Map<string, RejectionReason>,
  options?: { allowNonDeficitCandidate?: boolean }
): boolean {
  if (!wouldSatisfyStructure(beam, candidate, objective)) {
    rejectedMap.set(candidate.exercise.id, "structure_constraint_violated");
    return false;
  }

  // Merge volume
  const newVolumeFilled = mergeVolume(beam.volumeFilled, candidate.volumeContribution);

  // Check volume ceiling
  if (exceedsCeiling(newVolumeFilled, objective.constraints.volumeCeiling)) {
    rejectedMap.set(candidate.exercise.id, "volume_ceiling_reached");
    return false;
  }

  // Check max exercises
  if (beam.selected.length >= objective.constraints.maxExercises) {
    return false;
  }

  if (wouldViolatePullStructure(beam, candidate, objective)) {
    rejectedMap.set(candidate.exercise.id, "structure_constraint_violated");
    return false;
  }
  if (sharesBaseExerciseName(beam.selected, candidate)) {
    rejectedMap.set(candidate.exercise.id, "dominated_by_better_option");
    return false;
  }

  const hasDeficit = candidate.scores.deficitFill > 0;
  if (
    !options?.allowNonDeficitCandidate &&
    !hasDeficit &&
    hasRemainingDeficitFillingOption(beam, candidates, objective, candidate.exercise.id)
  ) {
    rejectedMap.set(candidate.exercise.id, "dominated_by_better_option");
    return false;
  }

  return true;
}

/**
 * Add a candidate to beam state (mutates beam)
 */
function addCandidateToBeam(beam: BeamState, candidate: SelectionCandidate): void {
  const newVolumeFilled = mergeVolume(beam.volumeFilled, candidate.volumeContribution);
  beam.selected.push(candidate);
  beam.volumeFilled = newVolumeFilled;
  beam.timeUsed += candidate.timeContribution;
  beam.score += candidate.totalScore;
}

/**
 * Try swapping out accessories to make room for a main lift
 *
 * Removes the lowest-scoring accessories until the main lift fits within constraints.
 * Only swaps accessories (never removes existing main lifts).
 *
 * @param beam - Beam state to modify
 * @param mainLift - Main lift candidate to add
 * @param objective - Selection objective
 * @param rejectedMap - Rejection tracking
 * @returns True if swap succeeded
 */
function trySwapForMainLift(
  beam: BeamState,
  mainLift: SelectionCandidate,
  candidates: SelectionCandidate[],
  objective: SelectionObjective,
  rejectedMap: Map<string, RejectionReason>
): boolean {
  // Get accessories sorted by score (lowest first - candidates for removal)
  const accessories = beam.selected
    .filter((c) => !isMainLiftCandidate(c, objective))
    .sort((a, b) => a.totalScore - b.totalScore);

  if (accessories.length === 0) {
    return false; // No accessories to swap
  }

  // Try removing accessories one by one until main lift fits
  const tempBeam: BeamState = {
    selected: [...beam.selected],
    volumeFilled: new Map(beam.volumeFilled),
    timeUsed: beam.timeUsed,
    score: beam.score,
    favoritesCount: beam.favoritesCount,
  };

  const removedAccessories: SelectionCandidate[] = [];

  for (const accessory of accessories) {
    // Remove the accessory
    const index = tempBeam.selected.findIndex((c) => c.exercise.id === accessory.exercise.id);
    if (index === -1) continue;

    tempBeam.selected.splice(index, 1);
    tempBeam.timeUsed -= accessory.timeContribution;
    tempBeam.score -= accessory.totalScore;
    removedAccessories.push(accessory);

    // Recalculate volume (conservative: just rebuild from scratch)
    tempBeam.volumeFilled = new Map();
    for (const candidate of tempBeam.selected) {
      tempBeam.volumeFilled = mergeVolume(tempBeam.volumeFilled, candidate.volumeContribution);
    }

    // Check if main lift now fits
    if (canAddCandidate(tempBeam, mainLift, candidates, objective, rejectedMap)) {
      // Success! Apply swap to original beam
      addCandidateToBeam(tempBeam, mainLift);
      beam.selected = tempBeam.selected;
      beam.volumeFilled = tempBeam.volumeFilled;
      beam.timeUsed = tempBeam.timeUsed;
      beam.score = tempBeam.score;

      return true;
    }

    // Not enough room yet, continue removing accessories
  }

  return false; // Couldn't make room even after removing all accessories
}

/**
 * Build final selection result from best beam state
 *
 * @param beam - Best beam state
 * @param allCandidates - Full candidate pool
 * @param objective - Selection objective
 * @param rejectedMap - Rejection tracking
 * @returns Complete selection result
 */
function buildResult(
  beam: BeamState,
  allCandidates: SelectionCandidate[],
  objective: SelectionObjective,
  rejectedMap: Map<string, RejectionReason>
): SelectionResult {
  const selected = beam.selected;
  const selectedIds = new Set(selected.map((c) => c.exercise.id));

  // Build rejected list
  const rejected: RejectedExercise[] = allCandidates
    .filter((c) => !selectedIds.has(c.exercise.id))
    .map((c) => ({
      exercise: c.exercise,
      reason: rejectedMap.get(c.exercise.id) ?? "dominated_by_better_option",
    }));

  // Compute remaining deficits
  const volumeDeficit = new Map<Muscle, number>();
  for (const [muscle, target] of objective.volumeContext.weeklyTarget) {
    const filled = beam.volumeFilled.get(muscle) ?? 0;
    const deficit = Math.max(0, target - filled);
    if (deficit > 0) {
      volumeDeficit.set(muscle, deficit);
    }
  }

  // Check constraint satisfaction
  const meetsMinExercises = selected.length >= objective.constraints.minExercises;
  const meetsVolumeFloor = Array.from(objective.constraints.volumeFloor).every(
    ([muscle, floor]) => (beam.volumeFilled.get(muscle) ?? 0) >= floor
  );

  // Check structural constraints (main lifts + accessories balance)
  const mainLiftCount = selected.filter((c) => isMainLiftCandidate(c, objective)).length;
  const accessoryCount = selected.filter((c) => !isMainLiftCandidate(c, objective)).length;
  const { minMainLifts = 0, maxMainLifts = 99, minAccessories = 0 } = objective.constraints;
  const meetsStructuralConstraints =
    mainLiftCount >= minMainLifts &&
    mainLiftCount <= maxMainLifts &&
    accessoryCount >= minAccessories;
  const requiredMuscles = objective.constraints.requiredMuscles ?? [];
  const meetsRequiredMuscles = requiredMuscles.every((muscle) =>
    selected.some(
      (candidate) =>
        !isMainLiftCandidate(candidate, objective) &&
        (candidate.exercise.primaryMuscles ?? []).includes(muscle)
    )
  );

  const constraintsSatisfied =
    meetsMinExercises && meetsVolumeFloor && meetsStructuralConstraints && meetsRequiredMuscles;

  // Annotate selected candidates with marginal deficitFill for rationale.
  // Simulate sequential selection so each exercise shows what it contributed
  // given what was already selected before it in the final beam path.
  let runningVolume = new Map<Muscle, number>();
  const annotatedSelected = selected.map((candidate) => {
    const marginalFill = scoreDeficitFillDynamic(
      candidate.volumeContribution,
      objective.volumeContext,
      runningVolume
    );
    runningVolume = mergeVolume(runningVolume, candidate.volumeContribution);
    return {
      ...candidate,
      scores: { ...candidate.scores, deficitFill: marginalFill },
    };
  });

  // Generate rationale
  const rationale = generateRationale(annotatedSelected, rejected, objective);

  return {
    selected,
    rejected,
    volumeFilled: beam.volumeFilled,
    volumeDeficit,
    timeUsed: beam.timeUsed,
    constraintsSatisfied,
    rationale,
  };
}

