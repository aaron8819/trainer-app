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
};

export function ExplainabilityPanel({ explanation }: Props) {
  const [expandedExercises, setExpandedExercises] = useState<Set<string>>(new Set());

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

  return (
    <div className="space-y-4 sm:space-y-6">
      <div
        className={`rounded-xl border px-3 py-2 text-xs ${
          explanation.confidence.level === "high"
            ? "border-emerald-200 bg-emerald-50 text-emerald-800"
            : explanation.confidence.level === "medium"
            ? "border-amber-200 bg-amber-50 text-amber-800"
            : "border-slate-200 bg-slate-50 text-slate-700"
        }`}
      >
        <p className="font-semibold">Explainability confidence: {explanation.confidence.level}</p>
        <p className="mt-1">{explanation.confidence.summary}</p>
        {explanation.confidence.missingSignals.length > 0 ? (
          <p className="mt-1">
            Missing: {explanation.confidence.missingSignals.join(", ")}.
          </p>
        ) : null}
      </div>

      {/* Session Context */}
      <SessionContextCard context={explanation.sessionContext} />

      {/* Filtered Exercises */}
      {explanation.filteredExercises && explanation.filteredExercises.length > 0 && (
        <FilteredExercisesCard filteredExercises={explanation.filteredExercises} />
      )}

      {/* Coach Messages */}
      {explanation.coachMessages.length > 0 && (
        <div className="space-y-3">
          {explanation.coachMessages.map((message, idx) => (
            <CoachMessageCard key={idx} message={message} />
          ))}
        </div>
      )}

      {/* Exercise Explanations */}
      {exerciseRationales.length > 0 && (
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
      )}
    </div>
  );
}
