import { NextResponse } from "next/server";
import {
  ActivePlanTargetArchivedError,
  ActivePlanTargetNotReadyError,
  selectActivePlan,
} from "@/lib/api/active-plan-context";
import { loadPlanActivationTarget } from "@/lib/api/plan-management";
import { planManagementErrorResponse } from "@/lib/api/plan-management-http";
import { resolveOwner } from "@/lib/api/workout-context";
import { productionWritePauseResponse } from "@/lib/operations/production-write-gate-http";
import { activatePlanSchema } from "@/lib/validation";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const paused = productionWritePauseResponse(
    "mesocycle_acceptance",
    "/api/plans/[id]/activate",
  );
  if (paused) return paused;

  const body = await request.json().catch(() => null);
  const parsed = activatePlanSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Current active plan identity is required.",
        code: "PLAN_VALIDATION_FAILED",
      },
      { status: 400 },
    );
  }

  const [{ id }, owner] = await Promise.all([context.params, resolveOwner()]);
  try {
    const target = await loadPlanActivationTarget(owner.id, id);
    if (target.status === "NOT_FOUND") {
      return NextResponse.json(
        { error: "Plan not found.", code: "PLAN_NOT_FOUND" },
        { status: 404 },
      );
    }
    if (target.status === "ARCHIVED") {
      throw new ActivePlanTargetArchivedError();
    }
    if (target.status !== "READY") {
      throw new ActivePlanTargetNotReadyError();
    }
    const selection = await selectActivePlan({
      userId: owner.id,
      targetMacroCycleId: id,
      targetMesocycleId: target.activeMesocycleId,
      expectedActiveMacroCycleId: parsed.data.expectedActiveMacroCycleId,
    });
    return NextResponse.json({ ok: true, selection });
  } catch (error) {
    const response = planManagementErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
