"use client";

import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import type { FlatSetItem, LogExerciseInput, LogSetInput } from "@/components/log-workout/types";

export type ChipEditDraft = {
  reps: string;
  load: string;
  rpe: string;
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

type UseWorkoutChipEditorParams = {
  flatSets: FlatSetItem[];
  isDumbbellExercise: (exercise: LogExerciseInput) => boolean;
  toInputNumberString: (value: number | null | undefined) => string;
  parseNullableNumber: (raw: string) => number | null;
  normalizeLoadInput: (raw: string, isDumbbell: boolean) => number | null;
  updateSetFields: (setId: string, updater: (set: LogSetInput) => LogSetInput) => void;
  logSet: (setId: string, overrides?: Partial<LogSetInput>) => Promise<boolean>;
};

export function useWorkoutChipEditor({
  flatSets,
  isDumbbellExercise,
  toInputNumberString,
  parseNullableNumber,
  normalizeLoadInput,
  updateSetFields,
  logSet,
}: UseWorkoutChipEditorParams): WorkoutSessionChipEditor {
  const [chipEditSetId, setChipEditSetId] = useState<string | null>(null);
  const [chipEditDraft, setChipEditDraft] = useState<ChipEditDraft | null>(null);

  const open = useCallback(
    (setId: string) => {
      const target = flatSets.find((item) => item.set.setId === setId);
      if (!target) {
        return;
      }

      setChipEditSetId(setId);
      setChipEditDraft({
        reps: toInputNumberString(target.set.actualReps),
        load: toInputNumberString(target.set.actualLoad),
        rpe: toInputNumberString(target.set.actualRpe),
      });
    },
    [flatSets, toInputNumberString]
  );

  const close = useCallback(() => {
    setChipEditSetId(null);
    setChipEditDraft(null);
  }, []);

  const handleLoadBlur = useCallback(
    (setId: string, isDumbbell: boolean) => {
      if (chipEditSetId !== setId || !chipEditDraft) {
        return;
      }

      const normalized = normalizeLoadInput(chipEditDraft.load, isDumbbell);
      setChipEditDraft((prev) =>
        prev
          ? {
              ...prev,
              load: toInputNumberString(normalized),
            }
          : prev
      );
    },
    [chipEditDraft, chipEditSetId, normalizeLoadInput, toInputNumberString]
  );

  const save = useCallback(
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

      const success = await logSet(setId, {
        actualReps: reps,
        actualLoad: load,
        actualRpe: rpe,
        wasSkipped: false,
      });

      if (success) {
        close();
      }
    },
    [
      chipEditDraft,
      chipEditSetId,
      close,
      flatSets,
      isDumbbellExercise,
      logSet,
      normalizeLoadInput,
      parseNullableNumber,
      updateSetFields,
    ]
  );

  return {
    setId: chipEditSetId,
    draft: chipEditDraft,
    setDraft: setChipEditDraft,
    open,
    close,
    handleLoadBlur,
    save,
  };
}
