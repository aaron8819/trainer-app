import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { reconcileRuntimeEditSelectionMetadata } from "@/lib/api/runtime-edit-reconciliation";
import { readRuntimeAddedExerciseIds } from "@/lib/ui/selection-metadata";
import { getClosedMesocycleWorkoutFenceReason } from "@/lib/workout-workflow";

type RemovedWorkoutExerciseSnapshot = {
  workoutExerciseId: string;
  exerciseId: string;
  orderIndex: number;
  section: "WARMUP" | "MAIN" | "ACCESSORY";
  setCount: number;
};

type PersistedExerciseRecord = {
  exerciseId: string;
  orderIndex: number;
  section: string | null;
  exercise: { name: string };
  sets: Array<{
    setIndex: number;
    targetReps: number | null;
    targetRepMin: number | null;
    targetRepMax: number | null;
    targetRpe: number | null;
    targetLoad: number | null;
    restSeconds: number | null;
  }>;
};

export class RuntimeExerciseRemoveError extends Error {
  status: number;
  code: string;

  constructor(message: string, options: { status: number; code: string }) {
    super(message);
    this.name = "RuntimeExerciseRemoveError";
    this.status = options.status;
    this.code = options.code;
  }
}

function buildRuntimeExerciseRemoveError(
  message: string,
  options: { status: number; code: string }
): RuntimeExerciseRemoveError {
  return new RuntimeExerciseRemoveError(message, options);
}

export function isRuntimeExerciseRemoveError(
  error: unknown
): error is RuntimeExerciseRemoveError {
  return error instanceof RuntimeExerciseRemoveError;
}

function isOpenWorkoutStatus(status: string) {
  return status === "PLANNED" || status === "IN_PROGRESS" || status === "PARTIAL";
}

function normalizeWorkoutSection(
  section: string | null | undefined
): "WARMUP" | "MAIN" | "ACCESSORY" {
  const normalized = section?.trim().toUpperCase();
  if (normalized === "WARMUP" || normalized === "MAIN") {
    return normalized;
  }
  return "ACCESSORY";
}

function mapPersistedExercises(persistedExercises: PersistedExerciseRecord[]) {
  return persistedExercises.map((exercise) => ({
    exerciseId: exercise.exerciseId,
    orderIndex: exercise.orderIndex,
    section: normalizeWorkoutSection(exercise.section),
    exercise: exercise.exercise,
    sets: exercise.sets.map((set) => ({
      setIndex: set.setIndex,
      targetReps: set.targetReps,
      targetRepMin: set.targetRepMin,
      targetRepMax: set.targetRepMax,
      targetRpe: set.targetRpe,
      targetLoad: set.targetLoad,
      restSeconds: set.restSeconds,
    })),
  }));
}

export type RuntimeExerciseRemoveResult = {
  removedWorkoutExerciseId: string;
};

export async function removeRuntimeAddedWorkoutExercise(input: {
  workoutId: string;
  workoutExerciseId: string;
  userId: string;
}): Promise<RuntimeExerciseRemoveResult> {
  return prisma.$transaction(async (tx) => {
    const workoutExercise = await tx.workoutExercise.findFirst({
      where: {
        id: input.workoutExerciseId,
        workoutId: input.workoutId,
        workout: {
          userId: input.userId,
        },
      },
      select: {
        id: true,
        exerciseId: true,
        orderIndex: true,
        section: true,
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
          orderBy: { setIndex: "asc" },
          select: {
            id: true,
            logs: {
              take: 1,
              select: {
                id: true,
              },
            },
          },
        },
      },
    });

    if (!workoutExercise) {
      throw buildRuntimeExerciseRemoveError("Workout exercise not found", {
        status: 404,
        code: "WORKOUT_EXERCISE_NOT_FOUND",
      });
    }

    if (!isOpenWorkoutStatus(workoutExercise.workout.status)) {
      throw buildRuntimeExerciseRemoveError(
        "Exercise removal is only available while the workout is still open.",
        {
          status: 409,
          code: "WORKOUT_NOT_OPEN",
        }
      );
    }

    const blockedReason = getClosedMesocycleWorkoutFenceReason({
      mesocycleId: workoutExercise.workout.mesocycleId,
      mesocycleState: workoutExercise.workout.mesocycle?.state ?? null,
      mesocycleIsActive: workoutExercise.workout.mesocycle?.isActive ?? null,
    });
    if (blockedReason) {
      throw buildRuntimeExerciseRemoveError(blockedReason, {
        status: 409,
        code: "WORKOUT_CLOSED_MESOCYCLE",
      });
    }

    if (
      !readRuntimeAddedExerciseIds(workoutExercise.workout.selectionMetadata).has(
        workoutExercise.id
      )
    ) {
      throw buildRuntimeExerciseRemoveError("Only runtime-added exercises can be removed.", {
        status: 409,
        code: "NOT_RUNTIME_ADDED",
      });
    }

    if (workoutExercise.sets.some((set) => set.logs.length > 0)) {
      throw buildRuntimeExerciseRemoveError("Logged exercises cannot be removed.", {
        status: 409,
        code: "LOGGED_EXERCISE_BLOCKED",
      });
    }

    const removedExercise: RemovedWorkoutExerciseSnapshot = {
      workoutExerciseId: workoutExercise.id,
      exerciseId: workoutExercise.exerciseId,
      orderIndex: workoutExercise.orderIndex,
      section: normalizeWorkoutSection(workoutExercise.section),
      setCount: workoutExercise.sets.length,
    };

    await tx.workoutSet.deleteMany({
      where: {
        workoutExerciseId: workoutExercise.id,
      },
    });
    await tx.workoutExercise.delete({
      where: {
        id: workoutExercise.id,
      },
    });

    const persistedExercises = await tx.workoutExercise.findMany({
      where: { workoutId: workoutExercise.workout.id },
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
      persistedExercises: mapPersistedExercises(persistedExercises),
      mutation: {
        kind: "remove_exercise",
        workoutExerciseId: removedExercise.workoutExerciseId,
        exerciseId: removedExercise.exerciseId,
        orderIndex: removedExercise.orderIndex,
        section: removedExercise.section,
        setCount: removedExercise.setCount,
      },
    }).nextSelectionMetadata;

    await tx.workout.update({
      where: { id: workoutExercise.workout.id },
      data: {
        revision: { increment: 1 },
        selectionMetadata: selectionMetadata as Prisma.InputJsonValue,
      },
    });

    return {
      removedWorkoutExerciseId: workoutExercise.id,
    };
  });
}
