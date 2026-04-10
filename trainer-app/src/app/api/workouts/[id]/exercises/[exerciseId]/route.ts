import { NextResponse } from "next/server";
import { resolveOwner } from "@/lib/api/workout-context";
import {
  isRuntimeExerciseRemoveError,
  removeRuntimeAddedWorkoutExercise,
} from "@/lib/api/runtime-exercise-remove-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function toErrorResponse(error: unknown) {
  if (isRuntimeExerciseRemoveError(error)) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  throw error;
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; exerciseId: string }> }
) {
  const resolvedParams = await params;
  if (!resolvedParams?.id || !resolvedParams?.exerciseId) {
    return NextResponse.json(
      { error: "Missing workout id or workout exercise id" },
      { status: 400 }
    );
  }

  const owner = await resolveOwner();

  try {
    const result = await removeRuntimeAddedWorkoutExercise({
      workoutId: resolvedParams.id,
      workoutExerciseId: resolvedParams.exerciseId,
      userId: owner.id,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return toErrorResponse(error);
  }
}
