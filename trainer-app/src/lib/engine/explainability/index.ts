/**
 * Explainability System - Barrel Exports
 *
 * Phase 4.1: Foundation module
 *
 * Provides transparent, coach-like explanations for workout generation:
 * - Session context (block phase, volume, readiness)
 * - Exercise rationale (selection factors, KB citations)
 * - Prescription rationale (sets/reps/load/RIR/rest)
 * - Coach messages (encouragement, warnings, milestones)
 */

// Types
export type {
  WorkoutExplanation,
  SessionContext,
  BlockPhaseContext,
  VolumeStatus,
  ReadinessStatus,
  ProgressionContext,
  CoachMessage,
  ExerciseRationale,
  SelectionFactorBreakdown,
  Citation,
  AlternativeExercise,
  PrescriptionRationale,
  SetRationale,
  RepRationale,
  LoadRationale,
  RirRationale,
  RestRationale,
} from "./types";

// Knowledge Base
export {
  KB_CITATIONS,
  getCitationsByExercise,
  getCitationsByTopic,
  getCitationById,
} from "./knowledge-base";

// Utilities
export {
  formatBlockPhase,
  formatVolumeStatus,
  formatReadinessLevel,
  formatCitation,
  formatCitationWithLink,
  formatPercentage,
  formatScoreTier,
  formatWeekInMesocycle,
  formatProgressionType,
  formatRestPeriod,
  pluralize,
  formatLoadChange,
} from "./utils";
