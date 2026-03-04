import { NextResponse } from "next/server";
import { resolveOwner } from "@/lib/api/workout-context";
import { computeWeeklyMuscleVolume, getVolumeLandmarks } from "@/lib/api/analytics";
import { buildRollingIsoWeeksAnalyticsWindow } from "@/lib/api/analytics-semantics";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const weeks = parseInt(searchParams.get("weeks") ?? "4", 10);
  const clampedWeeks = Math.min(Math.max(weeks, 1), 12);

  const user = await resolveOwner();
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const weeklyVolume = await computeWeeklyMuscleVolume(
    user.id,
    clampedWeeks
  );
  const landmarks = getVolumeLandmarks();

  return NextResponse.json({
    weeklyVolume,
    landmarks,
    semantics: {
      window: buildRollingIsoWeeksAnalyticsWindow(
        clampedWeeks,
        `Rolling ${clampedWeeks} ISO week volume window`
      ),
      counts: {
        workouts:
          "Volume includes performed workouts only (COMPLETED and PARTIAL) grouped by scheduledDate ISO week.",
        sets: "Only non-skipped logged sets count toward direct and indirect muscle volume.",
        muscles:
          "Primary muscle mappings count as direct sets; secondary mappings count as indirect sets.",
      },
    },
  });
}
