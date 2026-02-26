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
  ExplainabilityConfidence,
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
  FilteredExerciseSummary,
  VolumeComplianceStatus,
  MuscleVolumeCompliance,
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

// Session Context
export {
  explainSessionContext,
  describeBlockGoal,
  describeVolumeProgress,
  describeReadinessStatus,
  describeProgressionContext,
  summarizeFilteredExercises,
} from "./session-context";

// Exercise Rationale
export {
  explainExerciseRationale,
  buildSelectionFactorBreakdown,
  suggestAlternatives,
} from "./exercise-rationale";

// Prescription Rationale
export type { PrescriptionRationaleContext } from "./prescription-rationale";
export {
  explainPrescriptionRationale,
  explainSetCount,
  explainRepTarget,
  explainLoadChoice,
  explainRirTarget,
  explainRestPeriod,
} from "./prescription-rationale";

// Coach Messages
export { generateCoachMessages } from "./coach-messages";
