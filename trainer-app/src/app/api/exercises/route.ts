import { NextResponse } from "next/server";
import { loadExerciseLibrary } from "@/lib/api/exercise-library";
import { resolveOwner } from "@/lib/api/workout-context";

export async function GET() {
  const user = await resolveOwner();

  const exercises = await loadExerciseLibrary(user?.id);
  return NextResponse.json({ exercises });
}
