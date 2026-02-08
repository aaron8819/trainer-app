import { NextResponse } from "next/server";
import { loadExerciseDetail } from "@/lib/api/exercise-library";
import { resolveUser } from "@/lib/api/workout-context";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("userId") ?? undefined;

  const user = userId ? await resolveUser(userId) : await resolveUser();

  const detail = await loadExerciseDetail(id, user?.id);
  if (!detail) {
    return NextResponse.json({ error: "Exercise not found" }, { status: 404 });
  }

  return NextResponse.json({ exercise: detail });
}
