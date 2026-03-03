"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { deleteSetLogRequest, logSetRequest, saveWorkoutRequest } from "@/components/log-workout/api";
import { getNextUnloggedSetId, resolveRestSeconds } from "@/components/log-workout/useWorkoutLogState";
import type { RestTimerSnapshot } from "@/components/log-workout/useRestTimerState";
import type {
  AutoregHint,
  BaselineUpdateSummary,
  CompletionAction,
  FlatSetItem,
  LogExerciseInput,
  LogSetInput,
  NormalizedExercises,
  PrefilledFieldState,
  UndoSnapshot,
} from "@/components/log-workout/types";

export type ChipEditDraft = {
  reps: string;
  load: string;
  rpe: string;
};

export type WorkoutSessionFlowState = {
  completionAction: CompletionAction | null;
  pendingAction: CompletionAction | null;
  skipReason: string;
  showSkipOptions: boolean;
  terminalState: "active" | "completed" | "skipped";
};

export type WorkoutSessionChipEditor = {
  setId: string | null;
  draft: ChipEditDraft | null;
  setDraft: Dispatch<SetStateAction<ChipEditDraft | null>>;
  open: (setId: string) => void;
  close: () => void;
  handleLoadBlur: (setId: string, isDumbbell: boolean) => void;
  save: (setId: string) => Promise<void>;
};

export type WorkoutSessionCompletionController = {
  state: WorkoutSessionFlowState;
  completed: boolean;
  skipped: boolean;
  pending: boolean;
  submitting: boolean;
  run: (action: CompletionAction) => Promise<void>;
  openConfirm: (action: CompletionAction) => void;
  cancelConfirm: () => void;
  toggleSkipOptions: () => void;
  setSkipReason: (value: string) => void;
};

export type WorkoutSessionActions = {
  logSet: (setId: string, overrides?: Partial<LogSetInput>) => Promise<boolean>;
  undo: () => Promise<void>;
  addExercise: (exercise: LogExerciseInput) => void;
};

type SetPrefilledField = keyof PrefilledFieldState;

type UseWorkoutSessionFlowParams = {
  workoutId: string;
  flatSets: FlatSetItem[];
  loggedSetIds: Set<string>;
  setLoggedSetIds: Dispatch<SetStateAction<Set<string>>>;
  setActiveSetId: Dispatch<SetStateAction<string | null>>;
  setData: Dispatch<SetStateAction<NormalizedExercises>>;
  restTimer: RestTimerSnapshot | null;
  startTimer: (durationSeconds: number) => void;
  clearTimer: () => void;
  restoreTimer: (snapshot: RestTimerSnapshot | null) => void;
  clearDraft: (setId: string) => void;
  clearAllDrafts: () => void;
  clearDraftInputBuffers: (setId: string) => void;
  setFieldPrefilled: (setId: string, field: SetPrefilledField, value: boolean) => void;
  updateSetFields: (setId: string, updater: (set: LogSetInput) => LogSetInput) => void;
  isBodyweightExercise: (exercise: LogExerciseInput) => boolean;
  isDumbbellExercise: (exercise: LogExerciseInput) => boolean;
  toInputNumberString: (value: number | null | undefined) => string;
  toDisplayLoadValue: (value: number | null | undefined, isDumbbell: boolean) => number | null;
  parseNullableNumber: (raw: string) => number | null;
  normalizeLoadInput: (raw: string, isDumbbell: boolean) => number | null;
};

function setSetInputFieldsPrefilled(
  setId: string,
  setFieldPrefilled: UseWorkoutSessionFlowParams["setFieldPrefilled"],
  value: boolean
) {
  setFieldPrefilled(setId, "actualReps", value);
  setFieldPrefilled(setId, "actualLoad", value);
  setFieldPrefilled(setId, "actualRpe", value);
}

export function useWorkoutSessionFlow({
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
  toDisplayLoadValue,
  parseNullableNumber,
  normalizeLoadInput,
}: UseWorkoutSessionFlowParams) {
  const [savingSetId, setSavingSetId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [baselineSummary, setBaselineSummary] = useState<BaselineUpdateSummary | null>(null);
  const [undoSnapshot, setUndoSnapshot] = useState<UndoSnapshot | null>(null);
  const [autoregHint, setAutoregHint] = useState<AutoregHint | null>(null);
  const [chipEditSetId, setChipEditSetId] = useState<string | null>(null);
  const [chipEditDraft, setChipEditDraft] = useState<ChipEditDraft | null>(null);
  const [sessionFlow, setSessionFlow] = useState<WorkoutSessionFlowState>({
    completionAction: null,
    pendingAction: null,
    skipReason: "",
    showSkipOptions: false,
    terminalState: "active",
  });
  const statusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const errorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sessionActionPending = sessionFlow.pendingAction !== null;
  const completed = sessionFlow.terminalState === "completed";
  const skipped = sessionFlow.terminalState === "skipped";

  const clearStatusTimer = useCallback(() => {
    if (statusTimeoutRef.current) {
      clearTimeout(statusTimeoutRef.current);
      statusTimeoutRef.current = null;
    }
  }, []);

  const clearErrorTimer = useCallback(() => {
    if (errorTimeoutRef.current) {
      clearTimeout(errorTimeoutRef.current);
      errorTimeoutRef.current = null;
    }
  }, []);

  const showStatus = useCallback(
    (message: string) => {
      clearStatusTimer();
      setStatus(message);
      statusTimeoutRef.current = setTimeout(() => {
        setStatus(null);
        statusTimeoutRef.current = null;
      }, 2500);
    },
    [clearStatusTimer]
  );

  const showError = useCallback(
    (message: string) => {
      clearErrorTimer();
      setError(message);
      errorTimeoutRef.current = setTimeout(() => {
        setError(null);
        errorTimeoutRef.current = null;
      }, 5000);
    },
    [clearErrorTimer]
  );

  const clearFeedback = useCallback(() => {
    setStatus(null);
    setError(null);
    clearStatusTimer();
    clearErrorTimer();
  }, [clearErrorTimer, clearStatusTimer]);

  const dismissError = useCallback(() => {
    setError(null);
    clearErrorTimer();
  }, [clearErrorTimer]);

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

  useEffect(() => {
    return () => {
      clearStatusTimer();
      clearErrorTimer();
    };
  }, [clearErrorTimer, clearStatusTimer]);

  const openChipEditor = useCallback(
    (setId: string) => {
      const target = flatSets.find((item) => item.set.setId === setId);
      if (!target) {
        return;
      }

      setChipEditSetId(setId);
      setChipEditDraft({
        reps: toInputNumberString(target.set.actualReps),
        load: toInputNumberString(
          toDisplayLoadValue(target.set.actualLoad, isDumbbellExercise(target.exercise))
        ),
        rpe: toInputNumberString(target.set.actualRpe),
      });
    },
    [flatSets, isDumbbellExercise, toDisplayLoadValue, toInputNumberString]
  );

  const closeChipEditor = useCallback(() => {
    setChipEditSetId(null);
    setChipEditDraft(null);
  }, []);

  const handleChipLoadBlur = useCallback(
    (setId: string, isDumbbell: boolean) => {
      if (chipEditSetId !== setId || !chipEditDraft) {
        return;
      }

      const normalized = normalizeLoadInput(chipEditDraft.load, isDumbbell);
      setChipEditDraft((prev) =>
        prev
          ? {
              ...prev,
              load: toInputNumberString(toDisplayLoadValue(normalized, isDumbbell)),
            }
          : prev
      );
    },
    [chipEditDraft, chipEditSetId, normalizeLoadInput, toDisplayLoadValue, toInputNumberString]
  );

  const handleLogSet = useCallback(
    async (setId: string, overrides?: Partial<LogSetInput>): Promise<boolean> => {
      clearFeedback();
      const targetSet = flatSets.find((item) => item.set.setId === setId);
      if (!targetSet) {
        showError("Unable to find set");
        return false;
      }

      const wasAlreadyLogged = loggedSetIds.has(setId);
      const mergedSet = { ...targetSet.set, ...overrides };
      const isBodyweightTarget =
        isBodyweightExercise(targetSet.exercise) &&
        (targetSet.set.targetLoad === null ||
          targetSet.set.targetLoad === undefined ||
          targetSet.set.targetLoad === 0);
      const normalizedSet: LogSetInput = {
        ...mergedSet,
        actualLoad:
          !(mergedSet.wasSkipped ?? false) && isBodyweightTarget && mergedSet.actualLoad == null
            ? 0
            : mergedSet.actualLoad,
      };

      setSavingSetId(setId);

      try {
        const response = await logSetRequest({
          workoutSetId: targetSet.set.setId,
          actualReps: normalizedSet.actualReps ?? undefined,
          actualLoad: normalizedSet.actualLoad ?? undefined,
          actualRpe: normalizedSet.actualRpe ?? undefined,
          wasSkipped: normalizedSet.wasSkipped ?? false,
        });

        if (response.error) {
          showError(response.error);
          return false;
        }

        const body = response.data;
        updateSetFields(setId, (set) => ({ ...set, ...normalizedSet }));

        const nextLogged = new Set(loggedSetIds);
        nextLogged.add(setId);
        setLoggedSetIds(nextLogged);
        clearDraft(setId);
        clearDraftInputBuffers(setId);
        setSetInputFieldsPrefilled(setId, setFieldPrefilled, false);
        setUndoSnapshot({
          setId,
          previousRestTimer: restTimer,
          previousSet: targetSet.set,
          previousLog: body?.previousLog ?? null,
          wasCreated: body?.wasCreated ?? !wasAlreadyLogged,
          expiresAt: Date.now() + 5000,
        });

        if (!wasAlreadyLogged) {
          const nextSetId = getNextUnloggedSetId(flatSets, nextLogged, setId);
          if (nextSetId) {
            setActiveSetId(nextSetId);
          }
        }

        if (!(normalizedSet.wasSkipped ?? false)) {
          startTimer(resolveRestSeconds(targetSet));
        }

        const nextExerciseSet = flatSets.find(
          (item) =>
            item.exercise.workoutExerciseId === targetSet.exercise.workoutExerciseId &&
            !nextLogged.has(item.set.setId) &&
            item.set.targetRpe != null
        );
        if (nextExerciseSet && normalizedSet.actualRpe != null && nextExerciseSet.set.targetRpe != null) {
          const diff = normalizedSet.actualRpe - nextExerciseSet.set.targetRpe;
          if (diff <= -1.5) {
            setAutoregHint({
              exerciseId: targetSet.exercise.workoutExerciseId,
              message: "Set felt easier than target. Consider +2.5-5 lbs for next set.",
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

        showStatus(wasAlreadyLogged ? "Set updated" : "Set logged");
        return true;
      } finally {
        setSavingSetId(null);
      }
    },
    [
      clearDraft,
      clearDraftInputBuffers,
      clearFeedback,
      flatSets,
      isBodyweightExercise,
      loggedSetIds,
      restTimer,
      setActiveSetId,
      setFieldPrefilled,
      setLoggedSetIds,
      showError,
      showStatus,
      startTimer,
      updateSetFields,
    ]
  );

  const handleChipEditSave = useCallback(
    async (setId: string) => {
      if (chipEditSetId !== setId || !chipEditDraft) {
        return;
      }

      const target = flatSets.find((item) => item.set.setId === setId);
      if (!target) {
        return;
      }

      const isDumbbell = isDumbbellExercise(target.exercise);
      const reps = parseNullableNumber(chipEditDraft.reps);
      const load = normalizeLoadInput(chipEditDraft.load, isDumbbell);
      const rpe = parseNullableNumber(chipEditDraft.rpe);

      updateSetFields(setId, (set) => ({
        ...set,
        actualReps: reps,
        actualLoad: load,
        actualRpe: rpe,
        wasSkipped: false,
      }));

      const success = await handleLogSet(setId, {
        actualReps: reps,
        actualLoad: load,
        actualRpe: rpe,
        wasSkipped: false,
      });

      if (success) {
        closeChipEditor();
      }
    },
    [
      chipEditDraft,
      chipEditSetId,
      closeChipEditor,
      flatSets,
      handleLogSet,
      isDumbbellExercise,
      normalizeLoadInput,
      parseNullableNumber,
      updateSetFields,
    ]
  );

  const handleUndo = useCallback(async () => {
    if (!undoSnapshot) {
      return;
    }

    clearFeedback();
    setSavingSetId(undoSnapshot.setId);

    try {
      if (undoSnapshot.wasCreated) {
        const response = await deleteSetLogRequest(undoSnapshot.setId);
        if (response.error) {
          showError(response.error);
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
          showError(deleteResponse.error);
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
          showError(restoreResponse.error);
          return;
        }

        if (undoSnapshot.previousSet) {
          updateSetFields(undoSnapshot.setId, () => undoSnapshot.previousSet as LogSetInput);
        }
      }

      setActiveSetId(undoSnapshot.setId);
      restoreTimer(undoSnapshot.previousRestTimer);
      setUndoSnapshot(null);
      showStatus("Last set log reverted");
    } catch {
      showError("Failed to undo set log");
    } finally {
      setSavingSetId(null);
    }
  }, [clearFeedback, restoreTimer, setActiveSetId, setLoggedSetIds, showError, showStatus, undoSnapshot, updateSetFields]);

  const executeCompletionAction = useCallback(
    async (action: CompletionAction) => {
      if (sessionActionPending) {
        return;
      }

      setSessionFlow((prev) => ({ ...prev, pendingAction: action }));
      clearFeedback();
      setBaselineSummary(null);

      try {
        if (action === "mark_skipped") {
          const response = await saveWorkoutRequest({
            workoutId,
            action: "mark_skipped",
            status: "SKIPPED",
            notes: sessionFlow.skipReason ? `Skipped: ${sessionFlow.skipReason}` : "Skipped",
            exercises: [],
          });

          if (response.error) {
            showError(response.error);
            return;
          }

          clearAllDrafts();
          clearTimer();
          setSessionFlow((prev) => ({
            ...prev,
            completionAction: null,
            pendingAction: null,
            showSkipOptions: false,
            terminalState: "skipped",
          }));
          showStatus("Workout marked as skipped");
          return;
        }

        const response = await saveWorkoutRequest({
          workoutId,
          action,
          status: action === "mark_partial" ? "PARTIAL" : "COMPLETED",
          exercises: [],
        });

        if (response.error) {
          showError(response.error);
          return;
        }

        const body = response.data;
        clearAllDrafts();
        setBaselineSummary((body?.baselineSummary as BaselineUpdateSummary | null | undefined) ?? null);
        clearTimer();
        setSessionFlow((prev) => ({
          ...prev,
          completionAction: null,
          pendingAction: null,
          showSkipOptions: false,
          terminalState: "completed",
        }));
        showStatus(
          body?.workoutStatus === "PARTIAL"
            ? "Workout saved as partial (some planned sets were unresolved)"
            : "Workout marked as completed"
        );
      } catch {
        showError("Failed to complete workout action");
      } finally {
        setSessionFlow((prev) => ({
          ...prev,
          pendingAction: null,
          completionAction: prev.terminalState === "active" ? prev.completionAction : null,
        }));
      }
    },
    [clearAllDrafts, clearFeedback, clearTimer, sessionActionPending, sessionFlow.skipReason, showError, showStatus, workoutId]
  );

  const openCompletionConfirm = useCallback(
    (action: CompletionAction) => {
      if (sessionActionPending) {
        return;
      }

      setSessionFlow((prev) => ({ ...prev, completionAction: action }));
    },
    [sessionActionPending]
  );

  const cancelCompletionConfirm = useCallback(() => {
    setSessionFlow((prev) => ({ ...prev, completionAction: null }));
  }, []);

  const toggleSkipOptions = useCallback(() => {
    setSessionFlow((prev) => ({ ...prev, showSkipOptions: !prev.showSkipOptions }));
  }, []);

  const setSkipReason = useCallback((value: string) => {
    setSessionFlow((prev) => ({ ...prev, skipReason: value }));
  }, []);

  const handleAddExercise = useCallback(
    (exercise: LogExerciseInput) => {
      setData((prev) => ({
        ...prev,
        accessory: [...prev.accessory, exercise],
      }));
      if (exercise.sets[0]) {
        setActiveSetId(exercise.sets[0].setId);
      }
    },
    [setActiveSetId, setData]
  );

  const chipEditor: WorkoutSessionChipEditor = {
    setId: chipEditSetId,
    draft: chipEditDraft,
    setDraft: setChipEditDraft,
    open: openChipEditor,
    close: closeChipEditor,
    handleLoadBlur: handleChipLoadBlur,
    save: handleChipEditSave,
  };
  const completion: WorkoutSessionCompletionController = {
    state: sessionFlow,
    completed,
    skipped,
    pending: sessionActionPending,
    submitting: sessionActionPending,
    run: executeCompletionAction,
    openConfirm: openCompletionConfirm,
    cancelConfirm: cancelCompletionConfirm,
    toggleSkipOptions,
    setSkipReason,
  };
  const actions: WorkoutSessionActions = {
    logSet: handleLogSet,
    undo: handleUndo,
    addExercise: handleAddExercise,
  };

  return {
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
  };
}
