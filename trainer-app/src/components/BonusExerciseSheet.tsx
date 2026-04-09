"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SlideUpSheet } from "@/components/ui/SlideUpSheet";
import type { LogExerciseInput } from "@/components/log-workout/types";
import type { BonusSuggestion } from "@/lib/api/bonus-suggestions";
import type { RuntimeAddedExercisePreview } from "@/lib/api/runtime-added-exercise-preview";
import type { ExerciseSearchResult } from "@/lib/exercise-library/search";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  workoutId: string;
  onAdd: (exercise: LogExerciseInput) => void;
};

export function BonusExerciseSheet({ isOpen, onClose, workoutId, onAdd }: Props) {
  const [suggestions, setSuggestions] = useState<BonusSuggestion[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ExerciseSearchResult[]>([]);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [previewByExerciseId, setPreviewByExerciseId] = useState<Record<string, RuntimeAddedExercisePreview>>({});
  const [addingId, setAddingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestedPreviewIdsRef = useRef<Set<string>>(new Set());
  const trimmedSearchQuery = useMemo(() => searchQuery.trim(), [searchQuery]);

  const loadPreviews = useCallback(
    async (exerciseIds: string[]) => {
      const nextExerciseIds = [...new Set(exerciseIds.filter(Boolean))].filter(
        (exerciseId) => !requestedPreviewIdsRef.current.has(exerciseId)
      );
      if (nextExerciseIds.length === 0) {
        return;
      }

      nextExerciseIds.forEach((exerciseId) => requestedPreviewIdsRef.current.add(exerciseId));

      try {
        const res = await fetch(`/api/workouts/${workoutId}/add-exercise-preview`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ exerciseIds: nextExerciseIds }),
        });
        if (!res.ok) {
          return;
        }

        const data = await res.json().catch(() => ({}));
        const previews = Array.isArray(data.previews)
          ? (data.previews as RuntimeAddedExercisePreview[])
          : [];
        if (previews.length === 0) {
          return;
        }

        setPreviewByExerciseId((prev) => ({
          ...prev,
          ...Object.fromEntries(previews.map((preview) => [preview.exerciseId, preview])),
        }));
      } catch {
        // Keep the sheet usable even if preview hydration fails.
      }
    },
    [workoutId]
  );

  function formatRestSeconds(restSeconds: number): string {
    if (restSeconds % 60 === 0) {
      const minutes = restSeconds / 60;
      return `${minutes} min rest`;
    }
    return `${restSeconds} sec rest`;
  }

  function formatPreviewSummary(preview: RuntimeAddedExercisePreview): string {
    const parts = [
      `${preview.setCount} sets`,
      preview.targetRepRange.min === preview.targetRepRange.max
        ? `${preview.targetRepRange.min} reps`
        : `${preview.targetRepRange.min}-${preview.targetRepRange.max} reps`,
      `RPE ${preview.targetRpe}`,
      formatRestSeconds(preview.restSeconds),
    ];
    if (preview.targetLoad != null) {
      parts.push(`Load hint ${preview.targetLoad} lbs`);
    }

    return parts.join(" · ");
  }

  // Fetch the immediate shortlist when the sheet opens. Typed search stays server-backed.
  useEffect(() => {
    if (!isOpen) return;

    setSearchQuery("");
    setSearchResults([]);
    setLoadingSuggestions(true);
    setLoadingSearch(false);
    setError(null);
    setAddingId(null);
    setPreviewByExerciseId({});
    requestedPreviewIdsRef.current = new Set();
    fetch(`/api/workouts/${workoutId}/bonus-suggestions`)
      .then((res) => res.json())
      .then((data: { suggestions?: BonusSuggestion[] }) => {
        const nextSuggestions = data.suggestions ?? [];
        setSuggestions(nextSuggestions);
        void loadPreviews(nextSuggestions.map((suggestion) => suggestion.exerciseId));
      })
      .catch(() => setError("Could not load suggestions"))
      .finally(() => setLoadingSuggestions(false));
  }, [isOpen, workoutId, loadPreviews]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    if (trimmedSearchQuery.length < 2) {
      setSearchResults([]);
      setLoadingSearch(false);
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      setLoadingSearch(true);
      setError(null);

      fetch(`/api/exercises/search?q=${encodeURIComponent(trimmedSearchQuery)}&limit=8`, {
        signal: controller.signal,
      })
        .then(async (res) => {
          if (!res.ok) {
            throw new Error("SEARCH_FAILED");
          }

          const data = (await res.json().catch(() => ({}))) as { results?: ExerciseSearchResult[] };
          setSearchResults(Array.isArray(data.results) ? data.results : []);
        })
        .catch((searchError) => {
          if (
            controller.signal.aborted ||
            (searchError instanceof DOMException && searchError.name === "AbortError")
          ) {
            return;
          }

          setSearchResults([]);
          setError("Could not search exercises");
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setLoadingSearch(false);
          }
        });
    }, 150);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [isOpen, trimmedSearchQuery]);

  useEffect(() => {
    if (!isOpen || searchResults.length === 0) {
      return;
    }

    void loadPreviews(searchResults.map((exercise) => exercise.id));
  }, [searchResults, isOpen, loadPreviews]);

  const handleAdd = async (exerciseId: string) => {
    setAddingId(exerciseId);
    setError(null);
    try {
      const res = await fetch(`/api/workouts/${workoutId}/add-exercise`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exerciseId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Failed to add exercise");
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (data.exercise) {
        onAdd(data.exercise as LogExerciseInput);
        onClose();
      }
    } catch {
      setError("Failed to add exercise");
    } finally {
      setAddingId(null);
    }
  };

  return (
    <SlideUpSheet isOpen={isOpen} onClose={onClose} title="Add Exercise">
      <div className="space-y-5 pb-1">
        {/* Recommended section */}
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Recommended for this session
          </p>
          {loadingSuggestions ? (
            <p className="mt-3 text-sm text-slate-500">Finding suggestions...</p>
          ) : suggestions.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">No specific recommendations for this session.</p>
          ) : (
            <div className="mt-3 space-y-2">
              {suggestions.map((suggestion) => (
                <div
                  key={suggestion.exerciseId}
                  className="rounded-xl border border-slate-200 bg-white p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900">{suggestion.exerciseName}</p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {suggestion.primaryMuscles.slice(0, 2).join(", ")}
                        {suggestion.equipment.length > 0
                          ? ` · ${suggestion.equipment[0]}`
                          : ""}
                      </p>
                      <p className="mt-1 text-xs text-amber-700">{suggestion.reason}</p>
                      {previewByExerciseId[suggestion.exerciseId] ? (
                        <p className="mt-0.5 text-xs text-slate-500">
                          Preview: {formatPreviewSummary(previewByExerciseId[suggestion.exerciseId])}
                        </p>
                      ) : null}
                    </div>
                    <button
                      className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full bg-slate-900 px-5 text-sm font-semibold text-white disabled:opacity-60"
                      onClick={() => handleAdd(suggestion.exerciseId)}
                      disabled={addingId !== null}
                      type="button"
                    >
                      {addingId === suggestion.exerciseId ? "Adding..." : "Add"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Search section */}
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Browse all exercises
          </p>
          <input
            className="mt-3 min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
            type="search"
            placeholder="Search by name, alias, muscle, or equipment..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
            enterKeyHint="search"
            spellCheck={false}
          />
          {trimmedSearchQuery.length === 1 ? (
            <p className="mt-3 text-sm text-slate-500">Type at least 2 letters to search.</p>
          ) : loadingSearch ? (
            <p className="mt-3 text-sm text-slate-500">Searching exercises...</p>
          ) : searchResults.length > 0 ? (
            <div className="mt-3 space-y-2">
              {searchResults.map((exercise) => (
                <div
                  key={exercise.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900">{exercise.name}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {(exercise.primaryMuscles ?? []).slice(0, 2).join(", ")}
                    </p>
                    {previewByExerciseId[exercise.id] ? (
                      <p className="mt-1 text-xs text-slate-500">
                        Preview: {formatPreviewSummary(previewByExerciseId[exercise.id])}
                      </p>
                    ) : null}
                  </div>
                  <button
                    className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full bg-slate-900 px-5 text-sm font-semibold text-white disabled:opacity-60"
                    onClick={() => handleAdd(exercise.id)}
                    disabled={addingId !== null}
                    type="button"
                  >
                    {addingId === exercise.id ? "Adding..." : "Add"}
                  </button>
                </div>
              ))}
            </div>
          ) : trimmedSearchQuery.length >= 2 ? (
            <p className="mt-3 text-sm text-slate-500">No exercises found.</p>
          ) : null}
        </div>

        {error ? <p className="text-sm text-rose-600">{error}</p> : null}
      </div>
    </SlideUpSheet>
  );
}
