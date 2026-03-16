import type { ProgressionSet } from "@/lib/engine/progression";
import {
  resolveProgressionAnchorStrategy,
  type ProgressionAnchorStrategy,
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

export type PlannedSetStructure = "straight_sets" | "top_set_backoff" | "insufficient_data";

export type PerformedExerciseSemantics = {
  signalSets: ProgressionSet[];
  anchorStrategy: ProgressionAnchorStrategy;
  anchorLoad: number | null;
  medianReps: number | null;
  modalRpe: number | null;
  topSetLoad: number | null;
  backoffLoad: number | null;
  plannedSetStructure: PlannedSetStructure;
  hasPlannedBackoffTransition: boolean;
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

  const signalEntries = input.sets.filter(
    (set) =>
      !set.wasSkipped &&
      Number.isFinite(set.actualReps) &&
      (set.actualReps ?? 0) > 0 &&
      Number.isFinite(set.actualLoad) &&
      (set.actualLoad ?? 0) >= 0 &&
      (set.actualRpe == null || set.actualRpe >= EFFECTIVE_RPE_MIN)
  );

  const topSetLoad = resolveTopSessionLoad(signalEntries);
  const backoffLoad = resolveBackoffLoad(signalEntries, topSetLoad);
  const modalLoad = resolveModalLoad(signalSets);
  const anchorLoad = anchorStrategy === "top_set" ? topSetLoad : modalLoad;

  return {
    signalSets,
    anchorStrategy,
    anchorLoad,
    medianReps: resolveMedian(signalSets.map((set) => set.reps)),
    modalRpe: resolveModalRpe(signalSets),
    topSetLoad,
    backoffLoad,
    plannedSetStructure,
    hasPlannedBackoffTransition: plannedSetStructure === "top_set_backoff",
  };
}

export function derivePlannedSetStructure(
  sets: Array<Pick<PerformedExerciseSetInput, "setIndex" | "targetLoad">>
): PlannedSetStructure {
  const ordered = [...sets]
    .filter((set) => Number.isFinite(set.targetLoad))
    .sort((left, right) => left.setIndex - right.setIndex);
  if (ordered.length < 2) {
    return "insufficient_data";
  }

  const firstLoad = ordered[0]?.targetLoad ?? null;
  const hasLowerLaterLoad = ordered.slice(1).some((set) => (set.targetLoad ?? 0) < (firstLoad ?? 0));
  return hasLowerLaterLoad ? "top_set_backoff" : "straight_sets";
}

function resolveTopSessionLoad(sets: PerformedExerciseSetInput[]): number | null {
  const ordered = [...sets].sort((left, right) => left.setIndex - right.setIndex);
  for (const set of ordered) {
    if (Number.isFinite(set.actualLoad) && (set.actualLoad ?? 0) >= 0) {
      return set.actualLoad as number;
    }
  }
  return null;
}

function resolveBackoffLoad(
  sets: PerformedExerciseSetInput[],
  topSetLoad: number | null
): number | null {
  if (topSetLoad == null) {
    return null;
  }
  const laterLoads = sets
    .filter(
      (set) =>
        set.setIndex > 1 &&
        Number.isFinite(set.actualLoad) &&
        (set.actualLoad ?? 0) >= 0 &&
        (set.actualLoad as number) < topSetLoad
    )
    .map((set) => set.actualLoad as number);
  if (laterLoads.length === 0) {
    return null;
  }
  return resolveModalNumber(laterLoads);
}

function resolveModalLoad(sets: ProgressionSet[]): number | null {
  const loads = sets
    .map((set) => set.load)
    .filter((load): load is number => load != null && Number.isFinite(load) && load >= 0);
  if (loads.length === 0) {
    return null;
  }
  return resolveModalNumber(loads);
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
