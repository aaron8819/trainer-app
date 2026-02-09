import { NextResponse } from "next/server";
import { resolveUser } from "@/lib/api/workout-context";
import { loadExerciseHistory } from "@/lib/api/exercise-history";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: exerciseId } = await params;
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("userId") ?? undefined;
  const limit = parseInt(searchParams.get("limit") ?? "3", 10);

  const user = await resolveUser(userId);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const result = await loadExerciseHistory(
    exerciseId,
    user.id,
    Math.min(Math.max(limit, 1), 20)
  );

  return NextResponse.json(result);
}
