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
  detail: string;
  actionHref: string;
  actionLabel: string;
  actionMethod?: "link" | "post";
  canDismiss?: boolean;
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
  const [creatingCustom, setCreatingCustom] = useState(false);
  const [dismissingWeekClose, setDismissingWeekClose] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissedWeekKey, setDismissedWeekKey] = useState<string | null>(null);
  const showRecommended = Boolean(
    gapFill?.visible && gapFill.actionLabel && gapFill.actionHref
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
  const canCreateRecommended =
    gapFill?.actionMethod === "post" && Boolean(gapFill.actionHref);
  const canOpenRecommended =
    gapFill?.actionMethod === "link" && Boolean(gapFill.actionHref);
  const canDismissPendingWeekClose = Boolean(gapFill?.canDismiss && gapFill.weekCloseId);
  const deficitSummary = buildDeficitSummary(gapFill);
  const canCollapse = Boolean(gapFill?.canDismiss || customSession?.canDismiss);

  const handleRecommendedAction = async () => {
    if (!gapFill || targetWeek == null || !gapFill.weekCloseId) {
      return;
    }

    if (gapFill.linkedWorkout) {
      if (gapFill.actionHref) {
        router.push(gapFill.actionHref);
      }
      router.refresh();
      return;
    }

    setLoading(true);
    setError(null);

    const generateResponse = await fetch(gapFill.actionHref ?? "/api/workouts/generate-from-intent", {
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

  const handleDismissWeekClose = async () => {
    if (!gapFill?.weekCloseId) {
      return;
    }

    setDismissingWeekClose(true);
    setError(null);

    const response = await fetch(`/api/mesocycles/week-close/${gapFill.weekCloseId}/dismiss`, {
      method: "POST",
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body.error ?? "Failed to dismiss optional work.");
      setDismissingWeekClose(false);
      return;
    }

    router.refresh();
    setDismissingWeekClose(false);
  };

  const handleCustomAction = async () => {
    if (!customSession) {
      return;
    }

    setCreatingCustom(true);
    setError(null);

    const response = await fetch(customSession.actionHref, {
      method: "POST",
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body.error ?? "Failed to create optional session.");
      setCreatingCustom(false);
      return;
    }

    const body = await response.json().catch(() => ({}));
    const workoutId = body.workout?.id;
    if (typeof workoutId === "string" && workoutId.length > 0) {
      router.push(`/log/${workoutId}`);
      router.refresh();
      return;
    }

    setError("Optional session was created, but no workout was returned.");
    setCreatingCustom(false);
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
                <p className="mt-1 text-sm text-slate-600">{gapFill.detail}</p>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                Primary
              </span>
            </div>
            {canCreateRecommended ? (
              <button
                type="button"
                className="mt-4 inline-flex min-h-11 items-center justify-center rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white disabled:opacity-60"
                onClick={handleRecommendedAction}
                disabled={loading}
              >
                {loading ? "Working..." : gapFill.actionLabel}
              </button>
            ) : null}
            {canOpenRecommended && gapFill.actionHref ? (
              <Link
                className="mt-4 inline-flex min-h-11 items-center justify-center rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white"
                href={gapFill.actionHref}
              >
                {gapFill.actionLabel}
              </Link>
            ) : null}
            {canDismissPendingWeekClose ? (
              <button
                type="button"
                className="mt-3 inline-flex min-h-11 items-center justify-center rounded-full border border-slate-300 px-5 py-2 text-sm font-semibold text-slate-900 disabled:opacity-60"
                onClick={handleDismissWeekClose}
                disabled={dismissingWeekClose}
              >
                {dismissingWeekClose ? "Dismissing..." : "Dismiss optional work and continue"}
              </button>
            ) : null}
          </div>
        ) : null}

        {customSession ? (
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">Custom session</p>
                <p className="mt-1 text-sm text-slate-600">{customSession.detail}</p>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                {customSession.statusLabel}
              </span>
            </div>
            {customSession.actionMethod === "post" || !customSession.workoutId ? (
              <button
                type="button"
                className="mt-4 inline-flex min-h-11 items-center justify-center rounded-full border border-slate-300 px-5 py-2 text-sm font-semibold text-slate-900 disabled:opacity-60"
                onClick={handleCustomAction}
                disabled={creatingCustom}
              >
                {creatingCustom ? "Creating..." : customSession.actionLabel}
              </button>
            ) : (
              <Link
                className="mt-4 inline-flex min-h-11 items-center justify-center rounded-full border border-slate-300 px-5 py-2 text-sm font-semibold text-slate-900"
                href={customSession.actionHref}
                prefetch={false}
              >
                {customSession.actionLabel}
              </Link>
            )}
          </div>
        ) : null}
      </div>

      {canCollapse ? (
        <button
          type="button"
          className="mt-4 inline-flex min-h-10 items-center justify-center rounded-full border border-amber-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900"
          onClick={() => setDismissedWeekKey(weekKey)}
        >
          Collapse for now
        </button>
      ) : null}
      {error ? <p className="mt-2 text-sm text-rose-600">{error}</p> : null}
    </section>
  );
}
