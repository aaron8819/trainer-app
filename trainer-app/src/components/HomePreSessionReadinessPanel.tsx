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

function formatEffortLine(card: PreSessionReadinessGymCardDto): string | null {
  const parts = [
    card.workoutPreview.targetRpeLabel,
    formatRpeCap(card.rpeCap),
  ].filter((part): part is string => Boolean(part));

  return parts.length > 0 ? `Target effort: ${parts.join(". ")}.` : null;
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

function getSpecificTodayFocus(card: PreSessionReadinessGymCardDto): string | null {
  const focus = card.mainPriority.trim();
  if (!focus) {
    return null;
  }

  const normalized = focus.toLocaleLowerCase();
  const genericPatterns = [
    "planned workout first",
    "add optional work only if warm-ups feel normal",
    "run the planned workout",
    "no extra work needed today",
    "use the written targets as starting points",
    "resolve blockers before any start or add-on decision",
  ];

  return genericPatterns.some((pattern) => normalized.includes(pattern))
    ? null
    : focus;
}

function formatWorkoutRowMeta(
  exercise: PreSessionReadinessGymCardDto["workoutPreview"]["exercises"][number]
): string {
  const parts = [
    `${exercise.setCount} ${exercise.setCount === 1 ? "set" : "sets"}`,
    exercise.repTargetLabel,
    exercise.targetLoadLabel ? `load ${exercise.targetLoadLabel}` : null,
  ].filter((part): part is string => Boolean(part));

  return parts.join(" - ");
}

function formatOptionalAddOnTitle(
  item: PreSessionReadinessGymCardDto["optionalAddOns"]["items"][number]
): string {
  return `${item.candidateExerciseName} - ${item.reason}`;
}

function groupCalibrationNotes(
  notes: PreSessionReadinessGymCardDto["calibrationNotes"]
): string[] {
  const targetStartingPointExercises: string[] = [];
  const writtenTargetExercises: string[] = [];
  const specific: string[] = [];

  for (const note of notes) {
    if (
      note.displayActionCode === "use_target_as_starting_point" &&
      note.exerciseLabel
    ) {
      targetStartingPointExercises.push(note.exerciseLabel);
      continue;
    }
    if (
      note.displayActionCode === "calibrate_from_first_working_set" &&
      note.exerciseLabel
    ) {
      writtenTargetExercises.push(note.exerciseLabel);
      continue;
    }
    specific.push(note.message);
  }

  return [
    targetStartingPointExercises.length > 0
      ? `Use targets as starting points for ${targetStartingPointExercises.join(", ")}; adjust by feel.`
      : null,
    writtenTargetExercises.length > 0
      ? `Calibrate from the first working set for ${writtenTargetExercises.join(", ")}.`
      : null,
    ...specific,
  ].filter((item): item is string => Boolean(item));
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
  const statusLine = formatStatusLine({
    action: card.action,
    safeToTrain: card.safeToTrain,
  });
  const focus = getSpecificTodayFocus(card);
  const effortLine = formatEffortLine(card);
  const workoutExercises = card.workoutPreview.exercises;
  const calibrationNotes = groupCalibrationNotes(card.calibrationNotes);
  const avoid = card.avoid;
  const warnings = card.warnings;
  const blockers = blocked ? card.blockers : [];
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
            Today&apos;s Workout
          </p>
          {workoutExercises.length > 0 ? (
            <div className="mt-2 divide-y divide-white/70 rounded-lg bg-white/70">
              {workoutExercises.map((exercise) => (
                <div
                  key={exercise.exerciseId}
                  className="grid gap-1 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-3"
                >
                  <p className="min-w-0 text-sm font-semibold text-slate-900">
                    {exercise.exerciseName}
                  </p>
                  <p className="text-sm text-slate-700 sm:text-right">
                    {formatWorkoutRowMeta(exercise)}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-1 text-sm text-slate-700">{card.primaryInstruction}</p>
          )}
          {effortLine ? (
            <p className="mt-2 text-xs font-semibold text-slate-600">
              {effortLine}
            </p>
          ) : null}
        </div>

        {focus ? (
          <div className="border-t border-white/70 pt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Today&apos;s Focus
            </p>
            <p className="mt-1 text-sm text-slate-700">{focus}</p>
          </div>
        ) : null}

        {card.optionalAddOns.items.length > 0 ? (
          <div className="border-t border-white/70 pt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Optional Add-ons
            </p>
            <ul className="mt-2 space-y-2 text-sm text-slate-700">
              {card.optionalAddOns.items.map((item) => (
                <li key={`${item.targetMuscle}:${item.candidateExerciseName}`}>
                  <p className="font-semibold text-slate-900">
                    {formatOptionalAddOnTitle(item)}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-600">{item.guardrail}</p>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

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
              Load Calibration
            </p>
            <ul className="mt-2 space-y-1 text-sm text-slate-700">
              {calibrationNotes.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {warnings.length > 0 || blockers.length > 0 ? (
          <div className="border-t border-white/70 pt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Warnings &amp; Blockers
            </p>
            <ul className="mt-2 space-y-1 text-sm text-slate-700">
              {blockers.map((item) => (
                <li key={item}>{item}</li>
              ))}
              {warnings.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}
