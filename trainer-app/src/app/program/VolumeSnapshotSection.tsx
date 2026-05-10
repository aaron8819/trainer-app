import Link from "next/link";
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
  needs_attention: "Needs attention",
  on_track: "On track",
  watch_high: "Watch high",
  other: "Review",
};

const STATUS_BUCKET_STYLE: Record<SnapshotBucket, string> = {
  needs_attention: "border-rose-200 bg-rose-50 text-rose-800",
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
        <span>{row.weightedSetsLabel}</span>
        <span>{row.targetLabel}</span>
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
  const hiddenPriorityCount = priorityRows.length - visiblePriorityRows.length;
  const summary =
    priorityRows.length > 0
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
            Active-week volume uses the existing Program read model. Projected
            week finish remains above.
          </p>
        </div>
        <Link
          href="/analytics"
          className="inline-flex min-h-10 items-center justify-center rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition-colors hover:border-slate-400"
        >
          Open Analytics
        </Link>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold">
        <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-700">
          Primary {primaryCount}
        </span>
        <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-700">
          Support {supportCount}
        </span>
        <span className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-rose-800">
          Needs attention {needsAttentionCount}
        </span>
        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-800">
          On track {onTrackCount}
        </span>
        <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-amber-800">
          Watch high {watchHighCount}
        </span>
      </div>

      {visiblePriorityRows.length > 0 ? (
        <div className="mt-5">
          <h3 className="text-sm font-semibold text-slate-900">
            Needs attention
          </h3>
          <ul className="mt-2 grid gap-2">
            {visiblePriorityRows.map((row) => (
              <VolumeSnapshotRow key={row.muscle} row={row} />
            ))}
          </ul>
          {hiddenPriorityCount > 0 ? (
            <p className="mt-2 text-xs text-slate-500">
              +{hiddenPriorityCount} more in Analytics.
            </p>
          ) : null}
        </div>
      ) : (
        <p className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm font-medium text-emerald-800">
          On track: no primary/support volume rows need attention right now.
        </p>
      )}
    </section>
  );
}
