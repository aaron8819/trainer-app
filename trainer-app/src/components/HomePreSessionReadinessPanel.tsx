"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { PreSessionReadinessGymCardDto } from "@/lib/api/pre-session-readiness-gym-card";

type HomePreSessionReadinessPanelProps = {
  card: PreSessionReadinessGymCardDto | null;
  canPrepare: boolean;
};

function formatActionLabel(action: PreSessionReadinessGymCardDto["action"]): string {
  switch (action) {
    case "blocked":
      return "Blocked";
    case "resume":
      return "Resume";
    case "watch":
      return "Watch";
    default:
      return "Start";
  }
}

function formatRpeCap(value: PreSessionReadinessGymCardDto["rpeCap"]): string | null {
  if (value === "deload_prescribed") {
    return "Deload prescribed";
  }
  if (value === "prescribed") {
    return "Prescribed";
  }
  return null;
}

function readErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") {
    return null;
  }

  const record = body as Record<string, unknown>;
  return typeof record.message === "string"
    ? record.message
    : typeof record.error === "string"
      ? record.error
      : null;
}

export function HomePreSessionReadinessPanel({
  card,
  canPrepare,
}: HomePreSessionReadinessPanelProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePrepare = async () => {
    setLoading(true);
    setError(null);

    const response = await fetch("/api/pre-session-readiness/prepare", {
      method: "POST",
    });
    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      setError(readErrorMessage(body) ?? "Could not check readiness.");
      setLoading(false);
      return;
    }

    router.refresh();
  };

  if (!card) {
    if (!canPrepare) {
      return null;
    }

    return (
      <section className="rounded-2xl border border-slate-200 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Readiness
            </p>
            <p className="mt-1 text-sm text-slate-600">
              Get session-specific coaching before you train.
            </p>
          </div>
          <button
            type="button"
            className="inline-flex min-h-10 items-center justify-center rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-900 disabled:opacity-60"
            onClick={handlePrepare}
            disabled={loading}
          >
            {loading ? "Checking readiness..." : "Check readiness"}
          </button>
        </div>
        {error ? (
          <p role="alert" className="mt-3 text-sm text-rose-600">
            {error}
          </p>
        ) : null}
      </section>
    );
  }

  const blocked = card.action === "blocked" || card.safeToTrain === false;
  const rpeCap = formatRpeCap(card.rpeCap);

  return (
    <section
      className={`rounded-2xl border p-5 ${
        blocked ? "border-rose-200 bg-rose-50/70" : "border-emerald-200 bg-emerald-50/60"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Readiness
          </p>
          <h2 className="mt-2 text-lg font-semibold text-slate-900">
            {card.sessionLabel}
          </h2>
          <p className="mt-2 text-sm font-medium text-slate-800">
            {card.primaryInstruction}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700">
            {card.safeToTrain ? "Safe to train" : "Not safe to start"}
          </span>
          <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700">
            {formatActionLabel(card.action)}
          </span>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-white/70 bg-white/80 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Main Priority
          </p>
          <p className="mt-1 text-sm text-slate-700">{card.mainPriority}</p>
          {rpeCap ? (
            <p className="mt-2 text-xs font-semibold text-slate-600">
              RPE cap: {rpeCap}
            </p>
          ) : null}
        </div>

        <div className="rounded-xl border border-white/70 bg-white/80 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Optional Add-ons
          </p>
          {card.optionalAddOns.items.length > 0 ? (
            <ul className="mt-2 space-y-1 text-sm text-slate-700">
              {card.optionalAddOns.items.map((item) => (
                <li key={`${item.targetMuscle}:${item.candidateExerciseName}`}>
                  {item.targetMuscle}: {item.candidateExerciseName}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-sm text-slate-700">No add-ons recommended.</p>
          )}
          <p className="mt-2 text-xs text-slate-500">{card.optionalAddOns.reason}</p>
        </div>
      </div>

      {card.avoid.length > 0 ? (
        <div className="mt-4 rounded-xl border border-white/70 bg-white/80 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Avoid
          </p>
          <ul className="mt-2 space-y-1 text-sm text-slate-700">
            {card.avoid.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {card.blockers.length > 0 || card.warnings.length > 0 ? (
        <div className="mt-4 rounded-xl border border-white/70 bg-white/80 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {blocked ? "Blockers" : "Warnings"}
          </p>
          <ul className="mt-2 space-y-1 text-sm text-slate-700">
            {[...card.blockers, ...card.warnings].map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {card.calibrationNotes.length > 0 ? (
        <div className="mt-4 rounded-xl border border-white/70 bg-white/80 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Calibration
          </p>
          <ul className="mt-2 space-y-1 text-sm text-slate-700">
            {card.calibrationNotes.map((note) => (
              <li key={`${note.kind}:${note.message}`}>{note.message}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
