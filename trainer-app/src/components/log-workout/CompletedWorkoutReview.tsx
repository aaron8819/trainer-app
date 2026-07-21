"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PostSessionReviewCard } from "@/components/post-workout/PostSessionReviewCard";
import { classifySetLog } from "@/lib/session-semantics/set-classification";
import { isDumbbellEquipment, toDisplayLoad } from "@/lib/ui/load-display";
import { formatRepPrescriptionInline } from "@/lib/ui/rep-target-display";
import { evaluateTargetReps } from "@/lib/session-semantics/target-evaluation";
import type { PostSessionReviewDisplayDto } from "@/lib/api/post-session-review-display";
import {
  RUNTIME_ADDED_EXERCISE_BADGE_LABEL,
  SWAPPED_EXERCISE_BADGE_LABEL,
} from "@/lib/ui/selection-metadata";
import type { CompletedWorkoutExerciseSummary } from "@/components/log-workout/types";

function formatRepTarget(
  targetReps: number,
  targetRepRange: { min: number; max: number } | undefined,
  showAim: boolean
): string {
  return formatRepPrescriptionInline({ targetReps, targetRepRange }, { showAim });
}

type CompletedWorkoutReviewProps = {
  workoutId: string;
  performanceSummary: CompletedWorkoutExerciseSummary[];
};

export function CompletedWorkoutReview({
  workoutId,
  performanceSummary,
}: CompletedWorkoutReviewProps) {
  const [postSessionReview, setPostSessionReview] =
    useState<PostSessionReviewDisplayDto | null>(null);
  const [isLoadingPostSessionReview, setIsLoadingPostSessionReview] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function fetchPostSessionReview() {
      setIsLoadingPostSessionReview(true);
      setPostSessionReview(null);
      try {
        const response = await fetch(`/api/workouts/${workoutId}/post-session-review`, {
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error("Failed to load post-session review");
        }
        const data: { postSessionReview?: PostSessionReviewDisplayDto | null } =
          await response.json();
        if (mounted) {
          setPostSessionReview(data.postSessionReview ?? null);
        }
      } catch {
        if (mounted) {
          setPostSessionReview(null);
        }
      } finally {
        if (mounted) {
          setIsLoadingPostSessionReview(false);
        }
      }
    }

    void fetchPostSessionReview();

    return () => {
      mounted = false;
    };
  }, [workoutId]);

  return (
    <div className="space-y-5 sm:space-y-6">
      {isLoadingPostSessionReview ? (
        <section
          aria-label="Post-session review loading"
          className="min-h-[112px] rounded-2xl border border-slate-200 bg-white p-4 sm:p-5"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Post-session review
          </p>
          <h2 className="mt-1 text-base font-semibold text-slate-900">
            Preparing your post-session review...
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Checking completed work, load calibration, and next-exposure notes.
          </p>
        </section>
      ) : postSessionReview ? (
        <PostSessionReviewCard review={postSessionReview} />
      ) : (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          The saved review could not be loaded. Open the full review and audit before acting on this session.
        </section>
      )}

      {performanceSummary.length > 0 ? (
        <details className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
          <summary className="cursor-pointer text-sm font-semibold text-slate-700">
            Detailed set log
          </summary>
          <div className="mt-4 space-y-3">
            {performanceSummary.map((exercise) => {
            const isDumbbell = isDumbbellEquipment(exercise.equipment);
            return (
              <div
                key={exercise.exerciseId}
                className="rounded-2xl border border-slate-200 bg-white p-4"
              >
                <div className="flex items-center gap-2">
                  <p className="font-medium text-slate-900">{exercise.name}</p>
                  {exercise.isSwapped ? (
                    <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-700">
                      {SWAPPED_EXERCISE_BADGE_LABEL}
                    </span>
                  ) : exercise.isRuntimeAdded ? (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                      {RUNTIME_ADDED_EXERCISE_BADGE_LABEL}
                    </span>
                  ) : null}
                </div>
                {exercise.sessionNote ? (
                  <p className="mt-1 text-xs text-sky-700">{exercise.sessionNote}</p>
                ) : null}
                <div className="mt-3 space-y-2">
                  {exercise.sets.map((set) => {
                    const classification = classifySetLog({
                      actualReps: set.actualReps,
                      actualLoad: set.actualLoad,
                      actualRpe: set.actualRpe,
                      setIntent: set.setIntent,
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
                      formatRepTarget(set.targetReps, set.targetRepRange, exercise.isMainLift),
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
                            {set.setIntent === "WARMUP" ? (
                              <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                                Warmup/ramp
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
          </div>
        </details>
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
