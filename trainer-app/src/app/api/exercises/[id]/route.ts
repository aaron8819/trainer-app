import { NextResponse } from "next/server";
import { loadExerciseDetail } from "@/lib/api/exercise-library";
import { resolveOwner } from "@/lib/api/workout-context";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const user = await resolveOwner();

  const detail = await loadExerciseDetail(id, user?.id);
  if (!detail) {
    return NextResponse.json({ error: "Exercise not found" }, { status: 404 });
  }

  return NextResponse.json({ exercise: detail });
}
