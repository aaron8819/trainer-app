import { NextResponse } from "next/server";
import { loadExerciseLibrary } from "@/lib/api/exercise-library";
import { resolveUser } from "@/lib/api/workout-context";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("userId") ?? undefined;

  const user = userId ? await resolveUser(userId) : await resolveUser();

  const exercises = await loadExerciseLibrary(user?.id);
  return NextResponse.json({ exercises });
}
