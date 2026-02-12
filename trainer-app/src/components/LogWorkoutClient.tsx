﻿"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { isSetQualifiedForBaseline } from "@/lib/baseline-qualification";

export type LogSetInput = {
  setId: string;
  setIndex: number;
  targetReps: number;
  targetRepRange?: { min: number; max: number };
  targetLoad?: number | null;
  targetRpe?: number | null;
  actualReps?: number | null;
  actualLoad?: number | null;
  actualRpe?: number | null;
  wasSkipped?: boolean;
};

export type LogExerciseInput = {
  workoutExerciseId: string;
  name: string;
  equipment?: string[];
  isMainLift: boolean;
  section?: "WARMUP" | "MAIN" | "ACCESSORY";
  sets: LogSetInput[];
};

type SectionedExercises = {
  warmup?: LogExerciseInput[];
  main: LogExerciseInput[];
  accessory?: LogExerciseInput[];
};

type NormalizedExercises = {
  warmup: LogExerciseInput[];
  main: LogExerciseInput[];
  accessory: LogExerciseInput[];
};

type BaselineUpdateSummary = {
  context: string;
  evaluatedExercises: number;
  updated: number;
  skipped: number;
  items: {
    exerciseName: string;
    previousTopSetWeight?: number;
    newTopSetWeight: number;
    reps: number;
  }[];
  skippedItems: {
    exerciseName: string;
    reason: string;
  }[];
};

function formatTargetReps(set: LogSetInput): string {
  if (set.targetRepRange && set.targetRepRange.min !== set.targetRepRange.max) {
    return `${set.targetRepRange.min}-${set.targetRepRange.max} reps`;
  }
  return `${set.targetReps} reps`;
}

function parseNullableNumber(raw: string): number | null {
  const normalized = raw.trim();
  if (normalized.length === 0) {
    return null;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function isBodyweightExercise(exercise: LogExerciseInput): boolean {
  return (exercise.equipment ?? []).some((item) => item.toLowerCase() === "bodyweight");
}

function shouldUseBodyweightLoadLabel(exercise: LogExerciseInput, set: LogSetInput): boolean {
  return isBodyweightExercise(exercise) && (set.targetLoad === null || set.targetLoad === undefined);
}

function normalizeExercises(exercises: LogExerciseInput[] | SectionedExercises): NormalizedExercises {
  if (Array.isArray(exercises)) {
    return { warmup: [], main: exercises, accessory: [] };
  }
  return {
    warmup: exercises.warmup ?? [],
    main: exercises.main ?? [],
    accessory: exercises.accessory ?? [],
  };
}

function withDefaults(exercises: NormalizedExercises): NormalizedExercises {
  const applyDefaults = (items: LogExerciseInput[]) =>
    items.map((exercise) => ({
      ...exercise,
      sets: exercise.sets.map((set) => ({
        ...set,
        actualReps: set.actualReps ?? set.targetReps ?? null,
        actualLoad: set.actualLoad ?? set.targetLoad ?? null,
        actualRpe: set.actualRpe ?? set.targetRpe ?? null,
      })),
    }));

  return {
    warmup: applyDefaults(exercises.warmup),
    main: applyDefaults(exercises.main),
    accessory: applyDefaults(exercises.accessory),
  };
}

export default function LogWorkoutClient({
  workoutId,
  exercises,
}: {
  workoutId: string;
  exercises: LogExerciseInput[] | SectionedExercises;
}) {
  const initial = useMemo(() => withDefaults(normalizeExercises(exercises)), [exercises]);
  const [data, setData] = useState<NormalizedExercises>(initial);
  const [savingSetId, setSavingSetId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const [baselineSummary, setBaselineSummary] = useState<BaselineUpdateSummary | null>(null);
  const [loggedSetIds, setLoggedSetIds] = useState<Set<string>>(new Set());
  const [skipReason, setSkipReason] = useState("");

  const allExercises = [...data.warmup, ...data.main, ...data.accessory];

  const updateSet = (
    exerciseIndex: number,
    setIndex: number,
    field: keyof LogSetInput,
    value: number | boolean | null
  ) => {
    setData((prev) => {
      const updated = { ...prev } as NormalizedExercises;
      const flat = [...updated.warmup, ...updated.main, ...updated.accessory];
      const targetExercise = flat[exerciseIndex];
      if (!targetExercise) {
        return prev;
      }
      const updatedSets = targetExercise.sets.map((set, index) =>
        index === setIndex ? { ...set, [field]: value } : set
      );

      const rebuild = (list: LogExerciseInput[]) =>
        list.map((exercise) =>
          exercise.workoutExerciseId === targetExercise.workoutExerciseId
            ? { ...exercise, sets: updatedSets }
            : exercise
        );

      updated.warmup = rebuild(updated.warmup);
      updated.main = rebuild(updated.main);
      updated.accessory = rebuild(updated.accessory);
      return updated;
    });
  };

  const handleLogSet = async (exerciseIndex: number, setIndex: number) => {
    setStatus(null);
    setError(null);

    const set = allExercises[exerciseIndex].sets[setIndex];
    setSavingSetId(set.setId);

    const response = await fetch("/api/logs/set", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workoutSetId: set.setId,
        workoutExerciseId: allExercises[exerciseIndex].workoutExerciseId,
        actualReps: set.actualReps ?? undefined,
        actualLoad: set.actualLoad ?? undefined,
        actualRpe: set.actualRpe ?? undefined,
        wasSkipped: set.wasSkipped ?? false,
      }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body.error ?? "Failed to log set");
      setSavingSetId(null);
      return;
    }

    setLoggedSetIds((prev) => {
      const next = new Set(prev);
      next.add(set.setId);
      return next;
    });
    setStatus("Set logged");
    setSavingSetId(null);
  };

  const handleCompleteWorkout = async () => {
    setStatus(null);
    setError(null);
    setBaselineSummary(null);

    const response = await fetch("/api/workouts/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workoutId,
        status: "COMPLETED",
        exercises: [],
      }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body.error ?? "Failed to mark workout completed");
      return;
    }

    const body = await response.json().catch(() => ({}));
    setBaselineSummary(body.baselineSummary ?? null);
    setCompleted(true);
    setStatus("Workout marked as completed");
  };

  const handleSkipWorkout = async () => {
    setStatus(null);
    setError(null);
    setBaselineSummary(null);

    const response = await fetch("/api/workouts/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workoutId,
        status: "SKIPPED",
        notes: skipReason ? `Skipped: ${skipReason}` : "Skipped",
        exercises: [],
      }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body.error ?? "Failed to mark workout skipped");
      return;
    }

    setSkipped(true);
    setStatus("Workout marked as skipped");
  };

  const isBaselineEligible = (set: LogSetInput) => {
    if (!loggedSetIds.has(set.setId)) {
      return false;
    }
    if (set.wasSkipped) {
      return false;
    }
    if (set.actualReps === null || set.actualReps === undefined) {
      return false;
    }
    if (set.actualLoad === null || set.actualLoad === undefined) {
      return false;
    }
    if (set.targetReps !== undefined && set.actualReps < set.targetReps) {
      return false;
    }
    if (!isSetQualifiedForBaseline(set)) {
      return false;
    }
    return true;
  };

  const renderSection = (label: string, items: LogExerciseInput[], offset: number) => {
    if (!items || items.length === 0) {
      return null;
    }

    return (
      <section className="space-y-3 sm:space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{label}</h2>
        {items.map((exercise, exerciseIndex) => (
          <div key={exercise.workoutExerciseId} className="rounded-2xl border border-slate-200 p-4 sm:p-5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="text-lg font-semibold">{exercise.name}</h3>
                <p className="mt-1 text-sm text-slate-500">
                  {exercise.section === "WARMUP"
                    ? "Warmup"
                    : exercise.isMainLift || exercise.section === "MAIN"
                    ? "Main lift"
                    : "Accessory"}
                </p>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {exercise.sets.map((set, setIndex) => (
                <div key={set.setId} className="rounded-xl border border-slate-100 p-4">
                  {(() => {
                    const bodyweightLabel = shouldUseBodyweightLoadLabel(exercise, set);
                    return (
                  <>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold">Set {set.setIndex}</p>
                      <span className="text-xs text-slate-500">Target {formatTargetReps(set)}</span>
                      {bodyweightLabel ? (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-700">
                          Target BW
                        </span>
                      ) : null}
                      {isBaselineEligible(set) ? (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                          Baseline +
                        </span>
                      ) : null}
                    </div>
                    <button
                      className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50 sm:w-auto"
                      onClick={() => handleLogSet(offset + exerciseIndex, setIndex)}
                      disabled={savingSetId === set.setId}
                    >
                      {savingSetId === set.setId ? "Saving..." : "Log set"}
                    </button>
                  </div>

                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    <label className="text-xs font-medium text-slate-500">
                      Reps
                      <input
                        className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        type="number"
                        inputMode="numeric"
                        value={set.actualReps ?? ""}
                        onChange={(event) =>
                          updateSet(
                            offset + exerciseIndex,
                            setIndex,
                            "actualReps",
                            parseNullableNumber(event.target.value)
                          )
                        }
                      />
                    </label>
                    <label className="text-xs font-medium text-slate-500">
                      {bodyweightLabel ? "Load (lbs, optional)" : "Load (lbs)"}
                      <input
                        className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        type="number"
                        inputMode="decimal"
                        placeholder={bodyweightLabel ? "Optional for weighted variation" : undefined}
                        value={set.actualLoad ?? ""}
                        onChange={(event) =>
                          updateSet(
                            offset + exerciseIndex,
                            setIndex,
                            "actualLoad",
                            parseNullableNumber(event.target.value)
                          )
                        }
                      />
                      {bodyweightLabel ? (
                        <p className="mt-1 text-[11px] text-slate-500">BW if left blank.</p>
                      ) : null}
                    </label>
                    <label className="text-xs font-medium text-slate-500">
                      RPE
                      <input
                        className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        type="number"
                        step="0.5"
                        inputMode="decimal"
                        value={set.actualRpe ?? ""}
                        onChange={(event) =>
                          updateSet(
                            offset + exerciseIndex,
                            setIndex,
                            "actualRpe",
                            parseNullableNumber(event.target.value)
                          )
                        }
                      />
                    </label>
                  </div>
                  <div className="mt-3 text-xs text-slate-500">
                    <label className="inline-flex min-h-11 cursor-pointer items-center gap-2">
                      <input
                        className="h-4 w-4 rounded border-slate-300"
                        type="checkbox"
                        checked={set.wasSkipped ?? false}
                        onChange={(event) =>
                          updateSet(offset + exerciseIndex, setIndex, "wasSkipped", event.target.checked)
                        }
                      />
                      Mark as skipped
                    </label>
                  </div>
                  </>
                    );
                  })()}
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>
    );
  };

  const warmupOffset = 0;
  const mainOffset = data.warmup.length;
  const accessoryOffset = data.warmup.length + data.main.length;

  return (
    <div className="mt-5 space-y-5 pb-28 sm:mt-6 sm:space-y-6 sm:pb-32 md:pb-0">
      {renderSection("Warmup", data.warmup, warmupOffset)}
      {renderSection("Main Lifts", data.main, mainOffset)}
      {renderSection("Accessories", data.accessory, accessoryOffset)}

      {status ? <p className="text-sm text-emerald-600">{status}</p> : null}
      {error ? <p className="text-sm text-rose-600">{error}</p> : null}

      {baselineSummary ? (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm sm:p-5">
          <p className="font-semibold text-slate-900">Baseline updates</p>
          <p className="mt-1 text-slate-600">
            Context: {baselineSummary.context} · Evaluated: {baselineSummary.evaluatedExercises} · Updated:{" "}
            {baselineSummary.updated} · Skipped: {baselineSummary.skipped}
          </p>
          {baselineSummary.items.length > 0 ? (
            <div className="mt-3 space-y-2">
              {baselineSummary.items.map((item) => (
                <div key={`${item.exerciseName}-${item.newTopSetWeight}`} className="flex flex-wrap gap-2">
                  <span className="font-medium text-slate-900">{item.exerciseName}</span>
                  <span className="text-slate-600">
                    {item.previousTopSetWeight ? `${item.previousTopSetWeight} -> ` : ""}
                    {item.newTopSetWeight} lbs × {item.reps}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-slate-600">No baseline increases detected for this session.</p>
          )}
          {baselineSummary.skippedItems.length > 0 ? (
            <div className="mt-4 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Why skipped</p>
              {baselineSummary.skippedItems.map((item) => (
                <div key={`${item.exerciseName}-${item.reason}`} className="flex flex-wrap gap-2">
                  <span className="font-medium text-slate-900">{item.exerciseName}</span>
                  <span className="text-slate-600">{item.reason}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="space-y-3">
        {!completed && !skipped ? (
          <label className="text-xs font-medium text-slate-500">
            Skip reason (optional)
            <input
              className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Travel, low energy, time constraints"
              value={skipReason}
              onChange={(event) => setSkipReason(event.target.value)}
            />
          </label>
        ) : null}
        <div className="fixed inset-x-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom)+0.75rem)] z-20 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:inset-x-5 md:static md:inset-auto md:bottom-auto md:rounded-none md:border-0 md:bg-transparent md:p-0 md:shadow-none">
          <div className="grid gap-2 sm:grid-cols-2 md:flex md:flex-wrap md:items-center md:gap-3">
            <button
              className="inline-flex min-h-11 w-full items-center justify-center rounded-full bg-slate-900 px-6 py-2 text-sm font-semibold text-white disabled:opacity-60 sm:w-auto"
              onClick={handleCompleteWorkout}
              disabled={completed || skipped}
            >
              {completed ? "Workout completed" : "Mark workout completed"}
            </button>
            <button
              className="inline-flex min-h-11 w-full items-center justify-center rounded-full border border-slate-300 px-6 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60 sm:w-auto"
              onClick={handleSkipWorkout}
              disabled={completed || skipped}
            >
              {skipped ? "Workout skipped" : "Mark workout skipped"}
            </button>
          </div>
        </div>
        {skipped ? (
          <div className="text-sm text-slate-600">
            <Link className="font-semibold text-slate-900" href="/">
              Generate a replacement session
            </Link>
          </div>
        ) : null}
      </div>
    </div>
  );
}





