export type ProgressionAnchorStrategy = "working_set" | "modal";
export type PlannedLoadStructure =
  | "uniform_working_sets"
  | "variable_working_sets"
  | "insufficient_data";

type AnchorableSet = {
  setIndex: number;
  load?: number | null;
  targetLoad?: number | null;
  rpe?: number | null;
};

const EFFECTIVE_RPE_MIN = 6;

export function resolveProgressionAnchorStrategy(input: {
  isMainLiftEligible?: boolean | null;
}): ProgressionAnchorStrategy {
  return input.isMainLiftEligible ? "working_set" : "modal";
}

export function derivePlannedLoadStructure(
  sets: Array<Pick<AnchorableSet, "setIndex" | "targetLoad" | "load">>
): PlannedLoadStructure {
  const orderedLoads = resolveOrderedReferenceLoads(sets);
  if (orderedLoads.length < 2) {
    return "insufficient_data";
  }

  const firstLoad = orderedLoads[0]?.load;
  const hasVariableLoad = orderedLoads.some((set) => set.load !== firstLoad);
  return hasVariableLoad ? "variable_working_sets" : "uniform_working_sets";
}

export function resolveWorkingSetLoad(input: {
  isMainLiftEligible?: boolean | null;
  sets: AnchorableSet[];
}): number | null {
  const signalSets = resolveSignalSets(input.sets);
  if (signalSets.length === 0) {
    return null;
  }

  const modalLoad = resolveModalNumber(signalSets.map((set) => set.load));
  if (resolveProgressionAnchorStrategy(input) === "modal") {
    return modalLoad;
  }

  if (hasLegacyFrontLoadedStructure(input.sets)) {
    return signalSets[0]?.load ?? modalLoad;
  }

  return modalLoad ?? signalSets[0]?.load ?? null;
}

function hasLegacyFrontLoadedStructure(sets: AnchorableSet[]): boolean {
  const orderedLoads = resolveOrderedReferenceLoads(sets);
  if (orderedLoads.length < 2) {
    return false;
  }

  const firstLoad = orderedLoads[0]?.load;
  return orderedLoads.slice(1).some((set) => set.load < firstLoad);
}

function resolveOrderedReferenceLoads(
  sets: Array<Pick<AnchorableSet, "setIndex" | "targetLoad" | "load">>
): Array<{ setIndex: number; load: number }> {
  const orderedTargetLoads = [...sets]
    .filter(
      (set): set is { setIndex: number; targetLoad: number } =>
        Number.isFinite(set.targetLoad) && (set.targetLoad ?? 0) >= 0
    )
    .sort((left, right) => left.setIndex - right.setIndex)
    .map((set) => ({ setIndex: set.setIndex, load: set.targetLoad }));
  if (orderedTargetLoads.length >= 2) {
    return orderedTargetLoads;
  }

  return [...sets]
    .filter(
      (set): set is { setIndex: number; load: number } =>
        Number.isFinite(set.load) && (set.load ?? 0) >= 0
    )
    .sort((left, right) => left.setIndex - right.setIndex)
    .map((set) => ({ setIndex: set.setIndex, load: set.load }));
}

function resolveSignalSets(sets: AnchorableSet[]): Array<{ setIndex: number; load: number }> {
  return [...sets]
    .filter(
      (set): set is { setIndex: number; load: number; rpe?: number | null } =>
        Number.isFinite(set.load) &&
        (set.load ?? 0) >= 0 &&
        (set.rpe == null || set.rpe >= EFFECTIVE_RPE_MIN)
    )
    .sort((left, right) => left.setIndex - right.setIndex)
    .map((set) => ({ setIndex: set.setIndex, load: set.load }));
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
