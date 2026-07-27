import { NextResponse } from "next/server";
import { resolveOwner } from "@/lib/api/workout-context";
import {
  createHypertrophyPlan,
  loadPlanManagementData,
} from "@/lib/api/plan-management";
import { planManagementErrorResponse } from "@/lib/api/plan-management-http";
import { productionWritePauseResponse } from "@/lib/operations/production-write-gate-http";
import { createHypertrophyPlanSchema } from "@/lib/validation";

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
  const parsed = createHypertrophyPlanSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Enter a plan name, start date, and duration from 8 to 52 weeks.",
        code: "PLAN_VALIDATION_FAILED",
        details: parsed.error.format(),
      },
      { status: 400 },
    );
  }

  const owner = await resolveOwner();
  try {
    const plan = await createHypertrophyPlan({
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
