import { NextResponse } from "next/server";
import { analyticsSummarySchema } from "@/lib/validation";
import { prisma } from "@/lib/db/prisma";
import { WorkoutStatus } from "@prisma/client";
import { resolveOwner } from "@/lib/api/workout-context";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const parsed = analyticsSummarySchema.safeParse({
    dateFrom: searchParams.get("dateFrom") ?? undefined,
    dateTo: searchParams.get("dateTo") ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const dateFrom = parsed.data.dateFrom ? new Date(parsed.data.dateFrom) : undefined;
  const dateTo = parsed.data.dateTo ? new Date(parsed.data.dateTo) : undefined;
  const owner = await resolveOwner();
  const workoutDateFilter =
    dateFrom || dateTo
      ? {
          scheduledDate: {
            gte: dateFrom,
            lte: dateTo,
          },
        }
      : {};

  const workoutsCompleted = await prisma.workout.count({
    where: {
      userId: owner.id,
      status: WorkoutStatus.COMPLETED,
      ...workoutDateFilter,
    },
  });

  const completedAtFilter =
    dateFrom || dateTo
      ? {
          completedAt: {
            gte: dateFrom,
            lte: dateTo,
          },
        }
      : {};

  const setLogs = await prisma.setLog.findMany({
    where: {
      workoutSet: {
        workoutExercise: {
          workout: {
            userId: owner.id,
          },
        },
      },
      ...completedAtFilter,
    },
    include: {
      workoutSet: {
        include: {
          workoutExercise: {
            include: {
              exercise: true,
            },
          },
        },
      },
    },
  });

  const totalSets = setLogs.length;
  const volumeByExercise = new Map<string, number>();

  for (const log of setLogs) {
    const exerciseName = log.workoutSet.workoutExercise.exercise.name;
    const reps = log.actualReps ?? 0;
    const load = log.actualLoad ?? 0;
    const volume = reps * load;
    volumeByExercise.set(exerciseName, (volumeByExercise.get(exerciseName) ?? 0) + volume);
  }

  const volumeByExerciseArray = Array.from(volumeByExercise.entries())
    .map(([exercise, volume]) => ({ exercise, volume }))
    .sort((a, b) => b.volume - a.volume);

  return NextResponse.json({
    totals: {
      workoutsCompleted,
      totalSets,
      volumeByExercise: volumeByExerciseArray,
    },
  });
}
