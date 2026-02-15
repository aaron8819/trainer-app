// Phase 3: Readiness Signal Data Integration

import { prisma } from "@/lib/db/prisma";
import { WorkoutStatus } from "@prisma/client";
import type {
  ReadinessSignal,
  PerformanceSignals,
  WhoopData,
} from "@/lib/engine/readiness/types";

/**
 * Compute performance signals from recent workout history
 * Analyzes last N sessions to derive:
 * - RPE deviation (actual vs expected)
 * - Stall count (exercises without progress)
 * - Volume compliance rate (% of prescribed sets completed)
 *
 * @param userId - User ID
 * @param sessionCount - Number of recent sessions to analyze (default 3)
 * @returns Performance signals object
 */
export async function computePerformanceSignals(
  userId: string,
  sessionCount: number = 3
): Promise<PerformanceSignals> {
  // Fetch recent completed workouts
  const recentWorkouts = await prisma.workout.findMany({
    where: {
      userId,
      status: WorkoutStatus.COMPLETED,
    },
    orderBy: { scheduledDate: "desc" },
    take: sessionCount,
    include: {
      exercises: {
        include: {
          exercise: true,
          sets: {
            include: {
              logs: { orderBy: { completedAt: "desc" }, take: 1 },
            },
          },
        },
      },
    },
  });

  // Compute RPE deviation
  let rpeDeviations: number[] = [];
  for (const workout of recentWorkouts) {
    for (const exercise of workout.exercises) {
      for (const set of exercise.sets) {
        const log = set.logs[0];
        if (log?.actualRpe && set.targetRpe) {
          const deviation = log.actualRpe - set.targetRpe;
          rpeDeviations.push(deviation);
        }
      }
    }
  }

  const rpeDeviation =
    rpeDeviations.length > 0
      ? rpeDeviations.reduce((sum, val) => sum + val, 0) / rpeDeviations.length
      : 0;

  // Compute stall count
  // For now, stub with 0 (detailed stall detection done in stall-intervention.ts)
  // TODO: Integrate detectStalls() here if needed per-session
  const stallCount = 0;

  // Compute volume compliance rate
  let totalPrescribedSets = 0;
  let totalCompletedSets = 0;

  for (const workout of recentWorkouts) {
    for (const exercise of workout.exercises) {
      totalPrescribedSets += exercise.sets.length;
      totalCompletedSets += exercise.sets.filter((set) => set.logs.length > 0).length;
    }
  }

  const volumeComplianceRate =
    totalPrescribedSets > 0 ? totalCompletedSets / totalPrescribedSets : 1.0;

  return {
    rpeDeviation,
    stallCount,
    volumeComplianceRate,
  };
}

/**
 * Get latest readiness signal for user
 * @param userId - User ID
 * @returns Most recent ReadinessSignal or null if none exists
 */
export async function getLatestReadinessSignal(
  userId: string
): Promise<ReadinessSignal | null> {
  const signal = await prisma.readinessSignal.findFirst({
    where: { userId },
    orderBy: { timestamp: "desc" },
  });

  if (!signal) return null;

  // Map DB model to engine type
  return {
    timestamp: signal.timestamp,
    userId: signal.userId,
    whoop:
      signal.whoopRecovery !== null
        ? {
            recovery: signal.whoopRecovery,
            strain: signal.whoopStrain ?? 0,
            hrv: signal.whoopHrv ?? 0,
            sleepQuality: signal.whoopSleepQuality ?? 0,
            sleepDuration: signal.whoopSleepHours ?? 0,
          }
        : undefined,
    subjective: {
      readiness: signal.subjectiveReadiness as 1 | 2 | 3 | 4 | 5,
      motivation: signal.subjectiveMotivation as 1 | 2 | 3 | 4 | 5,
      soreness: signal.subjectiveSoreness as Record<string, 1 | 2 | 3>,
      stress: signal.subjectiveStress
        ? (signal.subjectiveStress as 1 | 2 | 3 | 4 | 5)
        : undefined,
    },
    performance: {
      rpeDeviation: signal.performanceRpeDeviation,
      stallCount: signal.performanceStalls,
      volumeComplianceRate: signal.performanceCompliance,
    },
  };
}

/**
 * Fetch Whoop recovery data for a given user and date
 * Phase 3: Stubbed - always returns null
 * Phase 3.5: Will implement Whoop OAuth + API integration
 *
 * @param userId - User ID
 * @param date - Date to fetch recovery data for
 * @returns WhoopData or null if not available
 */
export async function fetchWhoopRecovery(
  userId: string,
  date: Date
): Promise<WhoopData | null> {
  // Phase 3: Whoop integration not yet implemented
  // Return null to fall back to subjective + performance signals
  return null;

  // Phase 3.5 implementation:
  // 1. Fetch UserIntegration record for provider="whoop"
  // 2. Check if accessToken is valid (not expired)
  // 3. If expired, call refreshWhoopToken()
  // 4. Make API call to Whoop recovery endpoint
  // 5. Parse response and return WhoopData
}

/**
 * Refresh Whoop OAuth token for a user
 * Phase 3: Stubbed - throws error
 * Phase 3.5: Will implement OAuth refresh flow
 *
 * @param userId - User ID
 * @throws Error always (not yet implemented)
 */
export async function refreshWhoopToken(userId: string): Promise<void> {
  throw new Error(
    "Whoop integration not yet implemented. Phase 3.5 will add OAuth support."
  );

  // Phase 3.5 implementation:
  // 1. Fetch UserIntegration record for provider="whoop"
  // 2. Use refreshToken to get new accessToken from Whoop OAuth
  // 3. Update UserIntegration record with new tokens + expiration
}
