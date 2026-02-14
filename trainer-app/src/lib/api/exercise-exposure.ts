/**
 * Exercise Exposure API
 *
 * Manages exercise rotation tracking and performance trend analysis.
 * Used by selection-v2 for rotation novelty scoring.
 */

import { prisma } from "@/lib/db/prisma";
import type { RotationContext, PerformanceTrend } from "../engine/selection-v2/types";

/**
 * Load exercise exposure data for a user
 *
 * Maps ExerciseExposure records to RotationContext for selection-v2.
 *
 * @param userId - User ID
 * @returns Rotation context map (exerciseId → exposure data)
 */
export async function loadExerciseExposure(userId: string): Promise<RotationContext> {
  const exposureRecords = await prisma.exerciseExposure.findMany({
    where: { userId },
    orderBy: { lastUsedAt: "desc" },
  });

  const rotationContext: RotationContext = new Map();

  for (const record of exposureRecords) {
    // Compute weeks since last use
    const now = new Date();
    const lastUsed = new Date(record.lastUsedAt);
    const diffMs = now.getTime() - lastUsed.getTime();
    const weeksAgo = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000));

    // Compute performance trend
    const trend = assessPerformanceTrend(record.exerciseName, userId);

    rotationContext.set(record.exerciseName, {
      lastUsed,
      weeksAgo,
      usageCount: record.timesUsedL12W, // Use 12-week window
      trend: await trend, // Resolve promise
    });
  }

  return rotationContext;
}

/**
 * Update exercise exposure after workout completion
 *
 * Called when a workout is marked COMPLETED. Updates usage counts
 * and recalculates rolling windows.
 *
 * @param userId - User ID
 * @param workoutId - Completed workout ID
 */
export async function updateExerciseExposure(
  userId: string,
  workoutId: string
): Promise<void> {
  // Load completed workout with exercises
  const workout = await prisma.workout.findUnique({
    where: { id: workoutId },
    include: {
      exercises: {
        include: {
          exercise: {
            select: {
              name: true,
            },
          },
          sets: {
            select: {
              id: true,
            },
          },
        },
      },
    },
  });

  if (!workout || workout.status !== "COMPLETED") {
    throw new Error(`Workout ${workoutId} not found or not completed`);
  }

  const now = new Date();

  // Update exposure for each exercise in the workout
  for (const workoutExercise of workout.exercises) {
    const setsCompleted = workoutExercise.sets.length;
    await prisma.exerciseExposure.upsert({
      where: {
        userId_exerciseName: {
          userId,
          exerciseName: workoutExercise.exercise.name,
        },
      },
      create: {
        userId,
        exerciseName: workoutExercise.exercise.name,
        lastUsedAt: now,
        timesUsedL4W: 1,
        timesUsedL8W: 1,
        timesUsedL12W: 1,
        avgSetsPerWeek: setsCompleted,
        avgVolumePerWeek: 0, // Will be calculated with actual load data
      },
      update: {
        lastUsedAt: now,
        // Increment rolling window counters
        // (Exact logic will be refined with time-window queries)
        timesUsedL4W: { increment: 1 },
        timesUsedL8W: { increment: 1 },
        timesUsedL12W: { increment: 1 },
      },
    });
  }

  // TODO: Recalculate rolling windows (prune counts older than 4/8/12 weeks)
  // This requires querying workout history and counting exercises per window.
  // For now, simple increment works (will be refined in Week 3).
}

/**
 * Assess performance trend for an exercise
 *
 * Uses linear regression on estimated 1RM over last 6 sessions.
 * - Improving: positive slope (≥ 2.5% gain per session)
 * - Stalled: flat slope (-2.5% to +2.5%)
 * - Declining: negative slope (≤ -2.5%)
 *
 * @param exerciseName - Exercise to analyze
 * @param userId - User ID
 * @returns Performance trend classification
 */
export async function assessPerformanceTrend(
  exerciseName: string,
  userId: string
): Promise<PerformanceTrend> {
  // Query last 6 completed workouts with this exercise
  const recentSessions = await prisma.workoutExercise.findMany({
    where: {
      exercise: {
        name: exerciseName,
      },
      workout: {
        userId,
        status: "COMPLETED",
      },
    },
    include: {
      workout: {
        select: {
          completedAt: true,
        },
      },
      sets: {
        include: {
          logs: {
            select: {
              actualLoad: true,
              actualReps: true,
            },
            take: 1,
          },
        },
        orderBy: {
          setIndex: "asc",
        },
      },
    },
    orderBy: {
      workout: {
        completedAt: "desc",
      },
    },
    take: 6,
  });

  if (recentSessions.length < 3) {
    return "improving"; // Insufficient data, default to improving
  }

  // Estimate 1RM for each session (best set)
  const estimated1RMs: number[] = [];
  for (const session of recentSessions.reverse()) {
    // reverse to get chronological order
    const bestSet = session.sets.reduce(
      (best: number, set: { logs: { actualLoad: number | null; actualReps: number | null }[] }) => {
        const log = set.logs[0];
        if (!log) return best;
        const estimated1RM = estimate1RM(log.actualLoad ?? 0, log.actualReps ?? 0);
        return estimated1RM > best ? estimated1RM : best;
      },
      0
    );
    estimated1RMs.push(bestSet);
  }

  // Perform linear regression: y = mx + b
  const { slope } = linearRegression(estimated1RMs);

  // Compute percent change per session
  const baseline = estimated1RMs[0] ?? 1; // Avoid division by zero
  const percentChangePerSession = (slope / baseline) * 100;

  // Classify trend
  if (percentChangePerSession >= 2.5) return "improving";
  if (percentChangePerSession <= -2.5) return "declining";
  return "stalled";
}

/**
 * Estimate 1RM using Brzycki formula
 *
 * 1RM = weight / (1.0278 - 0.0278 × reps)
 *
 * @param load - Weight used
 * @param reps - Reps performed
 * @returns Estimated 1RM
 */
function estimate1RM(load: number, reps: number): number {
  if (reps === 0) return 0;
  if (reps === 1) return load;
  return load / (1.0278 - 0.0278 * reps);
}

/**
 * Simple linear regression
 *
 * Fits y = mx + b to data points [0, y[0]], [1, y[1]], ...
 *
 * @param yValues - Y values (x values are implicit: 0, 1, 2, ...)
 * @returns Slope and intercept
 */
function linearRegression(yValues: number[]): { slope: number; intercept: number } {
  const n = yValues.length;
  if (n === 0) return { slope: 0, intercept: 0 };

  // x values: 0, 1, 2, ..., n-1
  const xValues = Array.from({ length: n }, (_, i) => i);

  // Means
  const xMean = xValues.reduce((sum, x) => sum + x, 0) / n;
  const yMean = yValues.reduce((sum, y) => sum + y, 0) / n;

  // Slope: m = Σ((x - x̄)(y - ȳ)) / Σ((x - x̄)²)
  let numerator = 0;
  let denominator = 0;

  for (let i = 0; i < n; i++) {
    const xDiff = xValues[i] - xMean;
    const yDiff = yValues[i] - yMean;
    numerator += xDiff * yDiff;
    denominator += xDiff * xDiff;
  }

  const slope = denominator === 0 ? 0 : numerator / denominator;

  // Intercept: b = ȳ - m * x̄
  const intercept = yMean - slope * xMean;

  return { slope, intercept };
}
