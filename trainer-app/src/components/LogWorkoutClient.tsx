"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BonusExerciseSheet } from "@/components/BonusExerciseSheet";
import { GapFillExerciseSwapSheet } from "@/components/GapFillExerciseSwapSheet";
import { isDumbbellEquipment, toDisplayLoad, toStoredLoad } from "@/lib/ui/load-display";
import { useWorkoutLogState } from "@/components/log-workout/useWorkoutLogState";
import type {
  ActiveSetDraftState,
  CompletedWorkoutExerciseSummary,
  ExerciseSection,
  LogExerciseInput,
  LogSetInput,
  RpeAdherenceSummary,
  SectionedExercises,
} from "@/components/log-workout/types";
import { ActiveSetPanel } from "@/components/log-workout/ActiveSetPanel";
import { CompletedWorkoutReview } from "@/components/log-workout/CompletedWorkoutReview";
import { ExerciseListPanel } from "@/components/log-workout/ExerciseListPanel";
import { SkippedWorkoutReview } from "@/components/log-workout/SkippedWorkoutReview";
import {
  WorkoutActiveSetCard,
  type WorkoutActiveSetCardFormActions,
  type WorkoutActiveSetCardSummary,
} from "@/components/log-workout/WorkoutActiveSetCard";
import { WorkoutCompletionDialog } from "@/components/log-workout/WorkoutCompletionDialog";
import {
  WorkoutExerciseQueue,
  type WorkoutQueueSectionData,
} from "@/components/log-workout/WorkoutExerciseQueue";
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
import { isSetSatisfied } from "@/components/log-workout/useWorkoutLogState";

export type { LogExerciseInput, LogSetInput } from "@/components/log-workout/types";

const SECTION_ORDER: ExerciseSection[] = ["warmup", "main", "accessory"];

type ActiveCardMode =
  | { kind: "live" }
  | {
      kind: "edit";
      setId: string;
      returnSetId: string | null;
      setIndex: number;
    };

type PendingEditExitAction = {
  run: () => void;
};

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

  return toStoredLoad(parsed, isDumbbell) ?? null;
}

function formatQueueSetSummary(set: LogSetInput, isLogged: boolean, isDumbbell: boolean): string {
  const setPrefix = set.isRuntimeAdded ? `Set ${set.setIndex} Extra set` : `Set ${set.setIndex}`;
  if (!isLogged) {
    return setPrefix;
  }

  if (set.wasSkipped) {
    return `${setPrefix} skipped`;
  }

  const parts: string[] = [`${setPrefix} OK`];
  if (set.actualLoad != null && set.actualReps != null) {
    parts.push(`${toDisplayLoad(set.actualLoad, isDumbbell) ?? set.actualLoad} x ${set.actualReps}`);
  } else if (set.actualReps != null) {
    parts.push(`${set.actualReps} reps`);
  }
  if (set.actualRpe != null) {
    parts.push(`@${set.actualRpe}`);
  }

  return parts.join(" ");
}

export default function LogWorkoutClient({
  workoutId,
  exercises,
  allowBonusExerciseAdd = true,
  allowGapFillAccessorySwap = false,
  onQueueExerciseRowRender,
  sessionIdentityLabel,
  sessionTechnicalLabel,
}: {
  workoutId: string;
  exercises: LogExerciseInput[] | SectionedExercises;
  allowBonusExerciseAdd?: boolean;
  allowGapFillAccessorySwap?: boolean;
  onQueueExerciseRowRender?: (exerciseId: string) => void;
  sessionIdentityLabel?: string | null;
  sessionTechnicalLabel?: string | null;
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
  const [selectedSwapExerciseId, setSelectedSwapExerciseId] = useState<string | null>(null);
  const [activeCardMode, setActiveCardMode] = useState<ActiveCardMode>({ kind: "live" });
  const [showDiscardEditConfirm, setShowDiscardEditConfirm] = useState(false);
  const [timerHudHeight, setTimerHudHeight] = useState(0);
  const activeCardModeRef = useRef<ActiveCardMode>(activeCardMode);
  const isDraftDirtyRef = useRef<(setId: string) => boolean>(() => false);
  const pendingEditExitActionRef = useRef<PendingEditExitAction | null>(null);

  const totalSets = flatSets.length;
  const selectedSwapExercise = useMemo(() => {
    for (const section of SECTION_ORDER) {
      const match = data[section].find((exercise) => exercise.workoutExerciseId === selectedSwapExerciseId);
      if (match) {
        return match;
      }
    }
    return null;
  }, [data, selectedSwapExerciseId]);
  const satisfiedSetIds = useMemo(
    () =>
      new Set(
        flatSets
          .filter((item) => loggedSetIds.has(item.set.setId) || isSetSatisfied(item.set))
          .map((item) => item.set.setId)
      ),
    [flatSets, loggedSetIds]
  );
  const loggedCount = satisfiedSetIds.size;
  const completedSetCount = useMemo(
    () =>
      flatSets.filter((item) => satisfiedSetIds.has(item.set.setId) && !(item.set.wasSkipped ?? false)).length,
    [flatSets, satisfiedSetIds]
  );
  const skippedSetCount = useMemo(
    () => flatSets.filter((item) => satisfiedSetIds.has(item.set.setId) && (item.set.wasSkipped ?? false)).length,
    [flatSets, satisfiedSetIds]
  );
  const remainingCount = Math.max(0, totalSets - loggedCount);
  const resolvedActiveSetId = activeSet?.set.setId ?? null;
  const resolvedActiveSetIdRef = useRef<string | null>(resolvedActiveSetId);
  const loggedSetIdsRef = useRef(loggedSetIds);
  const flatSetsRef = useRef(flatSets);
  const activeSetIds = useMemo(() => flatSets.map((item) => item.set.setId), [flatSets]);
  const {
    keyboardOpen,
    keyboardHeight,
    visualViewportBottomOffset,
    activeSetPanelRef,
    sectionRefs,
    jumpToActiveSet,
  } =
    useWorkoutSessionLayout(restTimer ? timerHudHeight : 0);

  const { restTimerMuted, setRestTimerMuted } = usePersistedWorkoutSessionUi({
    workoutId,
    activeSetIds,
    resolvedActiveSetId,
    setActiveSetId,
  });

  useEffect(() => {
    activeCardModeRef.current = activeCardMode;
  }, [activeCardMode]);

  useEffect(() => {
    if (activeCardMode.kind !== "edit") {
      pendingEditExitActionRef.current = null;
    }
  }, [activeCardMode]);

  useEffect(() => {
    resolvedActiveSetIdRef.current = resolvedActiveSetId;
    loggedSetIdsRef.current = loggedSetIds;
    flatSetsRef.current = flatSets;
  }, [flatSets, loggedSetIds, resolvedActiveSetId]);

  const performanceSummary = useMemo<CompletedWorkoutExerciseSummary[]>(() => {
    return SECTION_ORDER.flatMap((section) =>
      data[section]
        .filter((exercise) => exercise.sets.some((set) => satisfiedSetIds.has(set.setId)))
        .map((exercise) => ({
          exerciseId: exercise.workoutExerciseId,
          name: exercise.name,
          equipment: exercise.equipment,
          isRuntimeAdded: exercise.isRuntimeAdded,
          isMainLift: exercise.isMainLift,
          section,
          sets: exercise.sets.map((set) => ({
            setIndex: set.setIndex,
            isRuntimeAdded: set.isRuntimeAdded,
            targetReps: set.targetReps,
            targetRepRange: set.targetRepRange,
            targetLoad: set.targetLoad,
            targetRpe: set.targetRpe,
            actualReps: set.actualReps,
            actualLoad: set.actualLoad,
            actualRpe: set.actualRpe,
            wasLogged: satisfiedSetIds.has(set.setId),
            wasSkipped: set.wasSkipped ?? false,
          })),
        }))
    );
  }, [data, satisfiedSetIds]);

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
    isDraftDirty,
    lastSavedDraft,
    markFieldTouched,
    prefilledFieldsBySet,
    primeNumericBuffer,
    restoredSetIds,
    savingDraftSetId,
    setFieldPrefilled,
    seedDraftFromValues,
    commitLoadValue,
    resetDraftVisualState,
    setRepsValue,
    setRpeValue,
    touchedFieldsBySet,
    updateDraftBuffer,
  } = useActiveSetDraftState({
    workoutId,
    activeSetIds,
    activeSet,
    flatSets,
    loggedSetIds,
    resolvedActiveSetId,
    findPreviousLoggedSet,
    toStoredLoadValue: (value, isDumbbell) => toStoredLoad(value, isDumbbell) ?? null,
    isDumbbellExercise,
  });

  useEffect(() => {
    isDraftDirtyRef.current = isDraftDirty;
  }, [isDraftDirty]);

  const resolveDraftNumericValues = useCallback(
    (set: LogSetInput, exercise: LogExerciseInput) => {
      const draft = draftBuffersBySet[set.setId];
      return {
        actualReps: draft?.reps !== undefined ? parseNullableNumber(draft.reps) : set.actualReps ?? null,
        actualLoad:
          draft?.load !== undefined
            ? normalizeLoadInput(draft.load, isDumbbellExercise(exercise))
            : set.actualLoad ?? null,
        actualRpe: draft?.rpe !== undefined ? parseNullableNumber(draft.rpe) : set.actualRpe ?? null,
      };
    },
    [draftBuffersBySet]
  );

  const {
    addingSetExerciseId,
    savingSetId,
    status,
    error,
    autoregHint,
    completion,
    actions,
    dismissError,
  } = useWorkoutSessionFlow({
    workoutId,
    flatSets,
    totalSets,
    completedSetCount,
    skippedSetCount,
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
      onAdvanceSet: jumpToActiveSet,
    });
  const addExerciseAction = actions.addExercise;
  const addSetAction = actions.addSet;

  useEffect(() => {
    if (activeCardMode.kind !== "edit") {
      return;
    }

    const editSet = flatSets.find((item) => item.set.setId === activeCardMode.setId);
    if (!editSet || !loggedSetIds.has(activeCardMode.setId)) {
      const exitTimerId = window.setTimeout(() => {
        pendingEditExitActionRef.current = null;
        setShowDiscardEditConfirm(false);
        setActiveCardMode({ kind: "live" });
      }, 0);
      return () => window.clearTimeout(exitTimerId);
    }

    if (resolvedActiveSetId !== activeCardMode.setId) {
      setActiveSetId(activeCardMode.setId);
    }

    seedDraftFromValues(activeCardMode.setId, {
      reps: editSet.set.actualReps ?? null,
      load: editSet.set.actualLoad ?? null,
      rpe: editSet.set.actualRpe ?? null,
    });
  }, [activeCardMode, flatSets, loggedSetIds, resolvedActiveSetId, seedDraftFromValues, setActiveSetId]);

  const exitEditMode = useCallback(
    (options?: { restoreLiveSet?: boolean; discardChanges?: boolean }) => {
      const currentMode = activeCardModeRef.current;
      if (currentMode.kind !== "edit") {
        return;
      }

      if (options?.discardChanges ?? true) {
        clearDraft(currentMode.setId);
        clearDraftInputBuffers(currentMode.setId);
        resetDraftVisualState(currentMode.setId);
      }

      if (options?.restoreLiveSet !== false && currentMode.returnSetId) {
        setActiveSetId(currentMode.returnSetId);
      }

      setShowDiscardEditConfirm(false);
      setActiveCardMode({ kind: "live" });
    },
    [clearDraft, clearDraftInputBuffers, resetDraftVisualState, setActiveSetId]
  );

  const requestEditModeExit = useCallback(
    (nextAction: () => void) => {
      const currentMode = activeCardModeRef.current;
      if (currentMode.kind !== "edit") {
        nextAction();
        return;
      }

      if (!isDraftDirtyRef.current(currentMode.setId)) {
        nextAction();
        return;
      }

      pendingEditExitActionRef.current = { run: nextAction };
      setShowDiscardEditConfirm(true);
    },
    []
  );

  const navigateToSet = useCallback(
    (setId: string) => {
      const selected = flatSetsRef.current.find((item) => item.set.setId === setId);
      if (!selected) {
        return;
      }

      const currentMode = activeCardModeRef.current;
      const currentResolvedActiveSetId = resolvedActiveSetIdRef.current;
      const currentLoggedSetIds = loggedSetIdsRef.current;

      if (currentMode.kind === "edit" && currentMode.setId === setId) {
        return;
      }

      if (currentLoggedSetIds.has(setId)) {
        if (currentMode.kind === "edit") {
          exitEditMode({ restoreLiveSet: false, discardChanges: true });
        }

        setActiveCardMode({
          kind: "edit",
          setId,
          returnSetId:
            currentMode.kind === "edit"
              ? currentMode.returnSetId
              : currentResolvedActiveSetId && !currentLoggedSetIds.has(currentResolvedActiveSetId)
                ? currentResolvedActiveSetId
                : null,
          setIndex: selected.set.setIndex,
        });
        jumpToActiveSet();
        return;
      }

      if (currentMode.kind === "edit") {
        exitEditMode({ restoreLiveSet: false, discardChanges: true });
      }

      setActiveCardMode({ kind: "live" });
      setActiveSetId(setId);
      jumpToActiveSet();
    },
    [exitEditMode, jumpToActiveSet, setActiveSetId]
  );

  const handleQueueSetSelect = useCallback(
    (setId: string) => {
      requestEditModeExit(() => {
        navigateToSet(setId);
      });
    },
    [navigateToSet, requestEditModeExit]
  );

  const handleJumpToCurrentSet = useCallback(() => {
    if (activeCardMode.kind === "edit") {
      requestEditModeExit(() => {
        exitEditMode({ restoreLiveSet: true, discardChanges: true });
      });
      return;
    }

    jumpToActiveSet();
  }, [activeCardMode, exitEditMode, jumpToActiveSet, requestEditModeExit]);

  const queueSections = useMemo<WorkoutQueueSectionData[]>(() => {
    return SECTION_ORDER.flatMap((section) => {
      const sectionItems = data[section];
      if (sectionItems.length === 0) {
        return [];
      }

      return [
        {
          section,
          isExpanded: expandedSections[section],
          collapsedSummaries: sectionItems.map((exercise) => ({
            exerciseId: exercise.workoutExerciseId,
            exerciseName: exercise.name,
            loggedCount: exercise.sets.filter((set) => satisfiedSetIds.has(set.setId)).length,
            totalSets: exercise.sets.length,
          })),
          exercises: sectionItems.map((exercise) => {
            const loggedCountForExercise = exercise.sets.filter((set) => satisfiedSetIds.has(set.setId)).length;
            const nextSet =
              exercise.sets.find((set) => !satisfiedSetIds.has(set.setId)) ?? exercise.sets[0] ?? null;

            return {
              section,
              exerciseId: exercise.workoutExerciseId,
              exerciseName: exercise.name,
              isRuntimeAdded: exercise.isRuntimeAdded ?? false,
              sessionNote: exercise.sessionNote,
              loggedCount: loggedCountForExercise,
              totalSets: exercise.sets.length,
              allSetsLogged:
                loggedCountForExercise === exercise.sets.length && exercise.sets.length > 0,
              isExpanded: expandedExerciseId === exercise.workoutExerciseId,
              nextSetId: nextSet?.setId ?? null,
              canSwap:
                allowGapFillAccessorySwap &&
                section === "accessory" &&
                !exercise.sessionNote &&
                exercise.sets.every((set) => !satisfiedSetIds.has(set.setId)),
              canAddSet: true,
              isAddingSet: addingSetExerciseId === exercise.workoutExerciseId,
              isSwapping: selectedSwapExerciseId === exercise.workoutExerciseId,
              chips: exercise.sets.map((set) => ({
                setId: set.setId,
                label: formatQueueSetSummary(
                  set,
                  satisfiedSetIds.has(set.setId),
                  isDumbbellExercise(exercise)
                ),
                isLogged: satisfiedSetIds.has(set.setId),
                isActive: resolvedActiveSetId === set.setId,
                isSaving: savingSetId === set.setId,
              })),
            };
          }),
        },
      ];
    });
  }, [
    data,
    expandedExerciseId,
    expandedSections,
    allowGapFillAccessorySwap,
    satisfiedSetIds,
    resolvedActiveSetId,
    selectedSwapExerciseId,
    addingSetExerciseId,
    savingSetId,
  ]);

  const toggleQueueSection = useCallback((section: ExerciseSection) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  }, [setExpandedSections]);

  const toggleQueueExercise = useCallback(
    (exerciseId: string, nextSetId: string | null) => {
      void nextSetId;
      setExpandedExerciseId((prev) => (prev === exerciseId ? null : exerciseId));
    },
    [setExpandedExerciseId]
  );

  const allSetsLogged = loggedCount === totalSets && totalSets > 0;
  const allSetsSkipped = allSetsLogged && skippedSetCount === totalSets && completedSetCount === 0;
  const showAutoregHint =
    autoregHint !== null &&
    activeSet !== null &&
    autoregHint.exerciseId === activeSet.exercise.workoutExerciseId;
  const sessionTerminated = completion.completed || completion.skipped;
  const showFinishBar = !sessionTerminated && allSetsLogged;
  const finishBarBottomOffset = showFinishBar && keyboardHeight > 0 ? keyboardHeight : 0;
  const discardEditConfirmOpen = activeCardMode.kind === "edit" && showDiscardEditConfirm;
  const resolvedActiveSetValues = useMemo(
    () =>
      activeSet
        ? resolveDraftNumericValues(activeSet.set, activeSet.exercise)
        : { actualReps: null, actualLoad: null, actualRpe: null },
    [activeSet, resolveDraftNumericValues]
  );
  const submitActiveSet = useCallback(async () => {
    if (!activeSet) {
      return false;
    }

    const success = await actions.logSet(activeSet.set.setId, {
      ...resolvedActiveSetValues,
      wasSkipped:
        resolvedActiveSetValues.actualReps != null ||
        resolvedActiveSetValues.actualLoad != null ||
        resolvedActiveSetValues.actualRpe != null
          ? false
          : (activeSet.set.wasSkipped ?? false),
    });

    if (success && activeCardMode.kind === "edit") {
      exitEditMode({ restoreLiveSet: true, discardChanges: false });
    }

    return success;
  }, [activeCardMode.kind, activeSet, actions, exitEditMode, resolvedActiveSetValues]);

  const skipActiveSet = useCallback(async () => {
    if (!activeSet) {
      return false;
    }

    const success = await actions.logSet(activeSet.set.setId, { wasSkipped: true });
    if (success && activeCardMode.kind === "edit") {
      exitEditMode({ restoreLiveSet: true, discardChanges: false });
    }

    return success;
  }, [activeCardMode.kind, activeSet, actions, exitEditMode]);

  const handleAddExercise = useCallback(
    (exercise: LogExerciseInput) => {
      setExpandedSections((prev) => ({ ...prev, accessory: true }));
      addExerciseAction(exercise);
    },
    [addExerciseAction, setExpandedSections]
  );
  const handleSwapExercise = useCallback((exerciseId: string) => {
    setSelectedSwapExerciseId(exerciseId);
  }, []);
  const handleAddSet = useCallback(
    (exerciseId: string, section: ExerciseSection) => {
      requestEditModeExit(() => {
        setExpandedSections((prev) => ({ ...prev, [section]: true }));
        setExpandedExerciseId(exerciseId);
        void addSetAction(exerciseId);
      });
    },
    [addSetAction, requestEditModeExit, setExpandedExerciseId, setExpandedSections]
  );
  const handleSwapApplied = useCallback(
    (exercise: LogExerciseInput) => {
      setData((prev) => {
        for (const section of SECTION_ORDER) {
          const exerciseIndex = prev[section].findIndex(
            (entry) => entry.workoutExerciseId === exercise.workoutExerciseId
          );
          if (exerciseIndex === -1) {
            continue;
          }

          const nextSection = [...prev[section]];
          nextSection[exerciseIndex] = {
            ...exercise,
            section: nextSection[exerciseIndex]?.section ?? exercise.section,
          };

          return {
            ...prev,
            [section]: nextSection,
          };
        }

        return prev;
      });
      setExpandedSections((prev) => ({ ...prev, accessory: true }));
      setExpandedExerciseId(exercise.workoutExerciseId);
    },
    [setData, setExpandedExerciseId, setExpandedSections]
  );

  const { hasPreviousSet, useSameAsLast } = useWorkoutSetHistoryActions({
    activeSet,
    findPreviousLoggedSet,
    markFieldTouched,
    setFieldPrefilled,
    setRepsValue,
    updateDraftBuffer,
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
    stickyOffset: restTimer ? timerHudHeight : 0,
    isEditing: activeCardMode.kind === "edit",
    editingSetLabel: activeCardMode.kind === "edit" ? `Set ${activeCardMode.setIndex}` : null,
    canReturnToLiveSet: activeCardMode.kind === "edit" && activeCardMode.returnSetId !== null,
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
    updateDraftBuffer,
  };

  return (
    <div
      className="mt-5 space-y-5 pb-8 sm:mt-6 sm:space-y-6"
      style={{
        paddingBottom:
          keyboardHeight > 0
            ? `${keyboardHeight + (showFinishBar ? 88 : 16)}px`
            : showFinishBar
              ? "calc(var(--mobile-nav-height) + env(safe-area-inset-bottom, 16px) + 88px)"
              : "env(safe-area-inset-bottom, 16px)",
      }}
    >
      {!sessionTerminated ? (
        <WorkoutTimerHud
          timer={restTimer}
          keyboardOpen={keyboardOpen}
          muted={restTimerMuted}
          onHeightChange={setTimerHudHeight}
          onDismiss={clearTimer}
          onAdjust={adjustTimer}
          onMuteToggle={() => setRestTimerMuted((prev) => !prev)}
        />
      ) : null}

      {!sessionTerminated && activeSet && !allSetsLogged ? (
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
            resolvedValues={resolvedActiveSetValues}
            onLogSet={() => void submitActiveSet()}
            onReturnToCurrentSet={handleJumpToCurrentSet}
            onUseSameAsLast={useSameAsLast}
            onSkipSet={() => void skipActiveSet()}
          />
        </ActiveSetPanel>
      ) : null}

      {!sessionTerminated ? (
        <ExerciseListPanel>
          <WorkoutExerciseQueue
            sections={queueSections}
            remainingCount={remainingCount}
            sectionRefs={sectionRefs}
            onToggleSection={toggleQueueSection}
            onToggleExercise={toggleQueueExercise}
            onSelectSet={handleQueueSetSelect}
            onAddSet={handleAddSet}
            onSwapExercise={handleSwapExercise}
            onExerciseRowRender={onQueueExerciseRowRender}
          />
        </ExerciseListPanel>
      ) : null}

      {!sessionTerminated && allowBonusExerciseAdd ? (
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
          workoutId={workoutId}
          loggedCount={loggedCount}
          performanceSummary={performanceSummary}
          rpeAdherence={rpeAdherence}
          sessionIdentityLabel={sessionIdentityLabel}
          sessionTechnicalLabel={sessionTechnicalLabel}
          totalSets={totalSets}
        />
      ) : null}

      {completion.skipped ? <SkippedWorkoutReview /> : null}

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
        onDismissError={dismissError}
        viewportBottomOffset={visualViewportBottomOffset}
      />

      <BonusExerciseSheet
        isOpen={showBonusSheet}
        onClose={() => setShowBonusSheet(false)}
        workoutId={workoutId}
        onAdd={handleAddExercise}
      />
      <GapFillExerciseSwapSheet
        isOpen={selectedSwapExercise != null}
        onClose={() => setSelectedSwapExerciseId(null)}
        workoutId={workoutId}
        exercise={selectedSwapExercise}
        onSwap={handleSwapApplied}
      />

      {!sessionTerminated && !showFinishBar ? (
        <WorkoutSessionActions
          loggedCount={loggedCount}
          totalSets={totalSets}
          completed={completion.completed}
          skipped={completion.skipped}
          showFinishBar={showFinishBar}
          finishActionLabel={allSetsSkipped ? "Skip workout" : "Finish workout"}
          showSkipOptions={completion.state.showSkipOptions}
          skipReason={completion.state.skipReason}
          sessionActionPending={completion.pending}
          onFinish={() => completion.openConfirm("mark_completed")}
          onLeaveForNow={() => completion.openConfirm("mark_partial")}
          onToggleSkipOptions={completion.toggleSkipOptions}
          onSkipReasonChange={completion.setSkipReason}
          onConfirmSkip={() => completion.openConfirm("mark_skipped")}
        />
      ) : null}

      {showFinishBar ? (
        <WorkoutFooter
          sticky
          bottomOffset={finishBarBottomOffset}
          viewportBottomOffset={visualViewportBottomOffset}
        >
          <WorkoutSessionActions
            loggedCount={loggedCount}
            totalSets={totalSets}
            completed={completion.completed}
            skipped={completion.skipped}
            showFinishBar={showFinishBar}
            finishActionLabel={allSetsSkipped ? "Skip workout" : "Finish workout"}
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

      {discardEditConfirmOpen ? (
        <div
          aria-label="Discard edit confirmation"
          aria-modal="true"
          className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-900/40 px-3 pt-3 pb-[calc(var(--mobile-nav-height)+env(safe-area-inset-bottom,0px)+12px)] sm:items-center sm:p-3"
          role="dialog"
          style={{ bottom: `${visualViewportBottomOffset}px` }}
        >
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-lg sm:p-5">
            <p className="text-sm font-semibold text-slate-900">Discard changes?</p>
            <p className="mt-2 text-sm text-slate-600">
              You modified this set.
            </p>
            <p className="mt-1 text-sm text-slate-600">
              Discard edits and continue?
            </p>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <button
                className="inline-flex min-h-11 items-center justify-center rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700"
                onClick={() => {
                  pendingEditExitActionRef.current = null;
                  setShowDiscardEditConfirm(false);
                }}
                type="button"
              >
                Cancel
              </button>
              <button
                className="inline-flex min-h-11 items-center justify-center rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
                onClick={() => {
                  const pendingAction = pendingEditExitActionRef.current;
                  pendingEditExitActionRef.current = null;
                  setShowDiscardEditConfirm(false);
                  pendingAction?.run();
                }}
                type="button"
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
