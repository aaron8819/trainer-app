/**
 * Explainability System - Type Definitions
 *
 * Phase 4.1: Foundation types for coach-like workout explanations
 *
 * Provides transparent, research-backed rationale at three levels:
 * 1. Session context - "Why this workout today?"
 * 2. Exercise rationale - "Why these exercises?"
 * 3. Prescription rationale - "Why these sets/reps/loads?"
 */

/**
 * Complete workout explanation
 */
export type WorkoutExplanation = {
  confidence: ExplainabilityConfidence;
  sessionContext: SessionContext;
  coachMessages: CoachMessage[];
  exerciseRationales: Map<string, ExerciseRationale>; // exerciseId -> rationale
  prescriptionRationales: Map<string, PrescriptionRationale>; // exerciseId -> rationale
  progressionReceipts: Map<string, ProgressionReceipt>; // exerciseId -> progression receipt
  filteredExercises?: FilteredExerciseSummary[]; // Exercises filtered due to constraints (Phase 2)
  volumeCompliance: MuscleVolumeCompliance[]; // Per-muscle weekly volume compliance (post-generation)
};

export type ExplainabilityConfidence = {
  level: "high" | "medium" | "low";
  summary: string;
  missingSignals: string[];
};

/**
 * Session-level context
 *
 * Explains macro-level "why this workout today?"
 */
export type SessionContext = {
  blockPhase: BlockPhaseContext;
  volumeStatus: VolumeStatus;
  readinessStatus: ReadinessStatus;
  progressionContext: ProgressionContext;
  cycleSource: "computed" | "fallback" | "none";
  narrative: string; // Human-readable summary
};

/**
 * Block phase context
 */
export type BlockPhaseContext = {
  blockType: "accumulation" | "intensification" | "realization" | "deload";
  weekInBlock: number;
  totalWeeksInBlock: number;
  primaryGoal: string; // "Build work capacity and muscle mass", "Convert fitness into strength", etc.
};

/**
 * Volume status across muscle groups
 */
export type VolumeStatus = {
  muscleStatuses: Map<
    string,
    {
      currentSets: number;
      targetRange: { min: number; max: number };
      status: "below_mev" | "at_mev" | "optimal" | "approaching_mrv" | "at_mrv";
    }
  >;
  overallSummary: string; // "3 of 6 muscle groups near target volume"
};

/**
 * Readiness status (from autoregulation)
 */
export type ReadinessStatus = {
  overall: "fresh" | "moderate" | "fatigued";
  signalAge: number; // Days since last check-in
  availability: "recent" | "stale" | "missing";
  label: string;
  perMuscleFatigue: Map<string, number>; // muscle -> fatigue score (0-10)
  adaptations: string[]; // ["Reduced volume by 2 sets chest", "Maintained intensity"]
};

/**
 * Progression context
 */
export type ProgressionContext = {
  weekInMesocycle: number;
  volumeProgression: "building" | "maintaining" | "deloading";
  intensityProgression: "ramping" | "peak" | "reduced"; // RIR progression
  nextMilestone: string; // "Deload week next", "Peak intensity week", etc.
};

/**
 * Coach message types
 */
export type CoachMessage = {
  type: "encouragement" | "warning" | "milestone" | "tip";
  priority: "high" | "medium" | "low";
  message: string;
};

/**
 * Per-exercise rationale
 *
 * Explains "Why this exercise?" with selection factors and KB citations
 */
export type ExerciseRationale = {
  exerciseName: string;
  primaryReasons: string[]; // Top 2-3 selection factors
  selectionFactors: SelectionFactorBreakdown;
  citations: Citation[]; // Research supporting this choice
  alternatives: AlternativeExercise[]; // "You could also do..."
  volumeContribution: string; // "3 sets chest, 0.9 indirect front delts"
};

/**
 * Selection factor breakdown
 *
 * Explains the multi-objective scoring
 */
export type SelectionFactorBreakdown = {
  deficitFill: { score: number; explanation: string }; // "Fills 4-set triceps deficit (67%)"
  rotationNovelty: { score: number; explanation: string }; // "Haven't used in 3 weeks"
  sfrEfficiency: { score: number; explanation: string }; // "High SFR (4/5)"
  lengthenedPosition: { score: number; explanation: string }; // "Loads muscle at long length (5/5)"
  sraAlignment: { score: number; explanation: string }; // "Targets recovered muscles"
  userPreference: { score: number; explanation: string }; // "Marked as favorite"
  movementNovelty: { score: number; explanation: string }; // "Novel movement pattern"
};

/**
 * Knowledge base citation
 */
export type Citation = {
  id: string; // "maeo_2023_overhead_triceps"
  authors: string; // "Maeo et al."
  year: number;
  title: string;
  finding: string; // Human-readable key finding
  relevance: string; // Why it's cited for this exercise
  url?: string; // DOI or pubmed link (optional)
};

/**
 * Alternative exercise suggestion
 */
export type AlternativeExercise = {
  exerciseName: string;
  similarity: number; // 0-1, how similar to selected exercise
  reason: string; // "Similar muscle targets, lower fatigue"
};

/**
 * Prescription rationale
 *
 * Explains "Why these sets/reps/loads/RIR/rest?"
 */
export type PrescriptionRationale = {
  exerciseName: string;
  sets: SetRationale;
  reps: RepRationale;
  load: LoadRationale;
  rir: RirRationale;
  rest: RestRationale;
  overallNarrative: string; // "3×8 @ 75kg, 1-2 RIR, 2 min rest — building volume in accumulation phase"
};

/**
 * Set rationale
 */
export type SetRationale = {
  count: number;
  reason: string; // "3 sets for accumulation block (building volume)"
  blockContext: string; // "Accumulation week 2 of 4"
};

/**
 * Rep rationale
 */
export type RepRationale = {
  target: number;
  reason: string; // "8 reps for hypertrophy focus (65-75% 1RM range)"
  exerciseConstraints?: string; // "Exercise works best in 10-20 rep range"
};

/**
 * Load rationale
 */
export type LoadRationale = {
  load: number;
  progressionType: "linear" | "double" | "autoregulated";
  reason: string; // "Increased from 72.5kg last week (+3.4%)"
  progressionContext?: string; // "Week 2 progression in mesocycle"
};

/**
 * RIR rationale
 */
export type RirRationale = {
  target: number;
  reason: string; // "1-2 RIR for accumulation week 2 (moderate intensity)"
  trainingAge?: string; // "Intermediate: can gauge proximity accurately"
};

/**
 * Rest rationale
 */
export type RestRationale = {
  seconds: number;
  reason: string; // "2 min for moderate compound (balance recovery and efficiency)"
  exerciseType: "heavy_compound" | "moderate_compound" | "isolation";
};

/**
 * Filtered exercise summary
 *
 * Explains why an exercise was filtered out during selection.
 * Used for explainability: "Why didn't I get this exercise?"
 */
export type FilteredExerciseSummary = {
  exerciseId: string;
  exerciseName: string;
  reason:
    | "user_avoided"
    | "pain_conflict"
    | "contraindicated"
    | string; // Other rejection reasons
  userFriendlyMessage: string; // "Avoided per your preferences", "Equipment not available", etc.
};

/**
 * Volume compliance status for a muscle group after this session.
 * Severity descending: OVER_MAV > AT_MAV > APPROACHING_MAV > OVER_TARGET > ON_TARGET > APPROACHING_TARGET > UNDER_MEV
 */
export type VolumeComplianceStatus =
  | "OVER_MAV"
  | "AT_MAV"
  | "APPROACHING_MAV"
  | "OVER_TARGET"
  | "ON_TARGET"
  | "APPROACHING_TARGET"
  | "UNDER_MEV";

/**
 * Per-muscle weekly volume compliance annotation.
 * projectedTotal = setsLoggedBeforeSession + setsPrescribedThisSession
 */
export type MuscleVolumeCompliance = {
  muscle: string; // Title Case, matches VOLUME_LANDMARKS keys
  setsLoggedBeforeSession: number;
  setsPrescribedThisSession: number;
  projectedTotal: number;
  weeklyTarget: number;
  mev: number;
  mav: number;
  status: VolumeComplianceStatus;
};

import type { ProgressionReceipt } from "@/lib/evidence/types";
