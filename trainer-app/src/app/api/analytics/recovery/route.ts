import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { resolveOwner, mapExercises, mapHistory } from "@/lib/api/workout-context";
import { buildMuscleRecoveryMap } from "@/lib/engine/sra";
import { WorkoutStatus } from "@prisma/client";
import { PERFORMED_WORKOUT_STATUSES } from "@/lib/workout-status";
import { buildRollingDaysAnalyticsWindow } from "@/lib/api/analytics-semantics";
import { buildMuscleStimulusTimeline } from "@/lib/api/muscle-stimulus-timeline";
import { getUiAuditFixtureFromHeaders } from "@/lib/ui-audit-fixtures/server";

export async function GET(request: Request) {
  const fixture = getUiAuditFixtureFromHeaders(request.headers);
  if (fixture?.analytics?.recovery) {
    return NextResponse.json(fixture.analytics.recovery);
  }

  const user = await resolveOwner();
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 14);

  const [workouts, exercises] = await Promise.all([
    prisma.workout.findMany({
      where: {
        userId: user.id,
        status: { in: [...PERFORMED_WORKOUT_STATUSES] as WorkoutStatus[] },
        scheduledDate: { gte: cutoff },
      },
      orderBy: { scheduledDate: "desc" },
      include: {
        exercises: {
          include: {
            exercise: {
              include: {
                aliases: true,
                exerciseMuscles: { include: { muscle: true } },
              },
            },
            sets: { include: { logs: { orderBy: { completedAt: "desc" }, take: 1 } } },
          },
        },
      },
    }),
    prisma.exercise.findMany({
      include: {
        exerciseEquipment: { include: { equipment: true } },
        exerciseMuscles: { include: { muscle: true } },
        aliases: true,
      },
    }),
  ]);

  const engineExercises = mapExercises(exercises);
  const history = mapHistory(workouts);
  const recoveryMap = buildMuscleRecoveryMap(history, engineExercises);
  const timelineByMuscle = buildMuscleStimulusTimeline(workouts, {
    asOf: new Date(),
    windowDays: 7,
    muscles: Array.from(recoveryMap.keys()),
  });

  const muscles = Array.from(recoveryMap.values()).map((state) => ({
    name: state.muscle,
    recoveryPercent: state.recoveryPercent,
    isRecovered: state.isRecovered,
    lastTrainedHoursAgo: state.lastTrainedHoursAgo,
    sraWindowHours: state.sraWindowHours,
    timeline: timelineByMuscle[state.muscle]?.days ?? [],
  }));

  return NextResponse.json({
    muscles,
    semantics: {
      window: buildRollingDaysAnalyticsWindow(
        14,
        "Stimulus recency uses performed workouts from the last 14 days."
      ),
      counts: {
        workouts:
          "Stimulus recency includes performed workouts only (COMPLETED and PARTIAL) within the rolling 14-day window.",
        output:
          "Percentages describe how much of each muscle's SRA window has elapsed since its last meaningful stimulus, not a training prescription or dashboard opportunity.",
      },
    },
  });
}
