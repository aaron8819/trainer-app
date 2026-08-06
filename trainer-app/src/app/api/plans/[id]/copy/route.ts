import { NextResponse } from "next/server";
import { createEditableHypertrophyPlanCopy } from "@/lib/api/hypertrophy-plan-drafts";
import { planManagementErrorResponse } from "@/lib/api/plan-management-http";
import { provisionOwnerForMutation } from "@/lib/api/workout-context";
import { customHypertrophyPlanRolloutUnavailableResponse } from "@/lib/operations/custom-hypertrophy-plan-rollout-http";
import { productionWritePauseResponse } from "@/lib/operations/production-write-gate-http";
import { copyHypertrophyPlanSchema } from "@/lib/validation";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const unavailable = customHypertrophyPlanRolloutUnavailableResponse();
  if (unavailable) return unavailable;
  const paused = productionWritePauseResponse(
    "mesocycle_acceptance",
    "/api/plans/[id]/copy",
  );
  if (paused) return paused;
  const parsed = copyHypertrophyPlanSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Choose a name for the editable copy.", code: "PLAN_VALIDATION_FAILED" },
      { status: 400 },
    );
  }
  const [{ id }, owner] = await Promise.all([
    context.params,
    provisionOwnerForMutation("mesocycle_acceptance"),
  ]);
  try {
    const result = await createEditableHypertrophyPlanCopy({
      userId: owner.id,
      sourcePlanId: id,
      ...parsed.data,
    });
    return NextResponse.json({ ok: true, ...result }, { status: 201 });
  } catch (error) {
    const response = planManagementErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
