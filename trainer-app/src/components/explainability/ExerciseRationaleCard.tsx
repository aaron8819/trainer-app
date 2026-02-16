/**
 * ExerciseRationaleCard - Per-exercise explanation
 *
 * Phase 4.6: Display selection factors, KB citations, alternatives, prescription
 *
 * Explains "Why this exercise?" and "Why these sets/reps/load/RIR/rest?"
 */

"use client";

import type { ExerciseRationale, PrescriptionRationale } from "@/lib/engine/explainability";
import { PrescriptionDetails } from "./PrescriptionDetails";

type Props = {
  exerciseId: string;
  rationale: ExerciseRationale;
  prescription?: PrescriptionRationale;
  isExpanded: boolean;
  onToggle: () => void;
};

export function ExerciseRationaleCard({
  exerciseId,
  rationale,
  prescription,
  isExpanded,
  onToggle,
}: Props) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white text-sm">
      {/* Header - Always visible */}
      <button
        onClick={onToggle}
        className="w-full px-4 py-3 text-left hover:bg-slate-50 sm:px-5"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-slate-900">{rationale.exerciseName}</p>
            <p className="mt-1 text-xs text-slate-600">{rationale.volumeContribution}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">
              {isExpanded ? "Hide" : "Show"} details
            </span>
            <svg
              className={`h-5 w-5 text-slate-400 transition-transform ${isExpanded ? "rotate-180" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </div>
        </div>
      </button>

      {/* Expandable Content */}
      {isExpanded && (
        <div className="border-t border-slate-100 px-4 py-3 sm:px-5">
          {/* Primary Reasons */}
          <div className="mb-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Why This Exercise?
            </p>
            <ul className="mt-2 space-y-1">
              {rationale.primaryReasons.map((reason, idx) => (
                <li key={idx} className="flex items-start gap-2 text-slate-700">
                  <span className="text-blue-600">•</span>
                  <span>{reason}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Selection Factors Breakdown */}
          <div className="mb-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Selection Factors
            </p>
            <div className="mt-2 space-y-2">
              {Object.entries(rationale.selectionFactors).map(([key, factor]) => {
                if (factor.score === 0) return null;
                const scorePercent = Math.round(factor.score * 100);
                return (
                  <div key={key} className="flex items-start gap-3">
                    <div className="flex-shrink-0">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50">
                        <span className="text-xs font-semibold text-blue-700">
                          {scorePercent}%
                        </span>
                      </div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-slate-700">
                        {formatFactorLabel(key)}
                      </p>
                      <p className="text-xs text-slate-600">{factor.explanation}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Knowledge Base Citations */}
          {rationale.citations.length > 0 && (
            <div className="mb-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Research Support
              </p>
              <div className="mt-2 space-y-2">
                {rationale.citations.map((citation) => (
                  <div
                    key={citation.id}
                    className="rounded-lg border border-blue-100 bg-blue-50 p-3"
                  >
                    <p className="text-xs font-semibold text-blue-900">
                      {citation.authors} ({citation.year})
                    </p>
                    <p className="mt-1 text-xs text-blue-800">{citation.finding}</p>
                    <p className="mt-1 text-xs italic text-blue-700">
                      Relevance: {citation.relevance}
                    </p>
                    {citation.url && (
                      <a
                        href={citation.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-block text-xs font-medium text-blue-600 hover:underline"
                      >
                        View study →
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Prescription Details */}
          {prescription && (
            <div className="mb-4">
              <PrescriptionDetails prescription={prescription} />
            </div>
          )}

          {/* Alternatives */}
          {rationale.alternatives.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Alternative Exercises
              </p>
              <div className="mt-2 space-y-2">
                {rationale.alternatives.map((alt, idx) => (
                  <div
                    key={idx}
                    className="flex items-start justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50 p-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-slate-700">{alt.exerciseName}</p>
                      <p className="text-xs text-slate-600">{alt.reason}</p>
                    </div>
                    <div className="flex-shrink-0">
                      <span className="text-xs text-slate-500">
                        {Math.round(alt.similarity * 100)}% similar
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatFactorLabel(key: string): string {
  const labels: Record<string, string> = {
    deficitFill: "Deficit Fill",
    rotationNovelty: "Rotation Novelty",
    sfrEfficiency: "SFR Efficiency",
    lengthenedPosition: "Lengthened Position",
    sraAlignment: "SRA Alignment",
    userPreference: "User Preference",
    movementNovelty: "Movement Novelty",
  };
  return labels[key] || key;
}
