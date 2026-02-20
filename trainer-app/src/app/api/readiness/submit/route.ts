// Phase 3: POST /api/readiness/submit
// Submit a readiness signal and compute fatigue score

import { NextResponse } from "next/server";
import { readinessSignalSchema } from "@/lib/validation";
import {
  computePerformanceSignals,
  fetchWhoopRecovery,
} from "@/lib/api/readiness";
import { computeFatigueScore } from "@/lib/engine";
import { prisma } from "@/lib/db/prisma";
import { resolveOwner } from "@/lib/api/workout-context";
import type { ReadinessSignal } from "@/lib/engine/readiness/types";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = readinessSignalSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid readiness data", details: parsed.error },
      { status: 400 }
    );
  }

  const { subjective } = parsed.data;

  // Get user from database (matches existing codebase pattern)
  const user = await resolveOwner();
  const userId = user.id;

  // 1. Fetch Whoop data (stubbed, returns null for Phase 3)
  const whoop = await fetchWhoopRecovery(userId, new Date());

  // 2. Compute performance signals from recent workout history
  const performance = await computePerformanceSignals(userId, 3);

  // 3. Build ReadinessSignal
  const signal: ReadinessSignal = {
    timestamp: new Date(),
    userId,
    whoop: whoop ?? undefined,
    subjective: {
      readiness: subjective.readiness as 1 | 2 | 3 | 4 | 5,
      motivation: subjective.motivation as 1 | 2 | 3 | 4 | 5,
      soreness: subjective.soreness as Record<string, 1 | 2 | 3>,
      stress: subjective.stress as 1 | 2 | 3 | 4 | 5 | undefined,
    },
    performance,
  };

  // 4. Compute fatigue score
  const fatigueScore = computeFatigueScore(signal);

  // 5. Store ReadinessSignal in DB
  await prisma.readinessSignal.create({
    data: {
      userId,
      timestamp: signal.timestamp,
      whoopRecovery: whoop?.recovery ?? null,
      whoopStrain: whoop?.strain ?? null,
      whoopHrv: whoop?.hrv ?? null,
      whoopSleepQuality: whoop?.sleepQuality ?? null,
      whoopSleepHours: whoop?.sleepDuration ?? null,
      subjectiveReadiness: subjective.readiness,
      subjectiveMotivation: subjective.motivation,
      subjectiveSoreness: subjective.soreness as Record<string, number>,
      subjectiveStress: subjective.stress ?? null,
      performanceRpeDeviation: performance.rpeDeviation,
      performanceStalls: performance.stallCount,
      performanceCompliance: performance.volumeComplianceRate,
      fatigueScoreOverall: fatigueScore.overall,
      fatigueScoreBreakdown: fatigueScore.components,
    },
  });

  // 6. Return signal + fatigue score
  const sourceMode = signal.whoop ? "whoop+subjective+performance" : "subjective+performance";
  return NextResponse.json({
    signal: {
      timestamp: signal.timestamp.toISOString(),
      hasWhoop: signal.whoop !== undefined,
      subjective: signal.subjective,
      performance: signal.performance,
    },
    source: {
      whoopAvailable: signal.whoop !== undefined,
      sourceMode,
    },
    fatigueScore: {
      overall: fatigueScore.overall,
      perMuscle: fatigueScore.perMuscle,
      weights: fatigueScore.weights,
      components: fatigueScore.components,
    },
  });
}
