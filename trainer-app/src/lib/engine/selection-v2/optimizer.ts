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
    return buildCandidate(exercise, objective, proposedSets);
  });

  // Phase 3: Beam search optimization
  const result = beamSearch(candidates, objective, beamConfig);

  // Phase 4: Merge rejected exercises
  const allRejected = [
    ...rejected.map((ex) => ({ exercise: ex.exercise, reason: ex.reason })),
    ...result.rejected,
  ];

  return {
    ...result,
    rejected: allRejected,
  };
}

/**
 * Filter exercises by hard constraints
 *
 * Returns { feasible, rejected } where rejected includes reason
 *
 * Hard constraints:
 * 1. Equipment availability
 * 2. User avoids / contraindications
 * 3. Pain conflicts
 * 4. SFR threshold (hypertrophy/fat_loss only)
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
  // 1. Equipment availability
  if (!hasAvailableEquipment(exercise, objective.constraints.equipment)) {
    return "equipment_unavailable";
  }

  // 2. User avoids
  if (objective.constraints.contraindications.has(exercise.id)) {
    return "contraindicated";
  }

  // 3. Pain conflicts (check exercise contraindications)
  // Note: painFlags would need to be passed in objective if implemented
  // For now, rely on contraindications set

  // 4. SFR threshold (hypertrophy/fat_loss accessories)
  // Defer to full implementation - would need goal context

  return undefined; // Passed all constraints
}

/**
 * Check if exercise has available equipment
 *
 * @param exercise - Exercise to check
 * @param availableEquipment - Set of available equipment types
 * @returns True if equipment is available
 */
function hasAvailableEquipment(
  exercise: Exercise,
  availableEquipment: Set<string>
): boolean {
  const requiredEquipment = exercise.equipment ?? [];

  // No equipment required → always available
  if (requiredEquipment.length === 0) return true;

  // Bodyweight → always available
  if (requiredEquipment.includes("bodyweight")) return true;

  // Check if at least one required equipment type is available
  return requiredEquipment.some((eq) => availableEquipment.has(eq));
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
