import type { PeriodizationModifiers } from "@/lib/engine/rules";
import type { BlockContext } from "@/lib/engine/periodization/types";
import type { SessionIntent, SelectionOutput } from "@/lib/engine/session-types";
import type { WorkoutPlan } from "@/lib/engine/types";
import type { SraWarning } from "@/lib/engine/sra";
import type { SubstitutionSuggestion } from "@/lib/engine/template-session";
import type { FilteredExerciseSummary } from "@/lib/engine/explainability";
import type { VolumePlanByMuscle } from "@/lib/engine/volume";
import type { SaveableSelectionMetadata } from "@/lib/ui/selection-metadata";
import type {
  CycleContextSnapshot,
  DeloadDecision,
  SessionDecisionReceipt,
  PlannerDiagnosticsMode,
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
import type { loadExerciseExposure } from "@/lib/api/exercise-exposure";
import type { Mesocycle } from "@prisma/client";

export type GenerateTemplateSessionParams = {
  pinnedExerciseIds?: string[];
  autoFillUnpinned?: boolean;
};

export type GenerateIntentSessionInput = {
  intent: SessionIntent;
  targetMuscles?: string[];
  anchorWeek?: number;
  weekCloseId?: string;
  maxGeneratedHardSets?: number;
  maxGeneratedExercises?: number;
  optionalGapFill?: boolean;
  pinnedExerciseIds?: string[];
  roleListIncomplete?: true;
  plannerDiagnosticsMode?: PlannerDiagnosticsMode;
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
    }
  | { error: string };

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
};

export type GenerateFromIntentResponse = SharedGeneratedWorkoutResponse & {
  selectionMetadata: WorkoutGenerationSelectionMetadata;
  selectionSummary: WorkoutGenerationSelectionSummary;
  filteredExercises?: FilteredExerciseSummary[];
};

export type GenerateFromTemplateResponse = SharedGeneratedWorkoutResponse & {
  templateId: string;
  selectionMetadata: WorkoutGenerationSelectionMetadata;
};

export type MappedGenerationContext = {
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
  activeMesocycle: Mesocycle | null;
  effectivePeriodization: PeriodizationModifiers;
  adaptiveDeload: boolean;
  deloadDecision: DeloadDecision;
  blockContext: BlockContext | null;
  rotationContext: Awaited<ReturnType<typeof loadExerciseExposure>>;
  cycleContext: CycleContextSnapshot;
  mesocycleRoleMapByIntent: Record<
    SessionIntent,
    Map<string, "CORE_COMPOUND" | "ACCESSORY">
  >;
};
