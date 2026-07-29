import { NextResponse } from "next/server";
import { resolveOwner } from "@/lib/api/workout-context";
import {
  createPlan,
  loadPlanManagementData,
} from "@/lib/api/plan-management";
import { planManagementErrorResponse } from "@/lib/api/plan-management-http";
import { productionWritePauseResponse } from "@/lib/operations/production-write-gate-http";
import { createPlanSchema } from "@/lib/validation";

export async function GET() {
  const owner = await resolveOwner();
  return NextResponse.json(await loadPlanManagementData(owner.id));
}

export async function POST(request: Request) {
  const paused = productionWritePauseResponse(
    "mesocycle_acceptance",
    "/api/plans",
  );
  if (paused) return paused;

  const body = await request.json().catch(() => null);
  const parsed = createPlanSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Review the plan details and correct any missing or invalid fields.",
        code: "PLAN_VALIDATION_FAILED",
        details: parsed.error.format(),
      },
      { status: 400 },
    );
  }

  const owner = await resolveOwner();
  try {
    const plan = await createPlan({
      userId: owner.id,
      ...parsed.data,
    });
    return NextResponse.json({ ok: true, plan }, { status: 201 });
  } catch (error) {
    const response = planManagementErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
