import { NextResponse } from "next/server";
import {
  assertPlanVersionFinalizable,
  finalizePlan,
} from "@/lib/api/plan-management";
import { makeHypertrophyPlanReady } from "@/lib/api/hypertrophy-plan-drafts";
import { planManagementErrorResponse } from "@/lib/api/plan-management-http";
import {
  findOwnerReadOnly,
  provisionOwnerForMutation,
} from "@/lib/api/workout-context";
import { productionWritePauseResponse } from "@/lib/operations/production-write-gate-http";
import {
  makeHypertrophyPlanReadySchema,
  planMutationSchema,
} from "@/lib/validation";
import { isCustomHypertrophyPlanRolloutEnabled } from "@/lib/operations/custom-hypertrophy-plan-rollout";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const paused = productionWritePauseResponse(
    "mesocycle_acceptance",
    "/api/plans/[id]/finalize",
  );
  if (paused) return paused;

  const { id } = await context.params;
  const readOnlyOwner = await findOwnerReadOnly();
  try {
    if (readOnlyOwner) {
      await assertPlanVersionFinalizable({
        userId: readOnlyOwner.id,
        planId: id,
      });
    }
  } catch (error) {
    const response = planManagementErrorResponse(error);
    if (response) return response;
    throw error;
  }

  const body = await request.json().catch(() => null);
  const customEnabled = isCustomHypertrophyPlanRolloutEnabled();
  const isCustomRequest =
    customEnabled &&
    body != null &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    "expectedDraftRevision" in body;
  const parsed = (isCustomRequest
    ? makeHypertrophyPlanReadySchema
    : planMutationSchema
  ).safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Plan version is required.", code: "PLAN_VALIDATION_FAILED" },
      { status: 400 },
    );
  }

  const owner = await provisionOwnerForMutation("mesocycle_acceptance");
  try {
    if (isCustomRequest && "expectedDraftRevision" in parsed.data) {
      const result = await makeHypertrophyPlanReady({
        userId: owner.id,
        planId: id,
        ...parsed.data,
      });
      return NextResponse.json({ ok: true, result });
    }
    const plan = await finalizePlan({
      userId: owner.id,
      planId: id,
      ...(parsed.data as { expectedUpdatedAt: string }),
    });
    return NextResponse.json({ ok: true, plan });
  } catch (error) {
    const response = planManagementErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
