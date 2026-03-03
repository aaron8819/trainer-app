"use client";

import Link from "next/link";
import { isDumbbellEquipment, toDisplayLoad } from "@/lib/ui/load-display";
import type {
  BaselineUpdateSummary,
  CompletedWorkoutExerciseSummary,
  RpeAdherenceSummary,
} from "@/components/log-workout/types";

function formatRepTarget(
  targetReps: number,
  targetRepRange?: { min: number; max: number }
): string {
  if (targetRepRange && targetRepRange.min !== targetRepRange.max) {
    return `${targetRepRange.min}-${targetRepRange.max} reps`;
  }
  return `${targetReps} reps`;
}

type CompletedWorkoutReviewProps = {
  totalSets: number;
  loggedCount: number;
  rpeAdherence: RpeAdherenceSummary | null;
  performanceSummary: CompletedWorkoutExerciseSummary[];
  baselineSummary: BaselineUpdateSummary | null;
};

export function CompletedWorkoutReview({
  totalSets,
  loggedCount,
  rpeAdherence,
  performanceSummary,
  baselineSummary,
}: CompletedWorkoutReviewProps) {
  return (
    <div className="space-y-5 sm:space-y-6">
      <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 sm:p-5">
        <p className="font-semibold text-emerald-900">Session complete!</p>
        <div className="mt-3 grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-emerald-700">Sets logged</p>
            <p className="text-2xl font-bold text-emerald-900">
              {totalSets > 0 ? Math.round((loggedCount / totalSets) * 100) : 0}%
            </p>
            <p className="text-xs text-emerald-600">
              {loggedCount}/{totalSets} sets
            </p>
          </div>
          {rpeAdherence ? (
            <div>
              <p className="text-xs text-emerald-700">RPE adherence</p>
              <p className="text-2xl font-bold text-emerald-900">
                {Math.round((rpeAdherence.adherent / rpeAdherence.total) * 100)}%
              </p>
              <p className="text-xs text-emerald-600">
                {rpeAdherence.adherent}/{rpeAdherence.total} on target
              </p>
            </div>
          ) : null}
        </div>
      </section>

      {performanceSummary.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Performance</h2>
          {performanceSummary.map((exercise) => {
            const isDumbbell = isDumbbellEquipment(exercise.equipment);
            return (
              <div
                key={`${exercise.section}-${exercise.name}`}
                className="rounded-2xl border border-slate-200 bg-white p-4"
              >
                <p className="font-medium text-slate-900">{exercise.name}</p>
                <div className="mt-3 space-y-2">
                  {exercise.sets.map((set) => {
                    const repDiff = (set.actualReps ?? 0) - (set.targetReps ?? 0);
                    const actualColor = !set.wasLogged
                      ? "text-slate-400"
                      : set.wasSkipped
                      ? "text-slate-500"
                      : repDiff >= 0
                      ? "text-emerald-700"
                      : repDiff === -1
                      ? "text-amber-700"
                      : "text-rose-700";
                    const targetLabel = [
                      formatRepTarget(set.targetReps, set.targetRepRange),
                      set.targetLoad != null
                        ? isDumbbell
                          ? `${toDisplayLoad(set.targetLoad, true)} lbs each`
                          : `${set.targetLoad} lbs`
                        : null,
                      set.targetRpe ? `RPE ${set.targetRpe}` : null,
                    ]
                      .filter(Boolean)
                      .join(" | ");
                    const actualLabel = !set.wasLogged
                      ? "-"
                      : set.wasSkipped
                      ? "Skipped"
                      : [
                          set.actualReps != null ? `${set.actualReps} reps` : null,
                          set.actualLoad != null
                            ? isDumbbell
                              ? `${toDisplayLoad(set.actualLoad, true)} lbs each`
                              : `${set.actualLoad} lbs`
                            : null,
                          set.actualRpe != null ? `RPE ${set.actualRpe}` : null,
                        ]
                          .filter(Boolean)
                          .join(" | ");
                    return (
                      <div key={set.setIndex} className="rounded-lg bg-slate-50 px-3 py-2">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="shrink-0 font-medium text-slate-700">Set {set.setIndex}</span>
                          <span className="text-slate-500">{targetLabel}</span>
                        </div>
                        <div className={`mt-0.5 text-xs font-medium ${actualColor}`}>{actualLabel}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </section>
      ) : null}

      {baselineSummary ? (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
          <p className="font-semibold text-slate-900">Strength updates</p>
          <p className="mt-1 text-sm text-slate-600">
            {baselineSummary.updated > 0
              ? `${baselineSummary.updated} personal record${baselineSummary.updated === 1 ? "" : "s"} set this session.`
              : "No new personal records this session."}
          </p>
          {baselineSummary.items.length > 0 ? (
            <div className="mt-3 space-y-2">
              {baselineSummary.items.map((item) => (
                <div key={`${item.exerciseName}-${item.newTopSetWeight}`} className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                    PR
                  </span>
                  <span className="font-medium text-slate-900">{item.exerciseName}</span>
                  <span className="text-slate-600">
                    {item.previousTopSetWeight ? `${item.previousTopSetWeight} -> ` : ""}
                    {item.newTopSetWeight} lbs x {item.reps}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
          {baselineSummary.skippedItems.length > 0 ? (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-slate-500">
                {baselineSummary.skipped} exercise{baselineSummary.skipped === 1 ? "" : "s"} evaluated, no update
              </summary>
              <div className="mt-2 space-y-1">
                {baselineSummary.skippedItems.map((item) => (
                  <div key={`${item.exerciseName}-${item.reason}`} className="text-xs text-slate-500">
                    {item.exerciseName}: {item.reason}
                  </div>
                ))}
              </div>
            </details>
          ) : null}
        </div>
      ) : null}

      <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <p className="font-semibold text-slate-900">What's next</p>
        <p className="mt-2 text-sm text-slate-600">
          Allow 48-72h before training these muscles again. Log a readiness check-in before your next session.
        </p>
        <Link
          className="mt-4 inline-flex min-h-11 items-center justify-center rounded-full bg-slate-900 px-5 text-sm font-semibold text-white"
          href="/"
        >
          Generate next workout
        </Link>
      </div>
    </div>
  );
}
