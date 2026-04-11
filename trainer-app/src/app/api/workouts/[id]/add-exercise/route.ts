import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { resolveOwner } from "@/lib/api/workout-context";
import { buildRuntimeAddedExercisePreview } from "@/lib/api/runtime-added-exercise-preview";
import { reconcileRuntimeEditSelectionMetadata } from "@/lib/api/runtime-edit-reconciliation";
import { RUNTIME_ADDED_EXERCISE_SESSION_NOTE } from "@/lib/ui/selection-metadata";
import { buildExerciseMuscleDisplayGroups } from "@/lib/ui/exercise-muscle-tags";
import type { TrainingAge, PrimaryGoal } from "@/lib/engine/types";
import { Prisma } from "@prisma/client";
import { isStrictOptionalGapFillSession } from "@/lib/gap-fill/classifier";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const addExerciseSchema = z.object({
  exerciseId: z.string().min(1),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const resolvedParams = await params;
  if (!resolvedParams?.id) {
    return NextResponse.json({ error: "Missing workout id" }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = addExerciseSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const owner = await resolveOwner();
  const workoutId = resolvedParams.id;

  // Verify workout belongs to owner
  const workout = await prisma.workout.findFirst({
    where: { id: workoutId, userId: owner.id },
    select: {
      id: true,
    },
  });
  if (!workout) {
    return NextResponse.json({ error: "Workout not found" }, { status: 404 });
  }

  // Load exercise, user profile, goals, and most recent actual load in parallel
  const [exercise, profile, goals, recentSet] = await Promise.all([
    prisma.exercise.findUnique({
      where: { id: parsed.data.exerciseId },
      include: {
        aliases: true,
        exerciseMuscles: { include: { muscle: true } },
        exerciseEquipment: { include: { equipment: true } },
      },
    }),
    prisma.profile.findUnique({
      where: { userId: owner.id },
      select: { trainingAge: true },
    }),
    prisma.goals.findUnique({
      where: { userId: owner.id },
      select: { primaryGoal: true },
    }),
    // Fetch last logged load for this exercise to give a useful starting weight
    prisma.setLog.findFirst({
      where: {
        actualLoad: { not: null },
        workoutSet: {
          workoutExercise: {
            exerciseId: parsed.data.exerciseId,
            workout: { userId: owner.id, status: "COMPLETED" },
          },
        },
      },
      orderBy: { completedAt: "desc" },
      select: { actualLoad: true },
    }),
  ]);
  if (!exercise) {
    return NextResponse.json({ error: "Exercise not found" }, { status: 404 });
  }

  // Use last logged load as the starting target — keeps prescription grounded in reality
  const targetLoad = recentSet?.actualLoad ?? null;
  const trainingAge = (profile?.trainingAge?.toLowerCase() as TrainingAge) ?? "intermediate";
  const primaryGoal = (goals?.primaryGoal?.toLowerCase() as PrimaryGoal) ?? "hypertrophy";

  const createExerciseAtNextIndex = async () =>
    prisma.$transaction(async (tx) => {
      const latestWorkout = await tx.workout.findUnique({
        where: { id: workoutId },
        select: {
          selectionMetadata: true,
          selectionMode: true,
          sessionIntent: true,
          exercises: {
            orderBy: [{ orderIndex: "asc" }, { id: "asc" }],
            select: {
              orderIndex: true,
              section: true,
              sets: {
                orderBy: { setIndex: "asc" },
                select: {
                  targetReps: true,
                  targetRepMin: true,
                  targetRepMax: true,
                  targetRpe: true,
                  restSeconds: true,
                },
              },
            },
          },
        },
      });
      if (!latestWorkout) {
        throw new Error("WORKOUT_NOT_FOUND");
      }
      if (
        isStrictOptionalGapFillSession({
          selectionMetadata: latestWorkout.selectionMetadata,
          selectionMode: latestWorkout.selectionMode,
          sessionIntent: latestWorkout.sessionIntent,
        })
      ) {
        throw new Error("GAP_FILL_BONUS_EXERCISE_BLOCKED");
      }

      const latest = await tx.workoutExercise.findFirst({
        where: { workoutId },
        orderBy: { orderIndex: "desc" },
        select: { orderIndex: true },
      });
      const nextOrderIndex = (latest?.orderIndex ?? -1) + 1;
      const preview = buildRuntimeAddedExercisePreview({
        exercise: {
          id: exercise.id,
          name: exercise.name,
          repRangeMin: exercise.repRangeMin,
          repRangeMax: exercise.repRangeMax,
          fatigueCost: exercise.fatigueCost,
          isCompound: exercise.isCompound,
          equipment: exercise.exerciseEquipment.map((eq) => eq.equipment.type),
        },
        targetLoad,
        selectionMetadata: latestWorkout.selectionMetadata,
        currentExercises: latestWorkout.exercises,
        trainingAge,
        primaryGoal,
      });
      const setIndices = Array.from({ length: preview.setCount }, (_, i) => i + 1);
      const createdExercise = await tx.workoutExercise.create({
        data: {
          workoutId,
          exerciseId: exercise.id,
          orderIndex: nextOrderIndex,
          section: preview.section,
          isMainLift: preview.isMainLift,
          sets: {
            create: setIndices.map((setIndex) => ({
              setIndex,
              targetReps: preview.targetReps,
              targetRepMin: preview.targetRepRange.min,
              targetRepMax: preview.targetRepRange.max,
              targetRpe: preview.targetRpe,
              restSeconds: preview.restSeconds,
              ...(targetLoad !== null ? { targetLoad } : {}),
            })),
          },
        },
        include: {
          sets: { orderBy: { setIndex: "asc" } },
        },
      });

      const persistedExercises = await tx.workoutExercise.findMany({
        where: { workoutId },
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
        selectionMetadata: latestWorkout.selectionMetadata,
        selectionMode: latestWorkout.selectionMode,
        sessionIntent: latestWorkout.sessionIntent,
        persistedExercises,
        mutation: {
          kind: "add_exercise",
          workoutExerciseId: createdExercise.id,
          exerciseId: exercise.id,
          orderIndex: nextOrderIndex,
          section: preview.section,
          setCount: createdExercise.sets.length,
          prescriptionSource: preview.prescriptionSource,
        },
      }).nextSelectionMetadata;

      await tx.workout.update({
        where: { id: workoutId },
        data: {
          revision: { increment: 1 },
          selectionMetadata: selectionMetadata as Prisma.InputJsonValue,
        },
      });

      return createdExercise;
    });

  let workoutExercise;
  try {
    workoutExercise = await createExerciseAtNextIndex();
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      workoutExercise = await createExerciseAtNextIndex();
    } else {
      if (error instanceof Error && error.message === "WORKOUT_NOT_FOUND") {
        return NextResponse.json({ error: "Workout not found" }, { status: 404 });
      }
      if (error instanceof Error && error.message === "GAP_FILL_BONUS_EXERCISE_BLOCKED") {
        return NextResponse.json(
          { error: "Strict gap-fill sessions only allow constrained swaps, not freeform exercise adds." },
          { status: 409 }
        );
      }
      throw error;
    }
  }

  // Return in LogExerciseInput format
  const muscleTagGroups = buildExerciseMuscleDisplayGroups(exercise);
  const logExercise = {
    workoutExerciseId: workoutExercise.id,
    name: exercise.name,
    equipment: exercise.exerciseEquipment.map((eq) => eq.equipment.type),
    muscleTags: muscleTagGroups.muscleTags,
    muscleTagGroups: {
      primaryMuscles: muscleTagGroups.primaryMuscles,
      secondaryMuscles: muscleTagGroups.secondaryMuscles,
    },
    isRuntimeAdded: true as const,
    isMainLift: false,
    section: "ACCESSORY" as const,
    sessionNote: RUNTIME_ADDED_EXERCISE_SESSION_NOTE,
    sets: workoutExercise.sets.map((set) => ({
      setId: set.id,
      setIndex: set.setIndex,
      targetReps: set.targetReps,
      targetRepRange:
        set.targetRepMin != null && set.targetRepMax != null
          ? { min: set.targetRepMin, max: set.targetRepMax }
          : undefined,
      targetLoad: set.targetLoad,
      targetRpe: set.targetRpe,
      restSeconds: set.restSeconds,
    })),
  };

  return NextResponse.json({ exercise: logExercise });
}
