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
      return "Resume planned workout";
    case "watch":
      return "Calibration day";
    default:
      return "Start planned workout";
  }
}

function formatRpeCap(value: PreSessionReadinessGymCardDto["rpeCap"]): string | null {
  if (value === "deload_prescribed") {
    return "Use the deload cap";
  }
  if (value === "prescribed") {
    return "Use the prescribed cap";
  }
  return null;
}

function formatStatusLine(input: {
  action: PreSessionReadinessGymCardDto["action"];
  safeToTrain: boolean;
}): string {
  if (!input.safeToTrain || input.action === "blocked") {
    return "Not safe to start - Resolve blockers first";
  }
  if (input.action === "watch") {
    return "Safe to train - Use calibration judgment";
  }
  if (input.action === "resume") {
    return "Safe to train - Resume the planned workout";
  }
  return "Safe to train - Run the planned workout";
}

function mainPriorityDuplicatesAddOn(
  mainPriority: string,
  item: PreSessionReadinessGymCardDto["optionalAddOns"]["items"][number] | undefined
): boolean {
  if (!item) {
    return false;
  }

  return mainPriority
    .toLocaleLowerCase()
    .includes(item.candidateExerciseName.toLocaleLowerCase());
}

function formatTodayFocus(card: PreSessionReadinessGymCardDto): string {
  if (
    mainPriorityDuplicatesAddOn(
      card.mainPriority,
      card.optionalAddOns.items[0]
    )
  ) {
    return "Planned workout first; add optional work only if warm-ups feel normal.";
  }

  return card.mainPriority;
}

function formatOptionalAddOn(
  item: PreSessionReadinessGymCardDto["optionalAddOns"]["items"][number]
): string {
  return `Optional: ${item.candidateExerciseName}`;
}

function limitList(items: string[], maxItems = 4): string[] {
  if (items.length <= maxItems) {
    return items;
  }
  return [...items.slice(0, maxItems), `+${items.length - maxItems} more`];
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
  const statusLine = formatStatusLine({
    action: card.action,
    safeToTrain: card.safeToTrain,
  });
  const focus = formatTodayFocus(card);
  const calibrationNotes = limitList(
    card.calibrationNotes.map((note) => note.message)
  );
  const avoid = limitList(card.avoid);
  const warnings = limitList(card.warnings);
  const blockers = blocked ? limitList(card.blockers) : [];
  const headingTitle = blocked
    ? `Readiness blocked for ${card.sessionLabel}`
    : `Ready for ${card.sessionLabel}`;

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
            {headingTitle}
          </h2>
          <p className="mt-2 text-sm font-medium text-slate-800">
            {statusLine}
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

      <div className="mt-5 space-y-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Today&apos;s Plan
          </p>
          <p className="mt-1 text-sm text-slate-700">{card.primaryInstruction}</p>
          {rpeCap ? (
            <p className="mt-2 text-xs font-semibold text-slate-600">
              {rpeCap}
            </p>
          ) : null}
        </div>

        <div className="border-t border-white/70 pt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Today&apos;s Focus
          </p>
          <p className="mt-1 text-sm text-slate-700">{focus}</p>
        </div>

        <div className="border-t border-white/70 pt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Optional Add-ons
          </p>
          {card.optionalAddOns.items.length > 0 ? (
            <ul className="mt-2 space-y-1 text-sm text-slate-700">
              {card.optionalAddOns.items.slice(0, 4).map((item) => (
                <li key={`${item.targetMuscle}:${item.candidateExerciseName}`}>
                  {formatOptionalAddOn(item)}
                </li>
              ))}
              {card.optionalAddOns.items.length > 4 ? (
                <li>+{card.optionalAddOns.items.length - 4} more</li>
              ) : null}
            </ul>
          ) : (
            <p className="mt-1 text-sm text-slate-700">No add-ons recommended.</p>
          )}
        </div>

        {avoid.length > 0 ? (
          <div className="border-t border-white/70 pt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Avoid
            </p>
            <ul className="mt-2 space-y-1 text-sm text-slate-700">
              {avoid.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {calibrationNotes.length > 0 ? (
          <div className="border-t border-white/70 pt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Load Notes
            </p>
            <ul className="mt-2 space-y-1 text-sm text-slate-700">
              {calibrationNotes.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {warnings.length > 0 ? (
          <div className="border-t border-white/70 pt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Warnings
            </p>
            <ul className="mt-2 space-y-1 text-sm text-slate-700">
              {warnings.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {blockers.length > 0 ? (
          <div className="border-t border-white/70 pt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Blockers
            </p>
            <ul className="mt-2 space-y-1 text-sm text-slate-700">
              {blockers.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}
