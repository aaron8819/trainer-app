import { NextResponse } from "next/server";
import { resolveOwner } from "@/lib/api/workout-context";
import { computeWeeklyMuscleVolume, getVolumeLandmarks } from "@/lib/api/analytics";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const weeks = parseInt(searchParams.get("weeks") ?? "4", 10);

  const user = await resolveOwner();
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const weeklyVolume = await computeWeeklyMuscleVolume(
    user.id,
    Math.min(Math.max(weeks, 1), 12)
  );
  const landmarks = getVolumeLandmarks();

  return NextResponse.json({ weeklyVolume, landmarks });
}
