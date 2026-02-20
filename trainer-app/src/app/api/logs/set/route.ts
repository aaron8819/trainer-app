import { NextResponse } from "next/server";
import { setLogSchema } from "@/lib/validation";
import { prisma } from "@/lib/db/prisma";
import { resolveOwner } from "@/lib/api/workout-context";
import { z } from "zod";
import { WorkoutStatus } from "@prisma/client";

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
  const outcome = await prisma.$transaction(async (tx) => {
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
                id: true,
                status: true,
              },
            },
          },
        },
      },
    });

    if (!setRecord) {
      return { error: "Workout set not found" as const };
    }

    const previousLog = await tx.setLog.findUnique({
      where: { workoutSetId: parsed.data.workoutSetId },
      select: {
        actualReps: true,
        actualRpe: true,
        actualLoad: true,
        wasSkipped: true,
        notes: true,
      },
    });

    const log = await tx.setLog.upsert({
      where: { workoutSetId: parsed.data.workoutSetId },
      update: {
        actualReps: parsed.data.actualReps ?? undefined,
        actualRpe: parsed.data.actualRpe ?? undefined,
        actualLoad: parsed.data.actualLoad ?? undefined,
        wasSkipped: parsed.data.wasSkipped ?? false,
        notes: parsed.data.notes ?? undefined,
        completedAt: new Date(),
      },
      create: {
        workoutSetId: parsed.data.workoutSetId,
        actualReps: parsed.data.actualReps ?? undefined,
        actualRpe: parsed.data.actualRpe ?? undefined,
        actualLoad: parsed.data.actualLoad ?? undefined,
        wasSkipped: parsed.data.wasSkipped ?? false,
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

  if ("error" in outcome) {
    return NextResponse.json({ error: outcome.error }, { status: 404 });
  }

  return NextResponse.json({
    status: "logged",
    logId: outcome.log.id,
    wasCreated: outcome.wasCreated,
    previousLog: outcome.previousLog,
    workoutStatusUpdated: outcome.workoutStatusUpdated,
  });
}

const deleteSetLogSchema = z.object({
  workoutSetId: z.string(),
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
  const deleted = await prisma.$transaction(async (tx) => {
    const setRecord = await tx.workoutSet.findFirst({
      where: {
        id: parsed.data.workoutSetId,
        workoutExercise: { workout: { userId: owner.id } },
      },
      select: { id: true },
    });

    if (!setRecord) {
      return { error: "Workout set not found" as const };
    }

    await tx.setLog.deleteMany({
      where: { workoutSetId: parsed.data.workoutSetId },
    });

    return { ok: true as const };
  });

  if ("error" in deleted) {
    return NextResponse.json({ error: deleted.error }, { status: 404 });
  }

  return NextResponse.json({ status: "deleted" });
}
