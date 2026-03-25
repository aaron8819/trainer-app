import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { resolveOwner } from "@/lib/api/workout-context";
import { reconcileRuntimeEditSelectionMetadata } from "@/lib/api/runtime-edit-reconciliation";
import { getClosedMesocycleWorkoutFenceReason } from "@/lib/workout-workflow";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
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

  const existingExercise = await prisma.workoutExercise.findFirst({
    where: {
      id: resolvedParams.exerciseId,
      workoutId: resolvedParams.id,
      workout: { userId: owner.id },
    },
    select: { id: true },
  });

  if (!existingExercise) {
    return NextResponse.json({ error: "Workout exercise not found" }, { status: 404 });
  }

  const result = await prisma.$transaction(async (tx) => {
    const workoutExercise = await tx.workoutExercise.findFirst({
      where: {
        id: resolvedParams.exerciseId,
        workoutId: resolvedParams.id,
        workout: { userId: owner.id },
      },
      select: {
        id: true,
        exerciseId: true,
        workout: {
          select: {
            id: true,
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
      return { error: "Workout exercise not found" as const, status: 404 as const };
    }

    const blockedReason = getClosedMesocycleWorkoutFenceReason({
      mesocycleId: workoutExercise.workout.mesocycleId,
      mesocycleState: workoutExercise.workout.mesocycle?.state ?? null,
      mesocycleIsActive: workoutExercise.workout.mesocycle?.isActive ?? null,
    });
    if (blockedReason) {
      return { error: blockedReason, status: 409 as const };
    }

    const lastSet = workoutExercise.sets[0];
    if (!lastSet) {
      return {
        error: "Cannot append a set to an exercise with no existing set.",
        status: 409 as const,
      };
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
        restSeconds: lastSet.restSeconds,
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
        revision: { increment: 1 },
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
  });

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(result);
}
