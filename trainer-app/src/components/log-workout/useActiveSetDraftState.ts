"use client";

import { useCallback, useEffect, useState, type FocusEvent } from "react";
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

export function useActiveSetDraftState({
  workoutId,
  activeSetIds,
  activeSet,
  loggedSetIds,
  resolvedActiveSetId,
  findPreviousLoggedSet,
  updateSetFields,
  setSingleField,
  toStoredLoadValue,
  isDumbbellExercise,
}: {
  workoutId: string;
  activeSetIds: string[];
  activeSet: FlatSetItem | null;
  loggedSetIds: Set<string>;
  resolvedActiveSetId: string | null;
  findPreviousLoggedSet: (exercise: LogExerciseInput, currentSetIndex: number) => LogSetInput | null;
  updateSetFields: (setId: string, updater: (set: LogSetInput) => LogSetInput) => void;
  setSingleField: (setId: string, field: keyof LogSetInput, value: number | boolean | null) => void;
  toStoredLoadValue: (value: number | null | undefined, isDumbbell: boolean) => number | null;
  isDumbbellExercise: (exercise: LogExerciseInput) => boolean;
}) {
  const [draftBuffersBySet, setDraftBuffersBySet] = useState<Record<string, SetDraftBuffers>>({});
  const [touchedFieldsBySet, setTouchedFieldsBySet] = useState<Record<string, PrefilledFieldState>>({});
  const [prefilledFieldsBySet, setPrefilledFieldsBySet] = useState<Record<string, PrefilledFieldState>>({});

  const updateDraftBuffer = useCallback(
    (setId: string, field: keyof SetDraftBuffers, value: string) => {
      setDraftBuffersBySet((prev) => ({
        ...prev,
        [setId]: {
          ...(prev[setId] ?? { reps: "", load: "", rpe: "" }),
          [field]: value,
        },
      }));
    },
    []
  );

  const markFieldTouched = useCallback((setId: string, field: keyof PrefilledFieldState) => {
    setTouchedFieldsBySet((prev) => ({
      ...prev,
      [setId]: {
        ...buildEmptyFieldState(prev[setId]),
        [field]: true,
      },
    }));
  }, []);

  const setFieldPrefilled = useCallback(
    (setId: string, field: keyof PrefilledFieldState, isPrefilled: boolean) => {
      setPrefilledFieldsBySet((prev) => ({
        ...prev,
        [setId]: {
          ...buildEmptyFieldState(prev[setId]),
          [field]: isPrefilled,
        },
      }));
    },
    []
  );

  const handleRestoreDraft = useCallback(
    (setId: string, draft: SetDraftBuffers) => {
      updateSetFields(setId, (set) => ({
        ...set,
        actualReps: parseNullableNumber(draft.reps),
        actualLoad: parseNullableNumber(draft.load),
        actualRpe: parseNullableNumber(draft.rpe),
      }));
      setDraftBuffersBySet((prev) => ({
        ...prev,
        [setId]: { reps: draft.reps, load: draft.load, rpe: draft.rpe },
      }));
    },
    [updateSetFields]
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

    updateSetFields(setId, (set) => ({
      ...set,
      actualReps: prefillValues.actualReps,
      actualLoad: prefillValues.actualLoad,
      actualRpe: prefillValues.actualRpe,
      wasSkipped: false,
    }));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTouchedFieldsBySet((prev) => ({
      ...prev,
      [setId]: { actualReps: false, actualLoad: false, actualRpe: false },
    }));
    setPrefilledFieldsBySet((prev) => ({
      ...prev,
      [setId]: {
        actualReps: prefillValues.actualReps != null,
        actualLoad: prefillValues.actualLoad != null,
        actualRpe: prefillValues.actualRpe != null,
      },
    }));
  }, [
    activeSet,
    draftBuffersBySet,
    findPreviousLoggedSet,
    loggedSetIds,
    touchedFieldsBySet,
    updateSetFields,
  ]);

  useEffect(() => {
    if (!activeSet) {
      return;
    }
    const setId = activeSet.set.setId;
    saveDraft(setId, {
      reps: draftBuffersBySet[setId]?.reps ?? toInputNumberString(activeSet.set.actualReps),
      load: draftBuffersBySet[setId]?.load ?? toInputNumberString(activeSet.set.actualLoad),
      rpe: draftBuffersBySet[setId]?.rpe ?? toInputNumberString(activeSet.set.actualRpe),
    });
  }, [activeSet, draftBuffersBySet, saveDraft]);

  const clearDraftInputBuffers = useCallback((setId: string) => {
    setDraftBuffersBySet((prev) => {
      const next = { ...prev };
      delete next[setId];
      return next;
    });
  }, []);

  const setRepsValue = useCallback(
    (setId: string, value: number | null) => {
      setSingleField(setId, "actualReps", value);
      updateDraftBuffer(setId, "reps", toInputNumberString(value));
    },
    [setSingleField, updateDraftBuffer]
  );

  const setLoadValue = useCallback(
    (setId: string, rawValue: string, isDumbbell: boolean, options?: { commit?: boolean }) => {
      const parsed = parseNullableNumber(rawValue);
      const normalized =
        parsed == null ? null : quantizeLoad(toStoredLoadValue(parsed, isDumbbell) ?? parsed);
      if (options?.commit) {
        setSingleField(setId, "actualLoad", normalized);
      }
      updateDraftBuffer(
        setId,
        "load",
        options?.commit && normalized != null
          ? toInputNumberString(normalized)
          : rawValue
      );
    },
    [setSingleField, toStoredLoadValue, updateDraftBuffer]
  );

  const commitLoadValue = useCallback(
    (setId: string, rawValue: string, isDumbbell: boolean) => {
      const parsed = parseNullableNumber(rawValue.trim());
      const normalized =
        parsed == null ? null : quantizeLoad(toStoredLoadValue(parsed, isDumbbell) ?? parsed);
      setSingleField(setId, "actualLoad", normalized);
      markFieldTouched(setId, "actualLoad");
      setFieldPrefilled(setId, "actualLoad", false);
      updateDraftBuffer(setId, "load", toInputNumberString(normalized));
    },
    [markFieldTouched, setFieldPrefilled, setSingleField, toStoredLoadValue, updateDraftBuffer]
  );

  const setRpeValue = useCallback(
    (setId: string, rawValue: string, options?: { commit?: boolean }) => {
      if (options?.commit) {
        setSingleField(setId, "actualRpe", parseNullableNumber(rawValue));
      }
      updateDraftBuffer(setId, "rpe", rawValue);
    },
    [setSingleField, updateDraftBuffer]
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
      draftField: keyof SetDraftBuffers,
      applyValue: (nextRaw: string) => void
    ) => {
      applyValue(rawValue);
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
      setSingleField(setId, "actualLoad", normalized);
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
      setSingleField,
      toStoredLoadValue,
      updateDraftBuffer,
    ]
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
  };
}
