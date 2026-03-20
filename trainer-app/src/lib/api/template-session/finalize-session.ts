import { generateWorkoutFromTemplate, type SubstitutionSuggestion, type TemplateExerciseInput } from "@/lib/engine/template-session";
import { buildVolumeContext, buildVolumePlanByMuscle } from "@/lib/engine/volume";
import type { SraWarning } from "@/lib/engine/sra";
import type { SelectionOutput, SessionIntent } from "@/lib/engine/session-types";
import type { WorkoutPlan } from "@/lib/engine/types";
import type { FilteredExerciseSummary } from "@/lib/engine/explainability";
import { applyLoadsWithAudit } from "@/lib/engine/apply-loads";
import { buildSessionDecisionReceipt } from "@/lib/evidence/session-decision-receipt";
import type { DeloadTransformationTrace } from "@/lib/evidence/session-audit-types";
import type { PlannerDiagnosticsMode, SessionSlotSnapshot } from "@/lib/evidence/types";
import { buildCanonicalDeloadDecision } from "@/lib/deload/semantics";
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

function buildPostLoadVolumePlan(
  mapped: MappedGenerationContext,
  workout: WorkoutPlan
) {
  const postLoadVolumeContext = buildVolumeContext(mapped.history, mapped.exerciseLibrary, {
    week: mapped.lifecycleWeek,
    length: mapped.mesocycleLength,
    mesocycleId: mapped.activeMesocycle?.id ?? undefined,
    weeklyTargets: mapped.lifecycleVolumeTargets,
  });
  return buildVolumePlanByMuscle(
    workout.mainLifts,
    workout.accessories,
    postLoadVolumeContext,
    { mesocycleWeek: mapped.lifecycleWeek, mesocycleLength: mapped.mesocycleLength }
  );
}

function attachResolvedLoadsToDeloadTrace(
  trace: DeloadTransformationTrace | undefined,
  audit: ReturnType<typeof applyLoadsWithAudit>["audit"]
): DeloadTransformationTrace | undefined {
  if (!trace) {
    return undefined;
  }

  return {
    ...trace,
    exercises: trace.exercises.map((exerciseTrace) => {
      const resolvedLoad = audit.resolvedLoads[exerciseTrace.exerciseId];
      const resolvedSetLoads = resolvedLoad?.resolvedSetLoads ?? [];
      const resolvedTopSetLoad = resolvedLoad?.resolvedTopSetLoad ?? null;
      const resolvedBackoffLoad =
        resolvedSetLoads.find((load, index) => index > 0 && load !== resolvedTopSetLoad) ?? null;
      const canonicalSourceLoad = resolvedLoad?.canonicalSourceLoad ?? null;
      const canonicalSourceLoadSource = resolvedLoad?.source ?? "none";
      const anchoredLoadSource =
        canonicalSourceLoadSource === "history"
          ? exerciseTrace.latestAccumulationLoadCount > 0
            ? "latest_accumulation"
            : exerciseTrace.peakAccumulationLoadCount > 0
              ? "peak_accumulation"
              : "none"
          : exerciseTrace.anchoredLoadSource;

      return {
        ...exerciseTrace,
        anchoredLoad:
          canonicalSourceLoadSource === "history"
            ? canonicalSourceLoad
            : exerciseTrace.anchoredLoad,
        anchoredLoadSource,
        canonicalSourceLoad,
        canonicalSourceLoadSource,
        resolvedLoadSource: canonicalSourceLoadSource,
        resolvedTopSetLoad,
        resolvedBackoffLoad,
        resolvedSetLoads,
      };
    }),
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
  filteredExercises?: FilteredExerciseSummary[],
  plannerDiagnosticsMode: PlannerDiagnosticsMode = "standard",
  sessionSlot?: SessionSlotSnapshot
): SessionGenerationResult {
  const exerciseById = Object.fromEntries(
    mapped.exerciseLibrary.map((exercise) => [exercise.id, exercise])
  );
  const { workout: withLoads, audit } = applyLoadsWithAudit(result.workout, {
    history: mapped.history,
    baselines: [],
    exerciseById,
    primaryGoal: mapped.mappedGoals.primary,
    profile: mapped.mappedProfile,
    periodization: mapped.effectivePeriodization,
    weekInBlock: mapped.weekInBlock,
    sessionIntent: result.sessionIntent,
    accumulationSessionsCompleted: mapped.activeMesocycle?.accumulationSessionsCompleted ?? undefined,
    isFirstSessionInMesocycle:
      (mapped.activeMesocycle?.accumulationSessionsCompleted ?? -1) === 0,
  });
  const volumePlanByMuscle = buildPostLoadVolumePlan(mapped, withLoads);

  const finalWorkout = mapped.adaptiveDeload
    ? {
        ...withLoads,
        notes: withLoads.notes
          ? `${withLoads.notes}. Adjusted to recovery session based on recent fatigue signals.`
          : "Adjusted to recovery session based on recent fatigue signals.",
      }
    : withLoads;
  const sessionDecisionReceipt = buildSessionDecisionReceipt({
    cycleContext: mapped.cycleContext,
    sessionSlot,
    lifecycleRirTarget: mapped.lifecycleRirTarget,
    lifecycleVolumeTargets: mapped.lifecycleVolumeTargets,
    sorenessSuppressedMuscles: mapped.sorenessSuppressedMuscles,
    deloadDecision: mapped.deloadDecision,
    plannerDiagnostics: result.selection.plannerDiagnostics,
    plannerDiagnosticsMode,
  });

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
      sessionDecisionReceipt,
      volumePlanByMuscle,
    },
    filteredExercises,
    audit,
  };
}

export function finalizeDeloadSessionResult(input: {
  mapped: MappedGenerationContext;
  workout: WorkoutPlan;
  selection: SelectionOutput;
  selectionMode: "AUTO" | "INTENT";
  sessionIntent: SessionIntent;
  templateId?: string;
  note: string;
  deloadTrace: DeloadTransformationTrace;
  plannerDiagnosticsMode?: PlannerDiagnosticsMode;
}): SessionGenerationResult {
  const exerciseById = Object.fromEntries(
    input.mapped.exerciseLibrary.map((exercise) => [exercise.id, exercise])
  );
  const { workout: withLoads, audit } = applyLoadsWithAudit(input.workout, {
    history: input.mapped.history,
    baselines: [],
    exerciseById,
    primaryGoal: input.mapped.mappedGoals.primary,
    profile: input.mapped.mappedProfile,
    periodization: input.mapped.effectivePeriodization,
    weekInBlock: input.mapped.weekInBlock,
    sessionIntent: input.sessionIntent,
    accumulationSessionsCompleted:
      input.mapped.activeMesocycle?.accumulationSessionsCompleted ?? undefined,
    isFirstSessionInMesocycle:
      (input.mapped.activeMesocycle?.accumulationSessionsCompleted ?? -1) === 0,
  });
  const volumePlanByMuscle = buildPostLoadVolumePlan(input.mapped, withLoads);

  return {
    workout: withLoads,
    templateId: input.templateId,
    selectionMode: input.selectionMode,
    sessionIntent: input.sessionIntent,
    sraWarnings: [],
    substitutions: [],
    volumePlanByMuscle,
    selection: {
      ...input.selection,
      sessionDecisionReceipt: buildSessionDecisionReceipt({
        cycleContext: input.mapped.cycleContext,
        lifecycleRirTarget: input.mapped.lifecycleRirTarget,
        lifecycleVolumeTargets: input.mapped.lifecycleVolumeTargets,
        sorenessSuppressedMuscles: input.mapped.sorenessSuppressedMuscles,
        deloadDecision: buildCanonicalDeloadDecision("scheduled", [input.note]),
        plannerDiagnosticsMode: input.plannerDiagnosticsMode ?? "standard",
      }),
      volumePlanByMuscle,
    },
    filteredExercises: [],
    audit: {
      progressionTraces: audit.progressionTraces,
      deloadTrace: attachResolvedLoadsToDeloadTrace(input.deloadTrace, audit),
    },
  };
}
