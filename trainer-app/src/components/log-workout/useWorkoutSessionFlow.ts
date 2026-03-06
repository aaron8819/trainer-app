"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { deleteSetLogRequest, logSetRequest } from "@/components/log-workout/api";
import {
  useWorkoutChipEditor,
  type WorkoutSessionChipEditor,
} from "@/components/log-workout/useWorkoutChipEditor";
import { getNextUnloggedSetId, resolveRestSeconds } from "@/components/log-workout/useWorkoutLogState";
import type { RestTimerSnapshot } from "@/components/log-workout/useRestTimerState";
import {
  useWorkoutSessionCompletion,
  type WorkoutSessionCompletionController,
} from "@/components/log-workout/useWorkoutSessionCompletion";
import type {
  AutoregHint,
  FlatSetItem,
  LogExerciseInput,
  LogSetInput,
  NormalizedExercises,
  PrefilledFieldState,
  UndoSnapshot,
} from "@/components/log-workout/types";
import { getLoadRecommendation } from "@/lib/progression/load-coaching";

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
  parseNullableNumber: (raw: string) => number | null;
  normalizeLoadInput: (raw: string, isDumbbell: boolean) => number | null;
  onAdvanceSet?: () => void;
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
  parseNullableNumber,
  normalizeLoadInput,
  onAdvanceSet,
}: UseWorkoutSessionFlowParams) {
  const [savingSetId, setSavingSetId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [undoSnapshot, setUndoSnapshot] = useState<UndoSnapshot | null>(null);
  const [autoregHint, setAutoregHint] = useState<AutoregHint | null>(null);
  const statusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const errorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
        setLoggedSetIds((prev) => {
          const next = new Set(prev);
          next.add(setId);
          return next;
        });
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
            onAdvanceSet?.();
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
          const repRange = nextExerciseSet.set.targetRepRange ?? {
            min: nextExerciseSet.set.targetReps,
            max: nextExerciseSet.set.targetReps,
          };
          const recommendation = getLoadRecommendation({
            reps: normalizedSet.actualReps,
            rir: 10 - normalizedSet.actualRpe,
            repRange,
            targetRir: 10 - nextExerciseSet.set.targetRpe,
          });
          if (recommendation) {
            setAutoregHint({
              exerciseId: targetSet.exercise.workoutExerciseId,
              message: recommendation.message,
            });
          } else {
            setAutoregHint(null);
          }
        } else {
          setAutoregHint(null);
        }

        showStatus(
          normalizedSet.wasSkipped ?? false
            ? "Set skipped."
            : wasAlreadyLogged
            ? "Set updated."
            : "Set logged. Rest timer started."
        );
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
      onAdvanceSet,
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

  const chipEditor: WorkoutSessionChipEditor = useWorkoutChipEditor({
    flatSets,
    isDumbbellExercise,
    toInputNumberString,
    parseNullableNumber,
    normalizeLoadInput,
    updateSetFields,
    logSet: handleLogSet,
  });
  const completion: WorkoutSessionCompletionController = useWorkoutSessionCompletion({
    workoutId,
    clearAllDrafts,
    clearTimer,
    clearFeedback,
    showError,
    showStatus,
  });
  const actions: WorkoutSessionActions = {
    logSet: handleLogSet,
    undo: handleUndo,
    addExercise: handleAddExercise,
  };

  return {
    savingSetId,
    status,
    error,
    baselineSummary: completion.baselineSummary,
    undoSnapshot,
    autoregHint,
    chipEditor,
    completion,
    actions,
    dismissError,
  };
}
