"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PostWorkoutInsights } from "@/components/post-workout/PostWorkoutInsights";
import { classifySetLog } from "@/lib/session-semantics/set-classification";
import { isDumbbellEquipment, toDisplayLoad } from "@/lib/ui/load-display";
import { evaluateTargetReps } from "@/lib/session-semantics/target-evaluation";
import { hydrateWorkoutExplanation, type WorkoutExplanationResponse } from "@/lib/ui/workout-explanation-response";
import type { WorkoutExplanation } from "@/lib/engine/explainability";
import type {
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
  workoutId: string;
  totalSets: number;
  loggedCount: number;
  rpeAdherence: RpeAdherenceSummary | null;
  performanceSummary: CompletedWorkoutExerciseSummary[];
  sessionIdentityLabel?: string | null;
  sessionTechnicalLabel?: string | null;
};

export function CompletedWorkoutReview({
  workoutId,
  totalSets,
  loggedCount,
  rpeAdherence,
  performanceSummary,
  sessionIdentityLabel,
  sessionTechnicalLabel,
}: CompletedWorkoutReviewProps) {
  const [explanation, setExplanation] = useState<WorkoutExplanation | null>(null);
  const [isLoadingExplanation, setIsLoadingExplanation] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function fetchExplanation() {
      try {
        const response = await fetch(`/api/workouts/${workoutId}/explanation`);
        if (!response.ok) {
          throw new Error("Failed to load post-workout explanation");
        }
        const data: WorkoutExplanationResponse = await response.json();
        if (mounted) {
          setExplanation(hydrateWorkoutExplanation(data));
        }
      } catch {
        if (mounted) {
          setExplanation(null);
        }
      } finally {
        if (mounted) {
          setIsLoadingExplanation(false);
        }
      }
    }

    void fetchExplanation();

    return () => {
      mounted = false;
    };
  }, [workoutId]);

  return (
    <div className="space-y-5 sm:space-y-6">
      <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 sm:p-5">
        <p className="font-semibold text-emerald-900">Session complete!</p>
        <p className="mt-1 text-sm text-emerald-800">
          Your sets are saved. Here&apos;s the short read on what today means.
        </p>
        {sessionIdentityLabel ? (
          <p className="mt-2 text-sm text-emerald-800">
            {sessionIdentityLabel}
            {sessionTechnicalLabel ? ` | ${sessionTechnicalLabel}` : ""}
          </p>
        ) : null}
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

      {isLoadingExplanation ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
          <p className="text-sm text-slate-600">Building your post-workout summary...</p>
        </section>
      ) : explanation ? (
        <PostWorkoutInsights
          explanation={explanation}
          exercises={performanceSummary.map((exercise) => ({
            exerciseId: exercise.exerciseId,
            exerciseName: exercise.name,
            isMainLift: exercise.isMainLift,
          }))}
        />
      ) : null}

      {performanceSummary.length > 0 ? (
        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Detailed set log</h2>
            <p className="mt-1 text-sm text-slate-600">
              Raw set-by-set results, kept separate from the progression takeaways above.
            </p>
          </div>
          {performanceSummary.map((exercise) => {
            const isDumbbell = isDumbbellEquipment(exercise.equipment);
            return (
              <div
                key={exercise.exerciseId}
                className="rounded-2xl border border-slate-200 bg-white p-4"
              >
                <p className="font-medium text-slate-900">{exercise.name}</p>
                <div className="mt-3 space-y-2">
                  {exercise.sets.map((set) => {
                    const classification = classifySetLog({
                      actualReps: set.actualReps,
                      actualLoad: set.actualLoad,
                      actualRpe: set.actualRpe,
                      wasSkipped: set.wasSkipped,
                    });
                    const repEvaluation = evaluateTargetReps({
                      actualReps: set.actualReps,
                      targetReps: set.targetReps,
                      targetRepRange: set.targetRepRange,
                    });
                    const actualColor = !set.wasLogged
                      ? "text-slate-400"
                      : classification.isSkipped
                      ? "text-slate-500"
                      : repEvaluation.kind === "in_range" || repEvaluation.kind === "above"
                      ? "text-emerald-700"
                      : repEvaluation.kind === "below" && repEvaluation.deviation === -1
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
                      : classification.isSkipped
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
                        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs">
                          <span className="flex items-center gap-2 font-medium text-slate-700">
                            <span>Set {set.setIndex}</span>
                            {set.isRuntimeAdded ? (
                              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                                Extra set
                              </span>
                            ) : null}
                          </span>
                          <span className="min-w-0 text-slate-500">{targetLabel}</span>
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

      <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <p className="font-semibold text-slate-900">What&apos;s next</p>
        <p className="mt-2 text-sm text-slate-600">
          See the full workout review for the original workout structure, deeper exercise detail, and fuller session context. When you&apos;re ready, generate the next workout and log a same-day readiness check-in first.
        </p>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <Link
            className="inline-flex min-h-11 items-center justify-center rounded-full border border-slate-300 px-5 text-sm font-semibold text-slate-700"
            href={`/workout/${workoutId}`}
          >
            View full review
          </Link>
          <Link
            className="inline-flex min-h-11 items-center justify-center rounded-full bg-slate-900 px-5 text-sm font-semibold text-white"
            href="/"
          >
            Generate next workout
          </Link>
        </div>
      </div>
    </div>
  );
}
