import { NextResponse } from "next/server";
import { setLogSchema } from "@/lib/validation";
import { prisma } from "@/lib/db/prisma";
import { resolveOwner } from "@/lib/api/workout-context";
import { reconcileRuntimeEditSelectionMetadata } from "@/lib/api/runtime-edit-reconciliation";
import { z } from "zod";
import { Prisma, WorkoutStatus } from "@prisma/client";
import { resolveDefaultRestSecondsForExecutionSet } from "@/lib/logging/rest-timer-policy";
import { quantizeLoad } from "@/lib/units/load-quantization";
import { getSetValidity } from "@/lib/logging/setValidity";
import { getClosedMesocycleWorkoutFenceReason } from "@/lib/workout-workflow";
import {
  executeWorkoutMutation,
  isWorkoutMutationError,
} from "@/lib/api/workout-mutation";

class SetLogMutationError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409,
  ) {
    super(message);
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = setLogSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const owner = await resolveOwner();
  const mutationTarget = parsed.data.workoutSetId
    ? await prisma.workoutSet.findFirst({
        where: {
          id: parsed.data.workoutSetId,
          workoutExercise: { workout: { userId: owner.id } },
        },
        select: { workoutExercise: { select: { workoutId: true } } },
      })
    : await prisma.workoutExercise.findFirst({
        where: {
          id: parsed.data.workoutExerciseId,
          workout: { userId: owner.id },
        },
        select: { workoutId: true },
      });
  const workoutId = parsed.data.workoutSetId
    ? mutationTarget && "workoutExercise" in mutationTarget
      ? mutationTarget.workoutExercise.workoutId
      : null
    : mutationTarget && "workoutId" in mutationTarget
      ? mutationTarget.workoutId
      : null;
  if (!workoutId) {
    const error = parsed.data.workoutSetId
      ? "Workout set not found"
      : "Workout exercise not found";
    return NextResponse.json({ error }, { status: 404 });
  }

  try {
    const mutation = await executeWorkoutMutation({
      workoutId,
      userId: owner.id,
      expectedRevision: parsed.data.expectedRevision,
    }, async (tx) => {
    if (!parsed.data.workoutSetId && parsed.data.setIntent === "WARMUP") {
      const workoutExercise = await tx.workoutExercise.findFirst({
        where: {
          id: parsed.data.workoutExerciseId,
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
            orderBy: { setIndex: "asc" },
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
        throw new SetLogMutationError("Workout exercise not found", 404);
      }

      const blockedReason = getClosedMesocycleWorkoutFenceReason({
        mesocycleId: workoutExercise.workout.mesocycleId,
        mesocycleState: workoutExercise.workout.mesocycle?.state ?? null,
        mesocycleIsActive: workoutExercise.workout.mesocycle?.isActive ?? null,
      });
      if (blockedReason) {
        throw new SetLogMutationError(blockedReason, 409);
      }

      const baseSet = workoutExercise.sets[0];
      if (!baseSet) {
        throw new SetLogMutationError(
          "Cannot log a warmup for an exercise with no prescribed set.",
          409,
        );
      }

      const wasSkipped = parsed.data.wasSkipped ?? false;
      const normalizedActualLoad =
        (parsed.data.actualLoad != null ? quantizeLoad(parsed.data.actualLoad) : undefined) ??
        (!wasSkipped && baseSet.targetLoad === 0 ? 0 : undefined);
      const validity = getSetValidity({
        actualReps: parsed.data.actualReps,
        actualRpe: parsed.data.actualRpe,
        actualLoad: normalizedActualLoad,
        wasSkipped,
      });
      if (!validity.valid) {
        throw new SetLogMutationError(validity.reason ?? "Invalid set log", 400);
      }

      const nextSet = await tx.workoutSet.create({
        data: {
          workoutExerciseId: workoutExercise.id,
          setIndex: 0,
          targetReps: baseSet.targetReps,
          targetRepMin: baseSet.targetRepMin,
          targetRepMax: baseSet.targetRepMax,
          targetRpe: baseSet.targetRpe,
          targetLoad: baseSet.targetLoad,
          restSeconds: resolveDefaultRestSecondsForExecutionSet({
            section: "warmup",
            isMainLift: false,
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

      const log = await tx.setLog.create({
        data: {
          workoutSetId: nextSet.id,
          actualReps: parsed.data.actualReps ?? undefined,
          actualRpe: parsed.data.actualRpe ?? undefined,
          actualLoad: normalizedActualLoad,
          setIntent: "WARMUP",
          wasSkipped,
          notes: parsed.data.notes ?? undefined,
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
        persistedExercises,
        mutation: {
          kind: "add_set",
          workoutExerciseId: workoutExercise.id,
          exerciseId: workoutExercise.exerciseId,
          workoutSetId: nextSet.id,
          setIndex: nextSet.setIndex,
          clonedFromSetIndex: baseSet.setIndex,
        },
      }).nextSelectionMetadata;

      let workoutStatusUpdated = false;
      await tx.workout.update({
        where: { id: workoutExercise.workout.id },
        data: {
          ...(workoutExercise.workout.status === WorkoutStatus.PLANNED
            ? { status: WorkoutStatus.IN_PROGRESS }
            : {}),
          selectionMetadata: selectionMetadata as Prisma.InputJsonValue,
        },
      });
      workoutStatusUpdated = workoutExercise.workout.status === WorkoutStatus.PLANNED;

      return {
        log,
        previousLog: null,
        wasCreated: true,
        workoutStatusUpdated,
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
          setIntent: "WARMUP" as const,
        },
      };
    }

    const workoutSetId = parsed.data.workoutSetId as string;
    const setRecord = await tx.workoutSet.findFirst({
      where: {
        id: workoutSetId,
        workoutExercise: { workout: { userId: owner.id } },
      },
      select: {
        id: true,
        targetLoad: true,
        workoutExercise: {
          select: {
            workout: {
              select: {
                id: true,
                status: true,
                mesocycleId: true,
                mesocycle: {
                  select: {
                    state: true,
                    isActive: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!setRecord) {
      throw new SetLogMutationError("Workout set not found", 404);
    }
    const blockedReason = getClosedMesocycleWorkoutFenceReason({
      mesocycleId: setRecord.workoutExercise.workout.mesocycleId,
      mesocycleState: setRecord.workoutExercise.workout.mesocycle?.state ?? null,
      mesocycleIsActive: setRecord.workoutExercise.workout.mesocycle?.isActive ?? null,
    });
    if (blockedReason) {
      throw new SetLogMutationError(blockedReason, 409);
    }
    const wasSkipped = parsed.data.wasSkipped ?? false;
    const setIntent = parsed.data.setIntent ?? "WORK";
    const normalizedActualLoad =
      (parsed.data.actualLoad != null ? quantizeLoad(parsed.data.actualLoad) : undefined) ??
      (!wasSkipped && setRecord.targetLoad === 0 ? 0 : undefined);
    const validity = getSetValidity({
      actualReps: parsed.data.actualReps,
      actualRpe: parsed.data.actualRpe,
      actualLoad: normalizedActualLoad,
      wasSkipped,
    });
    if (!validity.valid) {
      throw new SetLogMutationError(validity.reason ?? "Invalid set log", 400);
    }

    const previousLog = await tx.setLog.findUnique({
      where: { workoutSetId },
      select: {
        actualReps: true,
        actualRpe: true,
        actualLoad: true,
        setIntent: true,
        wasSkipped: true,
        notes: true,
      },
    });

    const log = await tx.setLog.upsert({
      where: { workoutSetId },
      update: {
        actualReps: parsed.data.actualReps ?? undefined,
        actualRpe: parsed.data.actualRpe ?? undefined,
        actualLoad: normalizedActualLoad,
        setIntent,
        wasSkipped,
        notes: parsed.data.notes ?? undefined,
        completedAt: new Date(),
      },
      create: {
        workoutSetId,
        actualReps: parsed.data.actualReps ?? undefined,
        actualRpe: parsed.data.actualRpe ?? undefined,
        actualLoad: normalizedActualLoad,
        setIntent,
        wasSkipped,
        notes: parsed.data.notes ?? undefined,
      },
    });

    let workoutStatusUpdated = false;
    if (setRecord.workoutExercise.workout.status === WorkoutStatus.PLANNED) {
      await tx.workout.update({
        where: { id: setRecord.workoutExercise.workout.id },
        data: { status: WorkoutStatus.IN_PROGRESS },
      });
      workoutStatusUpdated = true;
    }

    return {
      log,
      previousLog,
      wasCreated: previousLog === null,
      workoutStatusUpdated,
    };
    });
    const outcome = mutation.result;

  return NextResponse.json({
    status: "logged",
    logId: outcome.log.id,
    wasCreated: outcome.wasCreated,
    previousLog: outcome.previousLog,
    workoutStatusUpdated: outcome.workoutStatusUpdated,
    revision: mutation.revision,
    ...("set" in outcome ? { set: outcome.set } : {}),
  });
  } catch (error) {
    if (isWorkoutMutationError(error) || error instanceof SetLogMutationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}

const deleteSetLogSchema = z.object({
  workoutSetId: z.string(),
  expectedRevision: z.number().int().min(1),
});

export async function DELETE(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = deleteSetLogSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const owner = await resolveOwner();
  const mutationTarget = await prisma.workoutSet.findFirst({
    where: {
      id: parsed.data.workoutSetId,
      workoutExercise: { workout: { userId: owner.id } },
    },
    select: { workoutExercise: { select: { workoutId: true } } },
  });
  if (!mutationTarget) {
    return NextResponse.json({ error: "Workout set not found" }, { status: 404 });
  }

  try {
  const mutation = await executeWorkoutMutation({
    workoutId: mutationTarget.workoutExercise.workoutId,
    userId: owner.id,
    expectedRevision: parsed.data.expectedRevision,
  }, async (tx) => {
    const setRecord = await tx.workoutSet.findFirst({
      where: {
        id: parsed.data.workoutSetId,
        workoutExercise: { workout: { userId: owner.id } },
      },
      select: {
        id: true,
        workoutExercise: {
          select: {
            workout: {
              select: {
                mesocycleId: true,
                mesocycle: {
                  select: {
                    state: true,
                    isActive: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!setRecord) {
      throw new SetLogMutationError("Workout set not found", 404);
    }
    const blockedReason = getClosedMesocycleWorkoutFenceReason({
      mesocycleId: setRecord.workoutExercise.workout.mesocycleId,
      mesocycleState: setRecord.workoutExercise.workout.mesocycle?.state ?? null,
      mesocycleIsActive: setRecord.workoutExercise.workout.mesocycle?.isActive ?? null,
    });
    if (blockedReason) {
      throw new SetLogMutationError(blockedReason, 409);
    }

    await tx.setLog.deleteMany({
      where: { workoutSetId: parsed.data.workoutSetId },
    });

    return { ok: true as const };
  });

  return NextResponse.json({ status: "deleted", revision: mutation.revision });
  } catch (error) {
    if (isWorkoutMutationError(error) || error instanceof SetLogMutationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
