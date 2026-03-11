"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import type {
  DeloadReadiness,
  ProgramDashboardData,
  ProgramMuscleContribution,
  ProgramMesoBlock,
  ProgramVolumeRow,
} from "@/lib/api/program";
import { SlideUpSheet } from "@/components/ui/SlideUpSheet";
import {
  formatWeeklyMuscleStatusLabel,
  getWeeklyMuscleStatus,
} from "@/lib/ui/weekly-muscle-status";

type ProgramStatusCardVariant = "default" | "homeCompact";

export function getVolumeDotClass(
  effectiveSets: number,
  target: number,
  mev: number,
  mav: number,
  mrv: number
): string {
  if (effectiveSets >= mrv) return "bg-rose-500";
  if (effectiveSets > mav && effectiveSets < mrv) return "bg-amber-400";
  if (effectiveSets > target && effectiveSets <= mav) return "bg-emerald-300";
  if (effectiveSets >= mev && effectiveSets <= target) return "bg-emerald-500";
  return "bg-slate-300";
}

function formatSetCount(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatMultiplier(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  if (Number.isInteger(rounded) || Number.isInteger(rounded * 10)) {
    return rounded.toFixed(1);
  }
  return rounded.toFixed(2);
}

function formatContributionContext(contribution: ProgramMuscleContribution): string | null {
  const parts: string[] = [];
  if (contribution.directSets && contribution.directSets > 0) {
    parts.push(`${contribution.directSets} direct`);
  }
  if (contribution.indirectSets && contribution.indirectSets > 0) {
    parts.push(`${contribution.indirectSets} indirect`);
  }
  return parts.length > 0 ? parts.join(", ") : null;
}

function formatOpportunityStateLabel(
  state: ProgramVolumeRow["opportunityState"]
): string {
  switch (state) {
    case "high_opportunity":
      return "Today: room for more";
    case "moderate_opportunity":
      return "Today: optional";
    case "covered":
      return "Today: covered";
    case "deprioritize_today":
      return "Today: go lighter";
    default:
      return "Today: covered";
  }
}

function getTodayAdvisoryClass(state: ProgramVolumeRow["opportunityState"]): string {
  switch (state) {
    case "high_opportunity":
      return "text-blue-700";
    case "moderate_opportunity":
      return "text-slate-600";
    case "covered":
      return "text-emerald-700";
    case "deprioritize_today":
      return "text-amber-700";
    default:
      return "text-slate-600";
  }
}

const STATUS_STYLE: Record<string, string> = {
  below_mev: "bg-slate-50 text-slate-500 border-slate-200",
  in_range: "bg-yellow-50 text-yellow-700 border-yellow-200",
  near_target: "bg-yellow-50 text-yellow-700 border-yellow-200",
  on_target: "bg-green-50 text-green-700 border-green-200",
  near_mrv: "bg-orange-50 text-orange-700 border-orange-200",
  at_mrv: "bg-red-50 text-red-700 border-red-200",
};

function formatRawSetContext(directSets: number, indirectSets: number): string {
  if (indirectSets > 0) {
    return `Raw sets: ${directSets} direct, ${indirectSets} indirect`;
  }
  return `Raw sets: ${directSets} direct`;
}

function formatContributionFormula(contribution: ProgramMuscleContribution): string {
  const mappingParts: string[] = [];
  if (contribution.directSets && contribution.directSets > 0) {
    mappingParts.push("direct");
  }
  if (contribution.indirectSets && contribution.indirectSets > 0) {
    mappingParts.push("indirect");
  }

  const rawMapping =
    mappingParts.length === 0
      ? "raw sets"
      : mappingParts.length === 2
        ? "raw direct + indirect sets"
        : `raw ${mappingParts[0]} sets`;
  const multiplier =
    contribution.performedSets > 0 ? contribution.effectiveSets / contribution.performedSets : 0;

  return `${contribution.performedSets} ${rawMapping} x ${formatMultiplier(multiplier)} = ${formatSetCount(
    contribution.effectiveSets
  )} weighted`;
}

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
    desc: "High volume accumulation phase.",
  },
  intensification: {
    pill: "bg-purple-500 text-white",
    label: "Int",
    desc: "Lower volume, higher intensity phase.",
  },
  realization: {
    pill: "bg-orange-500 text-white",
    label: "Peak",
    desc: "Peak phase.",
  },
  deload: {
    pill: "bg-slate-400 text-white",
    label: "Deload",
    desc: "Reduced-volume recovery phase.",
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

  const weeks: { week: number; blockType: string; desc: string }[] = [];
  for (let w = 1; w <= durationWeeks; w += 1) {
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
              {isCurrent ? (
                <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 text-[8px] font-bold leading-none text-slate-900">
                  ^
                </span>
              ) : null}
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
  const labels: Record<DeloadReadiness["urgency"], string> = {
    scheduled: "Program timing",
    recommended: "Program advisory",
    urgent: "Program timing + advisory",
  };

  return (
    <div className={`rounded-xl border px-4 py-3 text-sm font-medium ${styles[readiness.urgency]}`}>
      {labels[readiness.urgency]}: {readiness.reason}
    </div>
  );
}

function ProgramStatusEmptyState() {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <h2 className="text-xl font-semibold">Training Program</h2>
      <p className="mt-2 text-sm text-slate-600">
        No active mesocycle. Set up a program to track cycle progress.
      </p>
      <Link className="mt-3 inline-block text-sm font-semibold text-slate-900" href="/settings">
        Set up program
      </Link>
    </div>
  );
}

function ProgramCardHeader({
  mesoNumber,
  focus,
  blockType,
}: {
  mesoNumber: number;
  focus: string;
  blockType: string;
}) {
  const badgeStyle = BLOCK_BADGE_STYLE[blockType] ?? "bg-slate-100 text-slate-600";

  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Mesocycle {mesoNumber}
        </p>
        <p className="mt-0.5 text-base font-semibold text-slate-900">{focus}</p>
      </div>
      <span
        className={`rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${badgeStyle}`}
      >
        {blockType}
      </span>
    </div>
  );
}

function ProgramCardProgress({
  blockType,
  currentWeek,
  durationWeeks,
}: {
  blockType: string;
  currentWeek: number;
  durationWeeks: number;
}) {
  const barColor = BLOCK_BAR_COLOR[blockType] ?? "bg-slate-400";
  const weekProgress = Math.round((currentWeek / durationWeeks) * 100);

  return (
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
  );
}

function ProgramCardStatusRow({
  rirTarget,
  sessionsUntilDeload,
}: {
  rirTarget: ProgramDashboardData["rirTarget"];
  sessionsUntilDeload?: number | null;
}) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      {rirTarget ? (
        <div className="rounded-xl border border-slate-200 px-3 py-1.5">
          <p className="text-[10px] uppercase tracking-wide text-slate-500">
            Target RIR this week
          </p>
          <p className="mt-0.5 text-sm font-semibold text-slate-900">
            {rirTarget.min}-{rirTarget.max} RIR
          </p>
        </div>
      ) : null}
      {typeof sessionsUntilDeload === "number" ? (
        <p
          className={`text-sm font-medium ${
            sessionsUntilDeload <= 3 ? "text-amber-700" : "text-slate-700"
          }`}
        >
          {sessionsUntilDeload === 0
            ? "Scheduled lighter week"
            : `${sessionsUntilDeload} sessions until scheduled lighter week`}
        </p>
      ) : null}
    </div>
  );
}

function ProgramStatusCardCompact({ initialData }: { initialData: ProgramDashboardData }) {
  const { activeMeso, currentWeek, sessionsUntilDeload, deloadReadiness, rirTarget, coachingCue } =
    initialData;

  if (!activeMeso) {
    return <ProgramStatusEmptyState />;
  }

  const blockType = activeMeso.currentBlockType ?? "accumulation";

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <ProgramCardHeader
        mesoNumber={activeMeso.mesoNumber}
        focus={activeMeso.focus}
        blockType={blockType}
      />
      <ProgramCardProgress
        blockType={blockType}
        currentWeek={currentWeek}
        durationWeeks={activeMeso.durationWeeks}
      />
      <ProgramCardStatusRow rirTarget={rirTarget} sessionsUntilDeload={sessionsUntilDeload} />
      {deloadReadiness?.shouldDeload ? (
        <div className="mt-3">
          <DeloadBanner readiness={deloadReadiness} />
        </div>
      ) : null}
      {coachingCue ? <p className="mt-4 text-xs italic text-slate-600">{coachingCue}</p> : null}
      <Link className="mt-4 inline-block text-sm font-semibold text-slate-900" href="/program">
        Open program details
      </Link>
    </div>
  );
}

function ProgramStatusCardDefault({ initialData }: { initialData: ProgramDashboardData }) {
  const [activeData, setActiveData] = useState(initialData);
  const [loading, setLoading] = useState(false);
  const [selectedMuscle, setSelectedMuscle] = useState<string | null>(null);

  const {
    activeMeso,
    currentWeek,
    viewedWeek,
    viewedBlockType,
    sessionsUntilDeload,
    deloadReadiness,
    rirTarget,
    coachingCue,
  } = activeData;
  const durationWeeks = activeMeso?.durationWeeks ?? 1;
  const isHistorical = viewedWeek !== currentWeek;

  const goToWeek = useCallback(
    async (week: number) => {
      if (week < 1 || week > currentWeek) return;
      setSelectedMuscle(null);
      if (week === currentWeek) {
        setActiveData(initialData);
        return;
      }
      setLoading(true);
      try {
        const res = await fetch(`/api/program?week=${week}`);
        const data = (await res.json()) as ProgramDashboardData;
        setActiveData(data);
      } catch {
        // Network error: keep showing the last coherent payload.
      } finally {
        setLoading(false);
      }
    },
    [currentWeek, initialData]
  );

  if (!activeMeso) {
    return <ProgramStatusEmptyState />;
  }

  const blockType = viewedBlockType ?? activeMeso.currentBlockType ?? "accumulation";
  const relevantVolume = activeData.volumeThisWeek.filter(
    (v) => v.mev > 0 || v.target > 0 || v.effectiveSets > 0
  );
  const selectedRow = relevantVolume.find((row) => row.muscle === selectedMuscle) ?? null;
  const selectedBreakdown = selectedRow?.breakdown ?? null;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <ProgramCardHeader
        mesoNumber={activeMeso.mesoNumber}
        focus={activeMeso.focus}
        blockType={blockType}
      />
      <ProgramCardProgress
        blockType={blockType}
        currentWeek={viewedWeek}
        durationWeeks={durationWeeks}
      />
      <MesocycleTimeline
        blocks={activeMeso.blocks}
        currentWeek={viewedWeek}
        durationWeeks={durationWeeks}
      />
      <ProgramCardStatusRow
        rirTarget={rirTarget}
        sessionsUntilDeload={isHistorical ? null : sessionsUntilDeload}
      />
      {!isHistorical && deloadReadiness?.shouldDeload ? (
        <div className="mt-3">
          <DeloadBanner readiness={deloadReadiness} />
        </div>
      ) : null}

      <div className="mt-5 flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-slate-900">
            {isHistorical
              ? `Volume - Week ${viewedWeek} of ${durationWeeks}`
              : "Volume This Week"}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            Weighted sets count toward your weekly target. Raw direct and indirect sets are
            context only.
          </p>
          <p className="mt-0.5 text-xs text-slate-400">
            MEV = minimum effective, MAV = productive upper range, MRV = recoverable ceiling.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={() => goToWeek(viewedWeek - 1)}
            disabled={viewedWeek <= 1}
            aria-label="View previous week"
            className="flex size-7 items-center justify-center rounded-lg text-sm text-slate-500 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-30"
          >
            {"<"}
          </button>
          <span className="min-w-[3.5rem] text-center text-xs font-medium tabular-nums text-slate-600">
            W{viewedWeek}/{durationWeeks}
          </span>
          <button
            onClick={() => goToWeek(viewedWeek + 1)}
            disabled={viewedWeek >= currentWeek}
            aria-label="View next week"
            className="flex size-7 items-center justify-center rounded-lg text-sm text-slate-500 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-30"
          >
            {">"}
          </button>
        </div>
      </div>

      {isHistorical ? (
        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700">
          Viewing Week {viewedWeek} - read only
        </div>
      ) : null}

      {relevantVolume.length > 0 ? (
        <div
          className={`mt-3 grid grid-cols-2 gap-2 transition-opacity sm:grid-cols-3 lg:grid-cols-4 ${
            loading ? "opacity-50" : ""
          }`}
        >
          {relevantVolume.map((row) => {
            const status = getWeeklyMuscleStatus({
              effectiveSets: row.effectiveSets,
              target: row.target,
              mev: row.mev,
              mrv: row.mrv,
            });
            const cls = STATUS_STYLE[status];
            const barWidth =
              row.target > 0 ? Math.min(100, Math.round((row.effectiveSets / row.target) * 100)) : 0;
            const hasBreakdown = Boolean(row.breakdown?.contributions.length);
            return (
              <button
                key={row.muscle}
                type="button"
                onClick={() => {
                  if (hasBreakdown) {
                    setSelectedMuscle(row.muscle);
                  }
                }}
                disabled={!hasBreakdown}
                aria-label={
                  hasBreakdown
                    ? `Show where ${row.muscle} sets came from`
                    : `${row.muscle} weekly volume`
                }
                className={`rounded-xl border p-3 text-left ${cls} ${
                  hasBreakdown ? "transition-shadow hover:shadow-sm" : "cursor-default"
                }`}
              >
                <p className="text-xs font-semibold">{row.muscle}</p>
                <p className="mt-0.5 text-lg font-bold leading-none">
                  {formatSetCount(row.effectiveSets)} weighted sets
                </p>
                <p className="text-xs opacity-75">target {row.target} weighted sets</p>
                <div className="mt-1.5">
                  <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${cls}`}>
                    {formatWeeklyMuscleStatusLabel(status)}
                  </span>
                </div>
                {!isHistorical ? (
                  <p
                    className={`mt-1 text-[11px] opacity-70 ${getTodayAdvisoryClass(
                      row.opportunityState
                    )}`}
                  >
                    {formatOpportunityStateLabel(row.opportunityState)}
                  </p>
                ) : null}
                {row.directSets > 0 || row.indirectSets > 0 ? (
                  <p className="mt-0.5 text-xs opacity-65">
                    {formatRawSetContext(row.directSets, row.indirectSets)}
                  </p>
                ) : null}
                <div className="mt-2 h-1 w-full rounded-full bg-current opacity-20">
                  <div
                    className="h-1 rounded-full bg-current opacity-80 transition-all"
                    style={{ width: `${barWidth}%` }}
                  />
                </div>
                <p className="mt-1 text-xs opacity-60">
                  MEV {row.mev} · MAV {row.mav} · MRV {row.mrv}
                </p>
                {hasBreakdown ? (
                  <p className="mt-2 text-[11px] font-medium opacity-70">Tap for breakdown</p>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : (
        <p className="mt-3 text-sm text-slate-500">No volume data for this week.</p>
      )}

      {coachingCue ? (
        <p className="mt-4 text-xs italic text-slate-600">{coachingCue}</p>
      ) : null}

      <SlideUpSheet
        isOpen={Boolean(selectedBreakdown)}
        onClose={() => setSelectedMuscle(null)}
        title={selectedBreakdown ? `${selectedBreakdown.muscle} breakdown` : undefined}
      >
        {selectedBreakdown ? (
          <div data-testid="muscle-breakdown-sheet">
            <p className="text-sm font-semibold text-slate-900">
              {selectedBreakdown.muscle}: {formatSetCount(selectedBreakdown.effectiveSets)} weighted /{" "}
              {formatSetCount(selectedBreakdown.targetSets)} target
            </p>
            <p className="mt-2 text-sm text-slate-600">
              Weighted sets count toward your weekly target. Raw direct and indirect sets are
              structural context.
            </p>
            <p className="mt-1 text-sm text-slate-600">
              Each row shows raw sets x exercise weighting = weighted contribution.
            </p>

            <div className="mt-4 space-y-3">
              {selectedBreakdown.contributions.map((contribution) => {
                const context = formatContributionContext(contribution);
                const formula = formatContributionFormula(contribution);
                return (
                  <div
                    key={contribution.exerciseId ?? contribution.exerciseName}
                    data-testid="muscle-breakdown-contributor"
                    className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-900">
                        {contribution.exerciseName}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-600">{formula}</p>
                      {context ? (
                        <p className="mt-0.5 text-xs text-slate-500">Raw mapping: {context}</p>
                      ) : null}
                    </div>
                    <p className="shrink-0 text-sm font-semibold tabular-nums text-slate-900">
                      {formatSetCount(contribution.effectiveSets)}
                    </p>
                  </div>
                );
              })}
            </div>

            <div className="mt-4 flex items-center justify-between border-t border-slate-200 pt-3 text-sm font-semibold text-slate-900">
              <span>Total weighted sets</span>
              <span>{formatSetCount(selectedBreakdown.effectiveSets)}</span>
            </div>
          </div>
        ) : null}
      </SlideUpSheet>
    </div>
  );
}

export function ProgramStatusCard({
  initialData,
  variant = "default",
}: {
  initialData: ProgramDashboardData;
  variant?: ProgramStatusCardVariant;
}) {
  if (variant === "homeCompact") {
    return <ProgramStatusCardCompact initialData={initialData} />;
  }

  return <ProgramStatusCardDefault initialData={initialData} />;
}

export default ProgramStatusCard;
