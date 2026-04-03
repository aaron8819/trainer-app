import type { ProgressionSet } from "@/lib/engine/progression";
import {
  derivePlannedLoadStructure,
  resolveProgressionAnchorStrategy,
  resolveWorkingSetLoad,
  type ProgressionAnchorStrategy,
  type PlannedLoadStructure,
} from "@/lib/progression/anchoring";

const EFFECTIVE_RPE_MIN = 6;

export type PerformedExerciseSetInput = {
  setIndex: number;
  targetLoad?: number | null;
  actualLoad?: number | null;
  actualReps?: number | null;
  actualRpe?: number | null;
  wasSkipped?: boolean;
};

export type PlannedSetStructure = PlannedLoadStructure;

export type PerformedExerciseSemantics = {
  signalSets: ProgressionSet[];
  anchorStrategy: ProgressionAnchorStrategy;
  anchorLoad: number | null;
  workingSetLoad: number | null;
  medianReps: number | null;
  modalRpe: number | null;
  plannedSetStructure: PlannedSetStructure;
  hasUniformTargetLoad: boolean;
};

export function derivePerformedExerciseSemantics(input: {
  isMainLiftEligible?: boolean | null;
  sets: PerformedExerciseSetInput[];
}): PerformedExerciseSemantics | null {
  const anchorStrategy = resolveProgressionAnchorStrategy({
    isMainLiftEligible: input.isMainLiftEligible,
  });
  const plannedSetStructure = derivePlannedSetStructure(input.sets);
  const signalSets = input.sets
    .filter(
      (set) =>
        !set.wasSkipped &&
        Number.isFinite(set.actualReps) &&
        (set.actualReps ?? 0) > 0 &&
        Number.isFinite(set.actualLoad) &&
        (set.actualLoad ?? 0) >= 0 &&
        (set.actualRpe == null || set.actualRpe >= EFFECTIVE_RPE_MIN)
    )
    .map((set) => ({
      reps: set.actualReps as number,
      load: set.actualLoad as number,
      rpe: set.actualRpe ?? undefined,
      targetLoad: set.targetLoad ?? undefined,
    }));

  if (signalSets.length === 0) {
    return null;
  }

  const workingSetLoad = resolveWorkingSetLoad({
    isMainLiftEligible: input.isMainLiftEligible,
    sets: input.sets.map((set) => ({
      setIndex: set.setIndex,
      load: set.actualLoad,
      targetLoad: set.targetLoad,
      rpe: set.actualRpe,
    })),
  });

  return {
    signalSets,
    anchorStrategy,
    anchorLoad: workingSetLoad,
    workingSetLoad,
    medianReps: resolveMedian(signalSets.map((set) => set.reps)),
    modalRpe: resolveModalRpe(signalSets),
    plannedSetStructure,
    hasUniformTargetLoad: plannedSetStructure === "uniform_working_sets",
  };
}

export function derivePlannedSetStructure(
  sets: Array<Pick<PerformedExerciseSetInput, "setIndex" | "targetLoad" | "actualLoad">>
): PlannedSetStructure {
  return derivePlannedLoadStructure(
    sets.map((set) => ({
      setIndex: set.setIndex,
      targetLoad: set.targetLoad,
      load: set.actualLoad,
    }))
  );
}

function resolveModalRpe(sets: ProgressionSet[]): number | null {
  const rpes = sets
    .map((set) => set.rpe)
    .filter((rpe): rpe is number => Number.isFinite(rpe));
  if (rpes.length === 0) {
    return null;
  }

  const rounded = rpes.map((value) => Number(value.toFixed(1)));
  return resolveModalNumber(rounded);
}

function resolveModalNumber(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const frequency = new Map<number, number>();
  for (const value of values) {
    frequency.set(value, (frequency.get(value) ?? 0) + 1);
  }
  return (
    Array.from(frequency.entries()).sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1];
      }
      return left[0] - right[0];
    })[0]?.[0] ?? null
  );
}

function resolveMedian(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle] ?? null;
}
