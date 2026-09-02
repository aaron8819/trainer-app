import type { PeriodizationModifiers } from "@/lib/engine/rules";
import type { BlockContext } from "@/lib/engine/periodization/types";
import type { SessionIntent, SelectionOutput } from "@/lib/engine/session-types";
import type { WorkoutPlan } from "@/lib/engine/types";
import type { SraWarning } from "@/lib/engine/sra";
import type { SubstitutionSuggestion } from "@/lib/engine/template-session";
import type { FilteredExerciseSummary } from "@/lib/engine/explainability";
import type { VolumePlanByMuscle } from "@/lib/engine/volume";
import type {
  SlotLanePlanLane,
  SlotPreselectionDemand,
} from "@/lib/engine/selection-v2";
import type { SaveableSelectionMetadata } from "@/lib/ui/selection-metadata";
import type { DeloadTransformationTrace } from "@/lib/evidence/session-audit-types";
import type {
  CycleContextSnapshot,
  DeloadDecision,
  NonScheduledMaterializationPurpose,
  SessionDecisionReceipt,
  PlannerDiagnosticsMode,
  SessionCompositionSource,
  SessionSlotSnapshot,
} from "@/lib/evidence/types";
import type {
  loadWorkoutContext,
  mapCheckIn,
  mapConstraints,
  mapExercises,
  mapGoals,
  mapHistory,
  mapPreferences,
  mapProfile,
} from "@/lib/api/workout-context";
import type { loadExerciseRotationContext } from "@/lib/api/exercise-rotation-history";
import type { ActiveMesocycleWithBlocks } from "@/lib/api/mesocycle-lifecycle-state";
import type { GenerationPhaseBlockContext } from "@/lib/api/generation-phase-block-context";
import type {
  ApplyLoadsAudit,
  ApplyLoadsHistoryEvidence,
} from "@/lib/engine/apply-loads";
import type { NumericPrescription } from "@/lib/engine/load-prescription";
import type {
  LoadConvention,
  MeasurementProfile,
  RepBasis,
  ZeroLoadMeaning,
} from "@/lib/exercise-measurement/semantics";
import type { V4ScheduledGenerationObligation } from "@/lib/api/v4-scheduled-slot-resolution";

export type GenerationScheduleMode =
  | {
      kind: "accepted_v4_scheduled";
      obligation: V4ScheduledGenerationObligation;
    }
  | {
      kind: "explicit_preview";
      weekInMeso: number;
      slotId?: string;
    }
  | {
      kind: "non_scheduled";
      purpose: NonScheduledMaterializationPurpose;
      anchorWeek?: number;
    }
  | {
      kind: "legacy";
    };

export type GenerateTemplateSessionParams = {
  generationMode: GenerationScheduleMode;
  pinnedExerciseIds?: string[];
  autoFillUnpinned?: boolean;
  slotId?: string;
  advancingSlot?: SessionSlotSnapshot;
  exerciseReplacements?: Array<{
    placementId: string;
    orderIndex: number;
    originalExerciseId: string;
    replacementExerciseId: string;
  }>;
};

export type GenerateIntentSessionInput = {
  generationMode: GenerationScheduleMode;
  intent: SessionIntent;
  slotId?: string;
  advancingSlot?: SessionSlotSnapshot;
  targetMuscles?: string[];
  projectionRepairMuscles?: string[];
  slotPreselectionDemands?: SlotPreselectionDemand[];
  slotLanePlan?: SlotLanePlanLane[];
  anchorWeek?: number;
  weekCloseId?: string;
  optionalGapFillContext?: {
    weekCloseId: string;
    targetWeek: number;
  };
  maxGeneratedHardSets?: number;
  maxGeneratedExercises?: number;
  optionalGapFill?: boolean;
  supplementalDeficitSession?: boolean;
  supplementalPlannerProfile?: boolean;
  pinnedExerciseIds?: string[];
  roleListIncomplete?: true;
  plannerDiagnosticsMode?: PlannerDiagnosticsMode;
};

export type PrescriptionReadoutLoadSource = NumericPrescription["source"];

export type PrescriptionReadout = {
  placementId: string;
  exerciseId: string;
  exerciseName: string;
  setCount: number;
  targetLoad: number | null;
  targetReps: number | null;
  repRange: { min: number; max: number } | null;
  targetRpe: number | null;
  targetRir: number | null;
  prescriptionKind:
    | "numeric"
    | "semantic_zero"
    | "calibration_required"
    | "not_applicable"
    | "unavailable";
  loadSource: PrescriptionReadoutLoadSource | null;
  confidence: "high" | "medium" | "low" | null;
  measurementProfile: MeasurementProfile | null;
  loadConvention: LoadConvention | null;
  repBasis: RepBasis | null;
  zeroLoadMeaning: ZeroLoadMeaning | null;
  cautionLevel: "none" | "notice" | "caution";
  cautionReason: string | null;
  historyEvidence?: ApplyLoadsHistoryEvidence;
};

export type SessionGenerationResult =
  | {
      workout: WorkoutPlan;
      templateId?: string;
      selectionMode: "AUTO" | "INTENT";
      sessionIntent: SessionIntent;
      sraWarnings: SraWarning[];
      substitutions: SubstitutionSuggestion[];
      volumePlanByMuscle: VolumePlanByMuscle;
      selection: SelectionOutput & {
        sessionDecisionReceipt?: SessionDecisionReceipt;
      };
      filteredExercises?: FilteredExerciseSummary[];
      prescriptionReadouts?: PrescriptionReadout[];
      audit?: ApplyLoadsAudit & {
        deloadTrace?: DeloadTransformationTrace;
      };
    }
  | { error: string };

export type PreLoadSessionGenerationResult = {
  workout: WorkoutPlan;
  templateId?: string;
  selectionMode: "AUTO" | "INTENT";
  sessionIntent: SessionIntent;
  sraWarnings: SraWarning[];
  substitutions: SubstitutionSuggestion[];
  droppedAccessoryExerciseIds: string[];
  selection: SelectionOutput;
};

export type IntentSessionCompositionResult = {
  generation: PreLoadSessionGenerationResult;
  compositionSource: SessionCompositionSource;
  filteredExercises: FilteredExerciseSummary[];
  intentionallyDroppedAccessoryRoleIds: string[];
  suppressWarmups?: boolean;
};

export type WorkoutGenerationSelectionSummary = {
  selectedCount: number;
  pinnedCount: number;
  setTargetCount: number;
};

export type WorkoutGenerationSelectionMetadata = SaveableSelectionMetadata;

type SharedGeneratedWorkoutResponse = {
  workout: WorkoutPlan;
  sraWarnings: SraWarning[];
  substitutions: SubstitutionSuggestion[];
  volumePlanByMuscle: VolumePlanByMuscle;
  selectionMode: "AUTO" | "INTENT";
  sessionIntent: SessionIntent;
  prescriptionReadouts?: PrescriptionReadout[];
};

export type GenerateFromIntentResponse = SharedGeneratedWorkoutResponse & {
  selectionMetadata: WorkoutGenerationSelectionMetadata;
  selectionSummary: WorkoutGenerationSelectionSummary;
  filteredExercises?: FilteredExerciseSummary[];
  sessionCapacity: {
    requestedMode: "as_planned" | "short_today";
    status: "as_planned" | "applied" | "unavailable";
    unavailableReason?:
      | "already_streamlined"
      | "older_plan"
      | "unsupported_session"
      | "stale_manifest"
      | "pain_or_equipment_conflict"
      | "integrity_failure"
      | "must_select_before_start";
    preview?: {
      removedExercises: Array<{ exerciseId: string; exerciseName: string }>;
      removedSetCount: number;
      retainedProtectionSummary: string;
      estimatedMinutes: number;
      redistributionNotice: string;
    };
  };
};

export type GenerateFromTemplateResponse = SharedGeneratedWorkoutResponse & {
  templateId: string;
  selectionMetadata: WorkoutGenerationSelectionMetadata;
};

export type MappedGenerationContext = {
  generationMode: GenerationScheduleMode;
  mappedProfile: ReturnType<typeof mapProfile>;
  mappedGoals: ReturnType<typeof mapGoals>;
  mappedConstraints: ReturnType<typeof mapConstraints>;
  mappedCheckIn: ReturnType<typeof mapCheckIn>;
  mappedPreferences: ReturnType<typeof mapPreferences>;
  exerciseLibrary: ReturnType<typeof mapExercises>;
  history: ReturnType<typeof mapHistory>;
  rawExercises: Awaited<ReturnType<typeof loadWorkoutContext>>["exercises"];
  rawWorkouts: Awaited<ReturnType<typeof loadWorkoutContext>>["workouts"];
  weekInBlock: number;
  mesocycleLength: number;
  lifecycleWeek: number;
  lifecycleRirTarget: { min: number; max: number };
  lifecycleVolumeTargets: Record<string, number>;
  sorenessSuppressedMuscles: string[];
  activeMesocycle: ActiveMesocycleWithBlocks | null;
  effectivePeriodization: PeriodizationModifiers;
  adaptiveDeload: boolean;
  deloadDecision: DeloadDecision;
  phaseBlockContext?: GenerationPhaseBlockContext;
  blockContext: BlockContext | null;
  rotationContext: Awaited<ReturnType<typeof loadExerciseRotationContext>>;
  cycleContext: CycleContextSnapshot;
  mesocycleRoleMapByIntent: Record<
    SessionIntent,
    Map<string, "CORE_COMPOUND" | "ACCESSORY">
  >;
};
