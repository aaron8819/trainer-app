import type { ProgramDashboardData, ProgramVolumeRow } from "@/lib/api/program";

type WeeklyVolumeStatus =
  | "below_mev"
  | "in_range"
  | "near_target"
  | "on_target"
  | "near_mrv"
  | "at_mrv";

type SnapshotBucket = "needs_attention" | "on_track" | "watch_high" | "other";

const STATUS_BUCKET_LABEL: Record<SnapshotBucket, string> = {
  needs_attention: "Watch list",
  on_track: "On track",
  watch_high: "Watch high",
  other: "Review",
};

const STATUS_BUCKET_STYLE: Record<SnapshotBucket, string> = {
  needs_attention: "border-sky-200 bg-sky-50 text-sky-800",
  on_track: "border-emerald-200 bg-emerald-50 text-emerald-800",
  watch_high: "border-amber-200 bg-amber-50 text-amber-800",
  other: "border-slate-200 bg-slate-50 text-slate-700",
};

function getDashboardGroup(
  row: ProgramVolumeRow,
): NonNullable<ProgramVolumeRow["dashboardGroup"]> {
  return (
    row.dashboardGroup ??
    (row.displayGroup === "secondary" ? "secondary" : "primary_driver")
  );
}

function getStatus(row: ProgramVolumeRow): WeeklyVolumeStatus | null {
  const status = row.badges[0]?.status;
  switch (status) {
    case "below_mev":
    case "in_range":
    case "near_target":
    case "on_target":
    case "near_mrv":
    case "at_mrv":
      return status;
    default:
      return null;
  }
}

function getBucket(row: ProgramVolumeRow): SnapshotBucket {
  const status = getStatus(row);
  switch (status) {
    case "below_mev":
    case "in_range":
      return "needs_attention";
    case "near_mrv":
    case "at_mrv":
      return "watch_high";
    case "near_target":
    case "on_target":
      return "on_track";
    default:
      return "other";
  }
}

function countRows(
  rows: ProgramVolumeRow[],
  predicate: (row: ProgramVolumeRow) => boolean,
): number {
  return rows.reduce((count, row) => count + (predicate(row) ? 1 : 0), 0);
}

function formatTargetGroupLabel(row: ProgramVolumeRow): string {
  switch (getDashboardGroup(row)) {
    case "primary_driver":
      return "Primary";
    case "support_driver":
      return "Support";
    case "secondary":
      return "Secondary";
    case "implicit":
      return "Implicit";
  }
}

function VolumeSnapshotRow({ row }: { row: ProgramVolumeRow }) {
  const bucket = getBucket(row);

  return (
    <li className="rounded-xl border border-slate-200 bg-white px-3 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-slate-900">{row.muscle}</p>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
              {formatTargetGroupLabel(row)}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-600">{row.statusDescription}</p>
        </div>
        <span
          className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold ${STATUS_BUCKET_STYLE[bucket]}`}
        >
          {bucket === "on_track" ? row.statusLabel : STATUS_BUCKET_LABEL[bucket]}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs font-medium text-slate-600">
        <span>Performed so far: {row.weightedSetsLabel}</span>
        <span>Planned target: {row.targetLabel}</span>
        <span>{row.deltaLabel}</span>
      </div>
    </li>
  );
}

export function VolumeSnapshotSection({
  dashboard,
}: {
  dashboard: ProgramDashboardData;
}) {
  const visibleRows = dashboard.volumeThisWeek.filter((row) => {
    const group = getDashboardGroup(row);
    return (
      group !== "implicit" &&
      (row.mev > 0 ||
        row.target > 0 ||
        row.effectiveSets > 0 ||
        row.targetKind === "soft")
    );
  });
  const primaryAndSupportRows = visibleRows.filter((row) => {
    const group = getDashboardGroup(row);
    return group === "primary_driver" || group === "support_driver";
  });
  const priorityRows = primaryAndSupportRows.filter((row) => {
    const bucket = getBucket(row);
    return bucket === "needs_attention" || bucket === "watch_high";
  });
  const visiblePriorityRows = priorityRows.slice(0, 5);
  const primaryCount = countRows(
    visibleRows,
    (row) => getDashboardGroup(row) === "primary_driver",
  );
  const supportCount = countRows(
    visibleRows,
    (row) => getDashboardGroup(row) === "support_driver",
  );
  const needsAttentionCount = countRows(
    primaryAndSupportRows,
    (row) => getBucket(row) === "needs_attention",
  );
  const watchHighCount = countRows(
    primaryAndSupportRows,
    (row) => getBucket(row) === "watch_high",
  );
  const onTrackCount = countRows(
    primaryAndSupportRows,
    (row) => getBucket(row) === "on_track",
  );
  const performedTotal = primaryAndSupportRows.reduce(
    (sum, row) => sum + row.effectiveSets,
    0,
  );
  const isNoPerformedVolume =
    primaryAndSupportRows.length > 0 &&
    primaryAndSupportRows.every(
      (row) =>
        row.effectiveSets <= 0 && row.directSets <= 0 && row.indirectSets <= 0,
    );
  const isEarlyPerformedState =
    isNoPerformedVolume ||
    (primaryAndSupportRows.length > 0 && performedTotal > 0 && performedTotal < 2);
  const hiddenPriorityCount = priorityRows.length - visiblePriorityRows.length;
  const summary = isNoPerformedVolume
    ? "Week just started. No performed volume yet; showing projected finish from the remaining plan above."
    : isEarlyPerformedState
      ? "Week just started. Performed volume is still sparse; use projected finish above to judge where the week is likely to land."
      : priorityRows.length > 0
      ? `${priorityRows.length} primary/support target${
          priorityRows.length === 1 ? "" : "s"
        } need a quick check this week.`
      : "Primary and support targets are on track in the current Program readout.";

  return (
    <section className="mt-8 rounded-3xl border border-slate-200 bg-slate-50/80 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Volume Snapshot
          </p>
          <h2 className="mt-1 text-lg font-semibold text-slate-900">
            Weekly Volume Snapshot
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">{summary}</p>
          <p className="mt-1 text-xs text-slate-500">
            Performed so far comes from logged work. Projected finish uses the
            remaining plan above. Planned target is the weekly target.
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold">
        <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-700">
          Primary {primaryCount}
        </span>
        <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-700">
          Support {supportCount}
        </span>
        {isEarlyPerformedState ? (
          <>
            <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-blue-800">
              {isNoPerformedVolume
                ? "No performed volume yet"
                : "Early performed volume"}
            </span>
            <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-700">
              Projected finish above
            </span>
          </>
        ) : (
          <>
            <span className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-sky-800">
              Watch list {needsAttentionCount}
            </span>
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-800">
              On track {onTrackCount}
            </span>
            <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-amber-800">
              Watch high {watchHighCount}
            </span>
          </>
        )}
      </div>

      {isEarlyPerformedState ? (
        <p className="mt-5 rounded-xl border border-blue-200 bg-blue-50 px-3 py-3 text-sm font-medium text-blue-900">
          Use Full details to inspect targets. The compact snapshot will call
          out truly actionable misses after performed volume starts landing.
        </p>
      ) : visiblePriorityRows.length > 0 ? (
        <div className="mt-5">
          <h3 className="text-sm font-semibold text-slate-900">
            Watch list
          </h3>
          <ul className="mt-2 grid gap-2">
            {visiblePriorityRows.map((row) => (
              <VolumeSnapshotRow key={row.muscle} row={row} />
            ))}
          </ul>
          {hiddenPriorityCount > 0 ? (
            <p className="mt-2 text-xs text-slate-500">
              +{hiddenPriorityCount} more in Full details.
            </p>
          ) : null}
        </div>
      ) : (
        <p className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm font-medium text-emerald-800">
          On track: no primary/support volume rows are on the watch list right
          now.
        </p>
      )}
    </section>
  );
}
