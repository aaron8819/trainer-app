import { prisma } from "@/lib/db/prisma";
import type { HistoryWorkoutItem, MesocycleOption } from "@/components/HistoryClient";
import {
  buildWorkoutListSurfaceSummary,
  workoutListItemSelect,
} from "@/lib/ui/workout-list-items";
import { getUiAuditFixtureForServer } from "@/lib/ui-audit-fixtures/server";

const TAKE = 20;

export type HistoryPageData = {
  initialWorkouts: HistoryWorkoutItem[];
  initialNextCursor: string | null;
  initialTotalCount: number;
  mesocycles: MesocycleOption[];
};

export async function loadHistoryPageData(userId: string): Promise<HistoryPageData> {
  const fixture = await getUiAuditFixtureForServer();
  if (fixture?.history) {
    return fixture.history;
  }

  const [workoutsRaw, totalCount, mesocyclesRaw] = await Promise.all([
    prisma.workout.findMany({
      where: { userId },
      orderBy: { scheduledDate: "desc" },
      take: TAKE + 1,
      select: workoutListItemSelect,
    }),
    prisma.workout.count({ where: { userId } }),
    prisma.mesocycle.findMany({
      where: { macroCycle: { userId } },
      include: { macroCycle: { select: { startDate: true } } },
      orderBy: [{ isActive: "desc" }, { macroCycle: { startDate: "desc" } }],
    }),
  ]);

  const hasMore = workoutsRaw.length > TAKE;
  const page = hasMore ? workoutsRaw.slice(0, TAKE) : workoutsRaw;

  const initialWorkouts = page.map(buildWorkoutListSurfaceSummary);

  const mesocycles = mesocyclesRaw.map((meso) => {
    const macroStart = meso.macroCycle.startDate.getTime();
    const startDate = new Date(macroStart + meso.startWeek * 7 * 24 * 60 * 60 * 1000);
    return {
      id: meso.id,
      startDate: startDate.toISOString(),
      isActive: meso.isActive,
      mesoNumber: meso.mesoNumber,
    };
  });

  return {
    initialWorkouts,
    initialNextCursor: hasMore ? page[page.length - 1].scheduledDate.toISOString() : null,
    initialTotalCount: totalCount,
    mesocycles,
  };
}
