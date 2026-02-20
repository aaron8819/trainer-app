import Link from "next/link";
import { resolveOwner } from "@/lib/api/workout-context";
import { loadProgramDashboardData } from "@/lib/api/program";
import type { ProgramVolumeRow, DeloadReadiness, ProgramMesoBlock } from "@/lib/api/program";
import { CycleAnchorControls } from "@/components/CycleAnchorControls";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

// ── helpers ──────────────────────────────────────────────────────────────────

function blockTypeBadge(blockType: string | null) {
  const map: Record<string, string> = {
    accumulation: "bg-blue-100 text-blue-700",
    intensification: "bg-purple-100 text-purple-700",
    realization: "bg-orange-100 text-orange-700",
    deload: "bg-slate-100 text-slate-600",
  };
  const cls = (blockType ? map[blockType] : null) ?? "bg-slate-100 text-slate-600";
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${cls}`}>
      {blockType ?? "—"}
    </span>
  );
}

function volumeStatus(row: ProgramVolumeRow): "below_mev" | "at_mev" | "optimal" | "approaching_mrv" | "at_mrv" {
  const sets = row.directSets;
  if (sets >= row.mrv) return "at_mrv";
  if (sets >= row.mrv * 0.85) return "approaching_mrv";
  if (sets >= row.target) return "optimal";
  if (sets >= row.mev) return "at_mev";
  return "below_mev";
}

const STATUS_STYLE: Record<string, string> = {
  below_mev: "bg-red-50 text-red-700 border-red-200",
  at_mev: "bg-yellow-50 text-yellow-700 border-yellow-200",
  optimal: "bg-green-50 text-green-700 border-green-200",
  approaching_mrv: "bg-orange-50 text-orange-700 border-orange-200",
  at_mrv: "bg-red-50 text-red-700 border-red-200",
};

function formatSessionDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function splitBadge(intent: string | null) {
  const map: Record<string, string> = {
    push: "bg-blue-50 text-blue-700",
    pull: "bg-indigo-50 text-indigo-700",
    legs: "bg-green-50 text-green-700",
    upper: "bg-purple-50 text-purple-700",
    lower: "bg-teal-50 text-teal-700",
    full_body: "bg-amber-50 text-amber-700",
    body_part: "bg-slate-50 text-slate-700",
  };
  const label = intent?.replace("_", " ") ?? "—";
  const cls = (intent ? map[intent] : null) ?? "bg-slate-50 text-slate-600";
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium capitalize ${cls}`}>{label}</span>
  );
}

const BLOCK_PILL_STYLE: Record<string, { pill: string; label: string; desc: string }> = {
  accumulation: {
    pill: "bg-blue-500 text-white",
    label: "Acc",
    desc: "High volume, moderate intensity. Work within 2–3 RIR.",
  },
  intensification: {
    pill: "bg-purple-500 text-white",
    label: "Int",
    desc: "Moderate volume, high intensity. Push to 0–1 RIR.",
  },
  realization: {
    pill: "bg-orange-500 text-white",
    label: "Peak",
    desc: "Low volume, maximal intensity. Test your strength.",
  },
  deload: {
    pill: "bg-slate-400 text-white",
    label: "Deload",
    desc: "40–60% reduced volume. Focus on recovery.",
  },
};

function MesocycleTimeline({
  blocks,
  currentWeek,
  durationWeeks,
}: {
  blocks: ProgramMesoBlock[];
  currentWeek: number;
  durationWeeks: number;
}) {
  if (blocks.length === 0) return null;

  // Build one pill per week
  const weeks: { week: number; blockType: string; desc: string }[] = [];
  for (let w = 1; w <= durationWeeks; w++) {
    const block = blocks.find(
      (b) => w >= b.startWeek && w < b.startWeek + b.durationWeeks
    );
    const blockType = block?.blockType ?? "accumulation";
    weeks.push({ week: w, blockType, desc: BLOCK_PILL_STYLE[blockType]?.desc ?? "" });
  }

  return (
    <div className="mt-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Mesocycle Timeline
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {weeks.map(({ week, blockType, desc }) => {
          const isCurrent = week === currentWeek;
          const style = BLOCK_PILL_STYLE[blockType] ?? BLOCK_PILL_STYLE.accumulation;
          const shortLabel = style.label;
          return (
            <div key={week} className="group relative" title={`Week ${week}: ${desc}`}>
              <div
                className={`flex h-8 min-w-[2.25rem] items-center justify-center rounded-full px-2 text-xs font-semibold transition-all ${style.pill} ${
                  isCurrent ? "ring-2 ring-offset-1 ring-slate-900" : "opacity-80"
                }`}
              >
                W{week}
                <span className="ml-1 hidden sm:inline opacity-75">{shortLabel}</span>
              </div>
              {isCurrent && (
                <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 text-[8px] font-bold text-slate-900 leading-none">
                  ▲
                </span>
              )}
            </div>
          );
        })}
      </div>
      {/* Legend */}
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
        {Object.entries(BLOCK_PILL_STYLE).map(([key, val]) => (
          <span key={key} className="flex items-center gap-1">
            <span className={`inline-block size-2 rounded-full ${val.pill.split(" ")[0]}`} />
            {val.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function DeloadBanner({ readiness }: { readiness: DeloadReadiness }) {
  if (!readiness.shouldDeload) return null;
  const styles: Record<DeloadReadiness["urgency"], string> = {
    scheduled: "border-blue-200 bg-blue-50 text-blue-800",
    recommended: "border-amber-200 bg-amber-50 text-amber-800",
    urgent: "border-red-200 bg-red-50 text-red-800",
  };
  const icons: Record<DeloadReadiness["urgency"], string> = {
    scheduled: "🔵",
    recommended: "🟡",
    urgent: "🔴",
  };
  return (
    <div className={`rounded-xl border px-4 py-3 text-sm font-medium ${styles[readiness.urgency]}`}>
      {icons[readiness.urgency]} {readiness.reason}
    </div>
  );
}

function workoutStatusDot(status: string) {
  const map: Record<string, string> = {
    completed: "bg-green-500",
    skipped: "bg-red-400",
    planned: "bg-slate-300",
    in_progress: "bg-yellow-400",
  };
  return <span className={`inline-block size-2 rounded-full ${map[status] ?? "bg-slate-300"}`} />;
}

// ── page ─────────────────────────────────────────────────────────────────────

export default async function ProgramPage() {
  const user = await resolveOwner();
  const data = await loadProgramDashboardData(user.id);

  const { activeMeso, currentWeek, sessionsUntilDeload, volumeThisWeek, recentWorkouts, deloadReadiness } = data;

  const weekProgress = activeMeso
    ? Math.round((currentWeek / activeMeso.durationWeeks) * 100)
    : 0;

  const blockBarColor: Record<string, string> = {
    accumulation: "bg-blue-500",
    intensification: "bg-purple-500",
    realization: "bg-orange-500",
    deload: "bg-slate-400",
  };
  const barColor = (activeMeso?.currentBlockType ? blockBarColor[activeMeso.currentBlockType] : null) ?? "bg-slate-400";

  // Filter out muscles with nothing to show (mev=0 and no data)
  const relevantVolume = volumeThisWeek.filter((v) => v.mev > 0 || v.directSets > 0);

  return (
    <main className="min-h-screen bg-white text-slate-900">
      <div className="page-shell max-w-5xl">
        <h1 className="page-title">My Program</h1>
        <p className="mt-1.5 text-sm text-slate-600">
          Training cycle progress and weekly volume.
        </p>

        {/* ── Deload Banner ──────────────────────────────────────────── */}
        {deloadReadiness?.shouldDeload && (
          <div className="mt-4">
            <DeloadBanner readiness={deloadReadiness} />
          </div>
        )}

        {/* ── Current Cycle ──────────────────────────────────────────── */}
        <section className="mt-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
            {activeMeso ? (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Mesocycle {activeMeso.mesoNumber}
                    </p>
                    <p className="mt-0.5 text-base font-semibold text-slate-900">{activeMeso.focus}</p>
                  </div>
                  {blockTypeBadge(activeMeso.currentBlockType)}
                </div>

                <div className="mt-4">
                  <div className="flex items-center justify-between text-xs text-slate-600">
                    <span>Week {currentWeek} of {activeMeso.durationWeeks}</span>
                    <span>{Math.round(weekProgress)}%</span>
                  </div>
                  <div className="mt-1.5 h-2 w-full rounded-full bg-slate-200">
                    <div
                      className={`h-2 rounded-full transition-all ${barColor}`}
                      style={{ width: `${weekProgress}%` }}
                    />
                  </div>
                </div>

                <MesocycleTimeline
                  blocks={activeMeso.blocks}
                  currentWeek={currentWeek}
                  durationWeeks={activeMeso.durationWeeks}
                />

                <div className="mt-3 flex flex-wrap gap-3 text-sm text-slate-600">
                  <span>
                    <span className="font-medium text-slate-900">{activeMeso.completedSessions}</span>
                    {" "}sessions completed
                  </span>
                  {sessionsUntilDeload > 0 ? (
                    <span>
                      <span className="font-medium text-slate-900">{sessionsUntilDeload}</span>
                      {" "}sessions until deload
                    </span>
                  ) : (
                    <span className="font-medium text-blue-700">Deload week</span>
                  )}
                </div>
                <CycleAnchorControls />
              </>
            ) : (
              <div className="py-4 text-center text-sm text-slate-500">
                No active mesocycle.{" "}
                <Link href="/settings" className="font-medium text-blue-600 underline-offset-2 hover:underline">
                  Set up your profile
                </Link>{" "}
                to start tracking your cycle.
              </div>
            )}
          </div>
        </section>

        {/* ── Volume This Week ───────────────────────────────────────── */}
        <section className="mt-6">
          <h2 className="text-base font-semibold sm:text-lg">Volume This Week</h2>
          <p className="mt-1 text-sm text-slate-500">Direct sets vs weekly target (MEV → MAV).</p>

          {relevantVolume.length > 0 ? (
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {relevantVolume.map((row) => {
                const status = volumeStatus(row);
                const cls = STATUS_STYLE[status];
                const barWidth = row.mrv > 0 ? Math.min(100, Math.round((row.directSets / row.mrv) * 100)) : 0;

                return (
                  <div key={row.muscle} className={`rounded-xl border p-3 ${cls}`}>
                    <p className="text-xs font-semibold">{row.muscle}</p>
                    <p className="mt-0.5 text-lg font-bold leading-none">{row.directSets}</p>
                    <p className="text-xs opacity-75">target {row.target} sets</p>
                    <div className="mt-2 h-1 w-full rounded-full bg-current opacity-20">
                      <div
                        className="h-1 rounded-full bg-current opacity-80 transition-all"
                        style={{ width: `${barWidth}%` }}
                      />
                    </div>
                    <p className="mt-1 text-xs opacity-60">
                      MEV {row.mev} · MAV {row.mav} · MRV {row.mrv}
                    </p>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-500">No completed workouts this week.</p>
          )}
        </section>

        {/* ── Session History ────────────────────────────────────────── */}
        <section className="mt-6 pb-8">
          <h2 className="text-base font-semibold sm:text-lg">Session History</h2>
          <p className="mt-1 text-sm text-slate-500">Last 10 sessions.</p>

          {recentWorkouts.length > 0 ? (
            <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-2.5">Date</th>
                    <th className="px-4 py-2.5">Split</th>
                    <th className="px-4 py-2.5">Status</th>
                    <th className="px-4 py-2.5 text-right">Counted</th>
                  </tr>
                </thead>
                <tbody>
                  {recentWorkouts.map((w, idx) => (
                    <tr
                      key={w.id}
                      className={`border-b border-slate-100 last:border-0 ${idx % 2 === 0 ? "" : "bg-slate-50/50"}`}
                    >
                      <td className="px-4 py-2.5">
                        <Link
                          href={`/workout/${w.id}`}
                          className="font-medium text-slate-900 hover:text-blue-600"
                        >
                          {formatSessionDate(w.scheduledDate)}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5">{splitBadge(w.sessionIntent)}</td>
                      <td className="px-4 py-2.5">
                        <span className="flex items-center gap-1.5">
                          {workoutStatusDot(w.status)}
                          <span className="capitalize text-slate-700">{w.status.replace("_", " ")}</span>
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {w.advancesSplit ? (
                          <span className="text-green-600">✓</span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
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
