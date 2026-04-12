import { NextResponse } from "next/server";
import { analyticsSummarySchema } from "@/lib/validation";
import { prisma } from "@/lib/db/prisma";
import { resolveOwner } from "@/lib/api/workout-context";
import { buildDateRangeAnalyticsWindow } from "@/lib/api/analytics-semantics";
import { PERFORMED_WORKOUT_STATUSES } from "@/lib/workout-status";
import { WORKOUT_SELECTION_MODE_VALUES } from "@/lib/validation";
import { WorkoutStatus } from "@prisma/client";
import { buildAnalyticsSummary } from "@/lib/api/analytics-summary";
import { getUiAuditFixtureFromHeaders } from "@/lib/ui-audit-fixtures/server";
const TRACKED_SELECTION_MODES = WORKOUT_SELECTION_MODE_VALUES;

export async function GET(request: Request) {
  const fixture = getUiAuditFixtureFromHeaders(request.headers);
  if (fixture?.analytics?.summary) {
    return NextResponse.json(fixture.analytics.summary);
  }

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
  if (!owner) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

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

  const [activeMesocycle, constraints, workouts, setLogs] = await Promise.all([
    prisma.mesocycle.findFirst({
      where: { macroCycle: { userId: owner.id }, isActive: true },
      select: { sessionsPerWeek: true },
    }),
    prisma.constraints.findUnique({
      where: { userId: owner.id },
      select: { daysPerWeek: true },
    }),
    prisma.workout.findMany({
      where: {
        userId: owner.id,
        ...workoutDateFilter,
      },
      select: {
        status: true,
        selectionMode: true,
        sessionIntent: true,
        scheduledDate: true,
      },
    }),
    prisma.setLog.findMany({
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
      select: { id: true },
    }),
  ]);

  const targetSessionsPerWeek = Math.max(
    1,
    activeMesocycle?.sessionsPerWeek ?? constraints?.daysPerWeek ?? 3
  );
  const summary = buildAnalyticsSummary({
    workouts,
    trackedSelectionModes: TRACKED_SELECTION_MODES,
    targetSessionsPerWeek,
    totalSets: setLogs.length,
    now: new Date(),
    dateFrom,
    dateTo,
  });

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
        consistency:
          "Consistency groups performed workouts into ISO weeks by scheduledDate and compares them against the active sessions-per-week target.",
      },
    },
    totals: summary.totals,
    consistency: summary.consistency,
    kpis: summary.kpis,
  });
}
