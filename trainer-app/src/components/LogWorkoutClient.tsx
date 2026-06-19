"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BonusExerciseSheet } from "@/components/BonusExerciseSheet";
import { RuntimeExerciseSwapSheet } from "@/components/RuntimeExerciseSwapSheet";
import { isDumbbellEquipment, toDisplayLoad, toStoredLoad } from "@/lib/ui/load-display";
import { useWorkoutLogState } from "@/components/log-workout/useWorkoutLogState";
import type {
  ActiveSetDraftState,
  CompletedWorkoutExerciseSummary,
  ExerciseSection,
  FlatSetItem,
  LogExerciseMuscleTagGroups,
  LogExerciseInput,
  LogWorkoutCapabilities,
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
import { WeeklyVolumeCheck } from "@/components/log-workout/WeeklyVolumeCheck";
import { useActiveSetDraftState } from "@/components/log-workout/useActiveSetDraftState";
import { usePersistedWorkoutSessionUi } from "@/components/log-workout/usePersistedWorkoutSessionUi";
import { useRestTimerState, type RestTimerSnapshot } from "@/components/log-workout/useRestTimerState";
import { useWorkoutSessionLayout } from "@/components/log-workout/useWorkoutSessionLayout";
import { useWorkoutSessionFlow } from "@/components/log-workout/useWorkoutSessionFlow";
import { isSetSatisfied } from "@/components/log-workout/useWorkoutLogState";

export type { LogExerciseInput, LogSetInput } from "@/components/log-workout/types";

const SECTION_ORDER: ExerciseSection[] = ["warmup", "main", "accessory"];
const VIRTUAL_WARMUP_SET_PREFIX = "warmup:";

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

function resolveExerciseSection(section?: LogExerciseInput["section"]): ExerciseSection | null {
  if (section === "WARMUP") {
    return "warmup";
  }
  if (section === "MAIN") {
    return "main";
  }
  if (section === "ACCESSORY") {
    return "accessory";
  }
  return null;
}

function resolveMuscleTagGroups(exercise: LogExerciseInput): LogExerciseMuscleTagGroups {
  if (exercise.muscleTagGroups) {
    return exercise.muscleTagGroups;
  }

  return {
    primaryMuscles: exercise.muscleTags ?? [],
    secondaryMuscles: [],
  };
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
  if (set.setIntent === "WARMUP") {
    return isLogged ? "Warmup recorded" : "Warmup";
  }

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

function buildVirtualWarmupSetId(workoutExerciseId: string): string {
  return `${VIRTUAL_WARMUP_SET_PREFIX}${workoutExerciseId}`;
}

function parseVirtualWarmupSetId(setId: string): string | null {
  return setId.startsWith(VIRTUAL_WARMUP_SET_PREFIX)
    ? setId.slice(VIRTUAL_WARMUP_SET_PREFIX.length)
    : null;
}

function isWarmupSet(set: LogSetInput): boolean {
  return set.setIntent === "WARMUP";
}

function formatVirtualWarmupSectionLabel(section: ExerciseSection): string {
  return section === "main" ? "Main Lifts" : section === "accessory" ? "Accessories" : "Warmup";
}

function resolveSelectedWarmupActiveSet(
  data: Required<SectionedExercises>,
  selectedWarmupExerciseId: string | null
): FlatSetItem | null {
  if (!selectedWarmupExerciseId) {
    return null;
  }

  for (const section of SECTION_ORDER) {
    const exerciseIndex = data[section].findIndex(
      (exercise) => exercise.workoutExerciseId === selectedWarmupExerciseId
    );
    if (exerciseIndex === -1) {
      continue;
    }

    const exercise = data[section][exerciseIndex];
    if (exercise.sets.some(isWarmupSet)) {
      return null;
    }

    const firstWorkSet = exercise.sets.find((set) => !isWarmupSet(set));
    if (!firstWorkSet) {
      return null;
    }

    return {
      section,
      sectionLabel: formatVirtualWarmupSectionLabel(section),
      exerciseIndex,
      setIndex: -1,
      exercise,
      set: {
        setId: buildVirtualWarmupSetId(exercise.workoutExerciseId),
        setIndex: 0,
        isRuntimeAdded: true,
        setIntent: "WARMUP",
        targetReps: firstWorkSet.targetReps,
        targetRepRange: firstWorkSet.targetRepRange,
        targetLoad: firstWorkSet.targetLoad,
        targetRpe: firstWorkSet.targetRpe,
        restSeconds: 60,
      },
    };
  }

  return null;
}

export default function LogWorkoutClient({
  workoutId,
  exercises,
  allowBonusExerciseAdd = true,
  allowRuntimeExerciseSwap = false,
  capabilities = {
    canAddSet: true,
    canRemoveSet: true,
    canSwapExercise: allowRuntimeExerciseSwap,
    canAddExercise: allowBonusExerciseAdd,
    canFinish: true,
    showWeeklyCheck: true,
  },
  initialRestTimer,
  onQueueExerciseRowRender,
  sessionIdentityLabel,
  sessionTechnicalLabel,
}: {
  workoutId: string;
  exercises: LogExerciseInput[] | SectionedExercises;
  allowBonusExerciseAdd?: boolean;
  allowRuntimeExerciseSwap?: boolean;
  capabilities?: LogWorkoutCapabilities;
  initialRestTimer?: RestTimerSnapshot | null;
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
  const [selectedWarmupExerciseId, setSelectedWarmupExerciseId] = useState<string | null>(null);
  const [showDiscardEditConfirm, setShowDiscardEditConfirm] = useState(false);
  const [timerHudHeight, setTimerHudHeight] = useState(0);
  const activeCardModeRef = useRef<ActiveCardMode>(activeCardMode);
  const initialRestTimerWorkoutRef = useRef<string | null>(null);
  const isDraftDirtyRef = useRef<(setId: string) => boolean>(() => false);
  const pendingEditExitActionRef = useRef<PendingEditExitAction | null>(null);

  useEffect(() => {
    if (initialRestTimerWorkoutRef.current === workoutId) {
      return;
    }

    initialRestTimerWorkoutRef.current = workoutId;
    if (initialRestTimer) {
      restoreTimer(initialRestTimer);
    }
  }, [initialRestTimer, restoreTimer, workoutId]);

  const selectedWarmupActiveSet = useMemo(
    () => resolveSelectedWarmupActiveSet(data, selectedWarmupExerciseId),
    [data, selectedWarmupExerciseId]
  );
  const visibleActiveSet = selectedWarmupActiveSet ?? activeSet;
  const workFlatSets = useMemo(
    () => flatSets.filter((item) => !isWarmupSet(item.set)),
    [flatSets]
  );
  const totalSets = workFlatSets.length;
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
  const completedSetCount = useMemo(
    () =>
      workFlatSets.filter((item) => satisfiedSetIds.has(item.set.setId) && !(item.set.wasSkipped ?? false)).length,
    [satisfiedSetIds, workFlatSets]
  );
  const skippedSetCount = useMemo(
    () => workFlatSets.filter((item) => satisfiedSetIds.has(item.set.setId) && (item.set.wasSkipped ?? false)).length,
    [satisfiedSetIds, workFlatSets]
  );
  const workLoggedCount = useMemo(
    () => workFlatSets.filter((item) => satisfiedSetIds.has(item.set.setId)).length,
    [satisfiedSetIds, workFlatSets]
  );
  const loggedCount = workLoggedCount;
  const remainingCount = Math.max(0, totalSets - loggedCount);
  const resolvedActiveSetId = visibleActiveSet?.set.setId ?? null;
  const resolvedActiveSetIdRef = useRef<string | null>(resolvedActiveSetId);
  const loggedSetIdsRef = useRef(loggedSetIds);
  const flatSetsRef = useRef(flatSets);
  const activeSetIds = useMemo(
    () => [
      ...flatSets.map((item) => item.set.setId),
      ...(selectedWarmupActiveSet ? [selectedWarmupActiveSet.set.setId] : []),
    ],
    [flatSets, selectedWarmupActiveSet]
  );
  const resumableSetIds = useMemo(
    () => workFlatSets.filter((item) => !loggedSetIds.has(item.set.setId)).map((item) => item.set.setId),
    [loggedSetIds, workFlatSets]
  );
  const resumeTargetSetId = useMemo(() => {
    if (activeCardMode.kind === "edit") {
      return activeCardMode.returnSetId;
    }

    return resolvedActiveSetId && resumableSetIds.includes(resolvedActiveSetId) ? resolvedActiveSetId : null;
  }, [activeCardMode, resolvedActiveSetId, resumableSetIds]);
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
    resumableSetIds,
    resumeTargetSetId,
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
          sourceExerciseId: exercise.exerciseId,
          name: exercise.name,
          equipment: exercise.equipment,
          isSwapped: exercise.isSwapped,
          isRuntimeAdded: exercise.isRuntimeAdded,
          isMainLift: exercise.isMainLift,
          section,
          sessionNote: exercise.sessionNote,
          sets: exercise.sets.map((set) => ({
            setIndex: set.setIndex,
            isRuntimeAdded: set.isRuntimeAdded,
            setIntent: set.setIntent ?? "WORK",
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
        !isWarmupSet(item.set) &&
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
    activeSet: visibleActiveSet,
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
    removingExerciseId,
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
  const removeExerciseAction = actions.removeExercise;

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
      const virtualWarmupExerciseId = parseVirtualWarmupSetId(setId);
      if (virtualWarmupExerciseId) {
        const currentMode = activeCardModeRef.current;
        if (currentMode.kind === "edit") {
          exitEditMode({ restoreLiveSet: false, discardChanges: true });
        }
        setActiveCardMode({ kind: "live" });
        setSelectedWarmupExerciseId(virtualWarmupExerciseId);
        jumpToActiveSet();
        return;
      }

      const selected = flatSetsRef.current.find((item) => item.set.setId === setId);
      if (!selected) {
        return;
      }
      setSelectedWarmupExerciseId(null);

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
            loggedCount: exercise.sets.filter((set) => !isWarmupSet(set) && satisfiedSetIds.has(set.setId)).length,
            totalSets: exercise.sets.filter((set) => !isWarmupSet(set)).length,
          })),
          exercises: sectionItems.map((exercise) => {
            const workSets = exercise.sets.filter((set) => !isWarmupSet(set));
            const warmupSet = exercise.sets.find(isWarmupSet);
            const virtualWarmupSetId = buildVirtualWarmupSetId(exercise.workoutExerciseId);
            const loggedCountForExercise = workSets.filter((set) => satisfiedSetIds.has(set.setId)).length;
            const nextSet =
              workSets.find((set) => !satisfiedSetIds.has(set.setId)) ?? workSets[0] ?? null;
            const exerciseCapabilities = exercise.capabilities;
            const canSwapFromServer =
              exerciseCapabilities?.canSwap ?? capabilities.canSwapExercise;
            const canAddSetFromServer =
              exerciseCapabilities?.canAddSet ?? capabilities.canAddSet;
            const canRemoveFromServer =
              exerciseCapabilities?.canRemove ?? false;
            let swapDisabledReason: string | null = null;
            if (canSwapFromServer) {
              if (loggedCountForExercise > 0) {
                swapDisabledReason = "Swap unavailable after sets are logged.";
              } else if (exercise.isSwapped) {
                swapDisabledReason = "This exercise was already swapped.";
              }
            }

            return {
              section,
              exerciseId: exercise.workoutExerciseId,
              exerciseName: exercise.name,
              muscleTags: exercise.muscleTags ?? [],
              muscleTagGroups: resolveMuscleTagGroups(exercise),
              isRuntimeAdded: exercise.isRuntimeAdded ?? false,
              sessionNote: exercise.sessionNote,
              loggedCount: loggedCountForExercise,
              totalSets: workSets.length,
              allSetsLogged:
                loggedCountForExercise === workSets.length && workSets.length > 0,
              isExpanded: expandedExerciseId === exercise.workoutExerciseId,
              nextSetId: nextSet?.setId ?? null,
              canSwap: canSwapFromServer && swapDisabledReason == null,
              swapDisabledReason,
              canAddSet: canAddSetFromServer,
              isAddingSet: addingSetExerciseId === exercise.workoutExerciseId,
              isSwapping: selectedSwapExerciseId === exercise.workoutExerciseId,
              canRemove: canRemoveFromServer,
              isRemoving: removingExerciseId === exercise.workoutExerciseId,
              chips: [
                warmupSet
                  ? {
                      setId: warmupSet.setId,
                      label: formatQueueSetSummary(
                        warmupSet,
                        satisfiedSetIds.has(warmupSet.setId),
                        isDumbbellExercise(exercise)
                      ),
                      isLogged: satisfiedSetIds.has(warmupSet.setId),
                      isActive: resolvedActiveSetId === warmupSet.setId,
                      isSaving: savingSetId === warmupSet.setId,
                      variant: "warmup" as const,
                    }
                  : {
                      setId: virtualWarmupSetId,
                      label: "Warmup",
                      isLogged: false,
                      isActive: resolvedActiveSetId === virtualWarmupSetId,
                      isSaving: savingSetId === virtualWarmupSetId,
                      variant: "warmup" as const,
                    },
                ...workSets.map((set) => ({
                  setId: set.setId,
                  label: formatQueueSetSummary(
                    set,
                    satisfiedSetIds.has(set.setId),
                    isDumbbellExercise(exercise)
                  ),
                  isLogged: satisfiedSetIds.has(set.setId),
                  isActive: resolvedActiveSetId === set.setId,
                  isSaving: savingSetId === set.setId,
                  variant: "work" as const,
                })),
              ],
            };
          }),
        },
      ];
    });
  }, [
    data,
    expandedExerciseId,
    expandedSections,
    capabilities,
    satisfiedSetIds,
    resolvedActiveSetId,
    selectedSwapExerciseId,
    removingExerciseId,
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
    visibleActiveSet !== null &&
    autoregHint.exerciseId === visibleActiveSet.exercise.workoutExerciseId;
  const sessionTerminated = completion.completed || completion.skipped;
  const showFinishBar = capabilities.canFinish && !sessionTerminated && allSetsLogged;
  const shouldShowActiveEditor =
    !sessionTerminated &&
    visibleActiveSet != null &&
    (selectedWarmupActiveSet != null || activeCardMode.kind === "edit" || !allSetsLogged);
  const plannedSetSummary = useMemo(() => {
    let plannedTotal = 0;
    let plannedResolved = 0;

    for (const item of flatSets) {
      if (item.exercise.isRuntimeAdded || item.set.isRuntimeAdded || isWarmupSet(item.set)) {
        continue;
      }

      plannedTotal += 1;
      if (satisfiedSetIds.has(item.set.setId)) {
        plannedResolved += 1;
      }
    }

    return {
      plannedTotal,
      plannedResolved,
      plannedCheckpointReached:
        plannedTotal > 0 && plannedResolved === plannedTotal,
    };
  }, [flatSets, satisfiedSetIds]);
  const showWeeklyVolumeCheck =
    capabilities.showWeeklyCheck && !sessionTerminated && plannedSetSummary.plannedCheckpointReached;
  const weeklyVolumeRefreshKey = useMemo(
    () =>
      JSON.stringify(
        flatSets.map((item) => ({
          exerciseId: item.exercise.workoutExerciseId,
          exerciseRuntimeAdded: item.exercise.isRuntimeAdded ?? false,
          setId: item.set.setId,
          setRuntimeAdded: item.set.isRuntimeAdded ?? false,
          actualReps: item.set.actualReps ?? null,
          actualLoad: item.set.actualLoad ?? null,
          actualRpe: item.set.actualRpe ?? null,
          setIntent: item.set.setIntent ?? "WORK",
          wasSkipped: item.set.wasSkipped ?? false,
        }))
      ),
    [flatSets]
  );
  const finishBarBottomOffset = showFinishBar && keyboardHeight > 0 ? keyboardHeight : 0;
  const discardEditConfirmOpen = activeCardMode.kind === "edit" && showDiscardEditConfirm;
  const resolvedActiveSetValues = useMemo(
    () =>
      visibleActiveSet
        ? resolveDraftNumericValues(visibleActiveSet.set, visibleActiveSet.exercise)
        : { actualReps: null, actualLoad: null, actualRpe: null },
    [resolveDraftNumericValues, visibleActiveSet]
  );
  const submitActiveSet = useCallback(async () => {
    if (!visibleActiveSet) {
      return false;
    }

    if (selectedWarmupActiveSet) {
      const loggedWarmupSet = await actions.logWarmupSet({
        workoutExerciseId: selectedWarmupActiveSet.exercise.workoutExerciseId,
        virtualSetId: selectedWarmupActiveSet.set.setId,
        values: resolvedActiveSetValues,
      });
      if (loggedWarmupSet) {
        setSelectedWarmupExerciseId(null);
        jumpToActiveSet();
      }
      return Boolean(loggedWarmupSet);
    }

    const success = await actions.logSet(visibleActiveSet.set.setId, {
      ...resolvedActiveSetValues,
      setIntent: visibleActiveSet.set.setIntent ?? "WORK",
      wasSkipped:
        resolvedActiveSetValues.actualReps != null ||
        resolvedActiveSetValues.actualLoad != null ||
        resolvedActiveSetValues.actualRpe != null
          ? false
          : (visibleActiveSet.set.wasSkipped ?? false),
    });

    if (success && activeCardMode.kind === "edit") {
      exitEditMode({ restoreLiveSet: true, discardChanges: false });
    }

    return success;
  }, [
    activeCardMode.kind,
    actions,
    exitEditMode,
    jumpToActiveSet,
    resolvedActiveSetValues,
    selectedWarmupActiveSet,
    visibleActiveSet,
  ]);

  const skipActiveSet = useCallback(async () => {
    if (!visibleActiveSet) {
      return false;
    }

    if (selectedWarmupActiveSet) {
      clearDraft(selectedWarmupActiveSet.set.setId);
      clearDraftInputBuffers(selectedWarmupActiveSet.set.setId);
      setSelectedWarmupExerciseId(null);
      setActiveSetId(
        selectedWarmupActiveSet.exercise.sets.find((set) => !isWarmupSet(set))?.setId ??
          selectedWarmupActiveSet.exercise.sets[0]?.setId ??
          null
      );
      jumpToActiveSet();
      return true;
    }

    const success = await actions.logSet(visibleActiveSet.set.setId, {
      setIntent: visibleActiveSet.set.setIntent ?? "WORK",
      wasSkipped: true,
    });
    if (success && activeCardMode.kind === "edit") {
      exitEditMode({ restoreLiveSet: true, discardChanges: false });
    }

    return success;
  }, [
    activeCardMode.kind,
    actions,
    clearDraft,
    clearDraftInputBuffers,
    exitEditMode,
    jumpToActiveSet,
    selectedWarmupActiveSet,
    setActiveSetId,
    visibleActiveSet,
  ]);

  const handleAddExercise = useCallback(
    (exercise: LogExerciseInput) => {
      requestEditModeExit(() => {
        exitEditMode({ restoreLiveSet: false, discardChanges: true });
        setSelectedWarmupExerciseId(null);
        setExpandedSections((prev) => ({ ...prev, accessory: true }));
        setExpandedExerciseId(exercise.workoutExerciseId);
        addExerciseAction(exercise);
        jumpToActiveSet();
      });
    },
    [
      addExerciseAction,
      exitEditMode,
      jumpToActiveSet,
      requestEditModeExit,
      setExpandedExerciseId,
      setExpandedSections,
    ]
  );
  const handleSwapExercise = useCallback((exerciseId: string) => {
    setSelectedSwapExerciseId(exerciseId);
  }, []);
  const handleAddSet = useCallback(
    (exerciseId: string, section: ExerciseSection) => {
      requestEditModeExit(() => {
        exitEditMode({ restoreLiveSet: false, discardChanges: true });
        setSelectedWarmupExerciseId(null);
        setActiveSetId(null);
        setExpandedSections((prev) => ({ ...prev, [section]: true }));
        setExpandedExerciseId(exerciseId);
        void (async () => {
          const success = await addSetAction(exerciseId);
          if (success) {
            jumpToActiveSet();
          }
        })();
      });
    },
    [
      addSetAction,
      exitEditMode,
      jumpToActiveSet,
      requestEditModeExit,
      setActiveSetId,
      setExpandedExerciseId,
      setExpandedSections,
    ]
  );
  const handleRemoveExercise = useCallback(
    (exerciseId: string) => {
      requestEditModeExit(() => {
        exitEditMode({ restoreLiveSet: false, discardChanges: true });
        setSelectedWarmupExerciseId(null);
        void (async () => {
          const success = await removeExerciseAction(exerciseId);
          if (success) {
            setExpandedExerciseId((prev) => (prev === exerciseId ? null : prev));
          }
        })();
      });
    },
    [exitEditMode, removeExerciseAction, requestEditModeExit, setExpandedExerciseId]
  );
  const handleSwapApplied = useCallback(
    (exercise: LogExerciseInput) => {
      const resolvedSection =
        SECTION_ORDER.find((section) =>
          data[section].some((entry) => entry.workoutExerciseId === exercise.workoutExerciseId)
        ) ??
        resolveExerciseSection(exercise.section) ??
        "accessory";
      const nextActiveSetId =
        exercise.sets.find((set) => !isSetSatisfied(set))?.setId ?? exercise.sets[0]?.setId ?? null;

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
      if (activeCardModeRef.current.kind === "edit") {
        exitEditMode({ restoreLiveSet: false, discardChanges: false });
      }
      setSelectedWarmupExerciseId(null);
      setExpandedSections((prev) => ({ ...prev, [resolvedSection]: true }));
      setExpandedExerciseId(exercise.workoutExerciseId);
      if (nextActiveSetId) {
        setActiveSetId(nextActiveSetId);
      }
      jumpToActiveSet();
    },
    [data, exitEditMode, jumpToActiveSet, setActiveSetId, setData, setExpandedExerciseId, setExpandedSections]
  );

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

      {shouldShowActiveEditor && visibleActiveSet ? (
        <ActiveSetPanel>
          <WorkoutActiveSetCard
            activeSet={visibleActiveSet}
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
            onRemoveExercise={handleRemoveExercise}
            onExerciseRowRender={onQueueExerciseRowRender}
          />
        </ExerciseListPanel>
      ) : null}

      {!sessionTerminated ? (
        <div className="flex flex-wrap justify-center gap-3">
          {capabilities.canAddExercise ? (
            <button
              className="inline-flex min-h-11 items-center justify-center rounded-full border border-slate-300 px-5 text-sm font-semibold text-slate-700"
              onClick={() => setShowBonusSheet(true)}
              type="button"
            >
              + Add Exercise
            </button>
          ) : null}
          <WorkoutSessionActions
            mode={showFinishBar ? "optionsOnly" : "inline"}
            workoutHref={`/workout/${workoutId}`}
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
        </div>
      ) : null}

      {completion.completed ? (
        <CompletedWorkoutReview
          workoutId={workoutId}
          performanceSummary={performanceSummary}
          rpeAdherence={rpeAdherence}
          sessionIdentityLabel={sessionIdentityLabel}
          sessionTechnicalLabel={sessionTechnicalLabel}
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
      <RuntimeExerciseSwapSheet
        isOpen={selectedSwapExercise != null}
        onClose={() => setSelectedSwapExerciseId(null)}
        workoutId={workoutId}
        exercise={selectedSwapExercise}
        onSwap={handleSwapApplied}
      />

      {!sessionTerminated && !showFinishBar ? (
        <>
          {showWeeklyVolumeCheck ? (
            <WeeklyVolumeCheck
              workoutId={workoutId}
              visible={showWeeklyVolumeCheck}
              refreshKey={weeklyVolumeRefreshKey}
            />
          ) : null}
        </>
      ) : null}

      {showFinishBar ? (
        <>
          {showWeeklyVolumeCheck ? (
            <WeeklyVolumeCheck
              workoutId={workoutId}
              visible={showWeeklyVolumeCheck}
              refreshKey={weeklyVolumeRefreshKey}
            />
          ) : null}
          <WorkoutFooter
            sticky
            bottomOffset={finishBarBottomOffset}
            viewportBottomOffset={visualViewportBottomOffset}
          >
            <WorkoutSessionActions
              mode="finishBar"
              workoutHref={`/workout/${workoutId}`}
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
        </>
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
