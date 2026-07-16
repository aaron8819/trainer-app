import { NextResponse } from "next/server";
import { productionWritePauseResponse } from "@/lib/operations/production-write-gate-http";
import { deleteWorkoutSchema } from "@/lib/validation";
import { resolveOwner } from "@/lib/api/workout-context";
import { reconcileMesocycleLifecycle } from "@/lib/api/mesocycle-lifecycle-reconciliation";
import { WorkoutStatus } from "@prisma/client";
import {
  executeWorkoutMutation,
  isWorkoutMutationError,
} from "@/lib/api/workout-mutation";

class DeleteWorkoutError extends Error {
  readonly status = 409 as const;
}

export async function POST(request: Request) {
  const paused = productionWritePauseResponse("workout_structural_edit", "/api/workouts/delete");
  if (paused) return paused;

  const body = await request.json().catch(() => ({}));
  const parsed = deleteWorkoutSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const owner = await resolveOwner();
  try {
    const mutation = await executeWorkoutMutation({
      workoutId: parsed.data.workoutId,
      userId: owner.id,
      expectedRevision: parsed.data.expectedRevision,
      editableStatuses: [
        WorkoutStatus.PLANNED,
        WorkoutStatus.IN_PROGRESS,
        WorkoutStatus.PARTIAL,
        WorkoutStatus.COMPLETED,
        WorkoutStatus.SKIPPED,
      ],
    }, async (tx) => {
    const workout = await tx.workout.findFirst({
      where: { id: parsed.data.workoutId, userId: owner.id },
      select: {
        id: true,
        mesocycleId: true,
        mesocycle: {
          select: {
            id: true,
            durationWeeks: true,
            sessionsPerWeek: true,
            state: true,
            isActive: true,
          },
        },
      },
    });
    if (!workout) {
      throw new Error("WORKOUT_NOT_FOUND_AFTER_CLAIM");
    }
    if (workout.mesocycle && !workout.mesocycle.isActive && workout.mesocycle.state === "COMPLETED") {
      throw new DeleteWorkoutError(
        "Cannot delete a historical workout from a completed mesocycle after closeout finalized lifecycle history.",
      );
    }

    const exercises = await tx.workoutExercise.findMany({
      where: { workoutId: workout.id },
      select: { id: true },
    });

    const exerciseIds = exercises.map((exercise) => exercise.id);

    if (exerciseIds.length > 0) {
      await tx.setLog.deleteMany({
        where: { workoutSet: { workoutExerciseId: { in: exerciseIds } } },
      });
      await tx.workoutSet.deleteMany({
        where: { workoutExerciseId: { in: exerciseIds } },
      });
      await tx.workoutExercise.deleteMany({
        where: { id: { in: exerciseIds } },
      });
    }

    await tx.workout.delete({ where: { id: workout.id } });

    if (
      workout.mesocycle &&
      (workout.mesocycle.isActive || workout.mesocycle.state !== "COMPLETED")
    ) {
      await reconcileMesocycleLifecycle(tx, workout.mesocycle);
    }
    return { status: "deleted" as const };
  });

    return NextResponse.json({ ...mutation.result, revision: mutation.revision });
  } catch (error) {
    if (isWorkoutMutationError(error) || error instanceof DeleteWorkoutError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
