import { NextResponse } from "next/server";
import { productionWritePauseResponse } from "@/lib/operations/production-write-gate-http";
import { Prisma } from "@prisma/client";
import { resolveOwner } from "@/lib/api/workout-context";
import { reconcileRuntimeEditSelectionMetadata } from "@/lib/api/runtime-edit-reconciliation";
import { getLogWorkoutPageState } from "@/lib/workout-workflow";
import { resolveDefaultRestSecondsForExecutionSet } from "@/lib/logging/rest-timer-policy";
import {
  executeWorkoutMutation,
  isWorkoutMutationError,
} from "@/lib/api/workout-mutation";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const addSetSchema = z.object({
  expectedRevision: z.number().int().min(1),
});

class AddSetError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 409,
  ) {
    super(message);
  }
}

type RuntimeEditableWorkoutState = {
  status: string | null;
  mesocycleId: string | null;
  mesocycle: {
    state: string | null;
    isActive: boolean | null;
  } | null;
};

function getRuntimeEditBlockedReason(workout: RuntimeEditableWorkoutState): string | null {
  const pageState = getLogWorkoutPageState(workout.status, {
    mesocycleId: workout.mesocycleId,
    mesocycleState: workout.mesocycle?.state ?? null,
    mesocycleIsActive: workout.mesocycle?.isActive ?? null,
  });

  return pageState.mutability === "editable" ? null : pageState.reason;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; exerciseId: string }> }
) {
  const paused = productionWritePauseResponse(
    "workout_structural_edit",
    "/api/workouts/[id]/exercises/[exerciseId]/add-set",
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
  const parsed = addSetSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const owner = await resolveOwner();
  try {
    const mutation = await executeWorkoutMutation(
      {
        workoutId: resolvedParams.id,
        userId: owner.id,
        expectedRevision: parsed.data.expectedRevision,
      },
      async (tx) => {
        const workoutExercise = await tx.workoutExercise.findFirst({
      where: {
        id: resolvedParams.exerciseId,
        workoutId: resolvedParams.id,
        workout: { userId: owner.id },
      },
      select: {
        id: true,
        exerciseId: true,
        section: true,
        isMainLift: true,
        workout: {
          select: {
            id: true,
            status: true,
            selectionMetadata: true,
            selectionMode: true,
            sessionIntent: true,
            mesocycleId: true,
            mesocycle: {
              select: {
                state: true,
                isActive: true,
              },
            },
          },
        },
        sets: {
          orderBy: { setIndex: "desc" },
          take: 1,
          select: {
            setIndex: true,
            targetReps: true,
            targetRepMin: true,
            targetRepMax: true,
            targetRpe: true,
            targetLoad: true,
            restSeconds: true,
          },
        },
      },
    });

    if (!workoutExercise) {
      throw new AddSetError("Workout exercise not found", 404);
    }

    const blockedReason = getRuntimeEditBlockedReason(workoutExercise.workout);
    if (blockedReason) {
      throw new AddSetError(blockedReason, 409);
    }

    const lastSet = workoutExercise.sets[0];
    if (!lastSet) {
      throw new AddSetError(
        "Cannot append a set to an exercise with no existing set.",
        409,
      );
    }

    const nextSet = await tx.workoutSet.create({
      data: {
        workoutExerciseId: workoutExercise.id,
        setIndex: lastSet.setIndex + 1,
        targetReps: lastSet.targetReps,
        targetRepMin: lastSet.targetRepMin,
        targetRepMax: lastSet.targetRepMax,
        targetRpe: lastSet.targetRpe,
        targetLoad: lastSet.targetLoad,
        restSeconds: resolveDefaultRestSecondsForExecutionSet({
          section: workoutExercise.section,
          isMainLift: workoutExercise.isMainLift,
        }),
      },
      select: {
        id: true,
        setIndex: true,
        targetReps: true,
        targetRepMin: true,
        targetRepMax: true,
        targetRpe: true,
        targetLoad: true,
        restSeconds: true,
      },
    });

    const persistedExercises = await tx.workoutExercise.findMany({
      where: { workoutId: resolvedParams.id },
      orderBy: [{ orderIndex: "asc" }, { id: "asc" }],
      select: {
        exerciseId: true,
        orderIndex: true,
        section: true,
        exercise: {
          select: {
            name: true,
          },
        },
        sets: {
          orderBy: { setIndex: "asc" },
          select: {
            setIndex: true,
            targetReps: true,
            targetRepMin: true,
            targetRepMax: true,
            targetRpe: true,
            targetLoad: true,
            restSeconds: true,
          },
        },
      },
    });

    const selectionMetadata = reconcileRuntimeEditSelectionMetadata({
      selectionMetadata: workoutExercise.workout.selectionMetadata,
      selectionMode: workoutExercise.workout.selectionMode,
      sessionIntent: workoutExercise.workout.sessionIntent,
      persistedExercises,
      mutation: {
        kind: "add_set",
        workoutExerciseId: workoutExercise.id,
        exerciseId: workoutExercise.exerciseId,
        workoutSetId: nextSet.id,
        setIndex: nextSet.setIndex,
        clonedFromSetIndex: lastSet.setIndex,
      },
    }).nextSelectionMetadata;

    await tx.workout.update({
      where: { id: resolvedParams.id },
      data: {
        selectionMetadata: selectionMetadata as Prisma.InputJsonValue,
      },
        });

        return {
          set: {
        setId: nextSet.id,
        setIndex: nextSet.setIndex,
        targetReps: nextSet.targetReps,
        targetRepRange:
          nextSet.targetRepMin != null && nextSet.targetRepMax != null
            ? { min: nextSet.targetRepMin, max: nextSet.targetRepMax }
            : undefined,
        targetLoad: nextSet.targetLoad,
        targetRpe: nextSet.targetRpe,
        restSeconds: nextSet.restSeconds,
        isRuntimeAdded: true as const,
          },
        };
      },
    );

    return NextResponse.json({ ...mutation.result, revision: mutation.revision });
  } catch (error) {
    if (isWorkoutMutationError(error) || error instanceof AddSetError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
