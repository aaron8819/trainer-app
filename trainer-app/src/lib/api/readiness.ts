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
  const rpeDeviations: number[] = [];
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
  // Note: Detailed stall detection is handled separately via /api/stalls route
  // using stall-intervention.ts. Stubbed here as it's not used in fatigue scoring.
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
 * Phase 3.5: Added staleness check (48-hour expiry)
 * @param userId - User ID
 * @returns Most recent ReadinessSignal or null if none exists or expired
 */
export async function getLatestReadinessSignal(
  userId: string
): Promise<ReadinessSignal | null> {
  const signal = await prisma.readinessSignal.findFirst({
    where: { userId },
    orderBy: { timestamp: "desc" },
  });

  if (!signal) return null;

  // Check staleness (Phase 3.5): signals > 48 hours old are expired
  const ageMs = new Date().getTime() - signal.timestamp.getTime();
  if (ageMs > SIGNAL_STALENESS_THRESHOLD_MS) {
    return null; // Expired - caller will fall back to default fatigue score
  }

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

/**
 * Signal staleness threshold (Phase 3.5)
 * Signals older than 48 hours are considered expired and not used for autoregulation
 */
export const SIGNAL_STALENESS_THRESHOLD_MS = 48 * 60 * 60 * 1000; // 48 hours

/**
 * Get age of readiness signal in hours
 * @param signal - Readiness signal with timestamp
 * @returns Age in hours (e.g., 2.5 = 2 hours 30 minutes)
 */
export function getSignalAgeHours(signal: { timestamp: Date }): number {
  const now = new Date();
  const ageMs = now.getTime() - signal.timestamp.getTime();
  return ageMs / (1000 * 60 * 60);
}

/**
 * Format signal age for display
 * @param ageHours - Age in hours
 * @returns Human-readable string (e.g., "2 hours ago", "just now", "1 day ago")
 */
export function formatSignalAge(ageHours: number): string {
  if (ageHours < 0.1) return "just now"; // < 6 minutes
  if (ageHours < 1) return "less than 1 hour ago";
  if (ageHours < 2) return "1 hour ago";
  if (ageHours < 24) return `${Math.floor(ageHours)} hours ago`;
  const days = Math.floor(ageHours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}
