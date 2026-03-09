"use client";

import { useMemo, useState } from "react";
import DeleteWorkoutButton from "./DeleteWorkoutButton";
import { WorkoutRowActions } from "./workout/WorkoutRowActions";
import {
  formatWorkoutListExerciseLabel,
  formatWorkoutListIntentLabel,
  formatWorkoutListLoggedSetsLabel,
  getWorkoutListPrimaryLabel,
  getWorkoutListStatusClasses,
  getWorkoutListStatusLabel,
  WORKOUT_LIST_STATUS_OPTIONS,
  type WorkoutListSurfaceSummary,
} from "@/lib/ui/workout-list-items";
import { formatWorkoutSessionSnapshotLabel } from "@/lib/ui/workout-session-snapshot";

export type HistoryWorkoutItem = WorkoutListSurfaceSummary;

export type MesocycleOption = {
  id: string;
  startDate: string;
  isActive: boolean;
  mesoNumber: number;
};

type Props = {
  initialWorkouts: HistoryWorkoutItem[];
  initialNextCursor: string | null;
  initialTotalCount: number;
  mesocycles: MesocycleOption[];
};

type Filters = {
  intent: string | null;
  statuses: string[];
  mesocycleId: string | null;
  from: string | null;
  to: string | null;
};

const INTENT_OPTIONS = ["PUSH", "PULL", "LEGS", "UPPER", "LOWER", "FULL_BODY"] as const;

function buildApiUrl(filters: Filters, cursor: string | null): string {
  const params = new URLSearchParams();
  if (filters.intent) params.set("intent", filters.intent);
  if (filters.statuses.length > 0 && filters.statuses.length < WORKOUT_LIST_STATUS_OPTIONS.length) {
    params.set("status", filters.statuses.join(","));
  }
  if (filters.mesocycleId) params.set("mesocycleId", filters.mesocycleId);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (cursor) params.set("cursor", cursor);
  return `/api/workouts/history?${params.toString()}`;
}

const DEFAULT_FILTERS: Filters = {
  intent: null,
  statuses: [...WORKOUT_LIST_STATUS_OPTIONS],
  mesocycleId: null,
  from: null,
  to: null,
};

function SkeletonRows() {
  return (
    <div className="space-y-3" aria-busy="true">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-20 animate-pulse rounded-2xl border border-slate-100 bg-slate-50"
        />
      ))}
    </div>
  );
}

export default function HistoryClient({
  initialWorkouts,
  initialNextCursor,
  initialTotalCount,
  mesocycles,
}: Props) {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [workouts, setWorkouts] = useState<HistoryWorkoutItem[]>(initialWorkouts);
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor);
  const [totalCount, setTotalCount] = useState(initialTotalCount);
  const [isLoading, setIsLoading] = useState(false);

  const isDefaultFilters = useMemo(
    () =>
      filters.intent === null &&
      filters.statuses.length === WORKOUT_LIST_STATUS_OPTIONS.length &&
      filters.mesocycleId === null &&
      filters.from === null &&
      filters.to === null,
    [filters]
  );

  async function applyFilters(newFilters: Filters) {
    setFilters(newFilters);
    setIsLoading(true);
    try {
      const url = buildApiUrl(newFilters, null);
      const res = await fetch(url);
      if (!res.ok) return;
      const data = (await res.json()) as {
        workouts: HistoryWorkoutItem[];
        nextCursor: string | null;
        totalCount: number;
      };
      setWorkouts(data.workouts);
      setNextCursor(data.nextCursor);
      setTotalCount(data.totalCount);
    } finally {
      setIsLoading(false);
    }
  }

  async function loadMore() {
    if (!nextCursor || isLoading) return;
    setIsLoading(true);
    try {
      const url = buildApiUrl(filters, nextCursor);
      const res = await fetch(url);
      if (!res.ok) return;
      const data = (await res.json()) as {
        workouts: HistoryWorkoutItem[];
        nextCursor: string | null;
        totalCount: number;
      };
      setWorkouts((prev) => [...prev, ...data.workouts]);
      setNextCursor(data.nextCursor);
    } finally {
      setIsLoading(false);
    }
  }

  function toggleIntent(value: string | null) {
    const next = value === null || filters.intent === value ? null : value;
    applyFilters({ ...filters, intent: next });
  }

  function toggleStatus(value: string) {
    const current = filters.statuses;
    const next = current.includes(value)
      ? current.filter((s) => s !== value)
      : [...current, value];
    applyFilters({ ...filters, statuses: next });
  }

  function resetFilters() {
    applyFilters(DEFAULT_FILTERS);
  }

  function handleDeleted(deletedId: string) {
    setWorkouts((prev) => prev.filter((w) => w.id !== deletedId));
    setTotalCount((prev) => Math.max(0, prev - 1));
  }

  const pillBase =
    "inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold transition-colors";
  const pillActive = "border-slate-900 bg-slate-900 text-white";
  const pillInactive = "border-slate-200 bg-white text-slate-600 hover:border-slate-400";

  return (
    <div>
      <div className="space-y-4 rounded-2xl border border-slate-200 p-4 md:p-5">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Session type
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              className={`${pillBase} ${filters.intent === null ? pillActive : pillInactive}`}
              onClick={() => toggleIntent(null)}
              aria-pressed={filters.intent === null}
            >
              All
            </button>
            {INTENT_OPTIONS.map((intent) => (
              <button
                key={intent}
                className={`${pillBase} ${filters.intent === intent ? pillActive : pillInactive}`}
                onClick={() => toggleIntent(intent)}
                aria-pressed={filters.intent === intent}
              >
                {formatWorkoutListIntentLabel(intent)}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Status
          </p>
          <div className="flex flex-wrap gap-2">
            {WORKOUT_LIST_STATUS_OPTIONS.map((status) => (
              <button
                key={status}
                className={`${pillBase} ${
                  filters.statuses.includes(status) ? pillActive : pillInactive
                }`}
                onClick={() => toggleStatus(status)}
                aria-pressed={filters.statuses.includes(status)}
              >
                {getWorkoutListStatusLabel(status)}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Mesocycle
            </label>
            <select
              className="min-w-0 max-w-full w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400"
              value={filters.mesocycleId ?? ""}
              onChange={(e) =>
                applyFilters({ ...filters, mesocycleId: e.target.value || null })
              }
            >
              <option value="">All mesocycles</option>
              {mesocycles.map((meso) => (
                <option key={meso.id} value={meso.id}>
                  {meso.isActive ? "Active - " : ""}Meso {meso.mesoNumber} -{" "}
                  {new Date(meso.startDate).toLocaleDateString()}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              From
            </label>
            <input
              type="date"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400"
              value={filters.from ?? ""}
              onChange={(e) => applyFilters({ ...filters, from: e.target.value || null })}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              To
            </label>
            <input
              type="date"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400"
              value={filters.to ?? ""}
              onChange={(e) => applyFilters({ ...filters, to: e.target.value || null })}
            />
          </div>
        </div>
      </div>

      <div className="mt-5 flex items-center justify-between">
        <p className="text-sm text-slate-500">
          {totalCount} session{totalCount === 1 ? "" : "s"}
        </p>
        {!isDefaultFilters ? (
          <button
            className="text-sm font-semibold text-slate-900 underline underline-offset-2"
            onClick={resetFilters}
          >
            Reset filters
          </button>
        ) : null}
      </div>

      <div className="mt-3">
        {isLoading && workouts.length === 0 ? (
          <SkeletonRows />
        ) : workouts.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 p-6 text-center text-sm text-slate-500">
            <p>No workouts match your filters.</p>
            <button
              className="mt-3 text-sm font-semibold text-slate-900 underline underline-offset-2"
              onClick={resetFilters}
            >
              Reset filters
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {workouts.map((workout) => {
              const sessionSnapshotLabel = formatWorkoutSessionSnapshotLabel(
                workout.sessionSnapshot
              );

              return (
                <div
                  key={workout.id}
                  className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 p-5"
                >
                  <div>
                    <p className="text-sm font-semibold">
                      {getWorkoutListPrimaryLabel(workout)}
                      {sessionSnapshotLabel ? (
                        <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">
                          {sessionSnapshotLabel}
                        </span>
                      ) : null}
                      {workout.isSupplementalDeficitSession ? (
                        <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">
                          Supplemental
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {new Date(workout.scheduledDate).toLocaleDateString()} |{" "}
                      {formatWorkoutListExerciseLabel(workout.exerciseCount)} |{" "}
                      {formatWorkoutListLoggedSetsLabel(workout.totalSetsLogged)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${getWorkoutListStatusClasses(workout.status)}`}
                    >
                      {getWorkoutListStatusLabel(workout.status)}
                    </span>
                    <WorkoutRowActions workout={workout} />
                    <DeleteWorkoutButton
                      workoutId={workout.id}
                      onDeleted={() => handleDeleted(workout.id)}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {nextCursor ? (
        <div className="mt-6 flex justify-center">
          <button
            className="inline-flex min-h-11 items-center justify-center rounded-full border border-slate-300 px-6 py-2 text-sm font-semibold text-slate-900 transition-colors hover:bg-slate-50 disabled:opacity-50"
            onClick={loadMore}
            disabled={isLoading}
          >
            {isLoading ? "Loading..." : "Load more"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
