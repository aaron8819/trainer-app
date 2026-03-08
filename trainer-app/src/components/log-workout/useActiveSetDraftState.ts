"use client";

import { useCallback, useEffect, useReducer, useRef, type FocusEvent } from "react";
import { useSetDraft } from "@/components/log-workout/useSetDraft";
import { quantizeLoad } from "@/lib/units/load-quantization";
import type {
  FlatSetItem,
  LogExerciseInput,
  LogSetInput,
  PrefilledFieldState,
  SetDraftBuffers,
} from "@/components/log-workout/types";

function buildEmptyFieldState(
  existing?: PrefilledFieldState
): PrefilledFieldState {
  return {
    actualReps: existing?.actualReps ?? false,
    actualLoad: existing?.actualLoad ?? false,
    actualRpe: existing?.actualRpe ?? false,
  };
}

function parseNullableNumber(raw: string): number | null {
  const normalized = raw.trim();
  if (normalized.length === 0) {
    return null;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function toInputNumberString(value: number | null | undefined): string {
  if (value == null) {
    return "";
  }
  return String(value);
}

type DraftUiState = {
  draftBuffersBySet: Record<string, SetDraftBuffers>;
  touchedFieldsBySet: Record<string, PrefilledFieldState>;
  prefilledFieldsBySet: Record<string, PrefilledFieldState>;
};

type DraftUiAction =
  | {
      type: "draftBuffers";
      updater: (prev: Record<string, SetDraftBuffers>) => Record<string, SetDraftBuffers>;
    }
  | {
      type: "touchedFields";
      updater: (prev: Record<string, PrefilledFieldState>) => Record<string, PrefilledFieldState>;
    }
  | {
      type: "prefilledFields";
      updater: (prev: Record<string, PrefilledFieldState>) => Record<string, PrefilledFieldState>;
    };

function draftUiReducer(state: DraftUiState, action: DraftUiAction): DraftUiState {
  switch (action.type) {
    case "draftBuffers":
      return {
        ...state,
        draftBuffersBySet: action.updater(state.draftBuffersBySet),
      };
    case "touchedFields":
      return {
        ...state,
        touchedFieldsBySet: action.updater(state.touchedFieldsBySet),
      };
    case "prefilledFields":
      return {
        ...state,
        prefilledFieldsBySet: action.updater(state.prefilledFieldsBySet),
      };
    default:
      return state;
  }
}

export function useActiveSetDraftState({
  workoutId,
  activeSetIds,
  activeSet,
  flatSets,
  loggedSetIds,
  resolvedActiveSetId,
  findPreviousLoggedSet,
  toStoredLoadValue,
  isDumbbellExercise,
}: {
  workoutId: string;
  activeSetIds: string[];
  activeSet: FlatSetItem | null;
  flatSets: FlatSetItem[];
  loggedSetIds: Set<string>;
  resolvedActiveSetId: string | null;
  findPreviousLoggedSet: (exercise: LogExerciseInput, currentSetIndex: number) => LogSetInput | null;
  toStoredLoadValue: (value: number | null | undefined, isDumbbell: boolean) => number | null;
  isDumbbellExercise: (exercise: LogExerciseInput) => boolean;
}) {
  const [draftUiState, dispatchDraftUi] = useReducer(draftUiReducer, {
    draftBuffersBySet: {},
    touchedFieldsBySet: {},
    prefilledFieldsBySet: {},
  });
  const { draftBuffersBySet, touchedFieldsBySet, prefilledFieldsBySet } = draftUiState;
  const restoredBufferIdsRef = useRef<Set<string>>(new Set());

  const updateDraftBuffer = useCallback(
    (setId: string, field: keyof SetDraftBuffers, value: string) => {
      dispatchDraftUi({
        type: "draftBuffers",
        updater: (prev) => ({
          ...prev,
          [setId]: {
            ...(prev[setId] ?? {}),
            [field]: value,
          },
        }),
      });
    },
    []
  );

  const markFieldTouched = useCallback((setId: string, field: keyof PrefilledFieldState) => {
    dispatchDraftUi({
      type: "touchedFields",
      updater: (prev) => ({
        ...prev,
        [setId]: {
          ...buildEmptyFieldState(prev[setId]),
          [field]: true,
        },
      }),
    });
  }, []);

  const setFieldPrefilled = useCallback(
    (setId: string, field: keyof PrefilledFieldState, isPrefilled: boolean) => {
      dispatchDraftUi({
        type: "prefilledFields",
        updater: (prev) => ({
          ...prev,
          [setId]: {
            ...buildEmptyFieldState(prev[setId]),
            [field]: isPrefilled,
          },
        }),
      });
    },
    []
  );

  const handleRestoreDraft = useCallback(
    (setId: string, draft: SetDraftBuffers) => {
      restoredBufferIdsRef.current.add(setId);
      dispatchDraftUi({
        type: "draftBuffers",
        updater: (prev) => ({
          ...prev,
          [setId]: { reps: draft.reps, load: draft.load, rpe: draft.rpe },
        }),
      });
      dispatchDraftUi({
        type: "touchedFields",
        updater: (prev) => ({
          ...prev,
          [setId]: buildEmptyFieldState(prev[setId]),
        }),
      });
      dispatchDraftUi({
        type: "prefilledFields",
        updater: (prev) => ({
          ...prev,
          [setId]: buildEmptyFieldState(prev[setId]),
        }),
      });
    },
    []
  );

  const {
    saveDraft,
    clearDraft,
    clearAllDrafts,
    restoredSetIds,
    savingDraftSetId,
    lastSavedDraft,
    markRestoredSeen,
  } = useSetDraft({
    workoutId,
    setIds: activeSetIds,
    onRestore: handleRestoreDraft,
  });

  useEffect(() => {
    if (!activeSet) {
      return;
    }
    const setId = activeSet.set.setId;
    if (restoredBufferIdsRef.current.has(setId)) {
      return;
    }
    if (loggedSetIds.has(setId)) {
      return;
    }
    const hasTouchedFields = Boolean(
      touchedFieldsBySet[setId]?.actualReps ||
        touchedFieldsBySet[setId]?.actualLoad ||
        touchedFieldsBySet[setId]?.actualRpe
    );
    const hasDraftBuffer = draftBuffersBySet[setId] !== undefined;
    if (hasTouchedFields || hasDraftBuffer) {
      return;
    }
    const hasExistingActuals =
      activeSet.set.actualReps != null || activeSet.set.actualLoad != null || activeSet.set.actualRpe != null;
    if (hasExistingActuals || (activeSet.set.wasSkipped ?? false)) {
      return;
    }

    const previousLoggedSet = findPreviousLoggedSet(activeSet.exercise, activeSet.setIndex);
    const prefillValues = previousLoggedSet
      ? {
          actualReps: previousLoggedSet.actualReps ?? null,
          actualLoad: previousLoggedSet.actualLoad ?? null,
          actualRpe: previousLoggedSet.actualRpe ?? null,
        }
      : {
          actualReps: activeSet.set.targetReps ?? null,
          actualLoad: activeSet.set.targetLoad ?? null,
          actualRpe: activeSet.set.targetRpe ?? null,
        };
    if (
      prefillValues.actualReps == null &&
      prefillValues.actualLoad == null &&
      prefillValues.actualRpe == null
    ) {
      return;
    }

    dispatchDraftUi({
      type: "draftBuffers",
      updater: (prev) => ({
        ...prev,
        [setId]: {
          reps: toInputNumberString(prefillValues.actualReps),
          load: toInputNumberString(prefillValues.actualLoad),
          rpe: toInputNumberString(prefillValues.actualRpe),
        },
      }),
    });
    dispatchDraftUi({
      type: "touchedFields",
      updater: (prev) => ({
        ...prev,
        [setId]: { actualReps: false, actualLoad: false, actualRpe: false },
      }),
    });
    dispatchDraftUi({
      type: "prefilledFields",
      updater: (prev) => ({
        ...prev,
        [setId]: {
          actualReps: prefillValues.actualReps != null,
          actualLoad: prefillValues.actualLoad != null,
          actualRpe: prefillValues.actualRpe != null,
        },
      }),
    });
  }, [
    activeSet,
    draftBuffersBySet,
    findPreviousLoggedSet,
    loggedSetIds,
    touchedFieldsBySet,
  ]);

  useEffect(() => {
    restoredBufferIdsRef.current = new Set();
  }, [workoutId]);

  useEffect(() => {
    if (!activeSet) {
      return;
    }
    const setId = activeSet.set.setId;
    const draftBuffers = draftBuffersBySet[setId];
    if (!draftBuffers) {
      return;
    }
    const hasTouchedFields = Boolean(
      touchedFieldsBySet[setId]?.actualReps ||
        touchedFieldsBySet[setId]?.actualLoad ||
        touchedFieldsBySet[setId]?.actualRpe
    );
    if (!hasTouchedFields) {
      return;
    }
    saveDraft(setId, {
      reps: draftBuffers.reps ?? "",
      load: draftBuffers.load ?? "",
      rpe: draftBuffers.rpe ?? "",
    });
  }, [activeSet, draftBuffersBySet, saveDraft, touchedFieldsBySet]);

  const clearDraftInputBuffers = useCallback((setId: string) => {
    restoredBufferIdsRef.current.delete(setId);
    dispatchDraftUi({
      type: "draftBuffers",
      updater: (prev) => {
        const next = { ...prev };
        delete next[setId];
        return next;
      },
    });
  }, []);

  const seedDraftFromValues = useCallback(
    (
      setId: string,
      values: { reps?: number | null; load?: number | null; rpe?: number | null },
      options?: { prefilled?: boolean }
    ) => {
      restoredBufferIdsRef.current.delete(setId);
      dispatchDraftUi({
        type: "draftBuffers",
        updater: (prev) => ({
          ...prev,
          [setId]: {
            reps: toInputNumberString(values.reps),
            load: toInputNumberString(values.load),
            rpe: toInputNumberString(values.rpe),
          },
        }),
      });
      dispatchDraftUi({
        type: "touchedFields",
        updater: (prev) => ({
          ...prev,
          [setId]: { actualReps: false, actualLoad: false, actualRpe: false },
        }),
      });
      dispatchDraftUi({
        type: "prefilledFields",
        updater: (prev) => ({
          ...prev,
          [setId]: {
            actualReps: options?.prefilled ?? false,
            actualLoad: options?.prefilled ?? false,
            actualRpe: options?.prefilled ?? false,
          },
        }),
      });
    },
    []
  );

  const resetDraftVisualState = useCallback((setId: string) => {
    dispatchDraftUi({
      type: "touchedFields",
      updater: (prev) => ({
        ...prev,
        [setId]: { actualReps: false, actualLoad: false, actualRpe: false },
      }),
    });
    dispatchDraftUi({
      type: "prefilledFields",
      updater: (prev) => ({
        ...prev,
        [setId]: { actualReps: false, actualLoad: false, actualRpe: false },
      }),
    });
  }, []);

  const setRepsValue = useCallback(
    (setId: string, value: number | null) => {
      updateDraftBuffer(setId, "reps", toInputNumberString(value));
    },
    [updateDraftBuffer]
  );

  const setLoadValue = useCallback(
    (setId: string, rawValue: string, isDumbbell: boolean, options?: { commit?: boolean }) => {
      const parsed = parseNullableNumber(rawValue);
      const normalized =
        parsed == null ? null : quantizeLoad(toStoredLoadValue(parsed, isDumbbell) ?? parsed);
      updateDraftBuffer(
        setId,
        "load",
        options?.commit && normalized != null
          ? toInputNumberString(normalized)
          : rawValue
      );
    },
    [toStoredLoadValue, updateDraftBuffer]
  );

  const commitLoadValue = useCallback(
    (setId: string, rawValue: string, isDumbbell: boolean) => {
      const parsed = parseNullableNumber(rawValue.trim());
      const normalized =
        parsed == null ? null : quantizeLoad(toStoredLoadValue(parsed, isDumbbell) ?? parsed);
      markFieldTouched(setId, "actualLoad");
      setFieldPrefilled(setId, "actualLoad", false);
      updateDraftBuffer(setId, "load", toInputNumberString(normalized));
    },
    [markFieldTouched, setFieldPrefilled, toStoredLoadValue, updateDraftBuffer]
  );

  const setRpeValue = useCallback(
    (setId: string, rawValue: string, options?: { commit?: boolean }) => {
      updateDraftBuffer(setId, "rpe", rawValue);
    },
    [updateDraftBuffer]
  );

  const primeNumericBuffer = useCallback(
    (setId: string, value: number | null | undefined, field: keyof SetDraftBuffers) => {
      const currentValue = draftBuffersBySet[setId]?.[field];
      if (currentValue !== undefined) {
        return;
      }
      updateDraftBuffer(setId, field, toInputNumberString(value));
    },
    [draftBuffersBySet, updateDraftBuffer]
  );

  const commitNumericBuffer = useCallback(
    (
      setId: string,
      rawValue: string,
      field: keyof PrefilledFieldState,
      draftField: keyof SetDraftBuffers
    ) => {
      markFieldTouched(setId, field);
      setFieldPrefilled(setId, field, false);
      updateDraftBuffer(setId, draftField, toInputNumberString(parseNullableNumber(rawValue)));
    },
    [markFieldTouched, setFieldPrefilled, updateDraftBuffer]
  );

  const handleNumericFieldFocus = useCallback(() => {
    if (resolvedActiveSetId && restoredSetIds.has(resolvedActiveSetId)) {
      markRestoredSeen(resolvedActiveSetId);
    }
  }, [markRestoredSeen, resolvedActiveSetId, restoredSetIds]);

  const handleLoadFocus = useCallback(() => {
    if (!activeSet) {
      return;
    }
    const setId = activeSet.set.setId;
    if (draftBuffersBySet[setId]?.load !== undefined) {
      return;
    }
    updateDraftBuffer(setId, "load", toInputNumberString(activeSet.set.actualLoad));
  }, [activeSet, draftBuffersBySet, updateDraftBuffer]);

  const handleLoadBlur = useCallback(
    (event: FocusEvent<HTMLInputElement>) => {
      if (!activeSet) {
        return;
      }
      const setId = activeSet.set.setId;
      const isDumbbell = isDumbbellExercise(activeSet.exercise);
      const rawValue = (event.currentTarget.value ?? draftBuffersBySet[setId]?.load ?? "").trim();
      const parsed = parseNullableNumber(rawValue);
      const normalized =
        parsed == null ? null : quantizeLoad(toStoredLoadValue(parsed, isDumbbell) ?? parsed);
      markFieldTouched(setId, "actualLoad");
      setFieldPrefilled(setId, "actualLoad", false);
      updateDraftBuffer(setId, "load", toInputNumberString(normalized));
    },
    [
      activeSet,
      draftBuffersBySet,
      isDumbbellExercise,
      markFieldTouched,
      setFieldPrefilled,
      toStoredLoadValue,
      updateDraftBuffer,
    ]
  );

  const isDraftDirty = useCallback(
    (setId: string) => {
      const canonicalSet = flatSets.find((item) => item.set.setId === setId)?.set;
      if (!canonicalSet) {
        return false;
      }

      const draft = draftBuffersBySet[setId];
      if (!draft) {
        return false;
      }

      const canonicalValues = {
        reps: toInputNumberString(canonicalSet.actualReps),
        load: toInputNumberString(canonicalSet.actualLoad),
        rpe: toInputNumberString(canonicalSet.actualRpe),
      };

      return (
        (draft.reps ?? canonicalValues.reps) !== canonicalValues.reps ||
        (draft.load ?? canonicalValues.load) !== canonicalValues.load ||
        (draft.rpe ?? canonicalValues.rpe) !== canonicalValues.rpe
      );
    },
    [draftBuffersBySet, flatSets]
  );

  return {
    draftBuffersBySet,
    touchedFieldsBySet,
    prefilledFieldsBySet,
    restoredSetIds,
    savingDraftSetId,
    lastSavedDraft,
    clearDraft,
    clearAllDrafts,
    clearDraftInputBuffers,
    seedDraftFromValues,
    resetDraftVisualState,
    updateDraftBuffer,
    markFieldTouched,
    setFieldPrefilled,
    setRepsValue,
    setLoadValue,
    commitLoadValue,
    setRpeValue,
    primeNumericBuffer,
    commitNumericBuffer,
    handleNumericFieldFocus,
    handleLoadFocus,
    handleLoadBlur,
    isDraftDirty,
  };
}
