"use client";

import type { FocusEventHandler, RefObject } from "react";
import { toDisplayLoad } from "@/lib/ui/load-display";
import type {
  ActiveSetDraftState,
  FlatSetItem,
  LogExerciseInput,
  LogSetInput,
  PrefilledFieldState,
  SetDraftBuffers,
} from "@/components/log-workout/types";

function formatTargetReps(set: LogSetInput): string {
  if (set.targetRepRange && set.targetRepRange.min !== set.targetRepRange.max) {
    return `${set.targetRepRange.min}-${set.targetRepRange.max} reps`;
  }

  return `${set.targetReps} reps`;
}

function isBodyweightExercise(exercise: LogExerciseInput): boolean {
  return (exercise.equipment ?? []).some((item) => item.toLowerCase() === "bodyweight");
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

export type WorkoutActiveSetCardSummary = {
  loggedCount: number;
  totalSets: number;
  resolvedActiveSetId: string | null;
  loggedSetIds: Set<string>;
  autoregHintMessage: string | null;
  savingSetId: string | null;
  status: string | null;
  hasPreviousSet: boolean;
};

export type WorkoutActiveSetCardFormActions = {
  handleNumericFieldFocus: () => void;
  primeNumericBuffer: (
    setId: string,
    value: number | null | undefined,
    field: keyof SetDraftBuffers
  ) => void;
  commitNumericBuffer: (
    setId: string,
    rawValue: string,
    field: keyof PrefilledFieldState,
    draftField: keyof SetDraftBuffers,
    applyValue: (nextRaw: string) => void
  ) => void;
  handleLoadFocus: () => void;
  handleLoadBlur: FocusEventHandler<HTMLInputElement>;
  markFieldTouched: (setId: string, field: keyof PrefilledFieldState) => void;
  setFieldPrefilled: (setId: string, field: keyof PrefilledFieldState, isPrefilled: boolean) => void;
  setRepsValue: (setId: string, value: number | null) => void;
  setLoadValue: (
    setId: string,
    rawValue: string,
    isDumbbell: boolean,
    options?: { commit?: boolean }
  ) => void;
  setRpeValue: (setId: string, rawValue: string, options?: { commit?: boolean }) => void;
  setSingleField: (setId: string, field: keyof LogSetInput, value: number | boolean | null) => void;
  updateDraftBuffer: (setId: string, field: keyof SetDraftBuffers, value: string) => void;
};

type WorkoutActiveSetCardProps = {
  activeSet: FlatSetItem;
  activeSetPanelRef: RefObject<HTMLElement | null>;
  summary: WorkoutActiveSetCardSummary;
  draftState: ActiveSetDraftState;
  formActions: WorkoutActiveSetCardFormActions;
  isDumbbellExercise: (exercise: LogExerciseInput) => boolean;
  toInputNumberString: (value: number | null | undefined) => string;
  parseNullableNumber: (raw: string) => number | null;
  onLogSet: () => void;
  onUseSameAsLast: () => void;
  onSkipSet: () => void;
};

export function WorkoutActiveSetCard({
  activeSet,
  activeSetPanelRef,
  summary,
  draftState,
  formActions,
  isDumbbellExercise,
  toInputNumberString,
  parseNullableNumber,
  onLogSet,
  onUseSameAsLast,
  onSkipSet,
}: WorkoutActiveSetCardProps) {
  const setId = activeSet.set.setId;
  const isDumbbell = isDumbbellExercise(activeSet.exercise);
  const {
    loggedCount,
    totalSets,
    resolvedActiveSetId,
    loggedSetIds,
    autoregHintMessage,
    savingSetId,
    status,
    hasPreviousSet,
  } = summary;
  const {
    draftBuffersBySet,
    prefilledFieldsBySet,
    touchedFieldsBySet,
    restoredSetIds,
    savingDraftSetId,
    lastSavedDraft,
  } = draftState;
  const {
    handleNumericFieldFocus,
    primeNumericBuffer,
    commitNumericBuffer,
    handleLoadFocus,
    handleLoadBlur,
    markFieldTouched,
    setFieldPrefilled,
    setRepsValue,
    setLoadValue,
    setRpeValue,
    setSingleField,
    updateDraftBuffer,
  } = formActions;
  const repsDraft = draftBuffersBySet[setId]?.reps ?? toInputNumberString(activeSet.set.actualReps);
  const loadDraft = draftBuffersBySet[setId]?.load ?? toInputNumberString(activeSet.set.actualLoad);
  const rpeDraft = draftBuffersBySet[setId]?.rpe ?? toInputNumberString(activeSet.set.actualRpe);

  return (
    <section
      ref={activeSetPanelRef}
      className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5"
      style={{ scrollMarginBottom: "calc(var(--mobile-nav-height, 56px) + env(safe-area-inset-bottom, 0px))" }}
    >
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
        {resolvedActiveSetId && loggedSetIds.has(resolvedActiveSetId) ? (
          <p className="mt-0.5 text-xs font-semibold text-amber-700">Editing set (previously logged)</p>
        ) : null}
        <p className="mt-1 text-sm text-slate-500">
          {activeSet.sectionLabel} · Set {activeSet.set.setIndex} of {activeSet.exercise.sets.length} · Target{" "}
          {formatTargetReps(activeSet.set)}
          {activeSet.set.targetLoad != null
            ? ` | ${
                isDumbbell
                  ? `${toDisplayLoad(activeSet.set.targetLoad, true)} lbs each`
                  : `${activeSet.set.targetLoad} lbs`
              }`
            : ""}
          {activeSet.set.targetRpe ? ` | RPE ${activeSet.set.targetRpe}` : ""}
        </p>
        {autoregHintMessage ? (
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">{autoregHintMessage}</p>
        ) : null}
      </div>
      {shouldUseBodyweightLoadLabel(activeSet.exercise, activeSet.set) ? (
        <p className="mt-2 text-xs text-slate-500">Bodyweight movement (load optional for weighted variation).</p>
      ) : null}
      {restoredSetIds.has(setId) ? <p className="mt-2 text-xs text-slate-500">Draft restored</p> : null}
      {savingDraftSetId === setId ? (
        <p className="mt-1 text-xs text-slate-500">Saving draft...</p>
      ) : lastSavedDraft?.setId === setId ? (
        <p className="mt-1 text-xs text-slate-500">
          Draft saved {new Date(lastSavedDraft.savedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
        </p>
      ) : null}

      <div className="mt-4 space-y-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Reps</p>
          <div className="mt-1 flex items-center gap-2">
            <button
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-slate-300 px-3 text-sm font-semibold text-slate-700"
              onClick={() => {
                const nextReps = clampReps(activeSet.set.actualReps, -1);
                markFieldTouched(setId, "actualReps");
                setFieldPrefilled(setId, "actualReps", false);
                setRepsValue(setId, nextReps);
              }}
              type="button"
            >
              -1
            </button>
            <input
              aria-label="Reps"
              className={`min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-base ${
                prefilledFieldsBySet[setId]?.actualReps && !touchedFieldsBySet[setId]?.actualReps
                  ? "text-slate-400"
                  : "text-slate-900"
              }`}
              type="number"
              inputMode="numeric"
              value={repsDraft}
              onFocus={() => {
                handleNumericFieldFocus();
                primeNumericBuffer(setId, activeSet.set.actualReps, "reps");
              }}
              onBlur={() => {
                commitNumericBuffer(setId, repsDraft, "actualReps", "reps", (nextRaw) =>
                  setSingleField(setId, "actualReps", parseNullableNumber(nextRaw))
                );
              }}
              onChange={(event) => {
                const nextValue = event.target.value;
                updateDraftBuffer(setId, "reps", nextValue);
              }}
            />
            <button
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-slate-300 px-3 text-sm font-semibold text-slate-700"
              onClick={() => {
                const nextReps = clampReps(activeSet.set.actualReps, 1);
                markFieldTouched(setId, "actualReps");
                setFieldPrefilled(setId, "actualReps", false);
                setRepsValue(setId, nextReps);
              }}
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
              : isDumbbell
              ? "Load per dumbbell (lbs)"
              : "Load (lbs)"}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {[-5, -2.5, 2.5, 5].map((delta) => (
              <button
                key={`${setId}-delta-${delta}`}
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-slate-300 px-3 text-xs font-semibold text-slate-700"
                onClick={() => {
                  const bufferedLoad = parseNullableNumber(draftBuffersBySet[setId]?.load ?? "");
                  const nextLoad = normalizeStepValue(
                    bufferedLoad ?? activeSet.set.actualLoad,
                    activeSet.set.targetLoad,
                    delta
                  );
                  setSingleField(setId, "actualLoad", nextLoad);
                  updateDraftBuffer(setId, "load", toInputNumberString(nextLoad));
                  markFieldTouched(setId, "actualLoad");
                  setFieldPrefilled(setId, "actualLoad", false);
                }}
                type="button"
              >
                {delta > 0 ? `+${delta}` : delta}
              </button>
            ))}
            <button
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-slate-300 px-3 text-xs font-semibold text-slate-700"
              onClick={() => {
                setSingleField(setId, "actualLoad", null);
                updateDraftBuffer(setId, "load", "");
                markFieldTouched(setId, "actualLoad");
                setFieldPrefilled(setId, "actualLoad", false);
              }}
              type="button"
            >
              Clear
            </button>
          </div>
          <input
            aria-label="Load"
            className={`mt-2 min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-base ${
              prefilledFieldsBySet[setId]?.actualLoad && !touchedFieldsBySet[setId]?.actualLoad
                ? "text-slate-400"
                : "text-slate-900"
            }`}
            type="number"
            step="0.5"
            inputMode="decimal"
            value={loadDraft}
            onFocus={() => {
              handleNumericFieldFocus();
              handleLoadFocus();
            }}
            onBlur={handleLoadBlur}
            onChange={(event) => {
              setLoadValue(setId, event.target.value, isDumbbell);
            }}
          />
        </div>

        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">RPE</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {[6, 7, 8, 9, 10].map((preset) => (
              <button
                key={`${setId}-rpe-${preset}`}
                className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border px-3 text-xs font-semibold ${
                  activeSet.set.actualRpe === preset
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-300 text-slate-700"
                }`}
                onClick={() => {
                  setRpeValue(setId, toInputNumberString(preset), { commit: true });
                  markFieldTouched(setId, "actualRpe");
                  setFieldPrefilled(setId, "actualRpe", false);
                }}
                type="button"
              >
                {preset}
              </button>
            ))}
          </div>
          <input
            aria-label="RPE"
            className={`mt-2 min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-base ${
              prefilledFieldsBySet[setId]?.actualRpe && !touchedFieldsBySet[setId]?.actualRpe
                ? "text-slate-400"
                : "text-slate-900"
            }`}
            type="number"
            step="0.5"
            inputMode="decimal"
            value={rpeDraft}
            onFocus={() => {
              handleNumericFieldFocus();
              primeNumericBuffer(setId, activeSet.set.actualRpe, "rpe");
            }}
            onBlur={() => {
              commitNumericBuffer(setId, rpeDraft, "actualRpe", "rpe", (nextRaw) =>
                setSingleField(setId, "actualRpe", parseNullableNumber(nextRaw))
              );
            }}
            onChange={(event) => {
              setRpeValue(setId, event.target.value);
            }}
          />
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <button
          className="inline-flex min-h-11 items-center justify-center rounded-full bg-slate-900 px-6 py-2 text-sm font-semibold text-white disabled:opacity-60"
          onClick={onLogSet}
          disabled={savingSetId === setId}
          type="button"
        >
          {savingSetId === setId ? (
            <span className="inline-flex items-center gap-2">
              <span
                data-testid="log-set-spinner"
                className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"
              />
              Saving...
            </span>
          ) : resolvedActiveSetId && loggedSetIds.has(resolvedActiveSetId) ? (
            "Update set"
          ) : (
            "Log set"
          )}
        </button>
        <button
          className="inline-flex min-h-11 items-center justify-center rounded-full border border-slate-300 px-6 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60"
          type="button"
          onClick={onUseSameAsLast}
          disabled={!hasPreviousSet}
        >
          Same as last
        </button>
        <button
          className="inline-flex min-h-11 items-center justify-center rounded-full border border-rose-300 px-6 py-2 text-sm font-semibold text-rose-700 disabled:opacity-60"
          onClick={onSkipSet}
          disabled={savingSetId === setId}
          type="button"
        >
          Skip set
        </button>
      </div>

      {status ? <p className="mt-3 text-sm text-emerald-600">{status}</p> : null}
    </section>
  );
}
