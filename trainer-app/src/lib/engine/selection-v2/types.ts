/**
 * Selection V2: Multi-Objective Beam Search Optimizer
 *
 * Type definitions for the beam search-based exercise selection system.
 * Supports indirect volume accounting, rotation memory, and Pareto optimization.
 */

import type { Exercise, Muscle, EquipmentType, TrainingAge, Goals } from "../types";
import type { BlockContext } from "../periodization/types";

// ============================================================================
// Selection Objective (Input to Optimizer)
// ============================================================================

/**
 * Multi-objective selection specification with hard constraints and soft weights
 */
export interface SelectionObjective {
  /**
   * Hard constraints (MUST satisfy)
   */
  constraints: SelectionConstraints;

  /**
   * Soft objective weights (0-1, sum to 1.0)
   */
  weights: SelectionWeights;

  /**
   * Volume context (target, actual, deficits)
   */
  volumeContext: SelectionVolumeContext;

  /**
   * Exercise rotation context (exposure history)
   */
  rotationContext: RotationContext;

  /**
   * Muscle recovery context (SRA readiness)
   */
  sraContext: SRAContext;

  /**
   * Periodization context (from Phase 1)
   */
  blockContext?: BlockContext;

  /**
   * User preferences
   */
  preferences: SelectionPreferences;

  /**
   * Training goals (for rep range estimation)
   */
  goals?: Goals;
}

/**
 * Hard constraints that MUST be satisfied
 */
export interface SelectionConstraints {
  /** Minimum effective volume per muscle (MEV floor) */
  volumeFloor: Map<Muscle, number>;

  /** Maximum effective volume per muscle (MRV ceiling) */
  volumeCeiling: Map<Muscle, number>;

  /** Maximum session duration in minutes */
  timeBudget: number;

  /** Available equipment */
  equipment: Set<EquipmentType>;

  /** Contraindicated exercises (pain conflicts, user avoids) */
  contraindications: Set<string>; // Exercise IDs

  /** Minimum number of exercises */
  minExercises: number;

  /** Maximum number of exercises */
  maxExercises: number;

  /** Minimum main lifts (0 for body_part, 1 for push/pull/legs) */
  minMainLifts?: number;

  /** Maximum main lifts (prevent over-fatigue, typically 2-3) */
  maxMainLifts?: number;

  /** Minimum accessories (ensure variety, typically 2-3) */
  minAccessories?: number;
}

/**
 * Soft objective weights (sum to 1.0)
 *
 * Default weights (Phase 2 focus):
 * - volumeDeficitFill: 0.40 (primary objective)
 * - rotationNovelty: 0.25 (force variety)
 * - sfrEfficiency: 0.15 (moderate)
 * - lengthenedBias: 0.10 (defer to Phase 4)
 * - movementDiversity: 0.05 (defer to Phase 4)
 * - sraReadiness: 0.03 (advisory)
 * - userPreference: 0.02 (tiebreaker)
 */
export interface SelectionWeights {
  /** Prioritize filling volume deficits */
  volumeDeficitFill: number;

  /** Prefer exercises not recently used */
  rotationNovelty: number;

  /** Prefer high stimulus-to-fatigue ratio */
  sfrEfficiency: number;

  /** Prefer lengthened-position loading */
  lengthenedBias: number;

  /** Prefer diverse movement patterns */
  movementDiversity: number;

  /** Prefer targeting recovered muscles */
  sraReadiness: number;

  /** Respect user favorites */
  userPreference: number;
}

/**
 * Selection-specific volume context (Map-based for performance)
 * Different from engine VolumeContext type (Record-based for compatibility)
 */
export interface SelectionVolumeContext {
  /** Target sets per muscle this week */
  weeklyTarget: Map<Muscle, number>;

  /** Sets already completed this week (direct only) */
  weeklyActual: Map<Muscle, number>;

  /**
   * Effective sets already completed (direct + 0.3 × indirect)
   * This is the key field for indirect volume accounting
   */
  effectiveActual: Map<Muscle, number>;
}

/**
 * Rotation context: exercise exposure history
 *
 * CRITICAL: Keyed by exercise NAME, not ID
 * (ExerciseExposure table uses exerciseName as the tracking key)
 */
export type RotationContext = Map<
  string, // Exercise NAME (not ID!)
  ExerciseExposure
>;

/**
 * Exercise exposure data (from ExerciseExposure table + computed fields)
 */
export interface ExerciseExposure {
  /** Last time this exercise was used */
  lastUsed: Date;

  /** Weeks since last use (computed) */
  weeksAgo: number;

  /** Total usage count (all time) */
  usageCount: number;

  /** Performance trend */
  trend: PerformanceTrend;
}

/**
 * Performance trend classification
 */
export type PerformanceTrend = "improving" | "stalled" | "declining";

/**
 * SRA (Stimulus-Recovery-Adaptation) context
 */
export type SRAContext = Map<Muscle, number>; // 0-1, where 1.0 = fully recovered

/**
 * Selection-specific user preferences (Set-based for performance)
 * Different from engine UserPreferences type (array-based for serialization)
 */
export interface SelectionPreferences {
  /** Favorite exercise IDs */
  favoriteExerciseIds: Set<string>;

  /** Avoided exercise IDs */
  avoidExerciseIds: Set<string>;
}

// ============================================================================
// Selection Candidate (Scored Exercise)
// ============================================================================

/**
 * A candidate exercise with proposed sets and multi-objective scores
 */
export interface SelectionCandidate {
  /** The exercise being evaluated */
  exercise: Exercise;

  /** Proposed number of sets */
  proposedSets: number;

  /** Volume contribution (direct + indirect per muscle) */
  volumeContribution: VolumeContribution;

  /** Time contribution in minutes */
  timeContribution: number;

  /** Multi-objective scores (0-1 normalized) */
  scores: CandidateScores;

  /** Weighted total score */
  totalScore: number;
}

/**
 * Volume contribution per muscle (direct and indirect)
 */
export type VolumeContribution = Map<
  Muscle,
  {
    direct: number; // Sets directly targeting this muscle (primary)
    indirect: number; // Sets indirectly hitting this muscle (secondary)
  }
>;

/**
 * Multi-objective scores for a candidate (all 0-1 normalized)
 */
export interface CandidateScores {
  /** How much this fills volume deficits (0-1) */
  deficitFill: number;

  /** Rotation novelty (0 = used yesterday, 1 = never used) */
  rotationNovelty: number;

  /** SFR efficiency (exercise.sfrScore / 5) */
  sfrScore: number;

  /** Lengthened position score (exercise.lengthPositionScore / 5) */
  lengthenedScore: number;

  /** Movement pattern diversity (0 = duplicate, 1 = novel) */
  movementNovelty: number;

  /** SRA alignment (avg recovery of primary muscles, 0-1) */
  sraAlignment: number;

  /** User preference (1.0 = favorite, 0.5 = neutral, 0.0 = avoid) */
  userPreference: number;
}

// ============================================================================
// Selection Result (Output from Optimizer)
// ============================================================================

/**
 * Result of beam search optimization
 */
export interface SelectionResult {
  /** Selected exercises (ordered by beam search priority) */
  selected: SelectionCandidate[];

  /** Rejected exercises with reasons */
  rejected: RejectedExercise[];

  /** Total effective volume filled per muscle */
  volumeFilled: Map<Muscle, number>;

  /** Remaining volume deficit per muscle */
  volumeDeficit: Map<Muscle, number>;

  /** Total time used in minutes */
  timeUsed: number;

  /** Whether all hard constraints are satisfied */
  constraintsSatisfied: boolean;

  /** Explainability rationale */
  rationale: SelectionRationale;
}

/**
 * Rejected exercise with reason
 */
export interface RejectedExercise {
  exercise: Exercise;
  reason: RejectionReason;
}

/**
 * Rejection reasons (hard filter failures)
 */
export type RejectionReason =
  | "already_selected"
  | "equipment_unavailable"
  | "contraindicated"
  | "time_budget_exceeded"
  | "volume_ceiling_reached"
  | "sra_not_ready"
  | "dominated_by_better_option" // Pareto-dominated
  | "user_avoided"
  | "pain_conflict"
  | "sfr_below_threshold"
  | "structure_constraint_violated"; // Too many/few main lifts or accessories

/**
 * Explainability rationale for selection
 */
export interface SelectionRationale {
  /** Overall selection strategy description */
  overallStrategy: string;

  /** Per-exercise justification */
  perExercise: Map<string, string>; // Exercise ID → rationale

  /** Alternative exercises considered but rejected */
  alternativesConsidered?: Map<string, Exercise[]>; // Exercise ID → alternatives
}

// ============================================================================
// Beam Search Internal State
// ============================================================================

/**
 * Beam state during search (internal, not exported)
 */
export interface BeamState {
  /** Exercises selected so far */
  selected: SelectionCandidate[];

  /** Effective volume filled so far */
  volumeFilled: Map<Muscle, number>;

  /** Time used so far */
  timeUsed: number;

  /** Cumulative score */
  score: number;
}

/**
 * Beam search configuration
 */
export interface BeamSearchConfig {
  /** Beam width (number of top states to keep) */
  beamWidth: number;

  /** Maximum search depth (max exercises to select) */
  maxDepth: number;
}

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Default selection weights (Phase 2 focus: indirect volume + rotation)
 *
 * Note: movementDiversity weight is low because candidates are scored once at initialization.
 * Beam search cannot adapt scores based on beam state, making diversity weight ineffective
 * at preventing movement pattern clustering. This will be addressed in Phase 3 with beam
 * state tracking.
 */
export const DEFAULT_SELECTION_WEIGHTS: SelectionWeights = {
  volumeDeficitFill: 0.4, // Primary objective - fill volume deficits efficiently
  rotationNovelty: 0.25, // High weight - force variety across sessions
  sfrEfficiency: 0.15, // Moderate - efficiency matters
  movementDiversity: 0.05, // Low - ineffective without beam state tracking (Phase 3)
  lengthenedBias: 0.1, // Moderate - lengthened position bias
  sraReadiness: 0.03, // Advisory only
  userPreference: 0.02, // Tiebreaker
};

/**
 * Default beam search config
 */
export const DEFAULT_BEAM_CONFIG: BeamSearchConfig = {
  beamWidth: 5,
  maxDepth: 8,
};

/**
 * Cold start beam configs (reduced complexity for new users)
 */
export const COLD_START_BEAM_CONFIGS: Record<0 | 1 | 2, BeamSearchConfig> = {
  0: { beamWidth: 2, maxDepth: 2 }, // Minimal (1-2 exercises)
  1: { beamWidth: 3, maxDepth: 5 }, // Moderate
  2: DEFAULT_BEAM_CONFIG, // Full
};
