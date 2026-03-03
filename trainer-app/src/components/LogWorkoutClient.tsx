"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { BonusExerciseSheet } from "@/components/BonusExerciseSheet";
import { RestTimer } from "@/components/RestTimer";
import { isDumbbellEquipment, toDisplayLoad, toStoredLoad } from "@/lib/ui/load-display";
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
import { WorkoutSessionActions } from "@/components/log-workout/WorkoutSessionActions";
import { useActiveSetDraftState } from "@/components/log-workout/useActiveSetDraftState";
import { usePersistedWorkoutSessionUi } from "@/components/log-workout/usePersistedWorkoutSessionUi";
import { useRestTimerState } from "@/components/log-workout/useRestTimerState";
import { useWorkoutSessionFlow } from "@/components/log-workout/useWorkoutSessionFlow";

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

  return toStoredLoad(toDisplayLoad(parsed, isDumbbell) ?? null, isDumbbell) ?? null;
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
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const activeSetPanelRef = useRef<HTMLElement | null>(null);
  const scrollCancelRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sectionRefs = useRef<Record<ExerciseSection, HTMLDivElement | null>>({
    warmup: null,
    main: null,
    accessory: null,
  });

  const totalSets = flatSets.length;
  const loggedCount = loggedSetIds.size;
  const remainingCount = Math.max(0, totalSets - loggedCount);
  const resolvedActiveSetId = activeSet?.set.setId ?? null;
  const activeSection = activeSet?.section ?? null;
  const activeExerciseId = activeSet?.exercise.workoutExerciseId ?? null;
  const activeSetIds = useMemo(() => flatSets.map((item) => item.set.setId), [flatSets]);

  const { restTimerMuted, setRestTimerMuted } = usePersistedWorkoutSessionUi({
    workoutId,
    activeSetIds,
    resolvedActiveSetId,
    setActiveSetId,
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

  const scrollToActiveSet = useCallback(() => {
    if (scrollCancelRef.current !== null) {
      clearTimeout(scrollCancelRef.current);
    }

    scrollCancelRef.current = setTimeout(() => {
      scrollCancelRef.current = null;
      const element = activeSetPanelRef.current;
      if (!element || typeof element.scrollIntoView !== "function") {
        return;
      }

      element.scrollIntoView({ behavior: "smooth", block: "start" });
      window.scrollBy?.(0, -72);
    }, 150);
  }, []);

  useEffect(() => {
    if (!window.visualViewport) {
      return;
    }

    const viewport = window.visualViewport;
    const handleResize = () => {
      const activeElement = document.activeElement;
      const isInput =
        activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement;
      const heightDiff = window.innerHeight - viewport.height;
      const nextKeyboardOpen = heightDiff > 120;

      setKeyboardOpen(nextKeyboardOpen);
      setKeyboardHeight(nextKeyboardOpen ? heightDiff : 0);

      if (isInput && nextKeyboardOpen) {
        scrollToActiveSet();
      }
    };

    viewport.addEventListener("resize", handleResize);
    return () => viewport.removeEventListener("resize", handleResize);
  }, [scrollToActiveSet]);

  const updateSetFields = useCallback(
    (setId: string, updater: (set: LogSetInput) => LogSetInput) => {
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
    handleLoadBlur,
    handleLoadFocus,
    handleNumericFieldFocus,
    lastSavedDraft,
    markFieldTouched,
    prefilledFieldsBySet,
    primeNumericBuffer,
    restoredSetIds,
    savingDraftSetId,
    setFieldPrefilled,
    setLoadValue,
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
    toDisplayLoadValue: (value, isDumbbell) => toDisplayLoad(value, isDumbbell) ?? null,
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
    toDisplayLoadValue: (value, isDumbbell) => toDisplayLoad(value, isDumbbell) ?? null,
    parseNullableNumber,
    normalizeLoadInput,
  });
  const allSetsLogged = loggedCount === totalSets && totalSets > 0;
  const showAutoregHint =
    autoregHint !== null &&
    activeSet !== null &&
    autoregHint.exerciseId === activeSet.exercise.workoutExerciseId;

  useEffect(() => {
    if (completion.completed || completion.skipped || activeSection === null || activeExerciseId === null) {
      setExpandedSections({ warmup: true, main: true, accessory: true });
      return;
    }

    setExpandedSections({ warmup: false, main: false, accessory: false, [activeSection]: true });
    setExpandedExerciseId(activeExerciseId);
    scrollToActiveSet();
  }, [
    activeExerciseId,
    activeSection,
    completion.completed,
    completion.skipped,
    scrollToActiveSet,
    setExpandedExerciseId,
    setExpandedSections,
  ]);

  const handleAddExercise = useCallback(
    (exercise: LogExerciseInput) => {
      setExpandedSections((prev) => ({ ...prev, accessory: true }));
      actions.addExercise(exercise);
    },
    [actions, setExpandedSections]
  );

  const handleUseSameAsLast = useCallback(() => {
    if (!activeSet) {
      return;
    }

    const previousSet = findPreviousLoggedSet(activeSet.exercise, activeSet.setIndex);
    if (!previousSet) {
      return;
    }

    setRepsValue(activeSet.set.setId, previousSet.actualReps ?? null);
    updateDraftBuffer(activeSet.set.setId, "load", toInputNumberString(previousSet.actualLoad));
    setSingleField(activeSet.set.setId, "actualLoad", previousSet.actualLoad ?? null);
    setRpeValue(activeSet.set.setId, toInputNumberString(previousSet.actualRpe));
    setSingleField(activeSet.set.setId, "wasSkipped", false);
    markFieldTouched(activeSet.set.setId, "actualReps");
    markFieldTouched(activeSet.set.setId, "actualLoad");
    markFieldTouched(activeSet.set.setId, "actualRpe");
    setFieldPrefilled(activeSet.set.setId, "actualReps", false);
    setFieldPrefilled(activeSet.set.setId, "actualLoad", false);
    setFieldPrefilled(activeSet.set.setId, "actualRpe", false);
  }, [
    activeSet,
    findPreviousLoggedSet,
    markFieldTouched,
    setFieldPrefilled,
    setRepsValue,
    setRpeValue,
    setSingleField,
    updateDraftBuffer,
  ]);

  const hasPreviousSet = activeSet
    ? findPreviousLoggedSet(activeSet.exercise, activeSet.setIndex) !== null
    : false;
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
    handleLoadBlur,
    markFieldTouched,
    setFieldPrefilled,
    setRepsValue,
    setLoadValue,
    setRpeValue,
    setSingleField,
    updateDraftBuffer,
  };

  return (
    <div
      className="mt-5 space-y-5 pb-8 sm:mt-6 sm:space-y-6"
      style={{
        paddingBottom:
          keyboardHeight > 0 ? `${keyboardHeight + 16}px` : "env(safe-area-inset-bottom, 16px)",
      }}
    >
      {!completion.completed && !completion.skipped && allSetsLogged ? (
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 sm:p-5">
          <p className="font-semibold text-emerald-900">All sets logged - great work!</p>
          <p className="mt-1 text-sm text-emerald-700">
            {loggedCount}/{totalSets} sets completed. Tap below to save your session.
          </p>
          <div className="mt-4">
            <button
              className="inline-flex min-h-11 items-center justify-center rounded-full bg-emerald-700 px-6 py-2 text-sm font-semibold text-white disabled:opacity-60"
              onClick={() => completion.openConfirm("mark_completed")}
              disabled={completion.completed || completion.skipped || completion.pending}
              type="button"
            >
              Complete Workout
            </button>
          </div>
          {error ? <p className="mt-3 text-sm text-rose-600">{error}</p> : null}
        </section>
      ) : !completion.completed && !completion.skipped && activeSet ? (
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
            onUseSameAsLast={handleUseSameAsLast}
            onSkipSet={() => actions.logSet(activeSet.set.setId, { wasSkipped: true })}
          />
        </ActiveSetPanel>
      ) : null}

      {!completion.completed && !completion.skipped && restTimer !== null ? (
        <RestTimer
          startedAtMs={restTimer.startedAtMs}
          endAtMs={restTimer.endAtMs}
          onDismiss={clearTimer}
          onAdjust={adjustTimer}
          compact={keyboardOpen}
          muted={restTimerMuted}
          onMuteToggle={() => setRestTimerMuted((prev) => !prev)}
        />
      ) : null}

      {!completion.completed && !completion.skipped ? (
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

      {!completion.completed && !completion.skipped ? (
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

      {error ? (
        <div
          data-testid="error-snackbar"
          className="rounded-xl border border-rose-200 bg-rose-50 p-3 shadow-sm"
          style={{
            position: "fixed",
            bottom:
              "calc(var(--mobile-nav-height, 56px) + env(safe-area-inset-bottom, 0px) + 8px)",
            left: "16px",
            right: "16px",
            zIndex: 50,
          }}
        >
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-rose-700">{error}</p>
            <button
              className="inline-flex min-h-9 items-center justify-center rounded-full border border-rose-300 px-3 text-xs font-semibold text-rose-700"
              onClick={dismissError}
              type="button"
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      {undoSnapshot ? (
        <div
          className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
          style={{
            position: "fixed",
            bottom:
              "calc(var(--mobile-nav-height, 56px) + env(safe-area-inset-bottom, 0px) + 8px)",
            left: "16px",
            right: "16px",
            zIndex: 50,
          }}
        >
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-slate-600">Set logged. Undo available for a few seconds.</p>
            <button
              className="inline-flex min-h-11 items-center justify-center rounded-full border border-slate-300 px-3 text-xs font-semibold text-slate-700"
              onClick={actions.undo}
              disabled={savingSetId !== null}
              type="button"
            >
              Undo
            </button>
          </div>
        </div>
      ) : null}

      <BonusExerciseSheet
        isOpen={showBonusSheet}
        onClose={() => setShowBonusSheet(false)}
        workoutId={workoutId}
        onAdd={handleAddExercise}
      />

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
    </div>
  );
}
