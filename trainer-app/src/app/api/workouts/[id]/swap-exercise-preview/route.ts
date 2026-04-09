import { NextResponse } from "next/server";
import { resolveOwner } from "@/lib/api/workout-context";
import {
  isRuntimeExerciseSwapError,
  resolveRuntimeExerciseSwapPreview,
} from "@/lib/api/runtime-exercise-swap-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function toErrorResponse(error: unknown) {
  if (isRuntimeExerciseSwapError(error)) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  throw error;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const resolvedParams = await params;
  const workoutId = resolvedParams?.id;
  const searchParams = new URL(request.url).searchParams;
  const workoutExerciseId = searchParams.get("workoutExerciseId");
  const replacementExerciseId = searchParams.get("exerciseId");

  if (!workoutId || !workoutExerciseId || !replacementExerciseId) {
    return NextResponse.json(
      { error: "Missing workout id, workoutExerciseId, or exerciseId" },
      { status: 400 }
    );
  }

  const owner = await resolveOwner();

  try {
    const exercise = await resolveRuntimeExerciseSwapPreview({
      workoutId,
      workoutExerciseId,
      replacementExerciseId,
      userId: owner.id,
    });

    return NextResponse.json({ exercise });
  } catch (error) {
    return toErrorResponse(error);
  }
}
