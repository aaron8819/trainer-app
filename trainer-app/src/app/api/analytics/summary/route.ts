import { NextResponse } from "next/server";
import { analyticsSummarySchema } from "@/lib/validation";
import { prisma } from "@/lib/db/prisma";
import { resolveOwner } from "@/lib/api/workout-context";
import {
  buildDateRangeAnalyticsWindow,
  countAnalyticsWorkoutStatuses,
} from "@/lib/api/analytics-semantics";
import { PERFORMED_WORKOUT_STATUSES } from "@/lib/workout-status";
import { WorkoutStatus } from "@prisma/client";

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

  const totalCounts = countAnalyticsWorkoutStatuses(workouts.map((workout) => workout.status));

  const modeCounts = new Map<
    (typeof TRACKED_SELECTION_MODES)[number],
    { generated: number; performed: number; completed: number }
  >(
    TRACKED_SELECTION_MODES.map((mode) => [
      mode,
      { generated: 0, performed: 0, completed: 0 },
    ])
  );
  const intentCounts = new Map<
    string,
    { generated: number; performed: number; completed: number }
  >();

  for (const workout of workouts) {
    const mode = TRACKED_SELECTION_MODES.includes(
      workout.selectionMode as (typeof TRACKED_SELECTION_MODES)[number]
    )
      ? (workout.selectionMode as (typeof TRACKED_SELECTION_MODES)[number])
      : "AUTO";
    const modeBucket = modeCounts.get(mode);
    if (modeBucket) {
      modeBucket.generated += 1;
      if ((PERFORMED_WORKOUT_STATUSES as readonly string[]).includes(workout.status)) {
        modeBucket.performed += 1;
      }
      if (workout.status === WorkoutStatus.COMPLETED) {
        modeBucket.completed += 1;
      }
    }

    if (workout.sessionIntent) {
      const intent = workout.sessionIntent;
      const bucket = intentCounts.get(intent) ?? {
        generated: 0,
        performed: 0,
        completed: 0,
      };
      bucket.generated += 1;
      if ((PERFORMED_WORKOUT_STATUSES as readonly string[]).includes(workout.status)) {
        bucket.performed += 1;
      }
      if (workout.status === WorkoutStatus.COMPLETED) {
        bucket.completed += 1;
      }
      intentCounts.set(intent, bucket);
    }
  }

  const setLogs = await prisma.setLog.findMany({
    where: {
      wasSkipped: false,
      workoutSet: {
        workoutExercise: {
          workout: {
            userId: owner.id,
            status: { in: [...PERFORMED_WORKOUT_STATUSES] as WorkoutStatus[] },
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
    semantics: {
      workoutWindow: buildDateRangeAnalyticsWindow({
        label: "Generated, performed, and completed workouts use scheduledDate within the selected range.",
        dateField: "scheduledDate",
        dateFrom,
        dateTo,
      }),
      performedSetWindow: buildDateRangeAnalyticsWindow({
        label: "Performed set totals use set-log completedAt within the selected range.",
        dateField: "completedAt",
        dateFrom,
        dateTo,
      }),
      counts: {
        generated: "Generated workouts include every saved workout in the scheduledDate window.",
        performed:
          "Performed workouts include COMPLETED and PARTIAL workouts in the scheduledDate window.",
        completed: "Completed workouts include only COMPLETED workouts in the scheduledDate window.",
      },
    },
    totals: {
      workoutsGenerated: totalCounts.generated,
      workoutsPerformed: totalCounts.performed,
      workoutsCompleted: totalCounts.completed,
      totalSets,
      volumeByExercise: volumeByExerciseArray,
    },
    kpis: {
      selectionModes: TRACKED_SELECTION_MODES.map((mode) => {
        const bucket = modeCounts.get(mode) ?? { generated: 0, performed: 0, completed: 0 };
        return {
          mode,
          generated: bucket.generated,
          performed: bucket.performed,
          completed: bucket.completed,
          performedRate:
            bucket.generated > 0 ? Number((bucket.performed / bucket.generated).toFixed(3)) : null,
          completionRate:
            bucket.generated > 0 ? Number((bucket.completed / bucket.generated).toFixed(3)) : null,
        };
      }),
      intents: Array.from(intentCounts.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([intent, bucket]) => ({
          intent,
          generated: bucket.generated,
          performed: bucket.performed,
          completed: bucket.completed,
          performedRate:
            bucket.generated > 0 ? Number((bucket.performed / bucket.generated).toFixed(3)) : null,
          completionRate:
            bucket.generated > 0 ? Number((bucket.completed / bucket.generated).toFixed(3)) : null,
        })),
    },
  });
}
