import type {
  ApplyLoadsAudit,
  PrescriptionPlacementKey,
} from "@/lib/engine/apply-loads";
import {
  toTargetLoad,
  type PrescriptionResult,
} from "@/lib/engine/load-prescription";
import type { WorkoutExercise, WorkoutPlan, WorkoutSet } from "@/lib/engine/types";
import { listWorkoutPlanExercisesInOrder } from "@/lib/engine/workout-plan-order";
import type { PrescriptionReadout } from "@/lib/api/template-session/types";
import type { MeasurementSemantics } from "@/lib/exercise-measurement/semantics";

export type PrescriptionReadoutProjectionErrorCode =
  | "missing_placement_result"
  | "canonical_exercise_mismatch"
  | "measurement_mismatch"
  | "semantic_zero_meaning_mismatch"
  | "resolved_load_placement_mismatch"
  | "resolved_load_exercise_mismatch";

export class PrescriptionReadoutProjectionError extends Error {
  readonly name = "PrescriptionReadoutProjectionError";

  constructor(
    readonly code: PrescriptionReadoutProjectionErrorCode,
    readonly placementId: string,
  ) {
    super(`PRESCRIPTION_READOUT_PROJECTION_FAILED:${code}:${placementId}`);
  }
}

type FinalWorkingTarget = {
  setCount: number;
  targetReps: number | null;
  repRange: { min: number; max: number } | null;
  targetRpe: number | null;
};

/**
 * Projects final response state only. This adapter owns no generation,
 * schedule, materialization, receipt, save, or progression policy.
 */
export function buildPrescriptionReadouts(input: {
  workout: WorkoutPlan;
  prescriptionResultsByPlacement?: Readonly<
    Record<PrescriptionPlacementKey, PrescriptionResult>
  >;
  resolvedLoadsByPlacement?: ApplyLoadsAudit["resolvedLoads"];
}): PrescriptionReadout[] {
  return listWorkoutPlanExercisesInOrder(input.workout).flatMap(
    ({ section, exercise }) => {
      if (section === "warmup") {
        return [];
      }

      const placementId = exercise.id;
      const prescription = input.prescriptionResultsByPlacement?.[placementId];
      assertProjectionInvariants(exercise, prescription);
      const finalTarget = resolveFinalWorkingTarget(exercise);
      const measurement = exercise.measurement ?? null;
      const resolvedLoad = input.resolvedLoadsByPlacement?.[placementId];
      if (resolvedLoad && resolvedLoad.placementId !== placementId) {
        throw new PrescriptionReadoutProjectionError(
          "resolved_load_placement_mismatch",
          placementId,
        );
      }
      if (
        resolvedLoad &&
        resolvedLoad.canonicalExerciseId !== exercise.exercise.id
      ) {
        throw new PrescriptionReadoutProjectionError(
          "resolved_load_exercise_mismatch",
          placementId,
        );
      }
      const historyEvidence = resolvedLoad?.historyEvidence;

      return [{
        placementId,
        exerciseId: exercise.exercise.id,
        exerciseName: exercise.exercise.name,
        setCount: finalTarget.setCount,
        targetReps: finalTarget.targetReps,
        repRange: finalTarget.repRange,
        targetRpe: finalTarget.targetRpe,
        targetRir: deriveRepresentativeTargetRir(finalTarget.targetRpe),
        targetLoad: toTargetLoad(prescription),
        prescriptionKind: prescription.kind,
        loadSource:
          prescription.kind === "numeric" ? prescription.source : null,
        confidence: projectConfidence(prescription),
        measurementProfile: measurement?.profile ?? null,
        loadConvention:
          measurement && "loadConvention" in measurement
            ? measurement.loadConvention
            : null,
        repBasis: measurement?.repBasis ?? null,
        zeroLoadMeaning: exercise.zeroLoadMeaning ?? null,
        ...projectCaution(prescription),
        ...(historyEvidence ? { historyEvidence } : {}),
      }];
    },
  );
}

function resolveFinalWorkingTarget(exercise: WorkoutExercise): FinalWorkingTarget {
  const workingSets = exercise.sets.filter((set) => set.role !== "warmup");
  const representativeSet = resolveRepresentativeSet(workingSets);
  return {
    setCount: workingSets.length,
    targetReps: finiteNumberOrNull(representativeSet?.targetReps),
    repRange: representativeSet?.targetRepRange
      ? {
          min: representativeSet.targetRepRange.min,
          max: representativeSet.targetRepRange.max,
        }
      : null,
    targetRpe: finiteNumberOrNull(representativeSet?.targetRpe),
  };
}

function resolveRepresentativeSet(sets: WorkoutSet[]): WorkoutSet | undefined {
  return sets.find((set) => set.setIndex === 1) ?? sets[0];
}

function finiteNumberOrNull(value: number | undefined): number | null {
  return Number.isFinite(value) ? (value as number) : null;
}

function deriveRepresentativeTargetRir(targetRpe: number | null): number | null {
  return targetRpe == null ? null : Number((10 - targetRpe).toFixed(1));
}

function assertProjectionInvariants(
  exercise: WorkoutExercise,
  prescription: PrescriptionResult | undefined,
): asserts prescription is PrescriptionResult {
  if (!prescription) {
    throw new PrescriptionReadoutProjectionError(
      "missing_placement_result",
      exercise.id,
    );
  }
  if (prescription.canonicalExerciseId !== exercise.exercise.id) {
    throw new PrescriptionReadoutProjectionError(
      "canonical_exercise_mismatch",
      exercise.id,
    );
  }
  if (!sameMeasurement(prescription.measurement, exercise.measurement ?? null)) {
    throw new PrescriptionReadoutProjectionError(
      "measurement_mismatch",
      exercise.id,
    );
  }
  if (
    prescription.kind === "semantic_zero" &&
    prescription.zeroLoadMeaning !== (exercise.zeroLoadMeaning ?? null)
  ) {
    throw new PrescriptionReadoutProjectionError(
      "semantic_zero_meaning_mismatch",
      exercise.id,
    );
  }
}

function sameMeasurement(
  left: MeasurementSemantics | null,
  right: MeasurementSemantics | null,
): boolean {
  if (left == null || right == null) {
    return left === right;
  }
  return (
    left.profile === right.profile &&
    left.repBasis === right.repBasis &&
    ("loadConvention" in left ? left.loadConvention : null) ===
      ("loadConvention" in right ? right.loadConvention : null)
  );
}

function projectConfidence(
  prescription: PrescriptionResult,
): PrescriptionReadout["confidence"] {
  if (prescription.kind === "numeric") {
    switch (prescription.confidence) {
      case "high":
        return "high";
      case "reduced":
        return "medium";
      case "low":
        return "low";
    }
  }
  if (prescription.kind === "calibration_required") {
    return "low";
  }
  return null;
}

function projectCaution(
  prescription: PrescriptionResult,
): Pick<PrescriptionReadout, "cautionLevel" | "cautionReason"> {
  if (prescription.kind === "calibration_required") {
    return {
      cautionLevel: "caution",
      cautionReason: "calibration_required",
    };
  }
  if (prescription.kind === "unavailable") {
    return {
      cautionLevel: "caution",
      cautionReason: "prescription_unavailable",
    };
  }
  if (prescription.kind === "numeric" && prescription.confidence === "low") {
    return {
      cautionLevel: "caution",
      cautionReason: "low_prescription_confidence",
    };
  }
  if (prescription.kind === "numeric" && prescription.confidence === "reduced") {
    return {
      cautionLevel: "notice",
      cautionReason: "reduced_prescription_confidence",
    };
  }
  return { cautionLevel: "none", cautionReason: null };
}
