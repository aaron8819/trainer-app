import type {
  HypertrophyPlanEditorData,
  HypertrophyPlanV4Preview,
} from "@/lib/api/hypertrophy-plan-drafts";
import type { HypertrophyPlanHealthAssessment } from "@/lib/engine/hypertrophy-plan-health";

export function planHealthContextKey(
  data: Pick<
    HypertrophyPlanEditorData,
    "planId" | "draft" | "exercises" | "limitationKeys"
  > & { preview?: HypertrophyPlanV4Preview | null },
): string {
  return JSON.stringify({
    planId: data.planId,
    settings: data.draft.settings,
    exercises: [...data.exercises]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((exercise) => ({
        ...exercise,
        aliases: [...(exercise.aliases ?? [])].sort(),
        movementPatterns: [...exercise.movementPatterns].sort(),
        primaryMuscleIds: [...exercise.primaryMuscleIds].sort(),
        secondaryMuscleIds: [...exercise.secondaryMuscleIds].sort(),
        equipment: [...exercise.equipment].sort(),
        contraindicationKeys: [...exercise.contraindicationKeys].sort(),
      })),
    limitationKeys: [...data.limitationKeys].sort(),
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
