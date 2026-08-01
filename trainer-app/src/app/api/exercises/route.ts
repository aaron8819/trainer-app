import { NextResponse } from "next/server";
import { loadExerciseLibrary } from "@/lib/api/exercise-library";
import { findOwnerReadOnly } from "@/lib/api/workout-context";

export async function GET() {
  const user = await findOwnerReadOnly();

  const exercises = await loadExerciseLibrary(user?.id);
  return NextResponse.json({ exercises });
}
