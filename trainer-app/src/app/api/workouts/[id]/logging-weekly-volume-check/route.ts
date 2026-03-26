import { NextResponse } from "next/server";
import { loadLoggingWeeklyVolumeGuidance } from "@/lib/api/logging-weekly-volume-guidance";
import { resolveOwner } from "@/lib/api/workout-context";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const resolvedParams = await params;
  if (!resolvedParams?.id) {
    return NextResponse.json({ error: "Missing workout id" }, { status: 400 });
  }

  const owner = await resolveOwner();

  try {
    const guidance = await loadLoggingWeeklyVolumeGuidance({
      userId: owner.id,
      workoutId: resolvedParams.id,
    });

    return NextResponse.json(guidance);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load weekly volume guidance";
    const status = message.includes("not found") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
