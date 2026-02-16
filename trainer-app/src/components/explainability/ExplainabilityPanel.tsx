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
import type {
  WorkoutExplanation,
  SessionContext,
  CoachMessage,
  ExerciseRationale,
  PrescriptionRationale,
} from "@/lib/engine/explainability";
import { SessionContextCard } from "./SessionContextCard";
import { CoachMessageCard } from "./CoachMessageCard";
import { ExerciseRationaleCard } from "./ExerciseRationaleCard";

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
  const prescriptionRationales = new Map(
    Object.entries(explanation.prescriptionRationales)
  ) as Map<string, PrescriptionRationale>;

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Session Context */}
      <SessionContextCard context={explanation.sessionContext} />

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
                exerciseId={exerciseId}
                rationale={rationale}
                prescription={prescription}
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
