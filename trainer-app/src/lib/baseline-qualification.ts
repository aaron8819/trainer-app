export const BASELINE_RPE_TOLERANCE = 1.0;

export type BaselineQualificationSet = {
  targetReps?: number | null;
  targetRpe?: number | null;
  actualReps?: number | null;
  actualRpe?: number | null;
};

export function isSetQualifiedForBaseline(set: BaselineQualificationSet): boolean {
  if (set.targetReps !== undefined && set.targetReps !== null) {
    if (set.actualReps === undefined || set.actualReps === null || set.actualReps < set.targetReps) {
      return false;
    }
  }

  if (
    set.targetRpe !== undefined &&
    set.targetRpe !== null &&
    set.actualRpe !== undefined &&
    set.actualRpe !== null
  ) {
    return set.actualRpe <= set.targetRpe + BASELINE_RPE_TOLERANCE;
  }

  return true;
}
