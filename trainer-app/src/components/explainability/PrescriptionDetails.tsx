/**
 * PrescriptionDetails - Prescription rationale display
 *
 * Phase 4.6: Explain sets/reps/load/RIR/rest decisions
 *
 * Shows "Why these sets/reps/load/RIR/rest?"
 */

"use client";

import type { PrescriptionRationale } from "@/lib/engine/explainability";

type Props = {
  prescription: PrescriptionRationale;
};

export function PrescriptionDetails({ prescription }: Props) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Prescription Rationale
      </p>
      <p className="mt-1 text-sm font-medium text-slate-800">
        {prescription.overallNarrative}
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {/* Sets */}
        <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-bold text-slate-900">{prescription.sets.count}</span>
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Sets
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-600">{prescription.sets.reason}</p>
          {prescription.sets.blockContext && (
            <p className="mt-1 text-xs italic text-slate-500">{prescription.sets.blockContext}</p>
          )}
        </div>

        {/* Reps */}
        <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-bold text-slate-900">{prescription.reps.target}</span>
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Reps
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-600">{prescription.reps.reason}</p>
          {prescription.reps.exerciseConstraints && (
            <p className="mt-1 text-xs italic text-slate-500">
              {prescription.reps.exerciseConstraints}
            </p>
          )}
        </div>

        {/* Load */}
        <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-bold text-slate-900">
              {prescription.load.load}
              <span className="text-sm">kg</span>
            </span>
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Load
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-600">{prescription.load.reason}</p>
          {prescription.load.progressionContext && (
            <p className="mt-1 text-xs italic text-slate-500">
              {prescription.load.progressionContext}
            </p>
          )}
        </div>

        {/* RIR */}
        <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-bold text-slate-900">{prescription.rir.target}</span>
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
              RIR
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-600">{prescription.rir.reason}</p>
          {prescription.rir.trainingAge && (
            <p className="mt-1 text-xs italic text-slate-500">{prescription.rir.trainingAge}</p>
          )}
        </div>
      </div>

      {/* Rest Period */}
      <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50 p-3">
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-bold text-slate-900">
            {Math.floor(prescription.rest.seconds / 60)}:{String(prescription.rest.seconds % 60).padStart(2, "0")}
          </span>
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Rest
          </span>
        </div>
        <p className="mt-1 text-xs text-slate-600">{prescription.rest.reason}</p>
      </div>
    </div>
  );
}
