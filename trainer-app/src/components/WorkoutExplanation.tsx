/**
 * WorkoutExplanation - Client component for workout explanation
 *
 * Phase 4.6: Display workout explanation (server-provided or client-fetched)
 *
 * Replaces legacy "Why this workout was generated" section with
 * structured explainability UI (session context, coach messages,
 * exercise rationale, prescription rationale)
 *
 * If explanation prop is provided (server-side), uses it directly.
 * Otherwise falls back to client-side fetch (for backward compatibility).
 */

"use client";

import { useEffect, useState } from "react";
import type { WorkoutExplanation } from "@/lib/engine/explainability";
import { ExplainabilityPanel } from "./explainability";

type Props = {
  workoutId: string;
  explanation?: WorkoutExplanation | null;
};

type ExplanationResponse = {
  confidence: WorkoutExplanation["confidence"];
  sessionContext: WorkoutExplanation["sessionContext"];
  coachMessages: WorkoutExplanation["coachMessages"];
  exerciseRationales: Record<string, WorkoutExplanation["exerciseRationales"] extends Map<string, infer T> ? T : never>;
  prescriptionRationales: Record<string, WorkoutExplanation["prescriptionRationales"] extends Map<string, infer T> ? T : never>;
  progressionReceipts: Record<string, WorkoutExplanation["progressionReceipts"] extends Map<string, infer T> ? T : never>;
  filteredExercises?: WorkoutExplanation["filteredExercises"];
};

export function WorkoutExplanation({ workoutId, explanation: serverExplanation }: Props) {
  const [explanation, setExplanation] = useState<WorkoutExplanation | null>(serverExplanation ?? null);
  const [isLoading, setIsLoading] = useState(!serverExplanation);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // If server provided explanation, no need to fetch
    if (serverExplanation) {
      setExplanation(serverExplanation);
      setIsLoading(false);
      return;
    }

    // Fallback: client-side fetch for backward compatibility
    let mounted = true;

    async function fetchExplanation() {
      try {
        const response = await fetch(`/api/workouts/${workoutId}/explanation`);
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: "Failed to load explanation" }));
          throw new Error(errorData.error || "Failed to load explanation");
        }

        const data: ExplanationResponse = await response.json();

        // Convert Record to Map for component consumption
        const workoutExplanation: WorkoutExplanation = {
          confidence: data.confidence,
          sessionContext: data.sessionContext,
          coachMessages: data.coachMessages,
          exerciseRationales: new Map(Object.entries(data.exerciseRationales)),
          prescriptionRationales: new Map(Object.entries(data.prescriptionRationales)),
          progressionReceipts: new Map(Object.entries(data.progressionReceipts ?? {})),
          filteredExercises: data.filteredExercises,
        };

        if (mounted) {
          setExplanation(workoutExplanation);
          setIsLoading(false);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : "Failed to load explanation");
          setIsLoading(false);
        }
      }
    }

    fetchExplanation();

    return () => {
      mounted = false;
    };
  }, [workoutId, serverExplanation]);

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-4 text-center text-sm sm:p-5">
        <p className="text-slate-600">Loading workout explanation...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm sm:p-5">
        <p className="font-semibold text-red-900">Failed to load explanation</p>
        <p className="mt-1 text-red-700">{error}</p>
      </div>
    );
  }

  if (!explanation) {
    return null;
  }

  return <ExplainabilityPanel explanation={explanation} />;
}
