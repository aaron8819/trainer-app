"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LogExerciseInput } from "@/components/log-workout/types";
import { SlideUpSheet } from "@/components/ui/SlideUpSheet";
import type { RuntimeExerciseSwapExercisePayload } from "@/lib/api/runtime-exercise-swap-service";
import { isDumbbellEquipment, toDisplayLoad } from "@/lib/ui/load-display";

type RuntimeExerciseSwapCandidate = {
  exerciseId: string;
  exerciseName: string;
  primaryMuscles: string[];
  equipment: string[];
  reason: string;
};

type Props = {
  isOpen: boolean;
  onClose: () => void;
  workoutId: string;
  exercise: Pick<LogExerciseInput, "workoutExerciseId" | "name"> | null;
  onSwap: (exercise: LogExerciseInput) => void;
};

type SwapPreviewState =
  | { status: "loading" }
  | { status: "ready"; preview: RuntimeExerciseSwapExercisePayload }
  | { status: "error"; error: string };

export function RuntimeExerciseSwapSheet({
  isOpen,
  onClose,
  workoutId,
  exercise,
  onSwap,
}: Props) {
  const [candidates, setCandidates] = useState<RuntimeExerciseSwapCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [swappingId, setSwappingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewStateByExerciseId, setPreviewStateByExerciseId] = useState<
    Record<string, SwapPreviewState>
  >({});
  const requestedPreviewIdsRef = useRef<Set<string>>(new Set());
  const previewScopeRef = useRef(0);

  const loadPreview = useCallback(
    async (replacementExerciseId: string, force = false) => {
      if (!exercise) {
        return;
      }

      if (!force && requestedPreviewIdsRef.current.has(replacementExerciseId)) {
        return;
      }

      requestedPreviewIdsRef.current.add(replacementExerciseId);
      const previewScope = previewScopeRef.current;
      setPreviewStateByExerciseId((prev) => ({
        ...prev,
        [replacementExerciseId]: { status: "loading" },
      }));

      try {
        const response = await fetch(
          `/api/workouts/${workoutId}/swap-exercise-preview?workoutExerciseId=${encodeURIComponent(
            exercise.workoutExerciseId
          )}&exerciseId=${encodeURIComponent(replacementExerciseId)}`,
          {
            cache: "no-store",
          }
        );
        const body = await response.json().catch(() => ({}));
        if (!response.ok || !body.exercise) {
          throw new Error(body.error ?? "Failed to load swap preview.");
        }
        if (previewScopeRef.current !== previewScope) {
          return;
        }

        setPreviewStateByExerciseId((prev) => ({
          ...prev,
          [replacementExerciseId]: {
            status: "ready",
            preview: body.exercise as RuntimeExerciseSwapExercisePayload,
          },
        }));
      } catch (previewError) {
        if (previewScopeRef.current !== previewScope) {
          return;
        }

        setPreviewStateByExerciseId((prev) => ({
          ...prev,
          [replacementExerciseId]: {
            status: "error",
            error:
              previewError instanceof Error
                ? previewError.message
                : "Failed to load swap preview.",
          },
        }));
      }
    },
    [exercise, workoutId]
  );

  function formatRest(restSeconds: number | null | undefined): string {
    if (restSeconds == null) {
      return "Rest as written";
    }
    if (restSeconds % 60 === 0) {
      return `${restSeconds / 60} min rest`;
    }
    return `${restSeconds} sec rest`;
  }

  function formatRepTarget(
    targetReps: number,
    targetRepRange: { min: number; max: number } | undefined
  ): string {
    if (!targetRepRange) {
      return `${targetReps} reps`;
    }
    if (targetRepRange.min === targetRepRange.max) {
      return `${targetRepRange.min} reps`;
    }
    return `${targetReps} reps (${targetRepRange.min}-${targetRepRange.max})`;
  }

  function formatLoadHint(targetLoad: number | null, equipment: string[] | undefined): string {
    if (targetLoad == null) {
      return "No load hint";
    }

    const isDumbbell = isDumbbellEquipment(equipment);
    const displayLoad = toDisplayLoad(targetLoad, isDumbbell);
    return `Load hint ${displayLoad} lbs${isDumbbell ? " each" : ""}`;
  }

  useEffect(() => {
    if (!isOpen || !exercise) {
      return;
    }

    setLoading(true);
    setError(null);
    setCandidates([]);
    setPreviewStateByExerciseId({});
    previewScopeRef.current += 1;
    requestedPreviewIdsRef.current = new Set();

    fetch(
      `/api/workouts/${workoutId}/swap-exercise?workoutExerciseId=${encodeURIComponent(
        exercise.workoutExerciseId
      )}`,
      {
        cache: "no-store",
      }
    )
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(body.error ?? "Failed to load swap candidates.");
        }
        setCandidates(body.candidates ?? []);
      })
      .catch((fetchError: unknown) => {
        setError(fetchError instanceof Error ? fetchError.message : "Failed to load swap candidates.");
      })
      .finally(() => setLoading(false));
  }, [exercise, isOpen, workoutId]);

  useEffect(() => {
    if (!isOpen || !exercise || candidates.length === 0) {
      return;
    }

    candidates.forEach((candidate) => {
      void loadPreview(candidate.exerciseId);
    });
  }, [candidates, exercise, isOpen, loadPreview]);

  const handleSwap = async (replacementExerciseId: string) => {
    if (!exercise) {
      return;
    }
    if (previewStateByExerciseId[replacementExerciseId]?.status !== "ready") {
      return;
    }

    setSwappingId(replacementExerciseId);
    setError(null);

    try {
      const response = await fetch(`/api/workouts/${workoutId}/swap-exercise`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutExerciseId: exercise.workoutExerciseId,
          replacementExerciseId,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error ?? "Failed to swap exercise.");
      }
      if (body.exercise) {
        onSwap(body.exercise as LogExerciseInput);
        onClose();
      }
    } catch (swapError) {
      setError(swapError instanceof Error ? swapError.message : "Failed to swap exercise.");
    } finally {
      setSwappingId(null);
    }
  };

  return (
    <SlideUpSheet
      isOpen={isOpen}
      onClose={onClose}
      title={exercise ? `Swap ${exercise.name}` : "Swap exercise"}
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
          Narrow runtime swap. This keeps the planned slot, replaces the exercise in-place for this
          session, and keeps future progression exercise-specific to the replacement.
        </div>

        {loading ? <p className="text-sm text-slate-500">Finding constrained equivalents...</p> : null}

        {!loading && candidates.length === 0 ? (
          <p className="text-sm text-slate-500">No safe swap candidates were found for this exercise.</p>
        ) : null}

        {candidates.map((candidate) => {
          const previewState = previewStateByExerciseId[candidate.exerciseId];
          const preview = previewState?.status === "ready" ? previewState.preview : null;
          const confirmDisabled = swappingId !== null || previewState?.status !== "ready";

          return (
            <div
              key={candidate.exerciseId}
              className="rounded-xl border border-slate-200 bg-white p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-slate-900">{candidate.exerciseName}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {candidate.primaryMuscles.slice(0, 2).join(", ")}
                    {candidate.equipment.length > 0 ? ` | ${candidate.equipment[0]}` : ""}
                  </p>
                  <p className="mt-1 text-xs text-amber-700">{candidate.reason}</p>

                  {previewState?.status === "loading" ? (
                    <p className="mt-2 text-xs text-slate-500">
                      Loading exact post-swap prescription...
                    </p>
                  ) : null}

                  {preview ? (
                    <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Post-swap prescription
                      </p>
                      <div className="mt-2 space-y-1 text-xs text-slate-700">
                        {preview.sets.map((set) => (
                          <p key={set.setId}>
                            {`Set ${set.setIndex}: ${formatRepTarget(
                              set.targetReps,
                              set.targetRepRange
                            )} | ${formatLoadHint(
                              set.targetLoad,
                              preview.equipment
                            )} | Target RPE ${set.targetRpe ?? "as written"} | ${formatRest(
                              set.restSeconds
                            )}`}
                          </p>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {previewState?.status === "error" ? (
                    <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                      <p>Preview unavailable. Confirm is disabled until the exact prescription loads.</p>
                      <p className="mt-1">{previewState.error}</p>
                      <button
                        className="mt-2 font-semibold underline"
                        onClick={() => void loadPreview(candidate.exerciseId, true)}
                        type="button"
                      >
                        Retry preview
                      </button>
                    </div>
                  ) : null}
                </div>
                <button
                  className="inline-flex min-h-9 shrink-0 items-center justify-center rounded-full bg-slate-900 px-4 text-xs font-semibold text-white disabled:opacity-60"
                  disabled={confirmDisabled}
                  onClick={() => void handleSwap(candidate.exerciseId)}
                  type="button"
                >
                  {swappingId === candidate.exerciseId
                    ? "Swapping..."
                    : previewState?.status === "loading"
                      ? "Loading preview..."
                      : previewState?.status === "error"
                        ? "Preview required"
                        : "Use swap"}
                </button>
              </div>
            </div>
          );
        })}

        {error ? <p className="text-sm text-rose-600">{error}</p> : null}
      </div>
    </SlideUpSheet>
  );
}
