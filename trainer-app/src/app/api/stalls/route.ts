// Phase 3: GET /api/stalls
// Detect stalled exercises and suggest interventions

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { resolveOwner } from "@/lib/api/workout-context";
import { WorkoutStatus } from "@prisma/client";
import { detectStalls, suggestIntervention } from "@/lib/engine";
import type {
  StallDetectionWorkoutHistory,
  StallDetectionExerciseHistory,
  StallDetectionSetHistory,
  StallDetectionExercise,
} from "@/lib/engine/readiness/stall-intervention";

export async function GET(request: Request) {
  // Get user from database (matches existing codebase pattern)
  const user = await resolveOwner();
  const userId = user.id;

  // 1. Load recent workout history (last 12 weeks, ~36 sessions)
  const twelveWeeksAgo = new Date();
  twelveWeeksAgo.setDate(twelveWeeksAgo.getDate() - 84);

  const workouts = await prisma.workout.findMany({
    where: {
      userId,
      status: WorkoutStatus.COMPLETED,
      scheduledDate: { gte: twelveWeeksAgo },
    },
    orderBy: { scheduledDate: "desc" },
    take: 50, // Cap at 50 sessions for performance
    include: {
      exercises: {
        include: {
          exercise: { select: { id: true, name: true } },
          sets: {
            include: {
              logs: { orderBy: { completedAt: "desc" }, take: 1 },
            },
          },
        },
      },
    },
  });

  // 2. Map DB workouts to StallDetectionWorkoutHistory format
  const history = workouts.map((workout) => ({
    id: workout.id,
    completedAt: workout.scheduledDate,
    exercises: workout.exercises.map((we) => ({
      exerciseId: we.exerciseId,
      exerciseName: we.exercise.name,
      sets: we.sets
        .filter((set) => {
          const log = set.logs[0];
          return log && log.actualLoad !== null && log.actualLoad !== undefined;
        })
        .map((set) => {
          const log = set.logs[0]!; // Safe because we filtered above
          return {
            actualReps: log.actualReps ?? 0,
            actualLoad: log.actualLoad!,
            actualRir: log.actualRpe ? 10 - log.actualRpe : undefined,
          };
        }),
    })),
  }));

  // 3. Load all exercises (for stall detection reference)
  const allExercises = await prisma.exercise.findMany({
    select: { id: true, name: true },
  });

  const exerciseCatalog: StallDetectionExercise[] = allExercises.map((ex) => ({
    id: ex.id,
    name: ex.name,
  }));

  // 4. Detect stalls
  const stalls = detectStalls(history, exerciseCatalog);

  // 5. Generate intervention suggestions
  const interventions = stalls.map((stall) => suggestIntervention(stall));

  // 6. Return results
  return NextResponse.json({
    stalls,
    interventions,
    analysisInfo: {
      sessionsAnalyzed: workouts.length,
      dateRange: {
        from: workouts[workouts.length - 1]?.scheduledDate.toISOString() ?? null,
        to: workouts[0]?.scheduledDate.toISOString() ?? null,
      },
    },
  });
}
