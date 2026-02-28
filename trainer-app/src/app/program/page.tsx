import Link from "next/link";
import { resolveOwner } from "@/lib/api/workout-context";
import { loadProgramDashboardData } from "@/lib/api/program";
import { CycleAnchorControls } from "@/components/CycleAnchorControls";
import { ProgramStatusCard } from "@/components/ProgramStatusCard";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

// ── helpers used by session history table only ────────────────────────────────

function formatSessionDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
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

  const { recentWorkouts } = data;

  return (
    <main className="min-h-screen bg-white text-slate-900">
      <div className="page-shell max-w-5xl">
        <h1 className="page-title">My Program</h1>
        <p className="mt-1.5 text-sm text-slate-600">
          Training cycle progress and weekly volume.
        </p>

        {/* ── Program status card (meso header + timeline + RIR + volume nav) ── */}
        <section className="mt-6">
          <ProgramStatusCard initialData={data} />
        </section>

        {/* ── Cycle anchor controls ───────────────────────────────────────── */}
        <section className="mt-4">
          <CycleAnchorControls />
        </section>

        {/* ── Session History ────────────────────────────────────────────── */}
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
                          <span className="capitalize text-slate-700">
                            {w.status.replace("_", " ")}
                          </span>
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
