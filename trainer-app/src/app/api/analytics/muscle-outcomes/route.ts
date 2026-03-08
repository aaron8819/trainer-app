import { NextResponse } from "next/server";
import { resolveOwner } from "@/lib/api/workout-context";
import { loadWeeklyMuscleOutcomeFromPrisma } from "@/lib/api/muscle-outcome-review";

export async function GET() {
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
