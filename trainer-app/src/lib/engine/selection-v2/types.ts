/**
 * Selection V2: Multi-Objective Beam Search Optimizer
 *
 * Type definitions for the beam search-based exercise selection system.
 * Supports indirect volume accounting, rotation memory, and Pareto optimization.
 */

import type { Exercise, Muscle, Goals } from "../types";
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

  /**
   * Exercise IDs excluded due to pain flags or recent pain signals
   * @see RejectionReason "pain_conflict"
   */
  painConflicts: Set<string>;

  /**
   * Exercise IDs explicitly avoided by user (via preferences)
   * @see RejectionReason "user_avoided"
   */
  userAvoids: Set<string>;

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
 * See DEFAULT_SELECTION_WEIGHTS for values and KB citations.
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
  | "contraindicated"
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

  /** Number of user-favorite exercises in this state (for tiebreaker) */
  favoritesCount: number;
}

/**
 * Score difference threshold for applying the favorites tiebreaker during
 * beam pruning. When two beam states differ by less than this amount,
 * the state containing more user-favorite exercises is preferred.
 *
 * 0.05 ≈ 5% of a single exercise's maximum contribution, so the tiebreaker
 * fires only when states are genuinely equivalent in quality.
 */
export const BEAM_TIEBREAKER_EPSILON = 0.05;

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
 * Default selection weights (sum to 1.0)
 *
 * Priority order: volume deficit → rotation novelty → lengthened bias → SFR efficiency
 * → movement diversity (beam state-aware) → SRA readiness (advisory) → user preference (tiebreaker)
 *
 * KB grounding:
 * - volumeDeficitFill: primary hypertrophy variable (Pelland 2024, Schoenfeld 2017)
 * - rotationNovelty: rotate 2–4 exercises per mesocycle (KB §2)
 * - lengthenedBias: +40% growth from lengthened position (Maeo 2023, Kassiano 2023, Pedrosa 2022)
 * - sfrEfficiency: maximize stimulus per unit fatigue (Israetel SFR framework, KB §3)
 * - movementDiversity: dynamically re-scored per beam state during expansion
 */
export const DEFAULT_SELECTION_WEIGHTS: SelectionWeights = {
  volumeDeficitFill: 0.35, // Primary — fill volume deficits efficiently
  rotationNovelty: 0.22,   // High — force variety across sessions
  lengthenedBias: 0.20,    // KB-confirmed (Maeo 2023: +40% triceps growth overhead vs pushdown)
  sfrEfficiency: 0.12,     // Moderate — efficiency matters
  movementDiversity: 0.07, // Beam state-aware — dynamically re-scored during expansion
  sraReadiness: 0.03,      // Advisory only
  userPreference: 0.01,    // Tiebreaker
  // Sum: 1.00
};

/**
 * Default beam search config
 *
 * Beam width 7 (was 5): wider search is appropriate now that time budget no longer
 * hard-rejects exercises mid-search, so the feasible candidate set per depth is larger.
 */
export const DEFAULT_BEAM_CONFIG: BeamSearchConfig = {
  beamWidth: 7,
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
