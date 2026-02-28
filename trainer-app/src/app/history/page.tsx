import { prisma } from "@/lib/db/prisma";
import { resolveOwner } from "@/lib/api/workout-context";
import HistoryClient, { type HistoryWorkoutItem, type MesocycleOption } from "@/components/HistoryClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const TAKE = 20;

export default async function HistoryPage() {
  const owner = await resolveOwner();

  const [workoutsRaw, totalCount, mesocyclesRaw] = await Promise.all([
    prisma.workout.findMany({
      where: { userId: owner.id },
      orderBy: { scheduledDate: "desc" },
      take: TAKE + 1,
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
                  select: { logs: { where: { wasSkipped: false } } },
                },
              },
            },
          },
        },
      },
    }),
    prisma.workout.count({ where: { userId: owner.id } }),
    prisma.mesocycle.findMany({
      where: { macroCycle: { userId: owner.id } },
      include: { macroCycle: { select: { startDate: true } } },
      orderBy: [{ isActive: "desc" }, { macroCycle: { startDate: "desc" } }],
    }),
  ]);

  const hasMore = workoutsRaw.length > TAKE;
  const page = hasMore ? workoutsRaw.slice(0, TAKE) : workoutsRaw;

  const initialWorkouts: HistoryWorkoutItem[] = page.map((w) => ({
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

  const nextCursor = hasMore
    ? page[page.length - 1].scheduledDate.toISOString()
    : null;

  const mesocycles: MesocycleOption[] = mesocyclesRaw.map((meso) => {
    const macroStart = meso.macroCycle.startDate.getTime();
    const startDate = new Date(macroStart + meso.startWeek * 7 * 24 * 60 * 60 * 1000);
    return {
      id: meso.id,
      startDate: startDate.toISOString(),
      isActive: meso.isActive,
      mesoNumber: meso.mesoNumber,
    };
  });

  return (
    <main className="min-h-screen bg-white text-slate-900">
      <div className="page-shell max-w-5xl">
        <header className="mb-8 md:mb-10">
          <h1 className="page-title">Workout History</h1>
          <p className="mt-2 text-slate-600">Browse and filter your full training log.</p>
        </header>
        <HistoryClient
          initialWorkouts={initialWorkouts}
          initialNextCursor={nextCursor}
          initialTotalCount={totalCount}
          mesocycles={mesocycles}
        />
      </div>
    </main>
  );
}
