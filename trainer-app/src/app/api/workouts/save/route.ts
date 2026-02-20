import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { saveWorkoutSchema } from "@/lib/validation";
import { resolveOwner } from "@/lib/api/workout-context";
import { WorkoutStatus } from "@prisma/client";
import { updateExerciseExposure } from "@/lib/api/exercise-exposure";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = saveWorkoutSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const user = await resolveOwner();
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const scheduledDate = parsed.data.scheduledDate ? new Date(parsed.data.scheduledDate) : new Date();
  const status = parsed.data.status ?? WorkoutStatus.PLANNED;
  const selectionMode =
    parsed.data.selectionMode ?? (parsed.data.sessionIntent ? "INTENT" : undefined);
  const completedAt =
    status === WorkoutStatus.COMPLETED ? new Date() : undefined;

  const workoutId = parsed.data.workoutId;

  try {
    await prisma.$transaction(async (tx) => {
      const existingWorkout = await tx.workout.findUnique({
        where: { id: parsed.data.workoutId },
        select: { id: true, userId: true },
      });
      if (existingWorkout && existingWorkout.userId !== user.id) {
        throw new Error("WORKOUT_FORBIDDEN");
      }

      if (parsed.data.templateId) {
        const template = await tx.workoutTemplate.findFirst({
          where: { id: parsed.data.templateId, userId: user.id },
          select: { id: true },
        });
        if (!template) {
          throw new Error("TEMPLATE_NOT_FOUND");
        }
      }

      const workout = await tx.workout.upsert({
      where: { id: parsed.data.workoutId },
      update: {
        scheduledDate,
        status,
        completedAt,
        estimatedMinutes: parsed.data.estimatedMinutes ?? undefined,
        notes: parsed.data.notes ?? undefined,
        selectionMode,
        sessionIntent: parsed.data.sessionIntent ?? undefined,
        selectionMetadata: parsed.data.selectionMetadata ?? undefined,
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
        selectionMode,
        sessionIntent: parsed.data.sessionIntent ?? undefined,
        selectionMetadata: parsed.data.selectionMetadata ?? undefined,
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

          const section =
            exercise.section ??
            (exerciseIndex < 2 ? "WARMUP" : exerciseIndex < 5 ? "MAIN" : "ACCESSORY");

          const createdExercise = await tx.workoutExercise.create({
            data: {
              workoutId: workout.id,
              exerciseId: exercise.exerciseId,
              orderIndex: exerciseIndex,
              section,
              isMainLift: section === "MAIN" ? true : false,
              movementPatterns: exerciseRecord?.movementPatterns ?? [],
              sets: {
                create: exercise.sets.map((set) => ({
                  setIndex: set.setIndex,
                  targetReps: set.targetReps,
                  targetRepMin: set.targetRepRange?.min ?? undefined,
                  targetRepMax: set.targetRepRange?.max ?? undefined,
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

      // Persist filtered exercises (intent mode explainability)
      await tx.filteredExercise.deleteMany({ where: { workoutId } });
      if (parsed.data.filteredExercises?.length) {
        await tx.filteredExercise.createMany({
          data: parsed.data.filteredExercises.map((fe) => ({
            workoutId,
            exerciseId: fe.exerciseId ?? null,
            exerciseName: fe.exerciseName,
            reason: fe.reason,
            userFriendlyMessage: fe.userFriendlyMessage,
          })),
        });
      }

    });

    // Update exercise exposure for rotation tracking (outside transaction)
    if (status === WorkoutStatus.COMPLETED) {
      try {
        await updateExerciseExposure(user.id, workoutId);
      } catch (exposureError) {
        // Log error but don't fail the request
        console.error("Failed to update exercise exposure:", exposureError);
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message === "WORKOUT_FORBIDDEN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (error instanceof Error && error.message === "WORKOUT_NOT_FOUND") {
      return NextResponse.json({ error: "Workout not found" }, { status: 404 });
    }
    if (error instanceof Error && error.message === "TEMPLATE_NOT_FOUND") {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }
    throw error;
  }

  return NextResponse.json({
    status: "saved",
    workoutId: parsed.data.workoutId,
  });
}
