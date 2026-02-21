import type { getPeriodizationModifiers } from "@/lib/engine/rules";
import type { BlockContext } from "@/lib/engine/periodization/types";
import type { SessionIntent, SelectionOutput } from "@/lib/engine/session-types";
import type { WorkoutPlan } from "@/lib/engine/types";
import type { SraWarning } from "@/lib/engine/sra";
import type { SubstitutionSuggestion } from "@/lib/engine/template-session";
import type { FilteredExerciseSummary } from "@/lib/engine/explainability";
import type { VolumePlanByMuscle } from "@/lib/engine/volume";
import type { CycleContextSnapshot, DeloadDecision } from "@/lib/evidence/types";
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

export type GenerateTemplateSessionParams = {
  pinnedExerciseIds?: string[];
  autoFillUnpinned?: boolean;
};

export type GenerateIntentSessionInput = {
  intent: SessionIntent;
  targetMuscles?: string[];
  pinnedExerciseIds?: string[];
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
        adaptiveDeloadApplied?: boolean;
        periodizationWeek?: number;
        cycleContext?: CycleContextSnapshot;
        deloadDecision?: DeloadDecision;
      };
      filteredExercises?: FilteredExerciseSummary[];
    }
  | { error: string };

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
  effectivePeriodization: ReturnType<typeof getPeriodizationModifiers>;
  adaptiveDeload: boolean;
  deloadDecision: DeloadDecision;
  blockContext: BlockContext | null;
  rotationContext: Awaited<ReturnType<typeof loadExerciseExposure>>;
  cycleContext: CycleContextSnapshot;
};
