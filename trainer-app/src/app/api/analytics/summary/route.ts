import { NextResponse } from "next/server";
import { analyticsSummarySchema } from "@/lib/validation";
import { prisma } from "@/lib/db/prisma";
import { WorkoutStatus } from "@prisma/client";
import { resolveOwner } from "@/lib/api/workout-context";

const TRACKED_SELECTION_MODES = ["AUTO", "MANUAL", "BONUS", "INTENT"] as const;

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

  const workouts = await prisma.workout.findMany({
    where: {
      userId: owner.id,
      ...workoutDateFilter,
    },
    select: {
      status: true,
      selectionMode: true,
      sessionIntent: true,
    },
  });

  const modeCounts = new Map<
    (typeof TRACKED_SELECTION_MODES)[number],
    { generated: number; completed: number }
  >(
    TRACKED_SELECTION_MODES.map((mode) => [
      mode,
      { generated: 0, completed: 0 },
    ])
  );
  const intentCounts = new Map<string, { generated: number; completed: number }>();

  for (const workout of workouts) {
    const mode = TRACKED_SELECTION_MODES.includes(
      workout.selectionMode as (typeof TRACKED_SELECTION_MODES)[number]
    )
      ? (workout.selectionMode as (typeof TRACKED_SELECTION_MODES)[number])
      : "AUTO";
    const modeBucket = modeCounts.get(mode);
    if (modeBucket) {
      modeBucket.generated += 1;
      if (workout.status === WorkoutStatus.COMPLETED) {
        modeBucket.completed += 1;
      }
    }

    if (workout.sessionIntent) {
      const intent = workout.sessionIntent;
      const bucket = intentCounts.get(intent) ?? { generated: 0, completed: 0 };
      bucket.generated += 1;
      if (workout.status === WorkoutStatus.COMPLETED) {
        bucket.completed += 1;
      }
      intentCounts.set(intent, bucket);
    }
  }

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
    kpis: {
      selectionModes: TRACKED_SELECTION_MODES.map((mode) => {
        const bucket = modeCounts.get(mode) ?? { generated: 0, completed: 0 };
        const completionRate =
          bucket.generated > 0 ? Number((bucket.completed / bucket.generated).toFixed(3)) : null;
        return {
          mode,
          generated: bucket.generated,
          completed: bucket.completed,
          completionRate,
        };
      }),
      intents: Array.from(intentCounts.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([intent, bucket]) => ({
          intent,
          generated: bucket.generated,
          completed: bucket.completed,
          completionRate:
            bucket.generated > 0
              ? Number((bucket.completed / bucket.generated).toFixed(3))
              : null,
        })),
    },
  });
}
