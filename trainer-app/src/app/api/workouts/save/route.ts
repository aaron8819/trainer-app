import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { saveWorkoutSchema } from "@/lib/validation";
import { resolveUser } from "@/lib/api/workout-context";
import { WorkoutStatus } from "@prisma/client";
import {
  updateBaselinesFromWorkout,
  type BaselineUpdateSummary,
} from "@/lib/api/baseline-updater";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = saveWorkoutSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const user = await resolveUser(parsed.data.userId);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const scheduledDate = parsed.data.scheduledDate ? new Date(parsed.data.scheduledDate) : new Date();
  const status = parsed.data.status ?? WorkoutStatus.PLANNED;
  const completedAt =
    status === WorkoutStatus.COMPLETED ? new Date() : undefined;

  let baselineSummary: BaselineUpdateSummary | null = null;

  await prisma.$transaction(async (tx) => {
    const workout = await tx.workout.upsert({
      where: { id: parsed.data.workoutId },
      update: {
        scheduledDate,
        status,
        completedAt,
        estimatedMinutes: parsed.data.estimatedMinutes ?? undefined,
        notes: parsed.data.notes ?? undefined,
        selectionMode: parsed.data.selectionMode ?? undefined,
        forcedSplit: parsed.data.forcedSplit ?? undefined,
        advancesSplit: parsed.data.advancesSplit ?? undefined,
        templateId: parsed.data.templateId ?? undefined,
      },
      create: {
        id: parsed.data.workoutId,
        userId: user.id,
        scheduledDate,
        status,
        completedAt,
        estimatedMinutes: parsed.data.estimatedMinutes ?? undefined,
        notes: parsed.data.notes ?? undefined,
        selectionMode: parsed.data.selectionMode ?? undefined,
        forcedSplit: parsed.data.forcedSplit ?? undefined,
        advancesSplit: parsed.data.advancesSplit ?? undefined,
        templateId: parsed.data.templateId ?? undefined,
      },
    });

    if (parsed.data.exercises && parsed.data.exercises.length > 0) {
      const existingExercises = await tx.workoutExercise.findMany({
        where: { workoutId: workout.id },
        select: { id: true },
      });

      if (existingExercises.length > 0) {
        const exerciseIds = existingExercises.map((item) => item.id);
        await tx.workoutSet.deleteMany({ where: { workoutExerciseId: { in: exerciseIds } } });
        await tx.workoutExercise.deleteMany({ where: { id: { in: exerciseIds } } });
      }

      for (const [exerciseIndex, exercise] of parsed.data.exercises.entries()) {
        const exerciseRecord = await tx.exercise.findUnique({
          where: { id: exercise.exerciseId },
        });

        const section = exercise.section ?? (exerciseIndex < 2 ? "WARMUP" : exerciseIndex < 5 ? "MAIN" : "ACCESSORY");

        const createdExercise = await tx.workoutExercise.create({
          data: {
            workoutId: workout.id,
            exerciseId: exercise.exerciseId,
            orderIndex: exerciseIndex,
            isMainLift: section === "MAIN" ? true : exerciseRecord?.isMainLift ?? false,
            movementPattern: exerciseRecord?.movementPattern ?? "PUSH",
            movementPatternsV2: exerciseRecord?.movementPatternsV2 ?? [],
            sets: {
              create: exercise.sets.map((set) => ({
                setIndex: set.setIndex,
                targetReps: set.targetReps,
                targetRpe: set.targetRpe ?? undefined,
                targetLoad: set.targetLoad ?? undefined,
                restSeconds: set.restSeconds ?? undefined,
              })),
            },
          },
        });

        if (!createdExercise) {
          throw new Error("Failed to create workout exercise");
        }
      }
    }

    if (status === WorkoutStatus.COMPLETED) {
      baselineSummary = await updateBaselinesFromWorkout(tx, workout.id, user.id);
    }
  });

  return NextResponse.json({
    status: "saved",
    workoutId: parsed.data.workoutId,
    baselineSummary,
  });
}
