import type { ProgressionEquipment } from "./progression";

export type LoadCalibrationEquipment =
  | "barbell"
  | "dumbbell"
  | "machine"
  | "cable"
  | "kettlebell"
  | "band"
  | "sled"
  | "bodyweight"
  | "other";

export type LoadReliabilityTier = "high" | "medium" | "low" | "bodyweight";

export type LoadCalibrationPolicy = {
  equipment: LoadCalibrationEquipment;
  reliabilityTier: LoadReliabilityTier;
  estimateScale: number;
  earlyExposureConfidenceScale: number;
  confidenceReason?: string;
};

export type CalibrationEstimateSource =
  | "cold_start"
  | "donor"
  | "baseline"
  | "history";

type LoadCalibrationExercise = {
  equipment?: readonly string[] | null;
  isCompound?: boolean | null;
};

const CALIBRATION_BY_TIER: Record<
  LoadReliabilityTier,
  Pick<LoadCalibrationPolicy, "estimateScale" | "earlyExposureConfidenceScale">
> = {
  high: { estimateScale: 1, earlyExposureConfidenceScale: 1 },
  medium: { estimateScale: 0.95, earlyExposureConfidenceScale: 0.95 },
  low: { estimateScale: 0.85, earlyExposureConfidenceScale: 0.85 },
  bodyweight: { estimateScale: 1, earlyExposureConfidenceScale: 1 },
};

export function resolveLoadEquipment(exercise: LoadCalibrationExercise): LoadCalibrationEquipment {
  const equipment = new Set(
    (exercise.equipment ?? [])
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
  );

  if (equipment.has("bodyweight")) return "bodyweight";
  if (equipment.has("barbell")) return "barbell";
  if (equipment.has("dumbbell")) return "dumbbell";
  if (equipment.has("cable")) return "cable";
  if (equipment.has("machine")) return "machine";
  if (equipment.has("sled")) return "sled";
  if (equipment.has("kettlebell")) return "kettlebell";
  if (equipment.has("band")) return "band";
  return "other";
}

export function resolveLoadCalibrationPolicy(
  exercise: LoadCalibrationExercise
): LoadCalibrationPolicy {
  const equipment = resolveLoadEquipment(exercise);
  const reliabilityTier = resolveReliabilityTier(equipment, exercise.isCompound === true);
  const scales = CALIBRATION_BY_TIER[reliabilityTier];

  return {
    equipment,
    reliabilityTier,
    ...scales,
    confidenceReason:
      scales.earlyExposureConfidenceScale < 1
        ? `${reliabilityTier} load-reliability equipment scaled during early exposure.`
        : undefined,
  };
}

export function resolveCalibrationConfidenceScale(
  policy: LoadCalibrationPolicy,
  priorSessionCount: number
): number {
  if (!Number.isFinite(priorSessionCount) || priorSessionCount > 2) {
    return 1;
  }
  return policy.earlyExposureConfidenceScale;
}

export function applyCalibrationToEstimate(
  load: number | undefined,
  policy: LoadCalibrationPolicy,
  source: CalibrationEstimateSource
): number | undefined {
  if (load === undefined || !Number.isFinite(load)) {
    return undefined;
  }
  if (source !== "cold_start" && source !== "donor") {
    return load;
  }
  return load * policy.estimateScale;
}

export function resolveProgressionEquipment(
  exercise: LoadCalibrationExercise
): ProgressionEquipment {
  const equipment = resolveLoadEquipment(exercise);
  if (equipment === "barbell" || equipment === "dumbbell" || equipment === "cable") {
    return equipment;
  }
  return "other";
}

function resolveReliabilityTier(
  equipment: LoadCalibrationEquipment,
  isCompound: boolean
): LoadReliabilityTier {
  if (equipment === "bodyweight") return "bodyweight";
  if (equipment === "barbell" || equipment === "dumbbell") return "high";
  if (equipment === "sled" || equipment === "kettlebell") return "medium";
  if (equipment === "machine") return isCompound ? "medium" : "low";
  return "low";
}
