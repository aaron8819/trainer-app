import type { CycleContextSnapshot, DeloadDecision } from "./types";
import type { CanonicalDeloadStructureReasonCode } from "@/lib/deload/semantics";

export type SessionAuditVersion = 1;

export type SessionAuditSemanticsReasonCode =
  | "advances_split_true"
  | "advances_split_false"
  | "strict_gap_fill_marker"
  | "strict_supplemental_marker"
  | "deload_session"
  | "progression_history_excluded_for_supplemental"
  | "progression_history_excluded_for_deload"
  | "performance_history_excluded_for_supplemental"
  | "performance_history_excluded_for_deload"
  | "progression_anchor_excluded_for_supplemental"
  | "progression_anchor_excluded_for_deload";

export type SessionAuditSemanticsReason = {
  code: SessionAuditSemanticsReasonCode;
  message: string;
};

export type SessionAuditSemanticsTrace = {
  advancesSplitInput: boolean | null;
  normalizedPhase?: string;
  normalizedBlockType?: string;
  receiptDeloadMode?: DeloadDecision["mode"];
};

export type SessionAuditSemanticsSnapshot = {
  kind: "advancing" | "gap_fill" | "supplemental" | "non_advancing_generic";
  effectiveSelectionMode?: string;
  isDeload: boolean;
  isStrictGapFill: boolean;
  isStrictSupplemental: boolean;
  advancesLifecycle: boolean;
  consumesWeeklyScheduleIntent: boolean;
  countsTowardCompliance: boolean;
  countsTowardRecentStimulus: boolean;
  countsTowardWeeklyVolume: boolean;
  countsTowardProgressionHistory: boolean;
  countsTowardPerformanceHistory: boolean;
  updatesProgressionAnchor: boolean;
  eligibleForUniqueIntentSubtraction: boolean;
  reasons: SessionAuditSemanticsReason[];
  trace: SessionAuditSemanticsTrace;
};

export type SessionAuditSetSnapshot = {
  setIndex: number;
  targetReps?: number;
  targetRepRange?: {
    min: number;
    max: number;
  };
  targetRpe?: number;
  targetLoad?: number;
  role?: string;
  restSeconds?: number;
};

export type SessionAuditExerciseSnapshot = {
  exerciseId: string;
  exerciseName: string;
  orderIndex: number;
  section: "warmup" | "main" | "accessory";
  isMainLift: boolean;
  role?: string;
  prescribedSetCount: number;
  prescribedSets: SessionAuditSetSnapshot[];
};

export type ProgressionDecisionTrace = {
  version: SessionAuditVersion;
  decisionSource: "double_progression";
  repRange: {
    min: number;
    max: number;
  };
  equipment: "barbell" | "dumbbell" | "cable" | "other";
  anchor: {
    source: "working_set" | "conservative_modal";
    workingSetApplied: boolean;
    anchorLoad: number;
    signalSetCount: number;
    effectiveSetCount: number;
    trimmedSetCount: number;
    highVarianceDetected: boolean;
    minSignalLoad: number;
    maxSignalLoad: number;
    medianSignalLoad: number;
  };
  confidence: {
    priorSessionCount: number;
    sampleScale: number;
    historyScale: number;
    combinedScale: number;
    reasons: string[];
  };
  metrics: {
    medianReps: number;
    modalRpe: number | null;
    nextLoad: number;
    loadDelta: number;
  };
  outcome: {
    path:
      | "path_1"
      | "path_2"
      | "path_3"
      | "path_4"
      | "path_5_overshoot"
      | "fallback_hold";
    action: "increase" | "hold" | "decrease";
    reasonCodes: string[];
  };
  decisionLog: string[];
};

export type DeloadExerciseTransformationTrace = {
  exerciseId: string;
  exerciseName: string;
  isMainLift: boolean;
  baselineSetCount: number;
  baselineRepAnchor: number;
  deloadSetCount: number;
  redundancyBucket?: string;
  structuralDecisionCode?: CanonicalDeloadStructureReasonCode;
  structuralDecision?: string;
  anchoredLoad: number | null;
  anchoredLoadSource: "peak_accumulation" | "latest_accumulation" | "none";
  peakAccumulationLoadCount: number;
  latestAccumulationLoadCount: number;
  canonicalSourceLoad?: number | null;
  canonicalSourceLoadSource?:
    | "history"
    | "baseline"
    | "estimate"
    | "existing_target_load"
    | "none";
  resolvedLoadSource?: "history" | "baseline" | "estimate" | "existing_target_load" | "none";
  resolvedTopSetLoad?: number | null;
  resolvedBackoffLoad?: number | null;
  resolvedSetLoads?: number[];
};

export type DeloadTrimmedExerciseTrace = {
  exerciseId: string;
  exerciseName: string;
  isMainLift: boolean;
  baselineSetCount: number;
  baselineRepAnchor: number;
  redundancyBucket: string;
  structuralDecisionCode: Exclude<
    CanonicalDeloadStructureReasonCode,
    "preserved_main_lift" | "kept_unique_accessory_coverage"
  >;
  structuralDecision: string;
};

export type DeloadTransformationTrace = {
  version: SessionAuditVersion;
  sessionIntent: string;
  targetRpe: number;
  setFactor: number;
  minSets: number;
  exerciseCount: number;
  baselineExerciseCount?: number;
  baselineHardSetCount?: number;
  keptExerciseCount?: number;
  keptHardSetCount?: number;
  maxAccessoryCount?: number;
  exercises: DeloadExerciseTransformationTrace[];
  trimmedExercises?: DeloadTrimmedExerciseTrace[];
};

export type SessionAuditGeneratedState = {
  selectionMode: string;
  sessionIntent: string;
  targetMuscles?: string[];
  cycleContext?: CycleContextSnapshot;
  deloadDecision?: DeloadDecision;
  semantics: SessionAuditSemanticsSnapshot;
  exerciseCount: number;
  hardSetCount: number;
  exercises: SessionAuditExerciseSnapshot[];
  filteredExercises?: Array<{
    exerciseId?: string;
    exerciseName: string;
    reason: string;
    userFriendlyMessage: string;
  }>;
  traces: {
    progression: Record<string, ProgressionDecisionTrace>;
    deload?: DeloadTransformationTrace;
  };
};

export type SessionAuditSavedState = {
  workoutId: string;
  revision?: number;
  status: string;
  advancesSplit: boolean;
  mesocycleSnapshot?: {
    mesocycleId?: string | null;
    week?: number | null;
    session?: number | null;
    phase?: string | null;
  };
  semantics: SessionAuditSemanticsSnapshot;
};

export type SessionAuditSnapshot = {
  version: SessionAuditVersion;
  generated?: SessionAuditGeneratedState;
  saved?: SessionAuditSavedState;
};

export type SessionAuditMutationChangedField =
  | "selection_mode"
  | "session_intent"
  | "semantics_kind"
  | "progression_history_eligibility"
  | "exercise_added"
  | "exercise_removed"
  | "exercise_set_count_changed"
  | "exercise_prescription_changed";

export type SessionAuditMutationSummary = {
  version: 1;
  comparisonState: "comparable" | "missing_generated_snapshot";
  hasDrift: boolean;
  changedFields: SessionAuditMutationChangedField[];
  addedExerciseIds: string[];
  removedExerciseIds: string[];
  exercisesWithSetCountChanges: string[];
  exercisesWithPrescriptionChanges: string[];
  generatedSelectionMode?: string;
  savedSelectionMode?: string;
  generatedSessionIntent?: string;
  savedSessionIntent?: string;
  generatedSemanticsKind?: SessionAuditSemanticsSnapshot["kind"];
  savedSemanticsKind?: SessionAuditSemanticsSnapshot["kind"];
};
