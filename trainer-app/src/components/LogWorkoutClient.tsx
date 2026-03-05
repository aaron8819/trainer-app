"use client";

import { useCallback, useMemo, useState } from "react";
import { BonusExerciseSheet } from "@/components/BonusExerciseSheet";
import { isDumbbellEquipment, toDisplayLoad, toStoredLoad } from "@/lib/ui/load-display";
import { quantizeLoad } from "@/lib/units/load-quantization";
import { useWorkoutLogState } from "@/components/log-workout/useWorkoutLogState";
import type {
  ActiveSetDraftState,
  CompletedWorkoutExerciseSummary,
  ExerciseSection,
  LogExerciseInput,
  LogSetInput,
  NormalizedExercises,
  RpeAdherenceSummary,
  SectionedExercises,
} from "@/components/log-workout/types";
import { ActiveSetPanel } from "@/components/log-workout/ActiveSetPanel";
import { CompletedWorkoutReview } from "@/components/log-workout/CompletedWorkoutReview";
import { ExerciseListPanel } from "@/components/log-workout/ExerciseListPanel";
import {
  WorkoutActiveSetCard,
  type WorkoutActiveSetCardFormActions,
  type WorkoutActiveSetCardSummary,
} from "@/components/log-workout/WorkoutActiveSetCard";
import { WorkoutCompletionDialog } from "@/components/log-workout/WorkoutCompletionDialog";
import { WorkoutExerciseQueue } from "@/components/log-workout/WorkoutExerciseQueue";
import { WorkoutFooter } from "@/components/log-workout/WorkoutFooter";
import { WorkoutSessionFeedback } from "@/components/log-workout/WorkoutSessionFeedback";
import { WorkoutSessionActions } from "@/components/log-workout/WorkoutSessionActions";
import { WorkoutTimerHud } from "@/components/log-workout/WorkoutTimerHud";
import { useActiveSetDraftState } from "@/components/log-workout/useActiveSetDraftState";
import { usePersistedWorkoutSessionUi } from "@/components/log-workout/usePersistedWorkoutSessionUi";
import { useRestTimerState } from "@/components/log-workout/useRestTimerState";
import { useWorkoutSessionLayout } from "@/components/log-workout/useWorkoutSessionLayout";
import { useWorkoutSessionFlow } from "@/components/log-workout/useWorkoutSessionFlow";
import { useWorkoutSetHistoryActions } from "@/components/log-workout/useWorkoutSetHistoryActions";

export type { LogExerciseInput, LogSetInput } from "@/components/log-workout/types";

const SECTION_ORDER: ExerciseSection[] = ["warmup", "main", "accessory"];

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

function toInputNumberString(value: number | null | undefined): string {
  if (value == null) {
    return "";
  }

  return String(value);
}

function normalizeLoadInput(raw: string, isDumbbell: boolean): number | null {
  const parsed = parseNullableNumber(raw);
  if (parsed == null) {
    return null;
  }

  const stored = toStoredLoad(toDisplayLoad(parsed, isDumbbell) ?? null, isDumbbell) ?? null;
  return stored == null ? null : quantizeLoad(stored);
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
    flatSets,
    activeSet,
  } = useWorkoutLogState(exercises);
  const { restTimer, startTimer, clearTimer, restoreTimer, adjustTimer } = useRestTimerState(workoutId);
  const [showBonusSheet, setShowBonusSheet] = useState(false);

  const totalSets = flatSets.length;
  const loggedCount = loggedSetIds.size;
  const remainingCount = Math.max(0, totalSets - loggedCount);
  const resolvedActiveSetId = activeSet?.set.setId ?? null;
  const activeSetIds = useMemo(() => flatSets.map((item) => item.set.setId), [flatSets]);
  const { keyboardOpen, keyboardHeight, activeSetPanelRef, sectionRefs, jumpToActiveSet } =
    useWorkoutSessionLayout();

  const { restTimerMuted, setRestTimerMuted } = usePersistedWorkoutSessionUi({
    workoutId,
    activeSetIds,
    resolvedActiveSetId,
    setActiveSetId,
    onResumeSet: jumpToActiveSet,
  });

  const performanceSummary = useMemo<CompletedWorkoutExerciseSummary[]>(() => {
    return SECTION_ORDER.flatMap((section) =>
      data[section]
        .filter((exercise) => exercise.sets.some((set) => loggedSetIds.has(set.setId)))
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

  const rpeAdherence = useMemo<RpeAdherenceSummary | null>(() => {
    const setsWithBothRpe = flatSets.filter(
      (item) =>
        loggedSetIds.has(item.set.setId) &&
        !(item.set.wasSkipped ?? false) &&
        item.set.actualRpe != null &&
        item.set.targetRpe != null
    );
    if (setsWithBothRpe.length === 0) {
      return null;
    }

    const adherent = setsWithBothRpe.filter(
      (item) => Math.abs((item.set.actualRpe ?? 0) - (item.set.targetRpe ?? 0)) <= 1.0
    ).length;
    return { adherent, total: setsWithBothRpe.length };
  }, [flatSets, loggedSetIds]);

  const updateSetFields = useCallback(
    (setId: string, updater: (set: LogSetInput) => LogSetInput) => {
      setData((prev) => {
        for (const section of SECTION_ORDER) {
          const exerciseIndex = prev[section].findIndex((exercise) =>
            exercise.sets.some((set) => set.setId === setId)
          );
          if (exerciseIndex === -1) {
            continue;
          }

          const exercise = prev[section][exerciseIndex];
          const setIndex = exercise.sets.findIndex((set) => set.setId === setId);
          if (setIndex === -1) {
            return prev;
          }

          const currentSet = exercise.sets[setIndex];
          const nextSet = updater(currentSet);
          if (nextSet === currentSet) {
            return prev;
          }

          const nextSets = [...exercise.sets];
          nextSets[setIndex] = nextSet;

          const nextExercise = { ...exercise, sets: nextSets };
          const nextSection = [...prev[section]];
          nextSection[exerciseIndex] = nextExercise;

          return {
            ...prev,
            [section]: nextSection,
          };
        }

        return prev;
      });
    },
    [setData]
  );

  const setSingleField = useCallback(
    (setId: string, field: keyof LogSetInput, value: number | boolean | null) => {
      updateSetFields(setId, (set) => ({ ...set, [field]: value }));
    },
    [updateSetFields]
  );

  const findPreviousLoggedSet = useCallback(
    (exercise: LogExerciseInput, currentSetIndex: number) => {
      for (let index = currentSetIndex - 1; index >= 0; index -= 1) {
        const candidate = exercise.sets[index];
        if (!candidate) {
          continue;
        }
        if (!loggedSetIds.has(candidate.setId)) {
          continue;
        }
        if (candidate.wasSkipped) {
          continue;
        }
        return candidate;
      }

      return null;
    },
    [loggedSetIds]
  );

  const {
    clearDraft,
    clearAllDrafts,
    clearDraftInputBuffers,
    commitNumericBuffer,
    draftBuffersBySet,
    handleLoadFocus,
    handleNumericFieldFocus,
    lastSavedDraft,
    markFieldTouched,
    prefilledFieldsBySet,
    primeNumericBuffer,
    restoredSetIds,
    savingDraftSetId,
    setFieldPrefilled,
    commitLoadValue,
    setRepsValue,
    setRpeValue,
    touchedFieldsBySet,
    updateDraftBuffer,
  } = useActiveSetDraftState({
    workoutId,
    activeSetIds,
    activeSet,
    loggedSetIds,
    resolvedActiveSetId,
    findPreviousLoggedSet,
    updateSetFields,
    setSingleField,
    toStoredLoadValue: (value, isDumbbell) => toStoredLoad(value, isDumbbell) ?? null,
    isDumbbellExercise,
  });

  const {
    savingSetId,
    status,
    error,
    baselineSummary,
    undoSnapshot,
    autoregHint,
    chipEditor,
    completion,
    actions,
    dismissError,
  } = useWorkoutSessionFlow({
    workoutId,
    flatSets,
    loggedSetIds,
    setLoggedSetIds,
    setActiveSetId,
    setData,
    restTimer,
    startTimer,
    clearTimer,
    restoreTimer,
    clearDraft,
    clearAllDrafts,
    clearDraftInputBuffers,
    setFieldPrefilled,
    updateSetFields,
    isBodyweightExercise,
    isDumbbellExercise,
    toInputNumberString,
    parseNullableNumber,
    normalizeLoadInput,
    onAdvanceSet: jumpToActiveSet,
  });
  const allSetsLogged = loggedCount === totalSets && totalSets > 0;
  const showAutoregHint =
    autoregHint !== null &&
    activeSet !== null &&
    autoregHint.exerciseId === activeSet.exercise.workoutExerciseId;
  const sessionTerminated = completion.completed || completion.skipped;
  const hasActiveTimer = !sessionTerminated && restTimer !== null;
  const showFooterActions = !sessionTerminated && loggedCount > 0 && !allSetsLogged;

  const handleAddExercise = useCallback(
    (exercise: LogExerciseInput) => {
      setExpandedSections((prev) => ({ ...prev, accessory: true }));
      actions.addExercise(exercise);
    },
    [actions, setExpandedSections]
  );

  const { hasPreviousSet, useSameAsLast } = useWorkoutSetHistoryActions({
    activeSet,
    findPreviousLoggedSet,
    markFieldTouched,
    setFieldPrefilled,
    setRepsValue,
    updateDraftBuffer,
    setSingleField,
    setRpeValue,
    toInputNumberString,
  });
  const activeSetDraftState: ActiveSetDraftState = {
    draftBuffersBySet,
    prefilledFieldsBySet,
    touchedFieldsBySet,
    restoredSetIds,
    savingDraftSetId,
    lastSavedDraft,
  };
  const activeSetSummary: WorkoutActiveSetCardSummary = {
    loggedCount,
    totalSets,
    resolvedActiveSetId,
    loggedSetIds,
    autoregHintMessage: showAutoregHint ? autoregHint.message : null,
    savingSetId,
    status,
    hasPreviousSet,
  };
  const activeSetFormActions: WorkoutActiveSetCardFormActions = {
    handleNumericFieldFocus,
    primeNumericBuffer,
    commitNumericBuffer,
    handleLoadFocus,
    markFieldTouched,
    setFieldPrefilled,
    setRepsValue,
    commitLoadValue,
    setRpeValue,
    setSingleField,
    updateDraftBuffer,
  };

  return (
    <div
      className="mt-5 space-y-5 pb-8 sm:mt-6 sm:space-y-6"
      style={{
        paddingTop: hasActiveTimer ? (keyboardOpen ? "56px" : "220px") : undefined,
        paddingBottom:
          keyboardHeight > 0 ? `${keyboardHeight + 16}px` : "env(safe-area-inset-bottom, 16px)",
      }}
    >
      {!sessionTerminated && allSetsLogged ? (
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 sm:p-5">
          <p className="font-semibold text-emerald-900">All sets logged - great work!</p>
          <p className="mt-1 text-sm text-emerald-700">
            {loggedCount}/{totalSets} sets completed. Tap below to save your session.
          </p>
          <div className="mt-4">
            <button
              className="inline-flex min-h-11 items-center justify-center rounded-full bg-emerald-700 px-6 py-2 text-sm font-semibold text-white disabled:opacity-60"
              onClick={() => completion.openConfirm("mark_completed")}
              disabled={sessionTerminated || completion.pending}
              type="button"
            >
              Complete Workout
            </button>
          </div>
          {error ? <p className="mt-3 text-sm text-rose-600">{error}</p> : null}
        </section>
      ) : !sessionTerminated && activeSet ? (
        <ActiveSetPanel>
          <WorkoutActiveSetCard
            activeSet={activeSet}
            activeSetPanelRef={activeSetPanelRef}
            summary={activeSetSummary}
            draftState={activeSetDraftState}
            formActions={activeSetFormActions}
            isDumbbellExercise={isDumbbellExercise}
            toInputNumberString={toInputNumberString}
            parseNullableNumber={parseNullableNumber}
            onLogSet={() => actions.logSet(activeSet.set.setId)}
            onUseSameAsLast={useSameAsLast}
            onSkipSet={() => actions.logSet(activeSet.set.setId, { wasSkipped: true })}
          />
        </ActiveSetPanel>
      ) : null}

      {!sessionTerminated ? (
        <WorkoutTimerHud
          timer={restTimer}
          compact={keyboardOpen}
          muted={restTimerMuted}
          onDismiss={clearTimer}
          onAdjust={adjustTimer}
          onMuteToggle={() => setRestTimerMuted((prev) => !prev)}
        />
      ) : null}

      {!sessionTerminated && activeSet ? (
        <div className="flex justify-end">
          <button
            className="inline-flex min-h-9 items-center justify-center rounded-full border border-slate-300 px-4 text-xs font-semibold text-slate-700"
            onClick={jumpToActiveSet}
            type="button"
          >
            Jump to active set
          </button>
        </div>
      ) : null}

      {!sessionTerminated ? (
        <ExerciseListPanel>
          <WorkoutExerciseQueue
            data={data}
            sectionOrder={SECTION_ORDER}
            remainingCount={remainingCount}
            loggedSetIds={loggedSetIds}
            expandedSections={expandedSections}
            expandedExerciseId={expandedExerciseId}
            resolvedActiveSetId={resolvedActiveSetId}
            chipEditSetId={chipEditor.setId}
            chipEditDraft={chipEditor.draft}
            savingSetId={savingSetId}
            sectionRefs={sectionRefs}
            setExpandedSections={setExpandedSections}
            setExpandedExerciseId={setExpandedExerciseId}
            setActiveSetId={setActiveSetId}
            isDumbbellExercise={isDumbbellExercise}
            openChipEditor={chipEditor.open}
            setChipEditDraft={chipEditor.setDraft}
            handleChipLoadBlur={chipEditor.handleLoadBlur}
            handleChipEditSave={chipEditor.save}
            closeChipEditor={chipEditor.close}
          />
        </ExerciseListPanel>
      ) : null}

      {!sessionTerminated ? (
        <div className="flex justify-center">
          <button
            className="inline-flex min-h-11 items-center justify-center rounded-full border border-slate-300 px-5 text-sm font-semibold text-slate-700"
            onClick={() => setShowBonusSheet(true)}
            type="button"
          >
            + Add Exercise
          </button>
        </div>
      ) : null}

      {completion.completed ? (
        <CompletedWorkoutReview
          baselineSummary={baselineSummary}
          loggedCount={loggedCount}
          performanceSummary={performanceSummary}
          rpeAdherence={rpeAdherence}
          totalSets={totalSets}
        />
      ) : null}

      {completion.state.completionAction ? (
        <WorkoutCompletionDialog
          action={completion.state.completionAction}
          loggedCount={loggedCount}
          totalSets={totalSets}
          submitting={completion.submitting}
          onConfirm={completion.run}
          onCancel={completion.cancelConfirm}
        />
      ) : null}

      <WorkoutSessionFeedback
        error={error}
        undoSnapshot={undoSnapshot}
        savingSetId={savingSetId}
        onDismissError={dismissError}
        onUndo={() => void actions.undo()}
      />

      <BonusExerciseSheet
        isOpen={showBonusSheet}
        onClose={() => setShowBonusSheet(false)}
        workoutId={workoutId}
        onAdd={handleAddExercise}
      />

      {showFooterActions ? (
        <WorkoutFooter>
          <WorkoutSessionActions
            loggedCount={loggedCount}
            totalSets={totalSets}
            completed={completion.completed}
            skipped={completion.skipped}
            showSkipOptions={completion.state.showSkipOptions}
            skipReason={completion.state.skipReason}
            sessionActionPending={completion.pending}
            onFinish={() => completion.openConfirm("mark_completed")}
            onLeaveForNow={() => completion.openConfirm("mark_partial")}
            onToggleSkipOptions={completion.toggleSkipOptions}
            onSkipReasonChange={completion.setSkipReason}
            onConfirmSkip={() => completion.openConfirm("mark_skipped")}
          />
        </WorkoutFooter>
      ) : null}
    </div>
  );
}
