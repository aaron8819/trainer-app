import { NextResponse } from "next/server";
import { productionWritePauseResponse } from "@/lib/operations/production-write-gate-http";
import { resolveOwner } from "@/lib/api/workout-context";
import {
  isRuntimeExerciseRemoveError,
  removeRuntimeAddedWorkoutExercise,
} from "@/lib/api/runtime-exercise-remove-service";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const removeExerciseSchema = z.object({
  expectedRevision: z.number().int().min(1),
});

function toErrorResponse(error: unknown) {
  if (isRuntimeExerciseRemoveError(error)) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  throw error;
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; exerciseId: string }> }
) {
  const paused = productionWritePauseResponse(
    "workout_structural_edit",
    "/api/workouts/[id]/exercises/[exerciseId]",
  );
  if (paused) return paused;

  const resolvedParams = await params;
  if (!resolvedParams?.id || !resolvedParams?.exerciseId) {
    return NextResponse.json(
      { error: "Missing workout id or workout exercise id" },
      { status: 400 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const parsed = removeExerciseSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const owner = await resolveOwner();

  try {
    const result = await removeRuntimeAddedWorkoutExercise({
      workoutId: resolvedParams.id,
      workoutExerciseId: resolvedParams.exerciseId,
      userId: owner.id,
      expectedRevision: parsed.data.expectedRevision,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return toErrorResponse(error);
  }
}
