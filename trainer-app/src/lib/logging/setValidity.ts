export const INVALID_SET_REASON_MISSING_PERFORMANCE =
  "Add reps or RPE to log this set, or skip it.";
export const INVALID_SET_REASON_LOAD_ONLY =
  "Load alone will not save. Add reps or RPE, or skip the set.";

type GetSetValidityParams = {
  actualReps?: number | null;
  actualRpe?: number | null;
  actualLoad?: number | null;
  wasSkipped?: boolean | null;
  measurementProfile?: import("@/lib/exercise-measurement/semantics").MeasurementProfile | null;
};

export function getSetValidity({
  actualReps,
  actualRpe,
  actualLoad,
  wasSkipped,
  measurementProfile,
}: GetSetValidityParams): {
  valid: boolean;
  reason?: string;
} {
  if (wasSkipped) {
    return { valid: true };
  }

  if (measurementProfile) {
    if (actualReps == null) {
      return { valid: false, reason: "Reps are required to log this set, or skip it." };
    }
    if (measurementProfile === "REPS_BODYWEIGHT") {
      return actualLoad == null
        ? { valid: true }
        : { valid: false, reason: "Load is not recorded for this bodyweight exercise." };
    }
    if (actualLoad == null || actualLoad <= 0) {
      return {
        valid: false,
        reason:
          measurementProfile === "REPS_ASSISTED"
            ? "Positive displayed assistance is required."
            : "Positive load is required.",
      };
    }
    return { valid: true };
  }

  if (actualReps != null || actualRpe != null) {
    return { valid: true };
  }

  if (actualLoad != null) {
    return {
      valid: false,
      reason: INVALID_SET_REASON_LOAD_ONLY,
    };
  }

  return {
    valid: false,
    reason: INVALID_SET_REASON_MISSING_PERFORMANCE,
  };
}
