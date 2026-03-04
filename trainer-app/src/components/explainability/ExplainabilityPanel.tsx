"use client";

import { useState } from "react";
import type { WorkoutExplanation, VolumeComplianceStatus } from "@/lib/engine/explainability";
import type { SessionSummaryModel } from "@/lib/ui/session-summary";
import type { SessionDecisionReceipt } from "@/lib/evidence/types";
import { SessionContextCard } from "./SessionContextCard";
import { CoachMessageCard } from "./CoachMessageCard";
import { ExerciseRationaleCard } from "./ExerciseRationaleCard";
import { FilteredExercisesCard } from "./FilteredExercisesCard";

type Props = {
  explanation: WorkoutExplanation;
  summary: SessionSummaryModel;
  sessionDecisionReceipt?: SessionDecisionReceipt;
  startLoggingHref?: string | null;
};

function VolumeComplianceBadge({ status }: { status: VolumeComplianceStatus }) {
  const config: Record<VolumeComplianceStatus, { label: string; className: string }> = {
    OVER_MAV: { label: "Over MAV", className: "bg-red-100 text-red-700" },
    AT_MAV: { label: "At MAV", className: "bg-amber-100 text-amber-700" },
    APPROACHING_MAV: { label: "Near MAV", className: "bg-amber-100 text-amber-700" },
    OVER_TARGET: { label: "Over target", className: "bg-emerald-100 text-emerald-700" },
    ON_TARGET: { label: "On target", className: "bg-emerald-100 text-emerald-700" },
    APPROACHING_TARGET: { label: "At MEV", className: "bg-slate-100 text-slate-600" },
    UNDER_MEV: { label: "Below MEV", className: "bg-slate-100 text-slate-600" },
  };
  const { label, className } = config[status];
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${className}`}>
      {label}
    </span>
  );
}

function formatCycleSource(value: WorkoutExplanation["sessionContext"]["cycleSource"]): string {
  return value === "fallback" ? "Cycle timing was approximated from persisted context." : "Cycle timing came from the active plan context.";
}

function formatHistorySource(hasRecentHistory: boolean): string {
  return hasRecentHistory
    ? "Recent performed history was available for progression and load checks."
    : "Recent performed history was limited, so load calls stayed closer to the written plan.";
}

export function ExplainabilityPanel({
  explanation,
  summary,
  sessionDecisionReceipt,
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
      hasHistory: receipt.lastPerformed != null,
    }))
    .filter((entry) => entry.decisionLog.length > 0);
  const plannerDiagnostics = sessionDecisionReceipt?.plannerDiagnostics;
  const plannerMuscleRows = plannerDiagnostics
    ? Object.entries(plannerDiagnostics.muscles).sort((left, right) => left[0].localeCompare(right[0]))
    : [];
  const plannerExerciseRows = plannerDiagnostics
    ? Object.values(plannerDiagnostics.exercises).sort((left, right) =>
        left.exerciseName.localeCompare(right.exerciseName)
      )
    : [];
  const plannerClosureCandidates = plannerDiagnostics?.closure.firstIterationCandidates ?? [];

  const evidenceChecklist = [
    {
      label: "Evidence quality",
      value: explanation.confidence.summary,
      tone:
        explanation.confidence.level === "high"
          ? "border-emerald-200 bg-emerald-50"
          : explanation.confidence.level === "medium"
          ? "border-amber-200 bg-amber-50"
          : "border-rose-200 bg-rose-50",
    },
    {
      label: "Cycle context",
      value: formatCycleSource(explanation.sessionContext.cycleSource),
      tone: "border-slate-200 bg-slate-50",
    },
    {
      label: "Progression evidence",
      value: formatHistorySource(hasRecentHistory),
      tone: "border-slate-200 bg-slate-50",
    },
    {
      label: "Volume view",
      value: "Volume checks use weighted effective volume from the shared stimulus model, not binary primary or secondary set credit.",
      tone: "border-slate-200 bg-slate-50",
    },
  ];

  return (
    <div className="space-y-4 sm:space-y-6">
      <SessionContextCard summary={summary} startLoggingHref={startLoggingHref} />

      <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Audit guide</p>
            <h2 className="mt-1 text-lg font-semibold text-slate-900">Session-level scan</h2>
            <p className="mt-1 text-sm text-slate-600">
              Start here to see which inputs were present, which ones were approximated, and where to drill deeper.
            </p>
          </div>

          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1 text-xs">
            <button
              className={`rounded px-3 py-1 ${activeTab === "evidence" ? "bg-white text-slate-900" : "text-slate-600"}`}
              onClick={() => setActiveTab("evidence")}
              type="button"
            >
              Session scan
            </button>
            <button
              className={`rounded px-3 py-1 ${activeTab === "selection" ? "bg-white text-slate-900" : "text-slate-600"}`}
              onClick={() => setActiveTab("selection")}
              type="button"
            >
              Exercise drill-down
            </button>
          </div>
        </div>

        {activeTab === "evidence" ? (
          <div className="mt-4 space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              {evidenceChecklist.map((item) => (
                <div key={item.label} className={`rounded-xl border p-3 ${item.tone}`}>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{item.label}</p>
                  <p className="mt-1 text-sm text-slate-700">{item.value}</p>
                </div>
              ))}
            </div>

            {explanation.confidence.missingSignals.length > 0 ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">Missing or weak signals</p>
                <ul className="mt-2 space-y-1 text-sm text-amber-900">
                  {explanation.confidence.missingSignals.map((signal) => (
                    <li key={signal}>- {signal}</li>
                  ))}
                </ul>
              </div>
            ) : null}

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
                  Exercise decision trace
                </p>
                <div className="mt-3 space-y-3">
                  {progressionLogicRows.map((entry) => (
                    <div key={entry.exerciseId} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-sm font-semibold text-slate-800">{entry.exerciseName}</p>
                        <p className="text-xs text-slate-500">
                          {entry.hasHistory ? "Uses recent performed history" : "No recent performed anchor"}
                        </p>
                      </div>
                      <ol className="mt-2 list-decimal pl-4 text-sm text-slate-600">
                        {entry.decisionLog.map((line, index) => (
                          <li key={`${entry.exerciseId}-${index}`}>{line}</li>
                        ))}
                      </ol>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {plannerDiagnostics ? (
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Planner diagnostics
                </p>
                <div className="mt-3 space-y-3">
                  {plannerMuscleRows.length > 0 ? (
                    <div className="space-y-2">
                      {plannerMuscleRows.map(([muscle, diagnostic]) => (
                        <div key={muscle} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium text-slate-800">{muscle}</span>
                            <span className="text-xs text-slate-500">
                              target {diagnostic.weeklyTarget.toFixed(1)}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-slate-600">
                            performed {diagnostic.performedEffectiveVolumeBeforeSession.toFixed(1)} |
                            post-role planned {diagnostic.plannedEffectiveVolumeAfterRoleBudgeting.toFixed(1)} |
                            post-closure planned {diagnostic.plannedEffectiveVolumeAfterClosure.toFixed(1)} |
                            remaining deficit {diagnostic.finalRemainingDeficit.toFixed(1)}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {plannerExerciseRows.length > 0 ? (
                    <div className="space-y-2">
                      {plannerExerciseRows.map((diagnostic) => (
                        <div
                          key={diagnostic.exerciseId}
                          className="rounded-lg border border-slate-100 bg-slate-50 p-3"
                        >
                          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                            <p className="text-sm font-semibold text-slate-800">
                              {diagnostic.exerciseName}
                            </p>
                            <p className="text-xs text-slate-500">
                              {diagnostic.assignedSetCount} set{diagnostic.assignedSetCount === 1 ? "" : "s"}
                            </p>
                          </div>
                          <p className="mt-1 text-xs text-slate-600">
                            {diagnostic.isRoleFixture ? "role fixture" : "non-role selection"}
                            {diagnostic.isClosureAddition ? " | closure addition" : ""}
                            {diagnostic.isSetExpandedCarryover ? ` | set-expanded carryover (+${diagnostic.closureSetDelta})` : ""}
                            {diagnostic.anchorUsed?.kind === "muscle"
                              ? ` | anchor ${diagnostic.anchorUsed.muscle}`
                              : ""}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {plannerClosureCandidates.length > 0 ? (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Closure candidate trace
                      </p>
                      {plannerClosureCandidates.map((candidate) => (
                        <div
                          key={`${candidate.kind}-${candidate.exerciseId}-${candidate.setDelta}`}
                          className="rounded-lg border border-slate-100 bg-slate-50 p-3"
                        >
                          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                            <p className="text-sm font-semibold text-slate-800">
                              {candidate.exerciseName}
                            </p>
                            <p className="text-xs text-slate-500">
                              {candidate.kind} {candidate.setDelta} set
                              {candidate.setDelta === 1 ? "" : "s"}
                            </p>
                          </div>
                          <p className="mt-1 text-xs text-slate-600">
                            dominant deficit {candidate.dominantDeficitMuscle ?? "n/a"} |
                            remaining {candidate.dominantDeficitRemaining?.toFixed(1) ?? "n/a"} |
                            contribution {candidate.dominantDeficitContribution.toFixed(1)}
                            {candidate.score != null ? ` | closure score ${candidate.score.toFixed(1)}` : ""}
                            {candidate.filteredOutReason ? ` | filtered ${candidate.filteredOutReason}` : ""}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            {explanation.volumeCompliance.length > 0 ? (
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Week volume check
                </p>
                <div className="mt-3 space-y-2">
                  {explanation.volumeCompliance.map((row) => (
                    <div key={row.muscle} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-slate-800">{row.muscle}</span>
                        <VolumeComplianceBadge status={row.status} />
                      </div>
                      <p className="mt-1 text-xs text-slate-600">
                        {row.performedEffectiveVolumeBeforeSession} performed + {row.plannedEffectiveVolumeThisSession} planned = {row.projectedEffectiveVolume} projected effective sets against a {row.weeklyTarget}-set target.
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            {explanation.filteredExercises && explanation.filteredExercises.length > 0 ? (
              <FilteredExercisesCard filteredExercises={explanation.filteredExercises} />
            ) : null}

            {exerciseRationales.length > 0 ? (
              <div className="space-y-3">
                <h3 className="text-base font-semibold text-slate-900 sm:text-lg">Exercise drill-down</h3>
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
      </section>
    </div>
  );
}
