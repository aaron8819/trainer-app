// Phase 3: Autoregulation - Workout Intensity Scaling

import {
  getPrescriptionPlacementKey,
  projectFinalPrescriptionResults,
  type ApplyLoadsAudit,
  type PrescriptionPlacementKey,
} from "@/lib/engine/apply-loads";
import type {
  NumericPrescription,
  PrescriptionReasonCode,
  PrescriptionResult,
} from "@/lib/engine/load-prescription";
import type { WorkoutPlan } from "@/lib/engine/types";
import type {
  FatigueScore,
  AutoregulationAction,
  AutoregulationPolicy,
  AutoregulationModification,
  FatigueConfig,
} from "./types";
import { DEFAULT_FATIGUE_CONFIG, DEFAULT_AUTOREGULATION_POLICY } from "./types";

const READINESS_INCREASE_BLOCKING_REASONS = new Set<PrescriptionReasonCode>([
  "missing_effort",
  "incomplete_set_coverage",
  "runtime_added_evidence",
  "substituted_exposure",
]);

export function transformPrescriptionForReadiness(
  prescription: PrescriptionResult,
  action: AutoregulationAction,
  config: FatigueConfig = DEFAULT_FATIGUE_CONFIG,
): PrescriptionResult {
  if (prescription.kind !== "numeric") {
    return prescription;
  }

  if (
    action === "maintain" ||
    (action === "scale_up" &&
      prescription.reasonCodes.some((reason) => READINESS_INCREASE_BLOCKING_REASONS.has(reason)))
  ) {
    return withReadinessReason(prescription, "readiness_hold");
  }

  const scalar = action === "scale_down" ? config.SCALE_DOWN_FACTOR : config.SCALE_UP_FACTOR;
  const adjustedValue = Math.round(prescription.value * scalar * 2) / 2;
  if (adjustedValue <= 0 || adjustedValue === prescription.value) {
    return withReadinessReason(prescription, "readiness_hold");
  }

  return {
    ...prescription,
    value: adjustedValue,
    reasonCodes: uniqueReasons([
      ...prescription.reasonCodes,
      "readiness_adjusted",
      action === "scale_down" ? "readiness_reduce" : "readiness_increase",
    ]),
  };
}

/**
 * Apply readiness to canonical load prescriptions, project those final results
 * to working sets, and retain the existing RPE adjustment for changed numeric work.
 */
export function autoregulateWorkout(
  workout: WorkoutPlan,
  loadAudit: ApplyLoadsAudit,
  fatigueScore: FatigueScore,
  policy: AutoregulationPolicy = DEFAULT_AUTOREGULATION_POLICY,
  config: FatigueConfig = DEFAULT_FATIGUE_CONFIG,
): {
  adjustedWorkout: WorkoutPlan;
  loadAudit: ApplyLoadsAudit;
  modifications: AutoregulationModification[];
  rationale: string;
} {
  const action = selectAction(fatigueScore.overall, policy, config);
  const finalPrescriptions = Object.fromEntries(
    Object.entries(loadAudit.prescriptions).map(([placementId, prescription]) => [
      placementId,
      transformPrescriptionForReadiness(prescription, action, config),
    ]),
  ) as Record<PrescriptionPlacementKey, PrescriptionResult>;
  const projected = projectFinalPrescriptionResults({
    workout,
    audit: loadAudit,
    prescriptions: finalPrescriptions,
  });
  const modifications: AutoregulationModification[] = [];
  const adjustedWorkout = applyRpeAdjustments({
    workout: projected.workout,
    basePrescriptions: loadAudit.prescriptions,
    finalPrescriptions,
    modifications,
  });

  return {
    adjustedWorkout,
    loadAudit: projected.audit,
    modifications,
    rationale: generateRationale(action, fatigueScore.overall, modifications),
  };
}

function selectAction(
  fatigueScore: number,
  policy: AutoregulationPolicy,
  config: FatigueConfig,
): AutoregulationAction {
  if (fatigueScore < config.SCALE_DOWN_THRESHOLD) {
    return policy.allowDownRegulation ? "scale_down" : "maintain";
  }

  if (fatigueScore > config.SCALE_UP_THRESHOLD && policy.allowUpRegulation) {
    return "scale_up";
  }

  return "maintain";
}

function applyRpeAdjustments(input: {
  workout: WorkoutPlan;
  basePrescriptions: Record<PrescriptionPlacementKey, PrescriptionResult>;
  finalPrescriptions: Record<PrescriptionPlacementKey, PrescriptionResult>;
  modifications: AutoregulationModification[];
}): WorkoutPlan {
  const adjustExercise = (exercise: WorkoutPlan["mainLifts"][number]) => {
    const placementId = getPrescriptionPlacementKey(exercise);
    const base = input.basePrescriptions[placementId];
    const final = input.finalPrescriptions[placementId];
    if (
      base?.kind !== "numeric" ||
      final?.kind !== "numeric" ||
      base.value === final.value
    ) {
      return exercise;
    }

    const direction = final.value < base.value ? "down" as const : "up" as const;
    const scalar = final.value / base.value;
    return {
      ...exercise,
      sets: exercise.sets.map((set) => {
        const originalRpe = set.targetRpe;
        const adjustedRpe =
          originalRpe === undefined
            ? undefined
            : direction === "down"
              ? Math.max(1, originalRpe - 1)
              : Math.min(10, originalRpe + 0.5);
        const rpeDetail =
          originalRpe !== undefined && adjustedRpe !== undefined
            ? `, RPE ${originalRpe} -> ${adjustedRpe}`
            : "";

        input.modifications.push({
          type: "intensity_scale",
          exerciseId: exercise.id,
          exerciseName: exercise.exercise.name,
          direction,
          scalar,
          originalLoad: base.value,
          adjustedLoad: final.value,
          originalRir: originalRpe !== undefined ? 10 - originalRpe : undefined,
          adjustedRir: adjustedRpe !== undefined ? 10 - adjustedRpe : undefined,
          reason:
            direction === "down"
              ? `Scaled down ${exercise.exercise.name} from ${base.value} lbs to ${final.value} lbs (-10%)${rpeDetail}`
              : `Scaled up ${exercise.exercise.name} from ${base.value} lbs to ${final.value} lbs (+5%)${rpeDetail}`,
        });

        return {
          ...set,
          ...(adjustedRpe !== undefined ? { targetRpe: adjustedRpe } : {}),
        };
      }),
    };
  };

  return {
    ...input.workout,
    mainLifts: input.workout.mainLifts.map(adjustExercise),
    accessories: input.workout.accessories.map(adjustExercise),
  };
}

function withReadinessReason(
  prescription: NumericPrescription,
  reason: PrescriptionReasonCode,
): NumericPrescription {
  return {
    ...prescription,
    reasonCodes: uniqueReasons([...prescription.reasonCodes, reason]),
  };
}

function uniqueReasons(reasonCodes: PrescriptionReasonCode[]): PrescriptionReasonCode[] {
  return [...new Set(reasonCodes)];
}

function generateRationale(
  action: AutoregulationAction,
  fatigueScore: number,
  modifications: AutoregulationModification[],
): string {
  const percentage = Math.round(fatigueScore * 100);
  const modificationCount = modifications.length;

  switch (action) {
    case "scale_down":
      return `Fatigue score ${percentage}% (moderately fatigued). Action: scale down intensity. ${modificationCount} exercises adjusted (-10% load, -1 RPE).`;
    case "scale_up":
      return `Fatigue score ${percentage}% (very fresh). Action: scale up intensity. ${modificationCount} exercises adjusted (+5% load, +0.5 RPE).`;
    default:
      return `Fatigue score ${percentage}% (recovered). No adjustments needed.`;
  }
}
