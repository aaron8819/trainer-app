import { NextResponse } from "next/server";
import { resolveOwner } from "@/lib/api/workout-context";
import { loadWeeklyMuscleOutcomeFromPrisma } from "@/lib/api/muscle-outcome-review";
import { getUiAuditFixtureFromHeaders } from "@/lib/ui-audit-fixtures/server";

export async function GET(request: Request) {
  const fixture = getUiAuditFixtureFromHeaders(request.headers);
  if (fixture?.analytics?.muscleOutcomes) {
    return NextResponse.json(fixture.analytics.muscleOutcomes);
  }

  const owner = await resolveOwner();
  if (!owner) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const review = await loadWeeklyMuscleOutcomeFromPrisma(owner.id);
  if (!review) {
    return NextResponse.json({
      review: null,
      semantics: {
        target:
          "Target sets come from canonical mesocycle lifecycle weekly volume targets for the active week.",
        actual:
          "Actual sets come from canonical weighted effective stimulus across performed workouts only.",
        status:
          "Outcome states compare actual weighted stimulus against the week target using conservative percent-delta thresholds.",
      },
    });
  }

  return NextResponse.json({
    review,
    semantics: {
      target:
        "Target sets come from canonical mesocycle lifecycle weekly volume targets for the active week.",
      actual:
        "Actual sets come from canonical weighted effective stimulus across performed workouts only.",
      status:
        "Outcome states compare actual weighted stimulus against the week target using conservative percent-delta thresholds.",
    },
  });
}
