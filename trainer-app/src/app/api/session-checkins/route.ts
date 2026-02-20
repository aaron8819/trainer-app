import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { resolveOwner } from "@/lib/api/workout-context";
import { computeFatigueScore } from "@/lib/engine";
import { computePerformanceSignals } from "@/lib/api/readiness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const readiness = Number(body.readiness);

    if (!Number.isFinite(readiness) || readiness < 1 || readiness > 5) {
      return NextResponse.json({ error: "Invalid readiness" }, { status: 400 });
    }

    const user = await resolveOwner();
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const painFlags =
      body.painFlags && typeof body.painFlags === "object"
        ? (body.painFlags as Record<string, number>)
        : undefined;
    const notes = typeof body.notes === "string" ? body.notes.trim() : undefined;

    const timestamp = new Date();
    const performance = await computePerformanceSignals(user.id, 3);
    const signal = {
      timestamp,
      userId: user.id,
      whoop: undefined,
      subjective: {
        readiness: readiness as 1 | 2 | 3 | 4 | 5,
        motivation: readiness as 1 | 2 | 3 | 4 | 5,
        soreness: (painFlags ?? {}) as Record<string, 1 | 2 | 3>,
      },
      performance,
    };
    const fatigue = computeFatigueScore(signal);

    const [checkIn] = await prisma.$transaction([
      prisma.sessionCheckIn.create({
        data: {
          userId: user.id,
          date: timestamp,
          readiness,
          painFlags,
          notes: notes && notes.length > 0 ? notes : undefined,
        },
      }),
      prisma.readinessSignal.create({
        data: {
          userId: user.id,
          timestamp,
          whoopRecovery: null,
          whoopStrain: null,
          whoopHrv: null,
          whoopSleepQuality: null,
          whoopSleepHours: null,
          subjectiveReadiness: readiness,
          subjectiveMotivation: readiness,
          subjectiveSoreness: (painFlags ?? {}) as Record<string, number>,
          subjectiveStress: null,
          performanceRpeDeviation: performance.rpeDeviation,
          performanceStalls: performance.stallCount,
          performanceCompliance: performance.volumeComplianceRate,
          fatigueScoreOverall: fatigue.overall,
          fatigueScoreBreakdown: fatigue.components,
        },
      }),
    ]);

    return NextResponse.json({
      id: checkIn.id,
      readiness: checkIn.readiness,
      painFlags: checkIn.painFlags ?? undefined,
      date: checkIn.date,
      deprecated: true,
      canonicalRoute: "/api/readiness/submit",
      message: "session-checkins is deprecated; readiness data is mirrored to ReadinessSignal.",
    });
  } catch (error) {
    console.error("Failed to create session check-in", error);
    const message =
      process.env.NODE_ENV === "production"
        ? "Failed to create session check-in"
        : error instanceof Error
        ? error.message
        : "Failed to create session check-in";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
