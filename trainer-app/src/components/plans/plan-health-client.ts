import type {
  HypertrophyPlanEditorData,
  HypertrophyPlanV4Preview,
} from "@/lib/api/hypertrophy-plan-drafts";
import {
  comparePlanHealthCodeUnits,
  type HypertrophyPlanHealthAssessment,
} from "@/lib/engine/hypertrophy-plan-health";

export function planHealthContextKey(
  data: Pick<
    HypertrophyPlanEditorData,
    "planId" | "draft" | "exercises" | "limitationKeys"
  > & { preview?: HypertrophyPlanV4Preview | null },
): string {
  const catalogById = new Map(
    data.exercises.map((exercise) => [exercise.id, exercise]),
  );
  const selectedExerciseIds = [
    ...new Set(
      data.draft.sessions.flatMap((session) =>
        session.exercises.map((exercise) => exercise.exerciseId),
      ),
    ),
  ].sort(comparePlanHealthCodeUnits);
  return JSON.stringify({
    planId: data.planId,
    settings: data.draft.settings,
    selectedCatalog: selectedExerciseIds.map((exerciseId) => {
      const exercise = catalogById.get(exerciseId);
      if (!exercise) return { exerciseId, availability: "MISSING" };
      return {
        exerciseId,
        availability: "PRESENT",
        facts: {
          name: exercise.name,
          aliases: [...(exercise.aliases ?? [])].sort(comparePlanHealthCodeUnits),
          movementPatterns: [...exercise.movementPatterns].sort(
            comparePlanHealthCodeUnits,
          ),
          primaryMuscleIds: [...exercise.primaryMuscleIds].sort(
            comparePlanHealthCodeUnits,
          ),
          secondaryMuscleIds: [...exercise.secondaryMuscleIds].sort(
            comparePlanHealthCodeUnits,
          ),
          stimulusByMuscleId: exercise.stimulusByMuscleId ?? null,
          equipment: [...exercise.equipment].sort(comparePlanHealthCodeUnits),
          contraindicationKeys: [...exercise.contraindicationKeys].sort(
            comparePlanHealthCodeUnits,
          ),
          isCompound: exercise.isCompound,
          isMainLiftEligible: exercise.isMainLiftEligible,
          measurement: exercise.measurement ?? null,
          timePerSetSec: exercise.timePerSetSec,
        },
      };
    }),
    limitationKeys: [...data.limitationKeys].sort(comparePlanHealthCodeUnits),
    preview:
      data.preview?.status === "ELIGIBLE"
        ? { status: data.preview.status, hash: data.preview.hash }
        : data.preview ?? null,
  });
}

export function importantWarningConfirmationPrompt(
  health: HypertrophyPlanHealthAssessment,
  action: string,
): string {
  const warnings = health.issues
    .filter((issue) => issue.tier === "IMPORTANT_WARNING")
    .map((issue) => `• ${issue.title}: ${issue.explanation}`)
    .join("\n");
  return `Review the current important warnings:\n\n${warnings}\n\n${action}`;
}
