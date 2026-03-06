"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { GapFillSupportData } from "@/lib/api/program";
import { buildCanonicalSelectionMetadata } from "@/lib/ui/selection-metadata";
import type { GenerateFromIntentResponse } from "@/lib/api/template-session/types";
import type { SaveWorkoutRequestPayload } from "@/components/log-workout/api";

type OptionalGapFillCardProps = {
  gapFill: GapFillSupportData;
};

function withOptionalGapFillMarker(
  selectionMetadata: ReturnType<typeof buildCanonicalSelectionMetadata>
) {
  const receipt = selectionMetadata.sessionDecisionReceipt;
  if (!receipt) {
    return selectionMetadata;
  }
  const hasMarker = receipt.exceptions.some((entry) => entry.code === "optional_gap_fill");
  if (hasMarker) {
    return selectionMetadata;
  }
  return {
    ...selectionMetadata,
    sessionDecisionReceipt: {
      ...receipt,
      exceptions: [
        ...receipt.exceptions,
        {
          code: "optional_gap_fill" as const,
          message: "Marked as optional gap-fill session.",
        },
      ],
    },
  };
}

export function OptionalGapFillCard({ gapFill }: OptionalGapFillCardProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const anchorWeek = gapFill.anchorWeek;
  if (!gapFill.eligible || anchorWeek == null) {
    return null;
  }

  const summaryRows = gapFill.deficitSummary.slice(0, 3);
  const targetMuscles = gapFill.targetMuscles.slice(0, 3);

  const handleGenerateGapFill = async () => {
    setLoading(true);
    setError(null);

    const generateResponse = await fetch("/api/workouts/generate-from-intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        intent: "body_part",
        anchorWeek,
        targetMuscles,
        maxGeneratedHardSets: gapFill.policy.maxGeneratedHardSets,
        maxGeneratedExercises: gapFill.policy.maxGeneratedExercises,
        optionalGapFill: true,
      }),
    });
    if (!generateResponse.ok) {
      const body = await generateResponse.json().catch(() => ({}));
      setError(body.error ?? "Failed to generate optional gap-fill.");
      setLoading(false);
      return;
    }

    const generatedBody: GenerateFromIntentResponse = await generateResponse.json();
    const canonicalSelectionMetadata = withOptionalGapFillMarker(
      buildCanonicalSelectionMetadata(generatedBody.selectionMetadata)
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
      mesocycleWeekSnapshot: anchorWeek,
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
      setError(body.error ?? "Failed to save optional gap-fill.");
      setLoading(false);
      return;
    }

    const saveBody = await saveResponse.json().catch(() => ({}));
    const workoutId = saveBody.workoutId ?? workout.id;
    router.push(`/log/${workoutId}`);
    router.refresh();
  };

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50/40 p-5">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-amber-700">
        Optional Gap-Fill
      </h3>
      <p className="mt-2 text-lg font-semibold text-slate-900">Gap-fill for Week {anchorWeek}</p>
      <p className="mt-2 text-sm text-slate-700">
        {summaryRows.length > 0
          ? summaryRows.map((row) => `${row.muscle} (${row.deficit} sets)`).join(", ")
          : "Focus target muscles are available."}
      </p>
      <p className="mt-2 text-xs text-amber-800">
        Starting Week {anchorWeek + 1} will hide this gap-fill.
      </p>
      <button
        type="button"
        className="mt-4 inline-flex min-h-11 items-center justify-center rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white disabled:opacity-60"
        onClick={handleGenerateGapFill}
        disabled={loading}
      >
        {loading ? "Generating..." : "Generate gap-fill"}
      </button>
      {error ? <p className="mt-2 text-sm text-rose-600">{error}</p> : null}
    </div>
  );
}
