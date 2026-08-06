import { NextResponse } from "next/server";
import { isCustomHypertrophyPlanRolloutEnabled } from "./custom-hypertrophy-plan-rollout";

export function customHypertrophyPlanRolloutUnavailableResponse(): NextResponse | null {
  if (isCustomHypertrophyPlanRolloutEnabled()) return null;
  return NextResponse.json(
    {
      error: "Custom hypertrophy plans are not enabled",
      code: "CUSTOM_HYPERTROPHY_PLANS_NOT_ENABLED",
    },
    { status: 503 },
  );
}
