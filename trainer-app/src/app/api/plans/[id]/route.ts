import { NextResponse } from "next/server";
import { renamePlan } from "@/lib/api/plan-management";
import { planManagementErrorResponse } from "@/lib/api/plan-management-http";
import { provisionOwnerForMutation } from "@/lib/api/workout-context";
import { productionWritePauseResponse } from "@/lib/operations/production-write-gate-http";
import { renamePlanSchema } from "@/lib/validation";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const paused = productionWritePauseResponse(
    "application_configuration",
    "/api/plans/[id]",
  );
  if (paused) return paused;

  const body = await request.json().catch(() => null);
  const parsed = renamePlanSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Plan names must be between 1 and 60 characters.",
        code: "PLAN_VALIDATION_FAILED",
      },
      { status: 400 },
    );
  }

  const [{ id }, owner] = await Promise.all([
    context.params,
    provisionOwnerForMutation("application_configuration"),
  ]);
  try {
    const plan = await renamePlan({
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
