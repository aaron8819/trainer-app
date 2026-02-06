import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { saveWorkoutSchema } from "@/lib/validation";
import { resolveUser } from "@/lib/api/workout-context";
import { BaselineCategory, PrimaryGoal, WorkoutStatus } from "@prisma/client";

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

type BaselineCandidate = {
  exerciseName: string;
  context: string;
  category: BaselineCategory;
  unit: string;
  workingWeightMin: number;
  workingWeightMax: number;
  workingRepsMin: number;
  workingRepsMax: number;
  topSetWeight: number;
  topSetReps: number;
};

type BaselineUpdateSummary = {
  context: string;
  evaluatedExercises: number;
  updated: number;
  skipped: number;
  items: {
    exerciseName: string;
    previousTopSetWeight?: number;
    newTopSetWeight: number;
    reps: number;
  }[];
  skippedItems: {
    exerciseName: string;
    reason: string;
  }[];
};

async function updateBaselinesFromWorkout(
  tx: typeof prisma,
  workoutId: string,
  userId: string
) {
  const goals = await tx.goals.findUnique({ where: { userId } });
  const context = goals?.primaryGoal === PrimaryGoal.STRENGTH ? "strength" : "volume";

  const workout = await tx.workout.findUnique({
    where: { id: workoutId },
    include: {
      exercises: {
        include: {
          exercise: true,
          sets: { include: { logs: true } },
        },
      },
    },
  });

  if (!workout || workout.exercises.length === 0) {
    return {
      context,
      evaluatedExercises: 0,
      updated: 0,
      skipped: 0,
      items: [],
      skippedItems: [],
    };
  }

  const evaluatedExercises = workout.exercises.filter((exercise) => exercise.sets.length >= 2);
  const candidates: BaselineCandidate[] = [];
  const skippedItems: BaselineUpdateSummary["skippedItems"] = [];

  for (const exercise of evaluatedExercises) {
    const sets = exercise.sets.map((set) => ({
      targetReps: set.targetReps ?? undefined,
      targetRpe: set.targetRpe ?? undefined,
      actualReps: set.logs[0]?.actualReps ?? undefined,
      actualLoad: set.logs[0]?.actualLoad ?? undefined,
      actualRpe: set.logs[0]?.actualRpe ?? undefined,
      wasSkipped: set.logs[0]?.wasSkipped ?? false,
      hasLog: Boolean(set.logs[0]),
    }));

    const unskipped = sets.filter((set) => !set.wasSkipped);
    if (unskipped.length === 0) {
      skippedItems.push({ exerciseName: exercise.exercise.name, reason: "All sets marked skipped." });
      continue;
    }

    const withPerformance = unskipped.filter(
      (set) => set.actualReps !== undefined && set.actualLoad !== undefined
    );
    if (withPerformance.length === 0) {
      const hasAnyLog = sets.some((set) => set.hasLog);
      skippedItems.push({
        exerciseName: exercise.exercise.name,
        reason: hasAnyLog ? "Missing logged reps or load." : "No logged sets.",
      });
      continue;
    }

    const qualifyingSets = withPerformance.filter((set) => {
      if (set.targetReps !== undefined && set.actualReps! < set.targetReps) {
        return false;
      }
      if (set.targetRpe !== undefined && set.actualRpe !== undefined) {
        return set.actualRpe <= set.targetRpe;
      }
      return true;
    });

    if (qualifyingSets.length === 0) {
      skippedItems.push({
        exerciseName: exercise.exercise.name,
        reason: "Targets not met (reps or RPE).",
      });
      continue;
    }

    const bestSet = qualifyingSets.reduce((best, current) =>
      (current.actualLoad ?? 0) > (best.actualLoad ?? 0) ? current : best
    );

    if (bestSet.actualLoad === undefined || bestSet.actualReps === undefined) {
      skippedItems.push({
        exerciseName: exercise.exercise.name,
        reason: "Missing logged reps or load.",
      });
      continue;
    }

    candidates.push({
      exerciseName: exercise.exercise.name,
      context,
      category: exercise.isMainLift ? BaselineCategory.MAIN_LIFT : BaselineCategory.OTHER,
      unit: "lbs",
      workingWeightMin: bestSet.actualLoad,
      workingWeightMax: bestSet.actualLoad,
      workingRepsMin: bestSet.actualReps,
      workingRepsMax: bestSet.actualReps,
      topSetWeight: bestSet.actualLoad,
      topSetReps: bestSet.actualReps,
    });
  }

  let updated = 0;
  let skipped = 0;
  const items: BaselineUpdateSummary["items"] = [];

  for (const candidate of candidates) {
    const existing = await tx.baseline.findUnique({
      where: {
        userId_exerciseName_context: {
          userId,
          exerciseName: candidate.exerciseName,
          context: candidate.context,
        },
      },
    });

    if (existing?.topSetWeight && candidate.topSetWeight <= existing.topSetWeight) {
      skipped += 1;
      skippedItems.push({
        exerciseName: candidate.exerciseName,
        reason: "Not above current baseline top set.",
      });
      continue;
    }

    await tx.baseline.upsert({
      where: {
        userId_exerciseName_context: {
          userId,
          exerciseName: candidate.exerciseName,
          context: candidate.context,
        },
      },
      update: {
        category: candidate.category,
        unit: candidate.unit,
        workingWeightMin: candidate.workingWeightMin,
        workingWeightMax: candidate.workingWeightMax,
        workingRepsMin: candidate.workingRepsMin,
        workingRepsMax: candidate.workingRepsMax,
        topSetWeight: candidate.topSetWeight,
        topSetReps: candidate.topSetReps,
      },
      create: {
        userId,
        exerciseName: candidate.exerciseName,
        context: candidate.context,
        category: candidate.category,
        unit: candidate.unit,
        workingWeightMin: candidate.workingWeightMin,
        workingWeightMax: candidate.workingWeightMax,
        workingRepsMin: candidate.workingRepsMin,
        workingRepsMax: candidate.workingRepsMax,
        topSetWeight: candidate.topSetWeight,
        topSetReps: candidate.topSetReps,
      },
    });

    updated += 1;
    items.push({
      exerciseName: candidate.exerciseName,
      previousTopSetWeight: existing?.topSetWeight ?? undefined,
      newTopSetWeight: candidate.topSetWeight,
      reps: candidate.topSetReps,
    });
  }

  return {
    context,
    evaluatedExercises: evaluatedExercises.length,
    updated,
    skipped,
    items,
    skippedItems,
  };
}
