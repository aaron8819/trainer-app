"use client";

import type { PrescriptionRationale } from "@/lib/engine/explainability";

type Props = {
  prescription: PrescriptionRationale;
};

export function PrescriptionDetails({ prescription }: Props) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Set targets</p>
      <p className="mt-1 text-sm font-medium text-slate-800">{prescription.overallNarrative}</p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <DetailCard
          label="Sets"
          value={`${prescription.sets.count}`}
          description={prescription.sets.reason}
          note={prescription.sets.blockContext}
        />
        <DetailCard
          label="Reps"
          value={`${prescription.reps.target}`}
          description={prescription.reps.reason}
          note={prescription.reps.exerciseConstraints}
        />
        <DetailCard
          label="Load"
          value={`${prescription.load.load} kg`}
          description={prescription.load.reason}
          note={prescription.load.progressionContext}
        />
        <DetailCard
          label="Effort"
          value={`${prescription.rir.target} RIR`}
          description={prescription.rir.reason}
          note={prescription.rir.trainingAge}
        />
      </div>

      <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50 p-3">
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-bold text-slate-900">
            {Math.floor(prescription.rest.seconds / 60)}:{String(prescription.rest.seconds % 60).padStart(2, "0")}
          </span>
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Rest</span>
        </div>
        <p className="mt-1 text-xs text-slate-600">{prescription.rest.reason}</p>
      </div>
    </div>
  );
}

function DetailCard(input: {
  label: string;
  value: string;
  description: string;
  note?: string;
}) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
      <div className="flex items-baseline gap-2">
        <span className="text-lg font-bold text-slate-900">{input.value}</span>
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{input.label}</span>
      </div>
      <p className="mt-1 text-xs text-slate-600">{input.description}</p>
      {input.note ? <p className="mt-1 text-xs italic text-slate-500">{input.note}</p> : null}
    </div>
  );
}
