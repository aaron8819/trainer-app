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
import type { WorkoutExplanation, VolumeComplianceStatus } from "@/lib/engine/explainability";
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

function VolumeComplianceBadge({ status }: { status: VolumeComplianceStatus }) {
  const config: Record<VolumeComplianceStatus, { label: string; className: string }> = {
    OVER_MAV: { label: "Over MAV", className: "bg-red-100 text-red-700" },
    AT_MAV: { label: "At MAV", className: "bg-amber-100 text-amber-700" },
    APPROACHING_MAV: { label: "Near MAV", className: "bg-amber-100 text-amber-700" },
    OVER_TARGET: { label: "On track", className: "bg-emerald-100 text-emerald-700" },
    ON_TARGET: { label: "On target", className: "bg-emerald-100 text-emerald-700" },
    APPROACHING_TARGET: { label: "Building", className: "bg-slate-100 text-slate-500" },
    UNDER_MEV: { label: "↑ needs more", className: "bg-slate-100 text-slate-500" },
  };
  const { label, className } = config[status];
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${className}`}>
      {label}
    </span>
  );
}

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
  const progressionLogicRows = Array.from(progressionReceipts.entries())
    .map(([exerciseId, receipt]) => ({
      exerciseId,
      exerciseName: explanation.exerciseRationales.get(exerciseId)?.exerciseName ?? exerciseId,
      decisionLog: receipt.decisionLog ?? [],
    }))
    .filter((entry) => entry.decisionLog.length > 0);
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
              {progressionLogicRows.length > 0 ? (
                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Progression Logic
                  </p>
                  <div className="mt-2 space-y-3">
                    {progressionLogicRows.map((entry) => (
                      <div key={entry.exerciseId}>
                        <p className="text-xs font-semibold text-slate-700">{entry.exerciseName}</p>
                        <ol className="mt-1 list-decimal pl-4 text-xs text-slate-600">
                          {entry.decisionLog.map((line, index) => (
                            <li key={`${entry.exerciseId}-${index}`}>{line}</li>
                          ))}
                        </ol>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              {explanation.volumeCompliance.length > 0 ? (
                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Volume Check
                  </p>
                  <div className="mt-2 space-y-2">
                    {explanation.volumeCompliance.map((row) => (
                      <div key={row.muscle} className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-slate-700 min-w-0 flex-1">
                          {row.muscle}
                        </span>
                        <span className="text-xs text-slate-500 whitespace-nowrap">
                          {row.setsLoggedBeforeSession} + {row.setsPrescribedThisSession}{" "}
                          → {row.projectedTotal} / {row.weeklyTarget} sets
                        </span>
                        <VolumeComplianceBadge status={row.status} />
                      </div>
                    ))}
                  </div>
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
