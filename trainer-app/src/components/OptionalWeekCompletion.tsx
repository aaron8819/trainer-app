"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { GapFillSupportData } from "@/lib/api/program";
import type { SaveWorkoutRequestPayload } from "@/components/log-workout/api";
import type { GenerateFromIntentResponse } from "@/lib/api/template-session/types";
import {
  attachOptionalGapFillMetadata,
  buildCanonicalSelectionMetadata,
} from "@/lib/ui/selection-metadata";

export type OptionalWeekCustomSession = {
  status: string;
  statusLabel: string;
  actionHref: string;
  workoutId: string | null;
};

type OptionalWeekCompletionProps = {
  activeWeek: number | null;
  gapFill?: GapFillSupportData | null;
  customSession?: OptionalWeekCustomSession | null;
};

function formatDeficitCount(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function buildDeficitSummary(gapFill: GapFillSupportData | null | undefined): string | null {
  if (!gapFill?.visible) {
    return null;
  }

  if (gapFill.deficitSummary.length > 0) {
    const summary = gapFill.deficitSummary
      .slice(0, 3)
      .map((row) => `${row.muscle} ${formatDeficitCount(row.deficit)} sets`)
      .join(", ");
    const remainingCount = Math.max(0, gapFill.deficitSummary.length - 3);
    return remainingCount > 0 ? `${summary}, +${remainingCount} more` : summary;
  }

  if (gapFill.remainingDeficitSets > 0) {
    return `${formatDeficitCount(gapFill.remainingDeficitSets)} remaining sets`;
  }

  return "No remaining deficits are currently reported.";
}

function buildRecommendedDetail(gapFill: GapFillSupportData): string {
  if (gapFill.workflowState === "COMPLETED") {
    return "The recommended workflow is complete. Current deficit state may still show remaining work.";
  }

  if (gapFill.deficitState === "PARTIAL") {
    return "Current week data still shows partial remaining deficits.";
  }

  if (gapFill.deficitState === "OPEN") {
    return "Targets the remaining deficits from current week data.";
  }

  return "Uses current week data to guide the optional session.";
}

function buildRecommendedActionLabel(gapFill: GapFillSupportData): string {
  if (!gapFill.linkedWorkout) {
    return "Generate recommended session";
  }

  const status = gapFill.linkedWorkout.status.trim().toUpperCase();
  return status === "COMPLETED" || status === "SKIPPED"
    ? "Review recommended session"
    : "Open recommended session";
}

function buildCustomDetail(customSession: OptionalWeekCustomSession): string {
  const status = customSession.status.trim().toUpperCase();
  if (!customSession.workoutId) {
    return "Create your own optional session for this active week.";
  }

  if (status === "COMPLETED") {
    return "Your custom optional session is recorded for this active week.";
  }

  if (status === "SKIPPED") {
    return "This custom optional session was skipped and stays separate from week progress.";
  }

  return "Manual optional work for this active week. It stays separate from the recommended session.";
}

function buildCustomActionLabel(customSession: OptionalWeekCustomSession): string {
  if (!customSession.workoutId) {
    return "Create custom session";
  }

  const status = customSession.status.trim().toUpperCase();
  return status === "COMPLETED" || status === "SKIPPED"
    ? "Review custom session"
    : "Open custom session";
}

function buildWeekKey(input: OptionalWeekCompletionProps): string {
  const week =
    input.activeWeek ??
    input.gapFill?.targetWeek ??
    input.gapFill?.anchorWeek ??
    "unknown";
  return String(week);
}

export function OptionalWeekCompletion({
  activeWeek,
  gapFill = null,
  customSession = null,
}: OptionalWeekCompletionProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissedWeekKey, setDismissedWeekKey] = useState<string | null>(null);
  const showRecommended = Boolean(
    gapFill?.visible && (gapFill.weekCloseId || gapFill.linkedWorkout)
  );
  const showCustom = Boolean(customSession);

  if (!showRecommended && !showCustom) {
    return null;
  }

  const weekKey = buildWeekKey({ activeWeek, gapFill, customSession });
  const dismissed = dismissedWeekKey === weekKey;

  if (dismissed) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <p className="text-sm text-slate-700">
          Optional week completion hidden for this active week.
        </p>
        <button
          type="button"
          className="mt-3 inline-flex min-h-10 items-center justify-center rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900"
          onClick={() => setDismissedWeekKey(null)}
        >
          Show options
        </button>
      </div>
    );
  }

  const targetWeek = gapFill?.targetWeek ?? gapFill?.anchorWeek ?? activeWeek;
  const canGenerateRecommended =
    gapFill?.eligible === true && gapFill.workflowState === "PENDING_OPTIONAL_GAP_FILL";
  const hasLinkedRecommended = Boolean(gapFill?.linkedWorkout);
  const deficitSummary = buildDeficitSummary(gapFill);

  const handleRecommendedAction = async () => {
    if (!gapFill || targetWeek == null || !gapFill.weekCloseId) {
      return;
    }

    if (gapFill.linkedWorkout) {
      const status = gapFill.linkedWorkout.status.trim().toUpperCase();
      router.push(
        status === "COMPLETED" || status === "SKIPPED"
          ? `/workout/${gapFill.linkedWorkout.id}`
          : `/log/${gapFill.linkedWorkout.id}`
      );
      router.refresh();
      return;
    }

    setLoading(true);
    setError(null);

    const generateResponse = await fetch("/api/workouts/generate-from-intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        intent: "body_part",
        weekCloseId: gapFill.weekCloseId,
        optionalGapFill: true,
      }),
    });
    if (!generateResponse.ok) {
      const body = await generateResponse.json().catch(() => ({}));
      setError(body.error ?? "Failed to generate recommended session.");
      setLoading(false);
      return;
    }

    const generatedBody: GenerateFromIntentResponse = await generateResponse.json();
    const canonicalSelectionMetadata = attachOptionalGapFillMetadata(
      buildCanonicalSelectionMetadata(generatedBody.selectionMetadata),
      {
        enabled: true,
        targetMuscles: gapFill.targetMuscles,
        weekCloseId: gapFill.weekCloseId,
      }
    );
    const workout = generatedBody.workout;

    const payload: SaveWorkoutRequestPayload = {
      workoutId: workout.id,
      action: "save_plan",
      scheduledDate: workout.scheduledDate,
      estimatedMinutes: workout.estimatedMinutes,
      selectionMode: "INTENT",
      sessionIntent: "BODY_PART",
      selectionMetadata: canonicalSelectionMetadata,
      advancesSplit: false,
      mesocycleWeekSnapshot: targetWeek,
      filteredExercises: generatedBody.filteredExercises,
      exercises: [
        ...workout.warmup.map((exercise) => ({ ...exercise, section: "WARMUP" as const })),
        ...workout.mainLifts.map((exercise) => ({ ...exercise, section: "MAIN" as const })),
        ...workout.accessories.map((exercise) => ({ ...exercise, section: "ACCESSORY" as const })),
      ].map((exercise) => ({
        section: exercise.section,
        exerciseId: exercise.exercise.id,
        sets: exercise.sets.map((set) => ({
          setIndex: set.setIndex,
          targetReps: set.targetReps,
          targetRepRange: set.targetRepRange,
          targetRpe: set.targetRpe,
          targetLoad: set.targetLoad,
        })),
      })),
    };

    const saveResponse = await fetch("/api/workouts/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!saveResponse.ok) {
      const body = await saveResponse.json().catch(() => ({}));
      setError(body.error ?? "Failed to save recommended session.");
      setLoading(false);
      return;
    }

    const saveBody = await saveResponse.json().catch(() => ({}));
    const workoutId = saveBody.workoutId ?? workout.id;
    router.push(`/log/${workoutId}`);
    router.refresh();
  };

  return (
    <section className="rounded-2xl border border-amber-200 bg-amber-50/40 p-5">
      <h2 className="text-lg font-semibold text-slate-900">Optional week completion</h2>
      <p className="mt-2 text-sm text-slate-700">
        You can add optional work for this week. The recommended session targets remaining
        deficits. You can also create your own custom session.
      </p>

      {deficitSummary ? (
        <div className="mt-4 rounded-xl border border-amber-200 bg-white/70 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">
            Deficit summary
          </p>
          <p className="mt-1 text-sm text-slate-700">{deficitSummary}</p>
        </div>
      ) : null}

      <div className="mt-4 grid gap-3">
        {showRecommended && gapFill ? (
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">Recommended session</p>
                <p className="mt-1 text-sm text-slate-600">{buildRecommendedDetail(gapFill)}</p>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                Primary
              </span>
            </div>
            {canGenerateRecommended || hasLinkedRecommended ? (
              <button
                type="button"
                className="mt-4 inline-flex min-h-11 items-center justify-center rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white disabled:opacity-60"
                onClick={handleRecommendedAction}
                disabled={loading}
              >
                {loading ? "Generating..." : buildRecommendedActionLabel(gapFill)}
              </button>
            ) : null}
          </div>
        ) : null}

        {customSession ? (
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">Custom session</p>
                <p className="mt-1 text-sm text-slate-600">{buildCustomDetail(customSession)}</p>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                {customSession.statusLabel}
              </span>
            </div>
            <Link
              className="mt-4 inline-flex min-h-11 items-center justify-center rounded-full border border-slate-300 px-5 py-2 text-sm font-semibold text-slate-900"
              href={customSession.actionHref}
              prefetch={false}
            >
              {buildCustomActionLabel(customSession)}
            </Link>
          </div>
        ) : null}
      </div>

      <button
        type="button"
        className="mt-4 inline-flex min-h-10 items-center justify-center rounded-full border border-amber-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900"
        onClick={() => setDismissedWeekKey(weekKey)}
      >
        Hide options
      </button>
      {error ? <p className="mt-2 text-sm text-rose-600">{error}</p> : null}
    </section>
  );
}
