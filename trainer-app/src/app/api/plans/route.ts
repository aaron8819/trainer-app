import { NextResponse } from "next/server";
import {
  findOwnerReadOnly,
  provisionOwnerForMutation,
} from "@/lib/api/workout-context";
import {
  createPlan,
  loadPlanManagementData,
} from "@/lib/api/plan-management";
import { createCustomHypertrophyPlan } from "@/lib/api/hypertrophy-plan-drafts";
import { planManagementErrorResponse } from "@/lib/api/plan-management-http";
import { productionWritePauseResponse } from "@/lib/operations/production-write-gate-http";
import {
  createPlanSchema,
  createPlanWithCustomHypertrophySchema,
} from "@/lib/validation";
import { isCustomHypertrophyPlanRolloutEnabled } from "@/lib/operations/custom-hypertrophy-plan-rollout";

export async function GET() {
  const owner = await findOwnerReadOnly();
  if (!owner) return NextResponse.json({ error: "User not found" }, { status: 404 });
  return NextResponse.json(
    await loadPlanManagementData(owner.id, {
      includeCustomDrafts: isCustomHypertrophyPlanRolloutEnabled(),
    }),
  );
}

export async function POST(request: Request) {
  const paused = productionWritePauseResponse(
    "mesocycle_acceptance",
    "/api/plans",
  );
  if (paused) return paused;

  const body = await request.json().catch(() => null);
  const customHypertrophyEnabled = isCustomHypertrophyPlanRolloutEnabled();
  const parsed = customHypertrophyEnabled
    ? createPlanWithCustomHypertrophySchema.safeParse(body)
    : createPlanSchema.safeParse(body);
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

  const owner = await provisionOwnerForMutation("mesocycle_acceptance");
  try {
    if (
      customHypertrophyEnabled &&
      parsed.data.planType === "HYPERTROPHY" &&
      "sessionsPerWeek" in parsed.data
    ) {
      const created = await createCustomHypertrophyPlan({
        userId: owner.id,
        ...parsed.data,
      });
      const data = await loadPlanManagementData(owner.id, {
        includeCustomDrafts: true,
      });
      const plan = data.plans.find((candidate) => candidate.id === created.planId);
      if (!plan) throw new Error("CUSTOM_PLAN_CREATED_DRAFT_NOT_FOUND");
      return NextResponse.json({ ok: true, plan }, { status: 201 });
    }
    const legacyInput = createPlanSchema.safeParse(parsed.data);
    if (!legacyInput.success) {
      return NextResponse.json(
        { error: "Custom hypertrophy plans are not available." },
        { status: 503 },
      );
    }
    const plan = await createPlan({ userId: owner.id, ...legacyInput.data });
    return NextResponse.json({ ok: true, plan }, { status: 201 });
  } catch (error) {
    const response = planManagementErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
