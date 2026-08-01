import { NextResponse } from "next/server";
import { finalizePlan } from "@/lib/api/plan-management";
import { planManagementErrorResponse } from "@/lib/api/plan-management-http";
import { provisionOwnerForMutation } from "@/lib/api/workout-context";
import { productionWritePauseResponse } from "@/lib/operations/production-write-gate-http";
import { planMutationSchema } from "@/lib/validation";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const paused = productionWritePauseResponse(
    "mesocycle_acceptance",
    "/api/plans/[id]/finalize",
  );
  if (paused) return paused;

  const body = await request.json().catch(() => null);
  const parsed = planMutationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Plan version is required.", code: "PLAN_VALIDATION_FAILED" },
      { status: 400 },
    );
  }

  const [{ id }, owner] = await Promise.all([
    context.params,
    provisionOwnerForMutation("mesocycle_acceptance"),
  ]);
  try {
    const plan = await finalizePlan({
      userId: owner.id,
      planId: id,
      ...parsed.data,
    });
    return NextResponse.json({ ok: true, plan });
  } catch (error) {
    const response = planManagementErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
