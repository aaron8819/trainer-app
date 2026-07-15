import { Prisma, WorkoutStatus } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

export const RUNTIME_EDITABLE_WORKOUT_STATUSES = [
  WorkoutStatus.PLANNED,
  WorkoutStatus.IN_PROGRESS,
  WorkoutStatus.PARTIAL,
] as const;

export type ClaimedWorkout = {
  id: string;
  revision: number;
  status: WorkoutStatus;
  mesocycleId: string | null;
};

export type WorkoutMutationErrorCode =
  | "WORKOUT_NOT_FOUND"
  | "WORKOUT_REVISION_CONFLICT"
  | "WORKOUT_NOT_EDITABLE";

export class WorkoutMutationError extends Error {
  readonly code: WorkoutMutationErrorCode;
  readonly status: 404 | 409;

  constructor(
    code: WorkoutMutationErrorCode,
    message: string,
    status: 404 | 409,
  ) {
    super(message);
    this.name = "WorkoutMutationError";
    this.code = code;
    this.status = status;
  }
}

export function isWorkoutMutationError(
  error: unknown,
): error is WorkoutMutationError {
  return error instanceof WorkoutMutationError;
}

export async function executeWorkoutMutationInTransaction<T>(
  tx: Prisma.TransactionClient,
  input: {
    workoutId: string;
    userId: string;
    expectedRevision: number;
    editableStatuses?: readonly WorkoutStatus[];
  },
  mutate: (
    tx: Prisma.TransactionClient,
    claimedWorkout: ClaimedWorkout,
  ) => Promise<T>,
): Promise<{ result: T; revision: number }> {
  const editableStatuses =
    input.editableStatuses ?? RUNTIME_EDITABLE_WORKOUT_STATUSES;
  const claimed = await tx.workout.updateMany({
    where: {
      id: input.workoutId,
      userId: input.userId,
      revision: input.expectedRevision,
      status: { in: [...editableStatuses] },
    },
    data: {
      revision: { increment: 1 },
    },
  });

  if (claimed.count !== 1) {
    const ownedWorkout = await tx.workout.findFirst({
      where: { id: input.workoutId, userId: input.userId },
      select: { revision: true, status: true },
    });
    if (!ownedWorkout) {
      throw new WorkoutMutationError(
        "WORKOUT_NOT_FOUND",
        "Workout not found",
        404,
      );
    }
    if (ownedWorkout.revision !== input.expectedRevision) {
      throw new WorkoutMutationError(
        "WORKOUT_REVISION_CONFLICT",
        "Workout changed since it was loaded. Refresh and try again.",
        409,
      );
    }
    throw new WorkoutMutationError(
      "WORKOUT_NOT_EDITABLE",
      "Workout is not editable in its current state.",
      409,
    );
  }

  const claimedWorkout = await tx.workout.findFirst({
    where: { id: input.workoutId, userId: input.userId },
    select: {
      id: true,
      revision: true,
      status: true,
      mesocycleId: true,
    },
  });
  if (!claimedWorkout) {
    throw new WorkoutMutationError(
      "WORKOUT_NOT_FOUND",
      "Workout not found",
      404,
    );
  }

  const result = await mutate(tx, claimedWorkout);
  return { result, revision: claimedWorkout.revision };
}

export async function executeWorkoutMutation<T>(
  input: {
    workoutId: string;
    userId: string;
    expectedRevision: number;
    editableStatuses?: readonly WorkoutStatus[];
  },
  mutate: (
    tx: Prisma.TransactionClient,
    claimedWorkout: ClaimedWorkout,
  ) => Promise<T>,
): Promise<{ result: T; revision: number }> {
  return prisma.$transaction((tx) =>
    executeWorkoutMutationInTransaction(tx, input, mutate),
  );
}
