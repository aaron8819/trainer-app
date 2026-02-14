/**
 * Selection V2: Multi-Objective Beam Search Optimizer
 *
 * Barrel export for selection-v2 module.
 */

// Types
export type {
  SelectionObjective,
  SelectionConstraints,
  SelectionWeights,
  VolumeContext,
  RotationContext,
  ExerciseExposure,
  PerformanceTrend,
  SRAContext,
  UserPreferences,
  SelectionCandidate,
  VolumeContribution,
  CandidateScores,
  SelectionResult,
  RejectedExercise,
  RejectionReason,
  SelectionRationale,
  BeamState,
  BeamSearchConfig,
} from "./types";

export {
  DEFAULT_SELECTION_WEIGHTS,
  DEFAULT_BEAM_CONFIG,
  COLD_START_BEAM_CONFIGS,
} from "./types";

// Main optimizer
export { selectExercisesOptimized } from "./optimizer";

// Candidate building
export {
  buildCandidate,
  computeVolumeContribution,
  mergeVolume,
  computeProposedSets,
} from "./candidate";

// Beam search
export { beamSearch } from "./beam-search";

// Scoring functions
export {
  scoreDeficitFill,
  scoreRotationNovelty,
  scoreSFR,
  scoreLengthened,
  scoreMovementNovelty,
  scoreSRAAlignment,
  scoreUserPreference,
} from "./scoring";

// Explainability
export { generateRationale } from "./rationale";
