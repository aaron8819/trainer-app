import { generateWorkoutFromTemplate, type SubstitutionSuggestion, type TemplateExerciseInput } from "@/lib/engine/template-session";
import { buildVolumeContext, buildVolumePlanByMuscle } from "@/lib/engine/volume";
import type { SraWarning } from "@/lib/engine/sra";
import type { SelectionOutput, SessionIntent } from "@/lib/engine/session-types";
import type { WorkoutPlan } from "@/lib/engine/types";
import type { FilteredExerciseSummary } from "@/lib/engine/explainability";
import { applyLoads } from "@/lib/api/workout-context";
import type { MappedGenerationContext, SessionGenerationResult } from "./types";

export function runSessionGeneration(
  mapped: MappedGenerationContext,
  templateExercises: TemplateExerciseInput[],
  options: {
    sessionIntent: SessionIntent;
    selectionMode: "AUTO" | "INTENT";
    templateId?: string;
    isStrict: boolean;
    setCountOverrides?: Record<string, number>;
    mainLiftSlotCap?: number;
    selection: SelectionOutput;
  }
):
  | {
      workout: WorkoutPlan;
      templateId?: string;
      selectionMode: "AUTO" | "INTENT";
      sessionIntent: SessionIntent;
      sraWarnings: SraWarning[];
      substitutions: SubstitutionSuggestion[];
      droppedAccessoryExerciseIds: string[];
      selection: SelectionOutput;
    }
  | { error: string } {
  const { workout, sraWarnings, substitutions, droppedAccessoryExerciseIds } = generateWorkoutFromTemplate(templateExercises, {
    profile: mapped.mappedProfile,
    goals: mapped.mappedGoals,
    history: mapped.history,
    exerciseLibrary: mapped.exerciseLibrary,
    preferences: mapped.mappedPreferences,
    checkIn: mapped.mappedCheckIn,
    weekInBlock: mapped.weekInBlock,
    mesocycleLength: mapped.mesocycleLength,
    periodization: mapped.effectivePeriodization,
    blockContext: mapped.blockContext,
    isStrict: options.isStrict,
    setCountOverrides: options.setCountOverrides,
    mainLiftSlotCap: options.mainLiftSlotCap,
  });

  return {
    workout,
    templateId: options.templateId,
    selectionMode: options.selectionMode,
    sessionIntent: options.sessionIntent,
    sraWarnings,
    substitutions,
    droppedAccessoryExerciseIds,
    selection: options.selection,
  };
}

export function finalizePostLoadResult(
  result: {
    workout: WorkoutPlan;
    templateId?: string;
    selectionMode: "AUTO" | "INTENT";
    sessionIntent: SessionIntent;
    sraWarnings: SraWarning[];
    substitutions: SubstitutionSuggestion[];
    droppedAccessoryExerciseIds?: string[];
    selection: SelectionOutput;
  },
  mapped: MappedGenerationContext,
  filteredExercises?: FilteredExerciseSummary[]
): SessionGenerationResult {
  const withLoads = applyLoads(
    result.workout,
    mapped.rawExercises,
    mapped.history,
    mapped.mappedProfile,
    mapped.mappedGoals.primary,
    mapped.effectivePeriodization,
    mapped.weekInBlock,
    result.sessionIntent
  );
  const postLoadVolumeContext = buildVolumeContext(mapped.history, mapped.exerciseLibrary, {
    week: mapped.lifecycleWeek,
    length: mapped.mesocycleLength,
    weeklyTargets: mapped.lifecycleVolumeTargets,
  });
  const volumePlanByMuscle = buildVolumePlanByMuscle(
    withLoads.mainLifts,
    withLoads.accessories,
    postLoadVolumeContext,
    { mesocycleWeek: mapped.lifecycleWeek, mesocycleLength: mapped.mesocycleLength }
  );

  const finalWorkout = mapped.adaptiveDeload
    ? {
        ...withLoads,
        notes: withLoads.notes
          ? `${withLoads.notes}. Adjusted to recovery session based on recent fatigue signals.`
          : "Adjusted to recovery session based on recent fatigue signals.",
      }
    : withLoads;

  return {
    workout: finalWorkout,
    templateId: result.templateId,
    selectionMode: result.selectionMode,
    sessionIntent: result.sessionIntent,
    sraWarnings: result.sraWarnings,
    substitutions: result.substitutions,
    volumePlanByMuscle,
    selection: {
      ...result.selection,
      volumePlanByMuscle,
      adaptiveDeloadApplied: mapped.adaptiveDeload,
      periodizationWeek: mapped.lifecycleWeek,
      cycleContext: mapped.cycleContext,
      deloadDecision: mapped.deloadDecision,
    },
    filteredExercises,
  };
}
