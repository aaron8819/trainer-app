import { NextResponse } from "next/server";
import { productionWritePauseResponse } from "@/lib/operations/production-write-gate-http";
import { deleteWorkoutSchema } from "@/lib/validation";
import { provisionOwnerForMutation } from "@/lib/api/workout-context";
import { isWorkoutMutationError } from "@/lib/api/workout-mutation";
import {
  deleteOwnedWorkout,
  DeleteWorkoutError,
} from "@/lib/api/workout-deletion";

export async function POST(request: Request) {
  const paused = productionWritePauseResponse("workout_structural_edit", "/api/workouts/delete");
  if (paused) return paused;

  const body = await request.json().catch(() => ({}));
  const parsed = deleteWorkoutSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const owner = await provisionOwnerForMutation("workout_structural_edit");
  try {
    const mutation = await deleteOwnedWorkout({
      workoutId: parsed.data.workoutId,
      userId: owner.id,
      expectedRevision: parsed.data.expectedRevision,
    });

    return NextResponse.json({ ...mutation.result, revision: mutation.revision });
  } catch (error) {
    if (isWorkoutMutationError(error) || error instanceof DeleteWorkoutError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    throw error;
  }
}
