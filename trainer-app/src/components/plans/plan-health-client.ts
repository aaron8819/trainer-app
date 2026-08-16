import type {
  HypertrophyPlanEditorData,
  HypertrophyPlanV4Preview,
} from "@/lib/api/hypertrophy-plan-drafts";
import {
  comparePlanHealthCodeUnits,
  projectHypertrophyPlanHealthSemantics,
  type HypertrophyPlanHealthAssessment,
} from "@/lib/engine/hypertrophy-plan-health";

export function planHealthContextKey(
  data: Pick<
    HypertrophyPlanEditorData,
    "planId" | "draft" | "health" | "limitationKeys"
  > & { preview?: HypertrophyPlanV4Preview | null },
): string {
  return JSON.stringify({
    planId: data.planId,
    settings: data.draft.settings,
    health:
      data.health.status === "AVAILABLE"
        ? {
            status: data.health.status,
            policyVersion: data.health.policyVersion,
            draftId: data.health.draftId,
            draftRevision: data.health.draftRevision,
            semantics: projectHypertrophyPlanHealthSemantics(data.health),
          }
        : data.health,
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
