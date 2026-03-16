"use client";

import { useEffect, useState } from "react";
import type { LogExerciseInput } from "@/components/log-workout/types";
import { SlideUpSheet } from "@/components/ui/SlideUpSheet";

type GapFillSwapCandidate = {
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

export function GapFillExerciseSwapSheet({
  isOpen,
  onClose,
  workoutId,
  exercise,
  onSwap,
}: Props) {
  const [candidates, setCandidates] = useState<GapFillSwapCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [swappingId, setSwappingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !exercise) {
      return;
    }

    setLoading(true);
    setError(null);
    setCandidates([]);

    fetch(
      `/api/workouts/${workoutId}/swap-exercise?workoutExerciseId=${encodeURIComponent(
        exercise.workoutExerciseId
      )}`
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

  const handleSwap = async (replacementExerciseId: string) => {
    if (!exercise) {
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
          Strict gap-fill only. Swaps are session-local, stay accessory-only, and keep the replacement
          exercise on its own progression history.
        </div>

        {loading ? <p className="text-sm text-slate-500">Finding constrained equivalents...</p> : null}

        {!loading && candidates.length === 0 ? (
          <p className="text-sm text-slate-500">No safe swap candidates were found for this exercise.</p>
        ) : null}

        {candidates.map((candidate) => (
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
              </div>
              <button
                className="inline-flex min-h-9 shrink-0 items-center justify-center rounded-full bg-slate-900 px-4 text-xs font-semibold text-white disabled:opacity-60"
                disabled={swappingId !== null}
                onClick={() => void handleSwap(candidate.exerciseId)}
                type="button"
              >
                {swappingId === candidate.exerciseId ? "Swapping..." : "Use swap"}
              </button>
            </div>
          </div>
        ))}

        {error ? <p className="text-sm text-rose-600">{error}</p> : null}
      </div>
    </SlideUpSheet>
  );
}
