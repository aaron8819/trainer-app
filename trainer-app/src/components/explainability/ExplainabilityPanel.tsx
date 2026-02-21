/**
 * ExplainabilityPanel - Main container for workout explanations
 *
 * Phase 4.6: UI for complete workout explanation
 *
 * Displays:
 * - Session context (block phase, volume, readiness)
 * - Coach messages (warnings, encouragement, milestones, tips)
 * - Per-exercise rationale (selection factors, KB citations)
 * - Per-exercise prescription rationale (sets/reps/load/RIR/rest)
 */

"use client";

import { useState } from "react";
import type { WorkoutExplanation } from "@/lib/engine/explainability";
import { SessionContextCard } from "./SessionContextCard";
import { CoachMessageCard } from "./CoachMessageCard";
import { ExerciseRationaleCard } from "./ExerciseRationaleCard";
import { FilteredExercisesCard } from "./FilteredExercisesCard";

type Props = {
  explanation: WorkoutExplanation;
  intentLabel?: string;
  deloadSummary?: string | null;
  startLoggingHref?: string | null;
};

export function ExplainabilityPanel({
  explanation,
  intentLabel,
  deloadSummary,
  startLoggingHref,
}: Props) {
  const [expandedExercises, setExpandedExercises] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<"evidence" | "selection">("evidence");

  const toggleExercise = (exerciseId: string) => {
    setExpandedExercises((prev) => {
      const next = new Set(prev);
      if (next.has(exerciseId)) {
        next.delete(exerciseId);
      } else {
        next.add(exerciseId);
      }
      return next;
    });
  };

  // Convert Map to array for rendering
  const exerciseRationales = Array.from(explanation.exerciseRationales.entries());
  const prescriptionRationales = explanation.prescriptionRationales;
  const progressionReceipts = explanation.progressionReceipts;
  const logicMessages = explanation.coachMessages.filter(
    (message) => message.type !== "encouragement" && message.type !== "tip"
  );
  const hasRecentHistory = Array.from(progressionReceipts.values()).some((receipt) => receipt.lastPerformed != null);
  const basisLabel = hasRecentHistory ? "Based on recent performance" : "Based on planned baseline";
  const basisWithCycle =
    explanation.sessionContext.cycleSource === "fallback"
      ? `${basisLabel} (cycle estimated)`
      : basisLabel;
  const evidenceRows = [
    `Cycle rules: ${explanation.sessionContext.cycleSource === "fallback" ? "estimated cycle context" : "computed cycle context"}.`,
    `Deload rule: ${deloadSummary ?? "No active deload."}`,
    "Volume window: Performed sets in a rolling 7-day window (today inclusive).",
    "History recency: Progression receipts use recent performed history only.",
  ];

  return (
    <div className="space-y-4 sm:space-y-6">
      <SessionContextCard
        context={explanation.sessionContext}
        confidence={explanation.confidence}
        intentLabel={intentLabel}
        deloadSummary={deloadSummary}
        basisLabel={basisWithCycle}
        startLoggingHref={startLoggingHref}
      />

      <details className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <summary className="cursor-pointer text-sm font-semibold text-slate-900">Programming Logic</summary>

        <div className="mt-3 space-y-4">
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1 text-xs">
            <button
              className={`rounded px-3 py-1 ${activeTab === "evidence" ? "bg-white text-slate-900" : "text-slate-600"}`}
              onClick={() => setActiveTab("evidence")}
              type="button"
            >
              Evidence
            </button>
            <button
              className={`rounded px-3 py-1 ${activeTab === "selection" ? "bg-white text-slate-900" : "text-slate-600"}`}
              onClick={() => setActiveTab("selection")}
              type="button"
            >
              Selection
            </button>
          </div>

          {activeTab === "evidence" ? (
            <div className="space-y-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Evidence Rules</p>
                <ul className="mt-2 space-y-1 text-xs text-slate-700">
                  {evidenceRows.map((row) => (
                    <li key={row}>- {row}</li>
                  ))}
                </ul>
              </div>
              {logicMessages.length > 0 ? (
                <div className="space-y-3">
                  {logicMessages.map((message, idx) => (
                    <CoachMessageCard key={idx} message={message} />
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="space-y-4">
              {explanation.filteredExercises && explanation.filteredExercises.length > 0 ? (
                <FilteredExercisesCard filteredExercises={explanation.filteredExercises} />
              ) : null}

              {exerciseRationales.length > 0 ? (
                <div className="space-y-3">
                  <h3 className="text-base font-semibold text-slate-900 sm:text-lg">
                    Exercise Selection Details
                  </h3>
                  {exerciseRationales.map(([exerciseId, rationale]) => {
                    const prescription = prescriptionRationales.get(exerciseId);
                    return (
                      <ExerciseRationaleCard
                        key={exerciseId}
                        rationale={rationale}
                        prescription={prescription}
                        progressionReceipt={progressionReceipts.get(exerciseId)}
                        isExpanded={expandedExercises.has(exerciseId)}
                        onToggle={() => toggleExercise(exerciseId)}
                      />
                    );
                  })}
                </div>
              ) : null}
            </div>
          )}
        </div>
      </details>
    </div>
  );
}
