import { NextResponse } from "next/server";
import { isFinisherRolloutEnabled } from "./finisher-rollout";

export function finisherRolloutUnavailableResponse(): NextResponse | null {
  if (isFinisherRolloutEnabled()) {
    return null;
  }

  return NextResponse.json(
    {
      error: "Finishers are not enabled",
      code: "FINISHERS_NOT_ENABLED",
    },
    { status: 503 },
  );
}
