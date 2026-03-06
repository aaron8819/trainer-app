export const INVALID_SET_REASON_MISSING_PERFORMANCE =
  "Add reps or RPE to log this set, or skip it.";
export const INVALID_SET_REASON_LOAD_ONLY =
  "Load alone will not save. Add reps or RPE, or skip the set.";

type GetSetValidityParams = {
  actualReps?: number | null;
  actualRpe?: number | null;
  actualLoad?: number | null;
  wasSkipped?: boolean | null;
};

export function getSetValidity({
  actualReps,
  actualRpe,
  actualLoad,
  wasSkipped,
}: GetSetValidityParams): {
  valid: boolean;
  reason?: string;
} {
  if (wasSkipped) {
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
