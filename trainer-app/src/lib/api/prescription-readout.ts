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

export const MISSING_PLACEMENT_PRESCRIPTION_REASON =
  "missing_placement_prescription" as const;
export const PLACEMENT_PRESCRIPTION_EXERCISE_MISMATCH_REASON =
  "placement_prescription_exercise_mismatch" as const;

type ProjectionFailureReason =
  | typeof MISSING_PLACEMENT_PRESCRIPTION_REASON
  | typeof PLACEMENT_PRESCRIPTION_EXERCISE_MISMATCH_REASON;

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
      const projectionFailure = resolveProjectionFailure(exercise, prescription);
      const finalTarget = resolveFinalWorkingTarget(exercise);
      const measurement = exercise.measurement ?? null;
      const resolvedLoad = input.resolvedLoadsByPlacement?.[placementId];
      const historyEvidence =
        resolvedLoad?.placementId === placementId &&
        resolvedLoad.canonicalExerciseId === exercise.exercise.id
          ? resolvedLoad.historyEvidence
          : undefined;

      return [{
        placementId,
        exerciseId: exercise.exercise.id,
        exerciseName: exercise.exercise.name,
        setCount: finalTarget.setCount,
        targetReps: finalTarget.targetReps,
        repRange: finalTarget.repRange,
        targetRpe: finalTarget.targetRpe,
        targetRir: deriveRepresentativeTargetRir(finalTarget.targetRpe),
        targetLoad:
          prescription && !projectionFailure ? toTargetLoad(prescription) : null,
        prescriptionKind:
          prescription && !projectionFailure ? prescription.kind : "unavailable",
        loadSource:
          prescription?.kind === "numeric" && !projectionFailure
            ? prescription.source
            : null,
        confidence: projectConfidence(prescription, projectionFailure),
        measurementProfile: measurement?.profile ?? null,
        loadConvention:
          measurement && "loadConvention" in measurement
            ? measurement.loadConvention
            : null,
        repBasis: measurement?.repBasis ?? null,
        zeroLoadMeaning: exercise.zeroLoadMeaning ?? null,
        ...projectCaution(prescription, projectionFailure),
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

function resolveProjectionFailure(
  exercise: WorkoutExercise,
  prescription: PrescriptionResult | undefined,
): ProjectionFailureReason | null {
  if (!prescription) {
    return MISSING_PLACEMENT_PRESCRIPTION_REASON;
  }
  return prescription.canonicalExerciseId === exercise.exercise.id
    ? null
    : PLACEMENT_PRESCRIPTION_EXERCISE_MISMATCH_REASON;
}

function projectConfidence(
  prescription: PrescriptionResult | undefined,
  projectionFailure: ProjectionFailureReason | null,
): PrescriptionReadout["confidence"] {
  if (!prescription || projectionFailure) {
    return "low";
  }
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
  if (
    prescription.kind === "calibration_required" ||
    prescription.kind === "unavailable"
  ) {
    return "low";
  }
  return "high";
}

function projectCaution(
  prescription: PrescriptionResult | undefined,
  projectionFailure: ProjectionFailureReason | null,
): Pick<PrescriptionReadout, "cautionLevel" | "cautionReason"> {
  if (projectionFailure) {
    return { cautionLevel: "caution", cautionReason: projectionFailure };
  }
  if (!prescription) {
    return {
      cautionLevel: "caution",
      cautionReason: MISSING_PLACEMENT_PRESCRIPTION_REASON,
    };
  }
  if (prescription.kind === "calibration_required") {
    return {
      cautionLevel: "caution",
      cautionReason: lastReasonCode(prescription) ?? "calibration_required",
    };
  }
  if (prescription.kind === "unavailable") {
    return {
      cautionLevel: "caution",
      cautionReason: lastReasonCode(prescription) ?? "prescription_unavailable",
    };
  }
  if (prescription.kind === "numeric" && prescription.confidence === "low") {
    return {
      cautionLevel: "caution",
      cautionReason: lastReasonCode(prescription) ?? "low_prescription_confidence",
    };
  }
  if (prescription.kind === "numeric" && prescription.confidence === "reduced") {
    return {
      cautionLevel: "notice",
      cautionReason:
        lastReasonCode(prescription) ?? "reduced_prescription_confidence",
    };
  }
  return { cautionLevel: "none", cautionReason: null };
}

function lastReasonCode(
  prescription: PrescriptionResult,
): PrescriptionResult["reasonCodes"][number] | undefined {
  return prescription.reasonCodes[prescription.reasonCodes.length - 1];
}
