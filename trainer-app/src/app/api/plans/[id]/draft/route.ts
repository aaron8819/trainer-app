import { NextResponse } from "next/server";
import { saveHypertrophyPlanDraft } from "@/lib/api/hypertrophy-plan-drafts";
import { planManagementErrorResponse } from "@/lib/api/plan-management-http";
import { provisionOwnerForMutation } from "@/lib/api/workout-context";
import { customHypertrophyPlanRolloutUnavailableResponse } from "@/lib/operations/custom-hypertrophy-plan-rollout-http";
import { productionWritePauseResponse } from "@/lib/operations/production-write-gate-http";
import { saveHypertrophyPlanDraftSchema } from "@/lib/validation";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const unavailable = customHypertrophyPlanRolloutUnavailableResponse();
  if (unavailable) return unavailable;
  const paused = productionWritePauseResponse(
    "mesocycle_acceptance",
    "/api/plans/[id]/draft",
  );
  if (paused) return paused;
  const body = await request.json().catch(() => null);
  const parsed = saveHypertrophyPlanDraftSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "The draft is invalid.", code: "PLAN_VALIDATION_FAILED" },
      { status: 400 },
    );
  }
  const [{ id }, owner] = await Promise.all([
    context.params,
    provisionOwnerForMutation("mesocycle_acceptance"),
  ]);
  try {
    const result = await saveHypertrophyPlanDraft({
      userId: owner.id,
      planId: id,
      ...parsed.data,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const response = planManagementErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
