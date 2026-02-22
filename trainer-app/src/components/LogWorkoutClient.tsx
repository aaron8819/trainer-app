"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { isSetQualifiedForBaseline } from "@/lib/baseline-qualification";
import { BonusExerciseSheet } from "@/components/BonusExerciseSheet";
import { RestTimer } from "@/components/RestTimer";
import { isDumbbellEquipment, toDisplayLoad, toStoredLoad } from "@/lib/ui/load-display";
import {
  deleteSetLogRequest,
  logSetRequest,
  saveWorkoutRequest,
} from "@/components/log-workout/api";
import {
  formatSectionLabel,
  getNextUnloggedSetId,
  resolveRestSeconds,
  useWorkoutLogState,
} from "@/components/log-workout/useWorkoutLogState";
import type {
  AutoregHint,
  BaselineUpdateSummary,
  ExerciseSection,
  LogExerciseInput,
  LogSetInput,
  NormalizedExercises,
  SectionedExercises,
  UndoSnapshot,
} from "@/components/log-workout/types";
import { ActiveSetPanel } from "@/components/log-workout/ActiveSetPanel";
import { ExerciseListPanel } from "@/components/log-workout/ExerciseListPanel";
import { WorkoutFooter } from "@/components/log-workout/WorkoutFooter";

export type { LogExerciseInput, LogSetInput } from "@/components/log-workout/types";

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

function isDumbbellExercise(exercise: LogExerciseInput): boolean {
  return isDumbbellEquipment(exercise.equipment);
}

function shouldUseBodyweightLoadLabel(exercise: LogExerciseInput, set: LogSetInput): boolean {
  return isBodyweightExercise(exercise) && (set.targetLoad === null || set.targetLoad === undefined);
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

function buildSetChipLabel(set: LogSetInput, isLogged: boolean, isDumbbell = false): string {
  if (!isLogged) {
    return `Set ${set.setIndex}`;
  }
  if (set.wasSkipped) {
    return `Set ${set.setIndex} · Skipped`;
  }
  const parts: string[] = [`Set ${set.setIndex}`];
  if (set.actualLoad != null) {
    const displayLoad = toDisplayLoad(set.actualLoad, isDumbbell);
    const loadSuffix = isDumbbell ? " ea" : "";
    parts.push(`${displayLoad}${loadSuffix}×${set.actualReps ?? "?"}`);
  } else if (set.actualReps != null) {
    parts.push(`${set.actualReps} reps`);
  }
  if (set.actualRpe != null) {
    parts.push(`RPE ${set.actualRpe}`);
  }
  return parts.join(" · ");
}

export default function LogWorkoutClient({
  workoutId,
  exercises,
}: {
  workoutId: string;
  exercises: LogExerciseInput[] | SectionedExercises;
}) {
  const {
    data,
    setData,
    loggedSetIds,
    setLoggedSetIds,
    setActiveSetId,
    expandedSections,
    setExpandedSections,
    expandedExerciseId,
    setExpandedExerciseId,
    restTimerSeconds,
    setRestTimerSeconds,
    flatSets,
    activeSet,
  } = useWorkoutLogState(exercises);
  const [savingSetId, setSavingSetId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [baselineSummary, setBaselineSummary] = useState<BaselineUpdateSummary | null>(null);
  const [skipReason, setSkipReason] = useState("");
  const [showSkipOptions, setShowSkipOptions] = useState(false);
  const [footerExpanded, setFooterExpanded] = useState(false);
  const [undoSnapshot, setUndoSnapshot] = useState<UndoSnapshot | null>(null);
  const [autoregHint, setAutoregHint] = useState<AutoregHint | null>(null);
  const [showBonusSheet, setShowBonusSheet] = useState(false);

  const totalSets = flatSets.length;
  const loggedCount = loggedSetIds.size;
  const remainingCount = Math.max(0, totalSets - loggedCount);
  const allSetsLogged = loggedCount === totalSets && totalSets > 0;
  const resolvedActiveSetId = activeSet?.set.setId ?? null;

  const showAutoregHint =
    autoregHint !== null &&
    activeSet !== null &&
    autoregHint.exerciseId === activeSet.exercise.workoutExerciseId;

  // Performance summary for completion view
  const performanceSummary = useMemo(() => {
    return SECTION_ORDER.flatMap((section) =>
      data[section]
        .filter((exercise) => exercise.sets.some((s) => loggedSetIds.has(s.setId)))
        .map((exercise) => ({
          name: exercise.name,
          equipment: exercise.equipment,
          section,
          sets: exercise.sets.map((set) => ({
            setIndex: set.setIndex,
            targetReps: set.targetReps,
            targetRepRange: set.targetRepRange,
            targetLoad: set.targetLoad,
            targetRpe: set.targetRpe,
            actualReps: set.actualReps,
            actualLoad: set.actualLoad,
            actualRpe: set.actualRpe,
            wasLogged: loggedSetIds.has(set.setId),
            wasSkipped: set.wasSkipped ?? false,
          })),
        }))
    );
  }, [data, loggedSetIds]);

  const rpeAdherence = useMemo(() => {
    const setsWithBothRpe = flatSets.filter(
      (item) =>
        loggedSetIds.has(item.set.setId) &&
        !(item.set.wasSkipped ?? false) &&
        item.set.actualRpe != null &&
        item.set.targetRpe != null
    );
    if (setsWithBothRpe.length === 0) return null;
    const adherent = setsWithBothRpe.filter(
      (item) => Math.abs((item.set.actualRpe ?? 0) - (item.set.targetRpe ?? 0)) <= 1.0
    ).length;
    return { adherent, total: setsWithBothRpe.length };
  }, [flatSets, loggedSetIds]);

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

  const findPreviousLoggedSet = (exercise: LogExerciseInput, currentSetIndex: number) => {
    for (let index = currentSetIndex - 1; index >= 0; index -= 1) {
      const candidate = exercise.sets[index];
      if (!candidate) continue;
      if (!loggedSetIds.has(candidate.setId)) continue;
      if (candidate.wasSkipped) continue;
      return candidate;
    }
    return null;
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

    const response = await logSetRequest({
      workoutSetId: targetSet.set.setId,
      actualReps: mergedSet.actualReps ?? undefined,
      actualLoad: mergedSet.actualLoad ?? undefined,
      actualRpe: mergedSet.actualRpe ?? undefined,
      wasSkipped: mergedSet.wasSkipped ?? false,
    });

    if (response.error) {
      setError(response.error);
      setSavingSetId(null);
      return;
    }
    const body = response.data;

    updateSetFields(setId, (set) => ({ ...set, ...mergedSet }));

    const nextLogged = new Set(loggedSetIds);
    nextLogged.add(setId);
    setLoggedSetIds(nextLogged);
    setUndoSnapshot({
      setId,
      previousSet: targetSet.set,
      previousLog: body?.previousLog ?? null,
      wasCreated: body?.wasCreated ?? !loggedSetIds.has(setId),
      expiresAt: Date.now() + 5000,
    });

    // Only auto-advance on first log (not re-log of existing set)
    if (!loggedSetIds.has(setId)) {
      const nextSetId = getNextUnloggedSetId(flatSets, nextLogged, setId);
      if (nextSetId) {
        setActiveSetId(nextSetId);
      }
    }

    if (!(mergedSet.wasSkipped ?? false)) {
      setRestTimerSeconds(resolveRestSeconds(targetSet));
    }

    // Advisory autoregulation hint for next set in same exercise
    const nextExerciseSet = flatSets.find(
      (item) =>
        item.exercise.workoutExerciseId === targetSet.exercise.workoutExerciseId &&
        !nextLogged.has(item.set.setId) &&
        item.set.targetRpe != null
    );
    if (nextExerciseSet && mergedSet.actualRpe != null && nextExerciseSet.set.targetRpe != null) {
      const diff = mergedSet.actualRpe - nextExerciseSet.set.targetRpe;
      if (diff <= -1.5) {
        setAutoregHint({
          exerciseId: targetSet.exercise.workoutExerciseId,
          message: "Set felt easier than target. Consider +2.5–5 lbs for next set.",
        });
      } else if (diff >= 1.0) {
        setAutoregHint({
          exerciseId: targetSet.exercise.workoutExerciseId,
          message: "Set was harder than target. Consider -2.5 lbs or -1 rep.",
        });
      } else {
        setAutoregHint(null);
      }
    } else {
      setAutoregHint(null);
    }

    setStatus(loggedSetIds.has(setId) ? "Set updated" : "Set logged");
    setSavingSetId(null);
  };

  const handleUndo = async () => {
    if (!undoSnapshot) {
      return;
    }
    setStatus(null);
    setError(null);
    setSavingSetId(undoSnapshot.setId);

    try {
      if (undoSnapshot.wasCreated) {
        const response = await deleteSetLogRequest(undoSnapshot.setId);
        if (response.error) {
          setError(response.error);
          setSavingSetId(null);
          return;
        }
        if (undoSnapshot.previousSet) {
          updateSetFields(undoSnapshot.setId, () => undoSnapshot.previousSet as LogSetInput);
        }
        setLoggedSetIds((prev) => {
          const next = new Set(prev);
          next.delete(undoSnapshot.setId);
          return next;
        });
      } else {
        const deleteResponse = await deleteSetLogRequest(undoSnapshot.setId);
        if (deleteResponse.error) {
          setError(deleteResponse.error);
          setSavingSetId(null);
          return;
        }

        const restoreResponse = await logSetRequest({
          workoutSetId: undoSnapshot.setId,
          actualReps: undoSnapshot.previousLog?.actualReps ?? undefined,
          actualLoad: undoSnapshot.previousLog?.actualLoad ?? undefined,
          actualRpe: undoSnapshot.previousLog?.actualRpe ?? undefined,
          wasSkipped: undoSnapshot.previousLog?.wasSkipped ?? false,
        });
        if (restoreResponse.error) {
          setError(restoreResponse.error);
          setSavingSetId(null);
          return;
        }
        if (undoSnapshot.previousSet) {
          updateSetFields(undoSnapshot.setId, () => undoSnapshot.previousSet as LogSetInput);
        }
      }

      setActiveSetId(undoSnapshot.setId);
      setUndoSnapshot(null);
      setStatus("Last set log reverted");
    } catch {
      setError("Failed to undo set log");
    } finally {
      setSavingSetId(null);
    }
  };

  const handleCompleteWorkout = async () => {
    if (completing || skipping) {
      return;
    }
    setCompleting(true);
    setStatus(null);
    setError(null);
    setBaselineSummary(null);

    try {
      const response = await saveWorkoutRequest({
        workoutId,
        action: "mark_completed",
        status: "COMPLETED",
        exercises: [],
      });

      if (response.error) {
        setError(response.error);
        return;
      }

      const body = response.data;
      setBaselineSummary((body?.baselineSummary as BaselineUpdateSummary | null | undefined) ?? null);
      setCompleted(true);
      setStatus(
        body?.workoutStatus === "PARTIAL"
          ? "Workout saved as partial (some planned sets were unresolved)"
          : "Workout marked as completed"
      );
    } catch {
      setError("Failed to mark workout completed");
    } finally {
      setCompleting(false);
    }
  };

  const handleSkipWorkout = async () => {
    if (skipping || completing) {
      return;
    }
    setSkipping(true);
    setStatus(null);
    setError(null);
    setBaselineSummary(null);

    try {
      const response = await saveWorkoutRequest({
        workoutId,
        action: "mark_skipped",
        status: "SKIPPED",
        notes: skipReason ? `Skipped: ${skipReason}` : "Skipped",
        exercises: [],
      });

      if (response.error) {
        setError(response.error);
        return;
      }

      setSkipped(true);
      setStatus("Workout marked as skipped");
    } catch {
      setError("Failed to mark workout skipped");
    } finally {
      setSkipping(false);
    }
  };

  const handleAddExercise = (exercise: LogExerciseInput) => {
    setData((prev) => ({
      ...prev,
      accessory: [...prev.accessory, exercise],
    }));
    // Open the accessory section and activate the first set of the new exercise
    setExpandedSections((prev) => ({ ...prev, accessory: true }));
    if (exercise.sets[0]) {
      setActiveSetId(exercise.sets[0].setId);
    }
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
    <div className="mt-5 space-y-5 pb-8 sm:mt-6 sm:space-y-6">
      {/* 1A: Green completion banner when all sets logged */}
      {!completed && !skipped && allSetsLogged ? (
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 sm:p-5">
          <p className="font-semibold text-emerald-900">All sets logged — great work!</p>
          <p className="mt-1 text-sm text-emerald-700">
            {loggedCount}/{totalSets} sets completed. Tap below to save your session.
          </p>
          <div className="mt-4">
            <button
              className="inline-flex min-h-11 items-center justify-center rounded-full bg-emerald-700 px-6 py-2 text-sm font-semibold text-white disabled:opacity-60"
              onClick={handleCompleteWorkout}
              disabled={completed || skipped || completing || skipping}
              type="button"
            >
              Complete Workout
            </button>
          </div>
          {error ? <p className="mt-3 text-sm text-rose-600">{error}</p> : null}
        </section>
      ) : !completed && !skipped && activeSet ? (
        /* Active set card */
        <ActiveSetPanel>
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
            {/* 1B: Editing label */}
            {resolvedActiveSetId && loggedSetIds.has(resolvedActiveSetId) ? (
              <p className="mt-0.5 text-xs font-semibold text-amber-700">Editing set (previously logged)</p>
            ) : null}
            <p className="mt-1 text-sm text-slate-500">
              {activeSet.sectionLabel} · Set {activeSet.set.setIndex} of {activeSet.exercise.sets.length} · Target{" "}
              {formatTargetReps(activeSet.set)}
              {activeSet.set.targetLoad != null
                ? ` | ${isDumbbellExercise(activeSet.exercise) ? `${toDisplayLoad(activeSet.set.targetLoad, true)} lbs each` : `${activeSet.set.targetLoad} lbs`}`
                : ""}
              {activeSet.set.targetRpe ? ` | RPE ${activeSet.set.targetRpe}` : ""}
            </p>
            {/* 1D: Advisory autoregulation hint */}
            {showAutoregHint ? (
              <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                {autoregHint!.message}
              </p>
            ) : null}
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
                  : isDumbbellExercise(activeSet.exercise)
                  ? "Load per dumbbell (lbs)"
                  : "Load (lbs)"}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {[-5, -2.5, 2.5, 5].map((delta) => {
                  const isDB = isDumbbellExercise(activeSet.exercise);
                  return (
                    <button
                      key={`${activeSet.set.setId}-delta-${delta}`}
                      className="inline-flex min-h-10 items-center justify-center rounded-full border border-slate-300 px-3 text-xs font-semibold text-slate-700"
                      onClick={() =>
                        setSingleField(
                          activeSet.set.setId,
                          "actualLoad",
                          toStoredLoad(
                            normalizeStepValue(
                              toDisplayLoad(activeSet.set.actualLoad, isDB),
                              toDisplayLoad(activeSet.set.targetLoad, isDB),
                              delta
                            ),
                            isDB
                          )
                        )
                      }
                      type="button"
                    >
                      {delta > 0 ? `+${delta}` : delta}
                    </button>
                  );
                })}
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
                value={toDisplayLoad(activeSet.set.actualLoad, isDumbbellExercise(activeSet.exercise)) ?? ""}
                onChange={(event) =>
                  setSingleField(
                    activeSet.set.setId,
                    "actualLoad",
                    toStoredLoad(parseNullableNumber(event.target.value), isDumbbellExercise(activeSet.exercise))
                  )
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
              {savingSetId === activeSet.set.setId
                ? "Saving..."
                : resolvedActiveSetId && loggedSetIds.has(resolvedActiveSetId)
                ? "Update set"
                : "Log set"}
            </button>
            <button
              className="inline-flex min-h-11 items-center justify-center rounded-full border border-slate-300 px-6 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60"
              type="button"
              onClick={() => {
                const previousSet = findPreviousLoggedSet(activeSet.exercise, activeSet.setIndex);
                if (!previousSet) {
                  return;
                }
                setSingleField(activeSet.set.setId, "actualReps", previousSet.actualReps ?? null);
                setSingleField(activeSet.set.setId, "actualLoad", previousSet.actualLoad ?? null);
                setSingleField(activeSet.set.setId, "actualRpe", previousSet.actualRpe ?? null);
                setSingleField(activeSet.set.setId, "wasSkipped", false);
              }}
              disabled={findPreviousLoggedSet(activeSet.exercise, activeSet.setIndex) === null}
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
        </ActiveSetPanel>
      ) : null}

      {!completed && !skipped && restTimerSeconds !== null ? (
        <RestTimer
          durationSeconds={restTimerSeconds}
          onDismiss={() => setRestTimerSeconds(null)}
          onAdjust={(deltaSeconds: number) =>
            setRestTimerSeconds((prev) => {
              if (prev === null) return null;
              return Math.max(0, prev + deltaSeconds);
            })
          }
        />
      ) : null}

      {!completed && !skipped ? (
        <ExerciseListPanel>
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
                      const allExerciseSetsLogged =
                        exerciseLogged === exercise.sets.length && exercise.sets.length > 0;
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
                            {/* 1C: ✓ when all sets logged */}
                            <span
                              className={`text-xs ${allExerciseSetsLogged ? "font-semibold text-emerald-700" : "text-slate-500"}`}
                            >
                              {allExerciseSetsLogged ? "✓ " : ""}
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
                                    {/* 1C: actual values in logged chips */}
                                    {buildSetChipLabel(set, isLogged, isDumbbellExercise(exercise))}
                                    {isLogged && isBaselineEligible(set) ? " · Baseline +" : ""}
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
        </ExerciseListPanel>
      ) : null}

      {/* Phase 3: Add Exercise button */}
      {!completed && !skipped ? (
        <div className="flex justify-center">
          <button
            className="inline-flex min-h-10 items-center justify-center rounded-full border border-slate-300 px-5 text-sm font-semibold text-slate-700"
            onClick={() => setShowBonusSheet(true)}
            type="button"
          >
            + Add Exercise
          </button>
        </div>
      ) : null}

      {/* Phase 2: Inline post-workout analysis */}
      {completed ? (
        <div className="space-y-5 sm:space-y-6">
          {/* Session Score */}
          <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 sm:p-5">
            <p className="font-semibold text-emerald-900">Session complete!</p>
            <div className="mt-3 grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-emerald-700">Sets logged</p>
                <p className="text-2xl font-bold text-emerald-900">
                  {totalSets > 0 ? Math.round((loggedCount / totalSets) * 100) : 0}%
                </p>
                <p className="text-xs text-emerald-600">
                  {loggedCount}/{totalSets} sets
                </p>
              </div>
              {rpeAdherence ? (
                <div>
                  <p className="text-xs text-emerald-700">RPE adherence</p>
                  <p className="text-2xl font-bold text-emerald-900">
                    {Math.round((rpeAdherence.adherent / rpeAdherence.total) * 100)}%
                  </p>
                  <p className="text-xs text-emerald-600">
                    {rpeAdherence.adherent}/{rpeAdherence.total} on target
                  </p>
                </div>
              ) : null}
            </div>
          </section>

          {/* Performance Comparison */}
          {performanceSummary.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Performance</h2>
              {performanceSummary.map((exercise) => {
                const isDB = isDumbbellEquipment(exercise.equipment);
                return (
                <div key={exercise.name} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <p className="font-medium text-slate-900">{exercise.name}</p>
                  <div className="mt-3 space-y-2">
                    {exercise.sets.map((set) => {
                      const repDiff = (set.actualReps ?? 0) - (set.targetReps ?? 0);
                      const actualColor = !set.wasLogged
                        ? "text-slate-400"
                        : set.wasSkipped
                        ? "text-slate-500"
                        : repDiff >= 0
                        ? "text-emerald-700"
                        : repDiff === -1
                        ? "text-amber-700"
                        : "text-rose-700";
                      const targetLabel = [
                        set.targetRepRange && set.targetRepRange.min !== set.targetRepRange.max
                          ? `${set.targetRepRange.min}–${set.targetRepRange.max} reps`
                          : `${set.targetReps} reps`,
                        set.targetLoad != null
                          ? (isDB ? `${toDisplayLoad(set.targetLoad, true)} lbs each` : `${set.targetLoad} lbs`)
                          : null,
                        set.targetRpe ? `RPE ${set.targetRpe}` : null,
                      ]
                        .filter(Boolean)
                        .join(" | ");
                      const actualLabel = !set.wasLogged
                        ? "—"
                        : set.wasSkipped
                        ? "Skipped"
                        : [
                            set.actualReps != null ? `${set.actualReps} reps` : null,
                            set.actualLoad != null
                              ? (isDB ? `${toDisplayLoad(set.actualLoad, true)} lbs each` : `${set.actualLoad} lbs`)
                              : null,
                            set.actualRpe != null ? `RPE ${set.actualRpe}` : null,
                          ]
                            .filter(Boolean)
                            .join(" | ");
                      return (
                        <div key={set.setIndex} className="rounded-lg bg-slate-50 px-3 py-2">
                          <div className="flex items-center justify-between gap-2 text-xs">
                            <span className="shrink-0 font-medium text-slate-700">Set {set.setIndex}</span>
                            <span className="text-slate-500">{targetLabel}</span>
                          </div>
                          <div className={`mt-0.5 text-xs font-medium ${actualColor}`}>
                            {actualLabel}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
              })}
            </section>
          ) : null}

          {/* Enhanced Baseline Summary */}
          {baselineSummary ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
              <p className="font-semibold text-slate-900">Strength updates</p>
              <p className="mt-1 text-sm text-slate-600">
                {baselineSummary.updated > 0
                  ? `${baselineSummary.updated} personal record${baselineSummary.updated === 1 ? "" : "s"} set this session.`
                  : "No new personal records this session."}
              </p>
              {baselineSummary.items.length > 0 ? (
                <div className="mt-3 space-y-2">
                  {baselineSummary.items.map((item) => (
                    <div
                      key={`${item.exerciseName}-${item.newTopSetWeight}`}
                      className="flex flex-wrap items-center gap-2"
                    >
                      <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                        PR
                      </span>
                      <span className="font-medium text-slate-900">{item.exerciseName}</span>
                      <span className="text-slate-600">
                        {item.previousTopSetWeight ? `${item.previousTopSetWeight} → ` : ""}
                        {item.newTopSetWeight} lbs × {item.reps}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
              {baselineSummary.skippedItems.length > 0 ? (
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {baselineSummary.skipped} exercise{baselineSummary.skipped === 1 ? "" : "s"} evaluated,
                    no update
                  </summary>
                  <div className="mt-2 space-y-1">
                    {baselineSummary.skippedItems.map((item) => (
                      <div
                        key={`${item.exerciseName}-${item.reason}`}
                        className="text-xs text-slate-500"
                      >
                        {item.exerciseName}: {item.reason}
                      </div>
                    ))}
                  </div>
                </details>
              ) : null}
            </div>
          ) : null}

          {/* What's Next */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
            <p className="font-semibold text-slate-900">What&apos;s next</p>
            <p className="mt-2 text-sm text-slate-600">
              Allow 48–72h before training these muscles again. Log a readiness check-in before your next
              session.
            </p>
            <Link
              className="mt-4 inline-flex min-h-10 items-center justify-center rounded-full bg-slate-900 px-5 text-sm font-semibold text-white"
              href="/"
            >
              Generate next workout
            </Link>
          </div>
        </div>
      ) : null}

      {undoSnapshot ? (
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-slate-600">Set logged. Undo available for a few seconds.</p>
            <button
              className="inline-flex min-h-9 items-center justify-center rounded-full border border-slate-300 px-3 text-xs font-semibold text-slate-700"
              onClick={handleUndo}
              disabled={savingSetId !== null}
              type="button"
            >
              Undo
            </button>
          </div>
        </div>
      ) : null}

      {/* Phase 3: Bonus exercise sheet */}
      <BonusExerciseSheet
        isOpen={showBonusSheet}
        onClose={() => setShowBonusSheet(false)}
        workoutId={workoutId}
        onAdd={handleAddExercise}
      />

      {/* 1A: Footer made always inline (no fixed positioning) */}
      <WorkoutFooter>
        <div className="space-y-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm md:rounded-none md:border-0 md:bg-transparent md:p-0 md:shadow-none">
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
              disabled={completed || skipped || completing || skipping}
            >
              {completed ? "Workout completed" : "Mark workout completed"}
            </button>
            {footerExpanded || completed || skipped ? (
              <button
                className="inline-flex min-h-11 w-full items-center justify-center rounded-full border border-slate-300 px-6 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60 sm:w-auto"
                onClick={handleSkipWorkout}
                disabled={completed || skipped || completing || skipping}
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
                : "Use \u201cMore actions\u201d to reveal skip controls."}
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
      </WorkoutFooter>
    </div>
  );
}
