"use client";

import { useEffect, useState } from "react";
import type {
  ExerciseExposure,
  ExerciseHistoryRepresentativeSet,
  ExerciseHistoryResult,
} from "@/lib/api/exercise-history";

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatLoad(
  load: number | null,
  loadConvention: ExerciseHistoryResult["comparison"]["loadConvention"]
): string | null {
  if (load == null) {
    return null;
  }
  return `${formatNumber(load)} lb${loadConvention === "per_dumbbell" ? " each" : ""}`;
}

function formatSet(
  set: Pick<ExerciseHistoryRepresentativeSet, "load" | "reps" | "rpe">,
  loadConvention: ExerciseHistoryResult["comparison"]["loadConvention"]
): string {
  const load = formatLoad(set.load, loadConvention);
  return [load ? `${load} × ${set.reps}` : `${set.reps} reps`, set.rpe != null ? `RPE ${set.rpe}` : null]
    .filter(Boolean)
    .join(" · ");
}

function exposureNote(exposure: ExerciseExposure): string | null {
  const notes = [
    exposure.workoutStatus === "PARTIAL" ? "Workout finished partial" : null,
    exposure.skippedSetCount > 0
      ? `${exposure.skippedSetCount} skipped ${exposure.skippedSetCount === 1 ? "set" : "sets"}`
      : null,
    exposure.unloggedSetCount > 0
      ? `${exposure.unloggedSetCount} unlogged ${exposure.unloggedSetCount === 1 ? "set" : "sets"}`
      : null,
    exposure.hasSessionLocalChanges ? "Included session-local changes" : null,
  ].filter((note): note is string => Boolean(note));
  return notes.length > 0 ? notes.join(" · ") : null;
}

export function PersonalHistorySection({ exerciseId }: { exerciseId: string }) {
  const [data, setData] = useState<ExerciseHistoryResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previousExerciseId, setPreviousExerciseId] = useState(exerciseId);

  if (exerciseId !== previousExerciseId) {
    setPreviousExerciseId(exerciseId);
    setData(null);
    setError(null);
    setLoading(true);
  }

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/exercises/${exerciseId}/history?limit=3`)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("History request failed");
        }
        return response.json() as Promise<ExerciseHistoryResult>;
      })
      .then((result) => {
        if (!cancelled) {
          setData(result);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError("Exercise history could not be loaded. Your workout is still safe to continue.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [exerciseId]);

  if (loading) {
    return (
      <div className="space-y-3 animate-pulse" aria-label="Loading exercise history">
        <div className="h-4 w-2/3 rounded bg-slate-200" />
        <div className="h-24 rounded-xl bg-slate-100" />
        <div className="h-20 rounded-xl bg-slate-100" />
      </div>
    );
  }

  if (error) {
    return <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{error}</p>;
  }

  if (!data?.lastExposure) {
    return (
      <div className="space-y-2">
        <p className="text-sm font-medium text-slate-800">No qualifying history yet.</p>
        <p className="text-xs leading-5 text-slate-500">
          Completed work sets from this exact exercise will appear here. Warmups, skipped sets,
          deloads, and untouched prescriptions do not count.
        </p>
      </div>
    );
  }

  const { lastExposure, records, comparison } = data;
  const trend = data.recentExposures.map((exposure) =>
    formatSet(exposure.representativeSet, comparison.loadConvention)
  );
  const lastExposureNote = exposureNote(lastExposure);

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        {data.exercise.equipment.length > 0 ? (
          <p className="text-xs font-medium text-slate-700">
            Equipment: {data.exercise.equipment.join(", ")}
          </p>
        ) : null}
        <p className="text-xs leading-5 text-slate-500">{comparison.note}</p>
      </div>

      <section aria-labelledby="exercise-history-last-exposure" className="space-y-2">
        <div>
          <p
            id="exercise-history-last-exposure"
            className="text-xs font-semibold uppercase tracking-wide text-slate-500"
          >
            Last exposure
          </p>
          <p className="mt-1 text-sm font-semibold text-slate-900">
            {formatDate(lastExposure.date)} · {lastExposure.completedSetCount} completed {lastExposure.completedSetCount === 1 ? "set" : "sets"}
          </p>
        </div>
        <div className="space-y-1 rounded-xl border border-slate-200 bg-slate-50 p-3">
          {lastExposure.sets.map((set) => (
            <div key={`${set.setIndex}:${set.completedAt}`} className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-slate-500">
                Set {set.setIndex}{set.isRuntimeAdded ? " · Extra" : ""}
              </span>
              <span className="text-right font-medium text-slate-800">
                {formatSet(set, comparison.loadConvention)}
              </span>
            </div>
          ))}
        </div>
        {lastExposureNote ? (
          <p className="text-xs leading-5 text-amber-700">{lastExposureNote}</p>
        ) : null}
      </section>

      <section aria-labelledby="exercise-history-records" className="space-y-2">
        <p
          id="exercise-history-records"
          className="text-xs font-semibold uppercase tracking-wide text-slate-500"
        >
          Personal records
        </p>
        {records.bestEstimatedStrength || records.heaviestCompletedLoad || records.highestSessionVolume ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {records.bestEstimatedStrength ? (
              <div className="rounded-xl border border-slate-200 p-3">
                <p className="text-xs text-slate-500">Best estimated strength</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">
                  {formatSet(records.bestEstimatedStrength, comparison.loadConvention)}
                </p>
                <p className="mt-1 text-xs text-slate-600">
                  Estimated 1RM {formatNumber(records.bestEstimatedStrength.estimatedOneRepMax)} lb · {formatDate(records.bestEstimatedStrength.date)}
                </p>
              </div>
            ) : null}
            {records.heaviestCompletedLoad ? (
              <div className="rounded-xl border border-slate-200 p-3">
                <p className="text-xs text-slate-500">Heaviest completed load</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">
                  {formatSet(records.heaviestCompletedLoad, comparison.loadConvention)}
                </p>
                <p className="mt-1 text-xs text-slate-600">
                  {formatDate(records.heaviestCompletedLoad.date)}
                </p>
              </div>
            ) : null}
            {records.highestSessionVolume ? (
              <div className="rounded-xl border border-slate-200 p-3 sm:col-span-2">
                <p className="text-xs text-slate-500">Highest completed session volume</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">
                  {formatNumber(records.highestSessionVolume.volume)} lb-reps
                </p>
                <p className="mt-1 text-xs text-slate-600">
                  {records.highestSessionVolume.completedSetCount} completed sets · {formatDate(records.highestSessionVolume.date)}
                </p>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
            Load-based records are unavailable for this exercise’s current load convention.
          </p>
        )}
      </section>

      <section aria-labelledby="exercise-history-trend" className="space-y-2">
        <p
          id="exercise-history-trend"
          className="text-xs font-semibold uppercase tracking-wide text-slate-500"
        >
          Recent representative sets
        </p>
        <p className="text-sm font-medium leading-6 text-slate-800">{trend.join(" → ")}</p>
        <p className="text-xs leading-5 text-slate-500">
          Each exposure uses its best estimated-strength set (1–15 reps), then heaviest load or most reps when needed. This is logged context, not a progression decision.
        </p>
      </section>
    </div>
  );
}
