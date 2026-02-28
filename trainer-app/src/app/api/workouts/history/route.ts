import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { resolveOwner } from "@/lib/api/workout-context";
import { workoutHistoryQuerySchema, WORKOUT_STATUS_VALUES } from "@/lib/validation";
import { type WorkoutStatus, type WorkoutSessionIntent, type Prisma } from "@prisma/client";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const rawParams = {
    intent: searchParams.get("intent") ?? undefined,
    status: searchParams.get("status") ?? undefined,
    mesocycleId: searchParams.get("mesocycleId") ?? undefined,
    from: searchParams.get("from") ?? undefined,
    to: searchParams.get("to") ?? undefined,
    cursor: searchParams.get("cursor") ?? undefined,
    take: searchParams.get("take") ?? undefined,
  };

  const parsed = workoutHistoryQuerySchema.safeParse(rawParams);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query parameters" }, { status: 400 });
  }

  const { intent, status: statusParam, mesocycleId, from, to, cursor, take } = parsed.data;

  // Parse comma-separated status values, validate each
  const statusFilter: string[] = [];
  if (statusParam) {
    const parts = statusParam.split(",").map((s) => s.trim());
    for (const part of parts) {
      if (!(WORKOUT_STATUS_VALUES as readonly string[]).includes(part)) {
        return NextResponse.json(
          { error: `Invalid status value: ${part}` },
          { status: 400 }
        );
      }
      statusFilter.push(part);
    }
  }

  const owner = await resolveOwner();

  // Build the scheduledDate filter — shared between pagination and count queries,
  // plus an additional cursor constraint only for the paginated query.
  const scheduledDateBase: Prisma.DateTimeFilter = {};
  if (from) scheduledDateBase.gte = new Date(from);
  if (to) scheduledDateBase.lte = new Date(to);

  const baseWhere: Prisma.WorkoutWhereInput = {
    userId: owner.id,
    ...(intent ? { sessionIntent: intent as WorkoutSessionIntent } : {}),
    ...(statusFilter.length > 0
      ? { status: { in: statusFilter as WorkoutStatus[] } }
      : {}),
    ...(mesocycleId ? { mesocycleId } : {}),
    ...(Object.keys(scheduledDateBase).length > 0 ? { scheduledDate: scheduledDateBase } : {}),
  };

  const paginatedWhere: Prisma.WorkoutWhereInput = {
    ...baseWhere,
    ...(cursor
      ? {
          scheduledDate: {
            ...scheduledDateBase,
            lt: new Date(cursor),
          },
        }
      : {}),
  };

  const [workouts, totalCount] = await Promise.all([
    prisma.workout.findMany({
      where: paginatedWhere,
      orderBy: { scheduledDate: "desc" },
      take: take + 1,
      select: {
        id: true,
        scheduledDate: true,
        completedAt: true,
        status: true,
        selectionMode: true,
        sessionIntent: true,
        mesocycleId: true,
        mesocycleWeekSnapshot: true,
        mesoSessionSnapshot: true,
        mesocyclePhaseSnapshot: true,
        _count: { select: { exercises: true } },
        exercises: {
          select: {
            sets: {
              select: {
                _count: {
                  select: {
                    logs: { where: { wasSkipped: false } },
                  },
                },
              },
            },
          },
        },
      },
    }),
    prisma.workout.count({ where: baseWhere }),
  ]);

  const hasMore = workouts.length > take;
  const page = hasMore ? workouts.slice(0, take) : workouts;

  const items = page.map((w) => ({
    id: w.id,
    scheduledDate: w.scheduledDate.toISOString(),
    completedAt: w.completedAt?.toISOString() ?? null,
    status: w.status,
    selectionMode: w.selectionMode,
    sessionIntent: w.sessionIntent ?? null,
    mesocycleId: w.mesocycleId ?? null,
    mesocycleWeekSnapshot: w.mesocycleWeekSnapshot ?? null,
    mesoSessionSnapshot: w.mesoSessionSnapshot ?? null,
    mesocyclePhaseSnapshot: w.mesocyclePhaseSnapshot ?? null,
    exerciseCount: w._count.exercises,
    totalSetsLogged: w.exercises
      .flatMap((e) => e.sets)
      .reduce((sum, s) => sum + s._count.logs, 0),
  }));

  const nextCursor = hasMore ? page[page.length - 1].scheduledDate.toISOString() : null;

  return NextResponse.json({ workouts: items, nextCursor, totalCount });
}
