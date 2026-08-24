import { deriveLoadEntryPolicy } from "@/lib/exercise-measurement/load-entry-policy";

export const INVALID_SET_REASON_MISSING_PERFORMANCE =
  "Add reps or RPE to log this set, or skip it.";
export const INVALID_SET_REASON_LOAD_ONLY =
  "Load alone will not save. Add reps or RPE, or skip the set.";
export const INVALID_SET_REASON_INVALID_LOAD =
  "Load must be a finite number greater than or equal to zero.";

type GetSetValidityParams = {
  actualReps?: number | null;
  actualRpe?: number | null;
  actualLoad?: number | null;
  wasSkipped?: boolean | null;
  measurement?: import("@/lib/exercise-measurement/semantics").MeasurementSemantics | null;
  zeroLoadMeaning?: import("@/lib/exercise-measurement/semantics").ZeroLoadMeaning | null;
};

export function getSetValidity({
  actualReps,
  actualRpe,
  actualLoad,
  wasSkipped,
  measurement = null,
  zeroLoadMeaning = null,
}: GetSetValidityParams): {
  valid: boolean;
  reason?: string;
} {
  if (
    actualLoad != null &&
    (!Number.isFinite(actualLoad) || actualLoad < 0)
  ) {
    return { valid: false, reason: INVALID_SET_REASON_INVALID_LOAD };
  }

  if (wasSkipped) {
    return { valid: true };
  }

  if (measurement) {
    if (actualReps == null) {
      return { valid: false, reason: "Reps are required to log this set, or skip it." };
    }
    const policy = deriveLoadEntryPolicy({ measurement, zeroLoadMeaning });
    if (!policy.showLoadField) {
      return actualLoad == null
        ? { valid: true }
        : { valid: false, reason: "Load is not recorded for this bodyweight exercise." };
    }
    if (actualLoad == null && !policy.blankAllowedForPerformedSet) {
      return {
        valid: false,
        reason:
          measurement.profile === "REPS_ASSISTED"
            ? "Positive displayed assistance is required."
            : "Load is required.",
      };
    }
    if (actualLoad === 0 && !policy.zeroAllowed) {
      return {
        valid: false,
        reason:
          measurement.profile === "REPS_ASSISTED"
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
