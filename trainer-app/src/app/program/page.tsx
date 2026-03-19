import Link from "next/link";
import { resolveOwner } from "@/lib/api/workout-context";
import { prisma } from "@/lib/db/prisma";
import { loadProgramDashboardData } from "@/lib/api/program";
import { loadPendingMesocycleHandoff } from "@/lib/api/mesocycle-handoff";
import { CycleAnchorControls } from "@/components/CycleAnchorControls";
import { ProgramStatusCard } from "@/components/ProgramStatusCard";
import { SurfaceGuideCard } from "@/components/SurfaceGuideCard";
import {
  buildWorkoutListSurfaceSummary,
  getWorkoutListPrimaryLabel,
  workoutListItemSelect,
} from "@/lib/ui/workout-list-items";
import { formatWorkoutSessionSnapshotLabel } from "@/lib/ui/workout-session-snapshot";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

function formatSessionDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function splitBadge(intent: string | null, label?: string | null) {
  const map: Record<string, string> = {
    push: "bg-blue-50 text-blue-700",
    pull: "bg-indigo-50 text-indigo-700",
    legs: "bg-green-50 text-green-700",
    upper: "bg-purple-50 text-purple-700",
    lower: "bg-teal-50 text-teal-700",
    full_body: "bg-amber-50 text-amber-700",
    body_part: "bg-slate-50 text-slate-700",
  };
  const displayLabel = label ?? intent?.replace("_", " ") ?? "-";
  const cls = (intent ? map[intent] : null) ?? "bg-slate-50 text-slate-600";
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium capitalize ${cls}`}>{displayLabel}</span>
  );
}

function workoutStatusDot(status: string) {
  const map: Record<string, string> = {
    completed: "bg-green-500",
    skipped: "bg-red-400",
    planned: "bg-slate-300",
    in_progress: "bg-yellow-400",
    partial: "bg-orange-400",
  };
  return <span className={`inline-block size-2 rounded-full ${map[status] ?? "bg-slate-300"}`} />;
}

export default async function ProgramPage() {
  const user = await resolveOwner();
  const [pendingHandoff, recentWorkouts] = await Promise.all([
    loadPendingMesocycleHandoff(user.id),
    prisma.workout.findMany({
      where: { userId: user.id },
      orderBy: { scheduledDate: "desc" },
      take: 10,
      select: workoutListItemSelect,
    }),
  ]);

  const sessionHistory = recentWorkouts.map(buildWorkoutListSurfaceSummary);

  if (pendingHandoff) {
    return (
      <main className="min-h-screen bg-white text-slate-900">
        <div className="page-shell max-w-5xl">
          <h1 className="page-title">My Program</h1>
          <p className="mt-1.5 text-sm text-slate-600">
            Training is paused while the handoff is pending.
          </p>

          <section className="mt-5">
            <SurfaceGuideCard current="program" />
          </section>

          <section className="mt-6 rounded-2xl border border-amber-300 bg-amber-50 p-6">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">
              Handoff Pending
            </p>
            <h2 className="mt-2 text-2xl font-semibold">
              Meso {pendingHandoff.mesoNumber}: {pendingHandoff.focus}
            </h2>
            <p className="mt-2 text-sm text-slate-700">
              Review the frozen handoff, make any setup edits you want, then accept the next cycle
              to resume generation and program controls.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link
                href={`/mesocycles/${pendingHandoff.mesocycleId}/review`}
                className="inline-flex min-h-11 items-center justify-center rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white"
              >
                Review handoff
              </Link>
              <Link
                href="/"
                className="inline-flex min-h-11 items-center justify-center rounded-full border border-slate-300 px-5 py-2 text-sm font-semibold text-slate-900"
              >
                Home
              </Link>
            </div>
          </section>

          <section className="mt-6 pb-8">
            <h2 className="text-base font-semibold sm:text-lg">Session History</h2>
            <p className="mt-1 text-sm text-slate-500">Last 10 sessions.</p>

            {sessionHistory.length > 0 ? (
              <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      <th className="px-4 py-2.5">Date</th>
                      <th className="px-4 py-2.5">Split</th>
                      <th className="px-4 py-2.5">Status</th>
                      <th className="px-4 py-2.5 text-right">Summary</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessionHistory.map((workout, idx) => {
                      const status = workout.status.toLowerCase();
                      const snapshotLabel = formatWorkoutSessionSnapshotLabel(workout.sessionSnapshot);

                      return (
                        <tr
                          key={workout.id}
                          className={`border-b border-slate-100 last:border-0 ${idx % 2 === 0 ? "" : "bg-slate-50/50"}`}
                        >
                          <td className="px-4 py-2.5">
                            <Link
                              href={`/workout/${workout.id}`}
                              className="font-medium text-slate-900 hover:text-blue-600"
                            >
                              {formatSessionDate(workout.scheduledDate)}
                            </Link>
                            {snapshotLabel ? (
                              <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">
                                {snapshotLabel}
                              </span>
                            ) : null}
                            {workout.isDeload ? (
                              <span className="ml-2 rounded bg-sky-100 px-1.5 py-0.5 text-xs font-medium text-sky-800">
                                Deload
                              </span>
                            ) : null}
                          </td>
                          <td className="px-4 py-2.5">
                            {splitBadge(workout.sessionIntent, getWorkoutListPrimaryLabel(workout))}
                          </td>
                          <td className="px-4 py-2.5">
                            <span className="flex items-center gap-1.5">
                              {workoutStatusDot(status)}
                              <span className="capitalize text-slate-700">
                                {status.replace("_", " ")}
                              </span>
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-right text-slate-600">
                            {workout.exerciseCount} ex / {workout.totalSetsLogged} sets
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-3 text-sm text-slate-500">No sessions logged yet.</p>
            )}
          </section>
        </div>
      </main>
    );
  }

  const data = await loadProgramDashboardData(user.id);

  return (
    <main className="min-h-screen bg-white text-slate-900">
      <div className="page-shell max-w-5xl">
        <h1 className="page-title">My Program</h1>
        <p className="mt-1.5 text-sm text-slate-600">
          Live mesocycle state and current-week decision support. Use History for past sessions and Analytics for longer-term trends.
        </p>

        <section className="mt-5">
          <SurfaceGuideCard current="program" />
        </section>

        <section className="mt-6">
          <ProgramStatusCard initialData={data} />
        </section>

        <section className="mt-4">
          <CycleAnchorControls />
        </section>

        <section className="mt-6 pb-8">
          <h2 className="text-base font-semibold sm:text-lg">Session History</h2>
          <p className="mt-1 text-sm text-slate-500">Last 10 sessions.</p>

          {sessionHistory.length > 0 ? (
            <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-2.5">Date</th>
                    <th className="px-4 py-2.5">Split</th>
                    <th className="px-4 py-2.5">Status</th>
                    <th className="px-4 py-2.5 text-right">Summary</th>
                  </tr>
                </thead>
                <tbody>
                  {sessionHistory.map((workout, idx) => {
                    const status = workout.status.toLowerCase();
                    const snapshotLabel = formatWorkoutSessionSnapshotLabel(workout.sessionSnapshot);

                    return (
                      <tr
                        key={workout.id}
                        className={`border-b border-slate-100 last:border-0 ${idx % 2 === 0 ? "" : "bg-slate-50/50"}`}
                      >
                        <td className="px-4 py-2.5">
                          <Link
                            href={`/workout/${workout.id}`}
                            className="font-medium text-slate-900 hover:text-blue-600"
                          >
                            {formatSessionDate(workout.scheduledDate)}
                          </Link>
                          {snapshotLabel ? (
                            <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">
                              {snapshotLabel}
                            </span>
                          ) : null}
                          {workout.isDeload ? (
                            <span className="ml-2 rounded bg-sky-100 px-1.5 py-0.5 text-xs font-medium text-sky-800">
                              Deload
                            </span>
                          ) : null}
                        </td>
                        <td className="px-4 py-2.5">
                          {splitBadge(workout.sessionIntent, getWorkoutListPrimaryLabel(workout))}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="flex items-center gap-1.5">
                            {workoutStatusDot(status)}
                            <span className="capitalize text-slate-700">
                              {status.replace("_", " ")}
                            </span>
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right text-slate-600">
                          {workout.exerciseCount} ex / {workout.totalSetsLogged} sets
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-500">No sessions logged yet.</p>
          )}
        </section>
      </div>
    </main>
  );
}
