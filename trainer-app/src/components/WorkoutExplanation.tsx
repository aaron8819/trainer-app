"use client";

import { useEffect, useState } from "react";
import type { WorkoutExplanation } from "@/lib/engine/explainability";
import type { SessionDecisionReceipt } from "@/lib/evidence/types";
import { buildSessionSummaryModel } from "@/lib/ui/session-summary";
import {
  hydrateWorkoutExplanation,
  type WorkoutExplanationResponse,
} from "@/lib/ui/workout-explanation-response";
import { ExplainabilityPanel } from "./explainability";

type Props = {
  workoutId: string;
  explanation?: WorkoutExplanation | null;
  sessionDecisionReceipt?: SessionDecisionReceipt;
  sessionIntent?: string | null;
  estimatedMinutes?: number | null;
  startLoggingHref?: string | null;
};

export function WorkoutExplanation({
  workoutId,
  explanation: serverExplanation,
  sessionDecisionReceipt,
  sessionIntent,
  estimatedMinutes,
  startLoggingHref,
}: Props) {
  const [explanation, setExplanation] = useState<WorkoutExplanation | null>(serverExplanation ?? null);
  const [isLoading, setIsLoading] = useState(!serverExplanation);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (serverExplanation) {
      setExplanation(serverExplanation);
      setIsLoading(false);
      return;
    }

    let mounted = true;

    async function fetchExplanation() {
      try {
        const response = await fetch(`/api/workouts/${workoutId}/explanation`);
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: "Failed to load audit details" }));
          throw new Error(errorData.error || "Failed to load audit details");
        }

        const data: WorkoutExplanationResponse = await response.json();

        const workoutExplanation = hydrateWorkoutExplanation(data);

        if (mounted) {
          setExplanation(workoutExplanation);
          setIsLoading(false);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : "Failed to load audit details");
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
        <p className="text-slate-600">Loading audit details...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm sm:p-5">
        <p className="font-semibold text-red-900">Failed to load audit details</p>
        <p className="mt-1 text-red-700">{error}</p>
      </div>
    );
  }

  if (!explanation) {
    return null;
  }

  const summary = buildSessionSummaryModel({
    context: explanation.sessionContext,
    receipt: sessionDecisionReceipt,
    sessionIntent,
    estimatedMinutes,
  });

  return (
    <ExplainabilityPanel
      explanation={explanation}
      summary={summary}
      sessionDecisionReceipt={sessionDecisionReceipt}
      startLoggingHref={startLoggingHref}
    />
  );
}
