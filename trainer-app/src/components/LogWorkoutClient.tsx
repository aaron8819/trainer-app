"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
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

type ExerciseSection = keyof NormalizedExercises;

type FlatSetItem = {
  section: ExerciseSection;
  sectionLabel: string;
  exerciseIndex: number;
  setIndex: number;
  exercise: LogExerciseInput;
  set: LogSetInput;
};

type UndoSnapshot = {
  setId: string;
  previousSet: LogSetInput;
  wasLoggedBefore: boolean;
  expiresAt: number;
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

const SECTION_ORDER: ExerciseSection[] = ["warmup", "main", "accessory"];

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

function formatSectionLabel(section: ExerciseSection): string {
  if (section === "warmup") {
    return "Warmup";
  }
  if (section === "main") {
    return "Main Lifts";
  }
  return "Accessories";
}

function normalizeStepValue(value: number | null | undefined, fallback: number | null | undefined, delta: number) {
  const base = value ?? fallback ?? 0;
  const next = Math.round((base + delta) * 100) / 100;
  return Math.max(0, next);
}

function clampReps(value: number | null | undefined, delta: number) {
  const base = value ?? 0;
  return Math.max(0, Math.round(base + delta));
}

function getNextUnloggedSetId(
  flatSets: FlatSetItem[],
  loggedSetIds: Set<string>,
  currentSetId: string
): string | null {
  if (flatSets.length === 0) {
    return null;
  }
  const currentIndex = flatSets.findIndex((item) => item.set.setId === currentSetId);
  if (currentIndex === -1) {
    return flatSets[0]?.set.setId ?? null;
  }
  for (let index = currentIndex + 1; index < flatSets.length; index += 1) {
    const candidate = flatSets[index];
    if (!loggedSetIds.has(candidate.set.setId)) {
      return candidate.set.setId;
    }
  }
  for (let index = 0; index < currentIndex; index += 1) {
    const candidate = flatSets[index];
    if (!loggedSetIds.has(candidate.set.setId)) {
      return candidate.set.setId;
    }
  }
  return null;
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
  const [activeSetId, setActiveSetId] = useState<string | null>(null);
  const [showSkipOptions, setShowSkipOptions] = useState(false);
  const [footerExpanded, setFooterExpanded] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<ExerciseSection, boolean>>({
    warmup: false,
    main: true,
    accessory: false,
  });
  const [expandedExerciseId, setExpandedExerciseId] = useState<string | null>(null);
  const [undoSnapshot, setUndoSnapshot] = useState<UndoSnapshot | null>(null);

  const flatSets = useMemo<FlatSetItem[]>(() => {
    const output: FlatSetItem[] = [];
    for (const section of SECTION_ORDER) {
      const exercisesInSection = data[section];
      exercisesInSection.forEach((exercise, exerciseIndex) => {
        exercise.sets.forEach((set, setIndex) => {
          output.push({
            section,
            sectionLabel: formatSectionLabel(section),
            exerciseIndex,
            setIndex,
            exercise,
            set,
          });
        });
      });
    }
    return output;
  }, [data]);

  const totalSets = flatSets.length;
  const loggedCount = loggedSetIds.size;
  const remainingCount = Math.max(0, totalSets - loggedCount);

  const fallbackActiveSet = useMemo(
    () => flatSets.find((item) => !loggedSetIds.has(item.set.setId)) ?? flatSets[0] ?? null,
    [flatSets, loggedSetIds]
  );
  const activeSet = useMemo(
    () => flatSets.find((item) => item.set.setId === activeSetId) ?? fallbackActiveSet,
    [activeSetId, fallbackActiveSet, flatSets]
  );
  const resolvedActiveSetId = activeSet?.set.setId ?? null;

  useEffect(() => {
    if (!undoSnapshot) {
      return;
    }
    const remaining = Math.max(0, undoSnapshot.expiresAt - Date.now());
    const timeout = setTimeout(() => {
      setUndoSnapshot(null);
    }, remaining);
    return () => clearTimeout(timeout);
  }, [undoSnapshot]);

  const updateSetFields = (
    setId: string,
    updater: (set: LogSetInput) => LogSetInput
  ) => {
    setData((prev) => {
      const next: NormalizedExercises = {
        warmup: prev.warmup.map((exercise) => ({
          ...exercise,
          sets: exercise.sets.map((set) => (set.setId === setId ? updater(set) : set)),
        })),
        main: prev.main.map((exercise) => ({
          ...exercise,
          sets: exercise.sets.map((set) => (set.setId === setId ? updater(set) : set)),
        })),
        accessory: prev.accessory.map((exercise) => ({
          ...exercise,
          sets: exercise.sets.map((set) => (set.setId === setId ? updater(set) : set)),
        })),
      };
      return next;
    });
  };

  const setSingleField = (
    setId: string,
    field: keyof LogSetInput,
    value: number | boolean | null
  ) => {
    updateSetFields(setId, (set) => ({ ...set, [field]: value }));
  };

  const handleLogSet = async (setId: string, overrides?: Partial<LogSetInput>) => {
    setStatus(null);
    setError(null);
    const targetSet = flatSets.find((item) => item.set.setId === setId);
    if (!targetSet) {
      setError("Unable to find set");
      return;
    }
    const mergedSet = { ...targetSet.set, ...overrides };
    setSavingSetId(setId);

    const response = await fetch("/api/logs/set", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workoutSetId: targetSet.set.setId,
        workoutExerciseId: targetSet.exercise.workoutExerciseId,
        actualReps: mergedSet.actualReps ?? undefined,
        actualLoad: mergedSet.actualLoad ?? undefined,
        actualRpe: mergedSet.actualRpe ?? undefined,
        wasSkipped: mergedSet.wasSkipped ?? false,
      }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body.error ?? "Failed to log set");
      setSavingSetId(null);
      return;
    }

    if (overrides) {
      updateSetFields(setId, (set) => ({ ...set, ...overrides }));
    }
    const wasLoggedBefore = loggedSetIds.has(setId);
    const nextLogged = new Set(loggedSetIds);
    nextLogged.add(setId);
    setLoggedSetIds(nextLogged);
    setUndoSnapshot({
      setId,
      previousSet: targetSet.set,
      wasLoggedBefore,
      expiresAt: Date.now() + 5000,
    });
    const nextSetId = getNextUnloggedSetId(flatSets, nextLogged, setId);
    if (nextSetId) {
      setActiveSetId(nextSetId);
    }
    setStatus("Set logged");
    setSavingSetId(null);
  };

  const handleUndo = () => {
    if (!undoSnapshot) {
      return;
    }
    updateSetFields(undoSnapshot.setId, () => ({ ...undoSnapshot.previousSet }));
    if (!undoSnapshot.wasLoggedBefore) {
      setLoggedSetIds((prev) => {
        const next = new Set(prev);
        next.delete(undoSnapshot.setId);
        return next;
      });
    }
    setActiveSetId(undoSnapshot.setId);
    setUndoSnapshot(null);
    setStatus("Last set log reverted locally");
    setError(null);
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

  return (
    <div className="mt-5 space-y-5 pb-28 sm:mt-6 sm:space-y-6 sm:pb-32 md:pb-0">
      {!completed && !skipped && activeSet ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Active set</p>
            <p className="text-xs text-slate-500">
              {loggedCount}/{totalSets} logged
            </p>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-slate-900 transition-all"
              style={{ width: `${totalSets === 0 ? 0 : (loggedCount / totalSets) * 100}%` }}
            />
          </div>
          <div className="mt-4">
            <h2 className="text-lg font-semibold">{activeSet.exercise.name}</h2>
            <p className="mt-1 text-sm text-slate-500">
              {activeSet.sectionLabel} · Set {activeSet.set.setIndex} of {activeSet.exercise.sets.length} · Target{" "}
              {formatTargetReps(activeSet.set)}
            </p>
          </div>
          {shouldUseBodyweightLoadLabel(activeSet.exercise, activeSet.set) ? (
            <p className="mt-2 text-xs text-slate-500">Bodyweight movement (load optional for weighted variation).</p>
          ) : null}
          {isBaselineEligible(activeSet.set) ? (
            <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-emerald-700">Baseline eligible</p>
          ) : null}

          <div className="mt-4 space-y-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Reps</p>
              <div className="mt-1 flex items-center gap-2">
                <button
                  className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-slate-300 px-3 text-sm font-semibold text-slate-700"
                  onClick={() =>
                    setSingleField(
                      activeSet.set.setId,
                      "actualReps",
                      clampReps(activeSet.set.actualReps, -1)
                    )
                  }
                  type="button"
                >
                  -1
                </button>
                <input
                  className="min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  type="number"
                  inputMode="numeric"
                  value={activeSet.set.actualReps ?? ""}
                  onChange={(event) =>
                    setSingleField(activeSet.set.setId, "actualReps", parseNullableNumber(event.target.value))
                  }
                />
                <button
                  className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-slate-300 px-3 text-sm font-semibold text-slate-700"
                  onClick={() =>
                    setSingleField(
                      activeSet.set.setId,
                      "actualReps",
                      clampReps(activeSet.set.actualReps, 1)
                    )
                  }
                  type="button"
                >
                  +1
                </button>
              </div>
            </div>

            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                {shouldUseBodyweightLoadLabel(activeSet.exercise, activeSet.set)
                  ? "Load (lbs, optional)"
                  : "Load (lbs)"}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {[-5, -2.5, 2.5, 5].map((delta) => (
                  <button
                    key={`${activeSet.set.setId}-delta-${delta}`}
                    className="inline-flex min-h-10 items-center justify-center rounded-full border border-slate-300 px-3 text-xs font-semibold text-slate-700"
                    onClick={() =>
                      setSingleField(
                        activeSet.set.setId,
                        "actualLoad",
                        normalizeStepValue(activeSet.set.actualLoad, activeSet.set.targetLoad, delta)
                      )
                    }
                    type="button"
                  >
                    {delta > 0 ? `+${delta}` : delta}
                  </button>
                ))}
                <button
                  className="inline-flex min-h-10 items-center justify-center rounded-full border border-slate-300 px-3 text-xs font-semibold text-slate-700"
                  onClick={() => setSingleField(activeSet.set.setId, "actualLoad", null)}
                  type="button"
                >
                  Clear
                </button>
              </div>
              <input
                className="mt-2 min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                type="number"
                inputMode="decimal"
                value={activeSet.set.actualLoad ?? ""}
                onChange={(event) =>
                  setSingleField(activeSet.set.setId, "actualLoad", parseNullableNumber(event.target.value))
                }
              />
            </div>

            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">RPE</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {[7, 8, 9, 10].map((preset) => (
                  <button
                    key={`${activeSet.set.setId}-rpe-${preset}`}
                    className={`inline-flex min-h-10 min-w-10 items-center justify-center rounded-full border px-3 text-xs font-semibold ${
                      activeSet.set.actualRpe === preset
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-slate-300 text-slate-700"
                    }`}
                    onClick={() => setSingleField(activeSet.set.setId, "actualRpe", preset)}
                    type="button"
                  >
                    {preset}
                  </button>
                ))}
              </div>
              <input
                className="mt-2 min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                type="number"
                step="0.5"
                inputMode="decimal"
                value={activeSet.set.actualRpe ?? ""}
                onChange={(event) =>
                  setSingleField(activeSet.set.setId, "actualRpe", parseNullableNumber(event.target.value))
                }
              />
            </div>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            <button
              className="inline-flex min-h-11 items-center justify-center rounded-full bg-slate-900 px-6 py-2 text-sm font-semibold text-white disabled:opacity-60"
              onClick={() => handleLogSet(activeSet.set.setId)}
              disabled={savingSetId === activeSet.set.setId}
              type="button"
            >
              {savingSetId === activeSet.set.setId ? "Saving..." : "Log set"}
            </button>
            <button
              className="inline-flex min-h-11 items-center justify-center rounded-full border border-slate-300 px-6 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60"
              type="button"
              onClick={() => {
                if (activeSet.setIndex === 0) {
                  return;
                }
                const previousSet = activeSet.exercise.sets[activeSet.setIndex - 1];
                setSingleField(activeSet.set.setId, "actualReps", previousSet.actualReps ?? null);
                setSingleField(activeSet.set.setId, "actualLoad", previousSet.actualLoad ?? null);
                setSingleField(activeSet.set.setId, "actualRpe", previousSet.actualRpe ?? null);
                setSingleField(activeSet.set.setId, "wasSkipped", false);
              }}
              disabled={activeSet.setIndex === 0}
            >
              Same as last
            </button>
            <button
              className="inline-flex min-h-11 items-center justify-center rounded-full border border-rose-300 px-6 py-2 text-sm font-semibold text-rose-700 disabled:opacity-60"
              onClick={() => handleLogSet(activeSet.set.setId, { wasSkipped: true })}
              disabled={savingSetId === activeSet.set.setId}
              type="button"
            >
              Skip set
            </button>
          </div>

          {status ? <p className="mt-3 text-sm text-emerald-600">{status}</p> : null}
          {error ? <p className="mt-3 text-sm text-rose-600">{error}</p> : null}
        </section>
      ) : null}

      {!completed && !skipped ? (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Exercise queue</h2>
            <p className="text-xs text-slate-500">{remainingCount} sets remaining</p>
          </div>
          {SECTION_ORDER.map((section) => {
            const sectionItems = data[section];
            if (sectionItems.length === 0) {
              return null;
            }
            const isExpanded = expandedSections[section];
            return (
              <div key={section} className="rounded-2xl border border-slate-200 bg-white">
                <button
                  className="flex min-h-11 w-full items-center justify-between px-4 py-3 text-left"
                  onClick={() =>
                    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }))
                  }
                  type="button"
                >
                  <span className="text-sm font-semibold">{formatSectionLabel(section)}</span>
                  <span className="text-xs text-slate-500">{isExpanded ? "Hide" : "Show"}</span>
                </button>
                {isExpanded ? (
                  <div className="space-y-2 border-t border-slate-100 p-3">
                    {sectionItems.map((exercise) => {
                      const exerciseLogged = exercise.sets.filter((set) => loggedSetIds.has(set.setId)).length;
                      const nextSet =
                        exercise.sets.find((set) => !loggedSetIds.has(set.setId)) ?? exercise.sets[0];
                      const isExerciseExpanded = expandedExerciseId === exercise.workoutExerciseId;
                      return (
                        <div key={exercise.workoutExerciseId} className="rounded-xl border border-slate-100">
                          <button
                            className="flex min-h-11 w-full items-center justify-between px-3 py-2 text-left"
                            onClick={() => {
                              if (nextSet) {
                                setActiveSetId(nextSet.setId);
                              }
                              setExpandedExerciseId((prev) =>
                                prev === exercise.workoutExerciseId ? null : exercise.workoutExerciseId
                              );
                            }}
                            type="button"
                          >
                            <span className="text-sm font-medium">{exercise.name}</span>
                            <span className="text-xs text-slate-500">
                              {exerciseLogged}/{exercise.sets.length}
                            </span>
                          </button>
                          {isExerciseExpanded ? (
                            <div className="flex flex-wrap gap-2 border-t border-slate-100 p-3">
                              {exercise.sets.map((set) => {
                                const isLogged = loggedSetIds.has(set.setId);
                                const isActive = resolvedActiveSetId === set.setId;
                                return (
                                  <button
                                    key={set.setId}
                                    className={`inline-flex min-h-9 items-center justify-center rounded-full border px-3 text-xs font-semibold ${
                                      isActive
                                        ? "border-slate-900 bg-slate-900 text-white"
                                        : isLogged
                                        ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                                        : "border-slate-300 text-slate-700"
                                    }`}
                                    onClick={() => setActiveSetId(set.setId)}
                                    type="button"
                                  >
                                    Set {set.setIndex}
                                    {set.wasSkipped ? " · Skipped" : ""}
                                    {isBaselineEligible(set) ? " · Baseline +" : ""}
                                  </button>
                                );
                              })}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </section>
      ) : null}

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

      {undoSnapshot ? (
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-slate-600">Set logged. Undo available for a few seconds.</p>
            <button
              className="inline-flex min-h-9 items-center justify-center rounded-full border border-slate-300 px-3 text-xs font-semibold text-slate-700"
              onClick={handleUndo}
              type="button"
            >
              Undo
            </button>
          </div>
        </div>
      ) : null}

      <div className="space-y-3">
        <div className="fixed inset-x-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom)+0.75rem)] z-20 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:inset-x-5 md:static md:inset-auto md:bottom-auto md:rounded-none md:border-0 md:bg-transparent md:p-0 md:shadow-none">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-xs text-slate-500">{loggedCount}/{totalSets} sets logged</div>
            {!completed && !skipped ? (
              <button
                className="inline-flex min-h-9 items-center justify-center rounded-full border border-slate-300 px-3 text-xs font-semibold text-slate-700"
                onClick={() => setFooterExpanded((prev) => !prev)}
                type="button"
              >
                {footerExpanded ? "Hide actions" : "More actions"}
              </button>
            ) : null}
          </div>
          <div className="grid gap-2 md:flex md:flex-wrap md:items-center md:gap-3">
            <button
              className="inline-flex min-h-11 w-full items-center justify-center rounded-full bg-slate-900 px-6 py-2 text-sm font-semibold text-white disabled:opacity-60 sm:w-auto"
              onClick={handleCompleteWorkout}
              disabled={completed || skipped}
            >
              {completed ? "Workout completed" : "Mark workout completed"}
            </button>
            {footerExpanded || completed || skipped ? (
              <button
                className="inline-flex min-h-11 w-full items-center justify-center rounded-full border border-slate-300 px-6 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60 sm:w-auto"
                onClick={handleSkipWorkout}
                disabled={completed || skipped}
              >
                {skipped ? "Workout skipped" : "Mark workout skipped"}
              </button>
            ) : null}
          </div>
          {!completed && !skipped && footerExpanded ? (
            <div className="mt-2">
              <button
                className="inline-flex min-h-9 items-center justify-center rounded-full border border-slate-300 px-3 text-xs font-semibold text-slate-700"
                onClick={() => setShowSkipOptions((prev) => !prev)}
                type="button"
              >
                {showSkipOptions ? "Hide skip reason" : "Add skip reason"}
              </button>
              {showSkipOptions ? (
                <label className="mt-2 block text-xs font-medium text-slate-500">
                  Skip reason (optional)
                  <input
                    className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    placeholder="Travel, low energy, time constraints"
                    value={skipReason}
                    onChange={(event) => setSkipReason(event.target.value)}
                  />
                </label>
              ) : null}
            </div>
          ) : null}
          {!completed && !skipped ? (
            <div className="mt-2 text-[11px] text-slate-500">
              {footerExpanded
                ? "Tip: collapse actions to reclaim screen space."
                : "Use “More actions” to reveal skip controls."}
            </div>
          ) : null}
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





