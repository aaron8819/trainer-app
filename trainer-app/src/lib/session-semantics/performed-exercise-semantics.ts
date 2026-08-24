import type { ProgressionSet } from "@/lib/engine/progression";
import type { MeasurementSemantics } from "@/lib/exercise-measurement/semantics";
import {
  derivePlannedLoadStructure,
  resolveProgressionAnchorStrategy,
  resolveWorkingSetLoad,
  type ProgressionAnchorStrategy,
  type PlannedLoadStructure,
} from "@/lib/progression/anchoring";
import { isPartialExposureAdequateForProgression } from "@/lib/progression/progression-eligibility";
import { classifySetLog } from "./set-classification";

export type PerformedExerciseSetInput = {
  setIndex: number;
  setIntent?: "WORK" | "WARMUP" | null;
  targetLoad?: number | null;
  targetReps?: number | null;
  targetRepMin?: number | null;
  targetRepMax?: number | null;
  targetRpe?: number | null;
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

export type PerformedEvidenceCoverage =
  | "complete"
  | "adequate_partial"
  | "inadequate_partial";

export type NormalizedPerformedExerciseEvidence = {
  evidenceId: string;
  workoutId: string | null;
  canonicalExerciseId: string;
  performedAt: string;
  status: "PLANNED" | "IN_PROGRESS" | "PARTIAL" | "COMPLETED" | "SKIPPED";
  measurement: MeasurementSemantics | null;
  measurementProvenance: "frozen" | "legacy_null";
  performedSetCount: number;
  plannedWorkingSetCount: number | null;
  coverage: PerformedEvidenceCoverage;
  representativeLoad: number | null;
  representativeReps: number | null;
  representativeRpe: number | null;
  hasPerformedLoad: boolean;
  hasPerformedReps: boolean;
  hasPerformedEffort: boolean;
  isDeload: boolean;
  runtimeAdded: boolean;
  substituted: boolean;
  acceptedPlanProvenance: string | null;
  confidence: number;
  confidenceNotes: string[];
  sets: ProgressionSet[];
};

export function normalizePerformedExerciseEvidence(input: {
  workoutId?: string | null;
  canonicalExerciseId: string;
  performedAt: string;
  status?: NormalizedPerformedExerciseEvidence["status"];
  measurement: MeasurementSemantics | null;
  plannedWorkingSetCount?: number | null;
  isMainLiftEligible?: boolean | null;
  isDeload?: boolean;
  runtimeAdded?: boolean;
  substituted?: boolean;
  acceptedPlanProvenance?: string | null;
  confidence?: number;
  confidenceNotes?: string[];
  sets: Array<{
    setIndex: number;
    load?: number | null;
    reps?: number | null;
    rpe?: number | null;
    targetLoad?: number | null;
    targetReps?: number | null;
    targetRepMin?: number | null;
    targetRepMax?: number | null;
    targetRpe?: number | null;
  }>;
}): NormalizedPerformedExerciseEvidence {
  const status = input.status ?? "COMPLETED";
  const performedSets = input.sets.filter(
    (set) => Number.isFinite(set.reps) && (set.reps ?? 0) > 0,
  );
  const semantics = derivePerformedExerciseSemantics({
    isMainLiftEligible: input.isMainLiftEligible,
    sets: input.sets.map((set) => ({
      setIndex: set.setIndex,
      actualLoad: set.load,
      actualReps: set.reps,
      actualRpe: set.rpe,
      targetLoad: set.targetLoad,
      targetReps: set.targetReps,
      targetRepMin: set.targetRepMin,
      targetRepMax: set.targetRepMax,
      targetRpe: set.targetRpe,
    })),
  });
  const plannedWorkingSetCount = Number.isInteger(input.plannedWorkingSetCount)
    ? Math.max(0, input.plannedWorkingSetCount as number)
    : null;
  const performedSetCount = performedSets.length;
  const coverage: PerformedEvidenceCoverage =
    plannedWorkingSetCount != null && performedSetCount >= plannedWorkingSetCount
      ? "complete"
      : plannedWorkingSetCount == null
        ? performedSetCount >= 1
          ? "adequate_partial"
          : "inadequate_partial"
        : isPartialExposureAdequateForProgression({
            plannedWorkingSetCount,
            performedWorkingSetCount: performedSetCount,
          })
        ? "adequate_partial"
        : "inadequate_partial";
  const workoutId = input.workoutId ?? null;
  const representativeSet = semantics?.signalSets.find(
    (set) => set.load === semantics.workingSetLoad,
  );

  return {
    evidenceId: `${workoutId ?? input.performedAt}:${input.canonicalExerciseId}`,
    workoutId,
    canonicalExerciseId: input.canonicalExerciseId,
    performedAt: input.performedAt,
    status,
    measurement: input.measurement,
    measurementProvenance: input.measurement ? "frozen" : "legacy_null",
    performedSetCount,
    plannedWorkingSetCount,
    coverage,
    representativeLoad: semantics?.workingSetLoad ?? null,
    representativeReps: representativeSet?.reps ?? semantics?.medianReps ?? null,
    representativeRpe: representativeSet?.rpe ?? semantics?.modalRpe ?? null,
    hasPerformedLoad: performedSets.some((set) => Number.isFinite(set.load)),
    hasPerformedReps: performedSetCount > 0,
    hasPerformedEffort: performedSets.some((set) => Number.isFinite(set.rpe)),
    isDeload: input.isDeload === true,
    runtimeAdded: input.runtimeAdded === true,
    substituted: input.substituted === true,
    acceptedPlanProvenance: input.acceptedPlanProvenance ?? null,
    confidence: Number.isFinite(input.confidence)
      ? Math.min(1, Math.max(0, input.confidence as number))
      : 1,
    confidenceNotes: [...(input.confidenceNotes ?? [])],
    sets: semantics?.signalSets ?? [],
  };
}

export function derivePerformedExerciseSemantics(input: {
  isMainLiftEligible?: boolean | null;
  sets: PerformedExerciseSetInput[];
}): PerformedExerciseSemantics | null {
  const anchorStrategy = resolveProgressionAnchorStrategy({
    isMainLiftEligible: input.isMainLiftEligible,
  });
  const plannedSetStructure = derivePlannedSetStructure(input.sets);
  const signalSourceSets = input.sets.filter((set) => classifySetLog(set).isSignal);
  const signalSets = signalSourceSets
    .filter(
      (set) =>
        Number.isFinite(set.actualReps) &&
        (set.actualReps ?? 0) > 0 &&
        Number.isFinite(set.actualLoad) &&
        (set.actualLoad ?? 0) >= 0
    )
    .map((set) => ({
      setIndex: set.setIndex,
      reps: set.actualReps as number,
      load: set.actualLoad as number,
      rpe: set.actualRpe ?? undefined,
      targetLoad: set.targetLoad ?? undefined,
      targetReps: set.targetReps ?? undefined,
      targetRepMin: set.targetRepMin ?? undefined,
      targetRepMax: set.targetRepMax ?? undefined,
      targetRpe: set.targetRpe ?? undefined,
    }));

  if (signalSets.length === 0) {
    return null;
  }

  const workingSetLoad = resolveWorkingSetLoad({
    isMainLiftEligible: input.isMainLiftEligible,
    sets: signalSourceSets.map((set) => ({
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
