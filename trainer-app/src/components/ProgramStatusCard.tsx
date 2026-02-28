"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import type {
  ProgramDashboardData,
  ProgramMesoBlock,
  DeloadReadiness,
  ProgramVolumeRow,
} from "@/lib/api/program";

// ── Volume status utilities ───────────────────────────────────────────────────

export function getVolumeDotClass(
  directSets: number,
  target: number,
  mev: number,
  mav: number,
  mrv: number
): string {
  if (directSets >= mrv) return "bg-rose-500";
  if (directSets > mav && directSets < mrv) return "bg-amber-400";
  if (directSets > target && directSets <= mav) return "bg-emerald-300";
  if (directSets >= mev && directSets <= target) return "bg-emerald-500";
  return "bg-slate-300";
}

function volumeStatus(
  row: ProgramVolumeRow
): "below_mev" | "at_mev" | "optimal" | "approaching_mrv" | "at_mrv" {
  const sets = row.directSets;
  if (row.mev === 0 && sets === 0) return "below_mev";
  if (sets >= row.mrv) return "at_mrv";
  if (sets >= row.mrv * 0.85) return "approaching_mrv";
  if (sets >= row.target) return "optimal";
  if (sets >= row.mev) return "at_mev";
  return "below_mev";
}

const STATUS_STYLE: Record<string, string> = {
  below_mev: "bg-slate-50 text-slate-500 border-slate-200",
  at_mev: "bg-yellow-50 text-yellow-700 border-yellow-200",
  optimal: "bg-green-50 text-green-700 border-green-200",
  approaching_mrv: "bg-orange-50 text-orange-700 border-orange-200",
  at_mrv: "bg-red-50 text-red-700 border-red-200",
};

// ── Block type style maps ─────────────────────────────────────────────────────

const BLOCK_BADGE_STYLE: Record<string, string> = {
  accumulation: "bg-blue-100 text-blue-700",
  intensification: "bg-purple-100 text-purple-700",
  realization: "bg-orange-100 text-orange-700",
  deload: "bg-slate-100 text-slate-600",
};

const BLOCK_BAR_COLOR: Record<string, string> = {
  accumulation: "bg-blue-500",
  intensification: "bg-purple-500",
  realization: "bg-orange-500",
  deload: "bg-slate-400",
};

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

// ── Sub-components ────────────────────────────────────────────────────────────

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

  const weeks: { week: number; blockType: string; desc: string }[] = [];
  for (let w = 1; w <= durationWeeks; w++) {
    const block = blocks.find((b) => w >= b.startWeek && w < b.startWeek + b.durationWeeks);
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
          return (
            <div key={week} className="group relative" title={`Week ${week}: ${desc}`}>
              <div
                className={`flex h-8 min-w-[2.25rem] items-center justify-center rounded-full px-2 text-xs font-semibold transition-all ${style.pill} ${
                  isCurrent ? "ring-2 ring-offset-1 ring-slate-900" : "opacity-80"
                }`}
              >
                W{week}
                <span className="ml-1 hidden sm:inline opacity-75">{style.label}</span>
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

// ── Main component ────────────────────────────────────────────────────────────

export function ProgramStatusCard({ initialData }: { initialData: ProgramDashboardData }) {
  const { activeMeso, currentWeek, sessionsUntilDeload, deloadReadiness, rirTarget, coachingCue } =
    initialData;
  const durationWeeks = activeMeso?.durationWeeks ?? 1;

  const [selectedWeek, setSelectedWeek] = useState(currentWeek);
  const [volumeRows, setVolumeRows] = useState(initialData.volumeThisWeek);
  const [loading, setLoading] = useState(false);

  const isHistorical = selectedWeek !== currentWeek;

  const goToWeek = useCallback(
    async (week: number) => {
      if (week < 1 || week > currentWeek) return;
      setSelectedWeek(week);
      if (week === currentWeek) {
        setVolumeRows(initialData.volumeThisWeek);
        return;
      }
      setLoading(true);
      try {
        const res = await fetch(`/api/program?week=${week}`);
        const data = (await res.json()) as ProgramDashboardData;
        setVolumeRows(data.volumeThisWeek);
      } catch {
        // Network error — keep showing current rows
      } finally {
        setLoading(false);
      }
    },
    [currentWeek, initialData.volumeThisWeek]
  );

  if (!activeMeso) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <h2 className="text-xl font-semibold">Training Program</h2>
        <p className="mt-2 text-sm text-slate-600">
          No active mesocycle. Set up a program to track cycle progress.
        </p>
        <Link
          className="mt-3 inline-block text-sm font-semibold text-slate-900"
          href="/settings"
        >
          Set up program
        </Link>
      </div>
    );
  }

  const blockType = activeMeso.currentBlockType ?? "accumulation";
  const barColor = BLOCK_BAR_COLOR[blockType] ?? "bg-slate-400";
  const badgeStyle = BLOCK_BADGE_STYLE[blockType] ?? "bg-slate-100 text-slate-600";
  const weekProgress = Math.round((currentWeek / durationWeeks) * 100);

  const relevantVolume = volumeRows.filter(
    (v) => v.mev > 0 || v.target > 0 || v.directSets > 0
  );

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      {/* ── Mesocycle header ──────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Mesocycle {activeMeso.mesoNumber}
          </p>
          <p className="mt-0.5 text-base font-semibold text-slate-900">{activeMeso.focus}</p>
        </div>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${badgeStyle}`}
        >
          {blockType}
        </span>
      </div>

      {/* ── Week progress bar ─────────────────────────────────────── */}
      <div className="mt-4">
        <div className="flex items-center justify-between text-xs text-slate-600">
          <span>Week {currentWeek} of {durationWeeks}</span>
          <span>{weekProgress}%</span>
        </div>
        <div className="mt-1.5 h-2 w-full rounded-full bg-slate-200">
          <div
            className={`h-2 rounded-full transition-all ${barColor}`}
            style={{ width: `${weekProgress}%` }}
          />
        </div>
      </div>

      {/* ── Mesocycle timeline ────────────────────────────────────── */}
      <MesocycleTimeline
        blocks={activeMeso.blocks}
        currentWeek={currentWeek}
        durationWeeks={durationWeeks}
      />

      {/* ── RIR + sessions until deload ───────────────────────────── */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {rirTarget && (
          <div className="rounded-xl border border-slate-200 px-3 py-1.5">
            <p className="text-[10px] uppercase tracking-wide text-slate-500">
              Target RIR this week
            </p>
            <p className="mt-0.5 text-sm font-semibold text-slate-900">
              {rirTarget.min}–{rirTarget.max} RIR
            </p>
          </div>
        )}
        <p
          className={`text-sm font-medium ${
            sessionsUntilDeload <= 3 ? "text-amber-700" : "text-slate-700"
          }`}
        >
          {sessionsUntilDeload === 0
            ? "Deload week"
            : `${sessionsUntilDeload} sessions until deload`}
        </p>
      </div>

      {/* ── Deload banner ─────────────────────────────────────────── */}
      {deloadReadiness?.shouldDeload && (
        <div className="mt-3">
          <DeloadBanner readiness={deloadReadiness} />
        </div>
      )}

      {/* ── Volume section header + week navigation ───────────────── */}
      <div className="mt-5 flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-slate-900">
            {isHistorical
              ? `Volume — Week ${selectedWeek} of ${durationWeeks}`
              : "Volume This Week"}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            Direct sets vs weekly target (MEV → MAV).
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={() => goToWeek(selectedWeek - 1)}
            disabled={selectedWeek <= 1}
            aria-label="View previous week"
            className="flex size-7 items-center justify-center rounded-lg text-sm text-slate-500 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-30"
          >
            ←
          </button>
          <span className="min-w-[3.5rem] text-center text-xs font-medium tabular-nums text-slate-600">
            W{selectedWeek}/{durationWeeks}
          </span>
          <button
            onClick={() => goToWeek(selectedWeek + 1)}
            disabled={selectedWeek >= currentWeek}
            aria-label="View next week"
            className="flex size-7 items-center justify-center rounded-lg text-sm text-slate-500 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-30"
          >
            →
          </button>
        </div>
      </div>

      {/* ── Historical read-only banner ───────────────────────────── */}
      {isHistorical && (
        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700">
          Viewing Week {selectedWeek} — read only
        </div>
      )}

      {/* ── Volume grid ───────────────────────────────────────────── */}
      {relevantVolume.length > 0 ? (
        <div
          className={`mt-3 grid grid-cols-2 gap-2 transition-opacity sm:grid-cols-3 lg:grid-cols-4 ${
            loading ? "opacity-50" : ""
          }`}
        >
          {relevantVolume.map((row) => {
            const status = volumeStatus(row);
            const cls = STATUS_STYLE[status];
            const barWidth =
              row.mrv > 0 ? Math.min(100, Math.round((row.directSets / row.mrv) * 100)) : 0;
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
        <p className="mt-3 text-sm text-slate-500">No volume data for this week.</p>
      )}

      {/* ── Coaching cue ──────────────────────────────────────────── */}
      {!isHistorical && coachingCue && (
        <p className="mt-4 text-xs italic text-slate-600">{coachingCue}</p>
      )}
    </div>
  );
}

export default ProgramStatusCard;
