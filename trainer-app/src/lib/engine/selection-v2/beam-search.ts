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
import { mergeVolume } from "./candidate";
import { generateRationale } from "./rationale";
import { scoreMovementNovelty } from "./scoring";

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
  const mainLiftCount = newSelected.filter((c) => c.exercise.isMainLiftEligible).length;
  const accessoryCount = newSelected.filter((c) => !c.exercise.isMainLiftEligible).length;

  // Always enforce maximum constraints
  if (mainLiftCount > maxMainLifts) {
    // DEBUG: Log rejections for troubleshooting
    if (state.selected.length < 2 && newCandidate.exercise.isMainLiftEligible) {
    }
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
        // DEBUG
        if (state.selected.length < 4) {
        }
        return false;
      }
    }

    // If we're short on accessories and can't add more, reject
    if (accessoryCount < minAccessories) {
      const needMore = minAccessories - accessoryCount;
      if (remainingSlots < needMore) {
        // DEBUG
        if (state.selected.length < 4 && !newCandidate.exercise.isMainLiftEligible) {
        }
        return false;
      }
    }
  }

  return true;
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

        // Hard cap: max 2 exercises per movement pattern
        const MOVEMENT_PATTERN_CAP = 2;
        const candidatePatterns = candidate.exercise.movementPatterns ?? [];
        const patternViolation = candidatePatterns.some((pattern) => {
          const count = state.selected.filter((s) =>
            (s.exercise.movementPatterns ?? []).includes(pattern)
          ).length;
          return count >= MOVEMENT_PATTERN_CAP;
        });
        if (patternViolation) {
          continue;
        }

        // C1: Per-session triceps isolation cap
        // KB: MRV=18 for triceps accounts for full pressing stimulus. When ≥2 pressing
        // compounds have Triceps as primary, allow only 1 isolation to stay within per-session
        // safe zone (~half of weekly MRV per push session).
        const isDirectTricepsIsolation =
          !candidate.exercise.isMainLiftEligible &&
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
                !c.exercise.isMainLiftEligible &&
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
          !candidate.exercise.isMainLiftEligible &&
          !(candidate.exercise.isCompound ?? false);

        if (candidateIsIsolation && candidatePatterns.length > 0) {
          const isolationDuplicate = candidatePatterns.some((pattern) =>
            state.selected.some((s) => {
              const sIsIsolation =
                !s.exercise.isMainLiftEligible && !(s.exercise.isCompound ?? false);
              if (!sIsIsolation) return false;
              const samePattern = (s.exercise.movementPatterns ?? []).includes(pattern);
              const sharedPrimary = (candidate.exercise.primaryMuscles ?? []).some((m) =>
                (s.exercise.primaryMuscles ?? []).includes(m)
              );
              return samePattern && sharedPrimary;
            })
          );
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
          !candidate.exercise.isMainLiftEligible &&
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
        const adjustedScore = candidate.totalScore + noveltyAdjustment;

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
  const mainLiftCount = beam.selected.filter((c) => c.exercise.isMainLiftEligible).length;
  const accessoryCount = beam.selected.filter((c) => !c.exercise.isMainLiftEligible).length;

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
      .filter((c) => c.exercise.isMainLiftEligible)
      .sort((a, b) => b.totalScore - a.totalScore);


    for (const candidate of mainLiftCandidates) {
      const currentMainLifts = augmentedBeam.selected.filter((c) => c.exercise.isMainLiftEligible).length;
      if (currentMainLifts >= minMainLifts) break;

      const canAdd = canAddCandidate(augmentedBeam, candidate, objective, rejectedMap, true); // Enable debug
      if (canAdd) {
        addCandidateToBeam(augmentedBeam, candidate);
      } else {
        // Try swapping out lowest-scoring accessories to make room
        const swapped = trySwapForMainLift(augmentedBeam, candidate, objective, rejectedMap);
        if (swapped) {
          break; // Successfully added a main lift, check if we need more
        }
      }
    }
  }

  // Step 2: Add accessories if needed
  const currentAccessories = augmentedBeam.selected.filter((c) => !c.exercise.isMainLiftEligible).length;
  if (currentAccessories < minAccessories) {
    const accessoryCandidates = remainingCandidates
      .filter((c) => !c.exercise.isMainLiftEligible)
      .filter((c) => !augmentedBeam.selected.some((s) => s.exercise.id === c.exercise.id))
      .sort((a, b) => b.totalScore - a.totalScore);

    for (const candidate of accessoryCandidates) {
      const currentAccessoryCount = augmentedBeam.selected.filter((c) => !c.exercise.isMainLiftEligible).length;
      if (currentAccessoryCount >= minAccessories) break;

      if (!canAddCandidate(augmentedBeam, candidate, objective, rejectedMap)) {
        continue;
      }

      addCandidateToBeam(augmentedBeam, candidate);
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
  objective: SelectionObjective,
  rejectedMap: Map<string, RejectionReason>,
  debug = false
): boolean {
  // Merge volume
  const newVolumeFilled = mergeVolume(beam.volumeFilled, candidate.volumeContribution);

  // Check volume ceiling
  if (exceedsCeiling(newVolumeFilled, objective.constraints.volumeCeiling)) {
    rejectedMap.set(candidate.exercise.id, "volume_ceiling_reached");
    if (debug) {
    }
    return false;
  }

  // Check max exercises
  if (beam.selected.length >= objective.constraints.maxExercises) {
    if (debug) {
    }
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
  objective: SelectionObjective,
  rejectedMap: Map<string, RejectionReason>
): boolean {
  // Get accessories sorted by score (lowest first - candidates for removal)
  const accessories = beam.selected
    .filter((c) => !c.exercise.isMainLiftEligible)
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
    if (canAddCandidate(tempBeam, mainLift, objective, rejectedMap, false)) {
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
  const mainLiftCount = selected.filter((c) => c.exercise.isMainLiftEligible).length;
  const accessoryCount = selected.filter((c) => !c.exercise.isMainLiftEligible).length;
  const { minMainLifts = 0, maxMainLifts = 99, minAccessories = 0 } = objective.constraints;
  const meetsStructuralConstraints =
    mainLiftCount >= minMainLifts &&
    mainLiftCount <= maxMainLifts &&
    accessoryCount >= minAccessories;

  const constraintsSatisfied = meetsMinExercises && meetsVolumeFloor && meetsStructuralConstraints;

  // Generate rationale
  const rationale = generateRationale(selected, rejected, objective);

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
