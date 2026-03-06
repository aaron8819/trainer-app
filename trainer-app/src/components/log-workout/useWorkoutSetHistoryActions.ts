"use client";

import { useCallback, useMemo } from "react";
import type {
  FlatSetItem,
  LogExerciseInput,
  LogSetInput,
  PrefilledFieldState,
  SetDraftBuffers,
} from "@/components/log-workout/types";

type UseWorkoutSetHistoryActionsParams = {
  activeSet: FlatSetItem | null;
  findPreviousLoggedSet: (exercise: LogExerciseInput, currentSetIndex: number) => LogSetInput | null;
  markFieldTouched: (setId: string, field: keyof PrefilledFieldState) => void;
  setFieldPrefilled: (setId: string, field: keyof PrefilledFieldState, value: boolean) => void;
  setRepsValue: (setId: string, value: number | null) => void;
  updateDraftBuffer: (setId: string, field: keyof SetDraftBuffers, value: string) => void;
  setRpeValue: (setId: string, rawValue: string, options?: { commit?: boolean }) => void;
  toInputNumberString: (value: number | null | undefined) => string;
};

export function useWorkoutSetHistoryActions({
  activeSet,
  findPreviousLoggedSet,
  markFieldTouched,
  setFieldPrefilled,
  setRepsValue,
  updateDraftBuffer,
  setRpeValue,
  toInputNumberString,
}: UseWorkoutSetHistoryActionsParams) {
  const previousSet = useMemo(() => {
    if (!activeSet) {
      return null;
    }

    return findPreviousLoggedSet(activeSet.exercise, activeSet.setIndex);
  }, [activeSet, findPreviousLoggedSet]);

  const useSameAsLast = useCallback(() => {
    if (!activeSet || !previousSet) {
      return;
    }

    const setId = activeSet.set.setId;
    setRepsValue(setId, previousSet.actualReps ?? null);
    updateDraftBuffer(setId, "load", toInputNumberString(previousSet.actualLoad));
    setRpeValue(setId, toInputNumberString(previousSet.actualRpe), { commit: true });
    markFieldTouched(setId, "actualReps");
    markFieldTouched(setId, "actualLoad");
    markFieldTouched(setId, "actualRpe");
    setFieldPrefilled(setId, "actualReps", false);
    setFieldPrefilled(setId, "actualLoad", false);
    setFieldPrefilled(setId, "actualRpe", false);
  }, [
    activeSet,
    markFieldTouched,
    previousSet,
    setFieldPrefilled,
    setRepsValue,
    setRpeValue,
    toInputNumberString,
    updateDraftBuffer,
  ]);

  return {
    hasPreviousSet: previousSet !== null,
    useSameAsLast,
  };
}
