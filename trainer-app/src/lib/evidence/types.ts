import type { PlannerDiagnostics } from "@/lib/planner-diagnostics/types";
import type { ExerciseStimulusAccountingEvidence } from "@/lib/stimulus-accounting/snapshot";

export type CyclePhase = "accumulation" | "intensification" | "realization" | "deload";

export type CycleContextSnapshot = {
  weekInMeso: number;
  weekInBlock: number;
  blockDurationWeeks?: number;
  mesocycleLength?: number;
  phase: CyclePhase;
  blockType: CyclePhase;
  isDeload: boolean;
  source: "computed" | "fallback";
};

export type SessionSlotSnapshot = {
  slotId: string;
  intent: string;
  sequenceIndex: number;
  sequenceLength?: number;
  source: "mesocycle_slot_sequence" | "legacy_weekly_schedule";
};

export type ScheduledSlotReceiptV1 = {
  version: 1;
  mesocycleId: string;
  acceptedRevisionId: string;
  acceptedRevisionNumber: number;
  acceptedRevisionHash: string;
  weekInMeso: number;
  slotId: string;
  sequenceIndex: number;
  sequenceLength: number;
};

export const NON_SCHEDULED_MATERIALIZATION_PURPOSES = [
  "body_part",
  "gap_fill",
  "supplemental",
  "closeout",
] as const;

export type NonScheduledMaterializationPurpose =
  (typeof NON_SCHEDULED_MATERIALIZATION_PURPOSES)[number];

export function isNonScheduledMaterializationPurpose(
  value: unknown,
): value is NonScheduledMaterializationPurpose {
  return NON_SCHEDULED_MATERIALIZATION_PURPOSES.some(
    (purpose) => purpose === value,
  );
}

export type SessionMaterializationEvidence =
  | {
      version: 1;
      generationMode: "accepted_v4_scheduled";
      materializationClass: "scheduled_required";
    }
  | {
      version: 1;
      generationMode: "explicit_preview";
      materializationClass: "preview_only";
    }
  | {
      version: 1;
      generationMode: "non_scheduled";
      materializationClass: "non_scheduled";
      purpose: NonScheduledMaterializationPurpose;
    }
  | {
      version: 1;
      generationMode: "legacy";
      materializationClass: "legacy";
    };

export type SessionCompositionSource =
  | "persisted_slot_plan_seed"
  | "runtime_selection"
  | "deload_seed_replay"
  | "legacy_fallback"
  | "unknown";

export type SessionDecisionProvenance = {
  mesocycleId?: string | null;
  compositionSource?: SessionCompositionSource;
  seedProvenance?: {
    revisionId: string;
    revision: number;
    hash: string;
  };
};

export type DeloadDecisionMode = "none" | "scheduled" | "reactive" | "readiness";

export type DeloadDecisionAppliedTo = "none" | "volume" | "load" | "both";

export type DeloadDecision = {
  mode: DeloadDecisionMode;
  reason: string[];
  reductionPercent: number;
  appliedTo: DeloadDecisionAppliedTo;
};

export type LifecycleRirTarget = {
  min: number;
  max: number;
};

export type SessionDecisionVolumeTargetSource =
  | "lifecycle"
  | "soreness_adjusted_lifecycle"
  | "unknown";

export type SessionDecisionReadinessScaling = {
  applied: boolean;
  exerciseIds: string[];
  scaledUpCount: number;
  scaledDownCount: number;
};

export type SessionDecisionExceptionCode =
  | "soreness_suppression"
  | "deload"
  | "readiness_scale"
  | "optional_gap_fill"
  | "supplemental_deficit_session"
  | "closeout_session";

export type SessionDecisionException = {
  code: SessionDecisionExceptionCode;
  message: string;
};

export type PlannerDiagnosticsMode = "standard" | "debug";

export type SessionDecisionStimulusAccounting = {
  contractVersion: 1;
  exercises: Array<
    ExerciseStimulusAccountingEvidence & {
      orderIndex: number;
      sourceExerciseId: string;
    }
  >;
};

export type SessionDecisionReceipt = {
  version: 1 | 2 | 3;
  cycleContext: CycleContextSnapshot;
  sessionProvenance?: SessionDecisionProvenance;
  sessionSlot?: SessionSlotSnapshot;
  scheduledSlotReceipt?: ScheduledSlotReceiptV1;
  materialization?: SessionMaterializationEvidence;
  targetMuscles?: string[];
  lifecycleRirTarget?: LifecycleRirTarget;
  lifecycleVolume: {
    targets?: Record<string, number>;
    source: SessionDecisionVolumeTargetSource;
  };
  sorenessSuppressedMuscles: string[];
  deloadDecision: DeloadDecision;
  plannerDiagnosticsMode?: PlannerDiagnosticsMode;
  plannerDiagnostics?: PlannerDiagnostics;
  stimulusAccounting?: SessionDecisionStimulusAccounting;
  readiness: {
    wasAutoregulated: boolean;
    signalAgeHours: number | null;
    fatigueScoreOverall: number | null;
    intensityScaling: SessionDecisionReadinessScaling;
    rationale?: string;
  };
  exceptions: SessionDecisionException[];
};

export type ProgressionSetSummary = {
  reps: number | null;
  load: number | null;
  rpe: number | null;
  performedAt?: string | null;
};

export type ProgressionReceiptTrigger =
  | "double_progression"
  | "hold"
  | "deload"
  | "readiness_scale"
  | "insufficient_data";

export type ProgressionReceipt = {
  lastPerformed: ProgressionSetSummary | null;
  todayPrescription: ProgressionSetSummary | null;
  delta: {
    load: number | null;
    loadPercent: number | null;
    reps: number | null;
    rpe: number | null;
  };
  trigger: ProgressionReceiptTrigger;
  decisionLog?: string[];
};
