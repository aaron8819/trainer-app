type BaselineCandidateSet = {
  targetReps?: number | null;
  actualReps?: number | null;
  actualLoad?: number | null;
  actualRpe?: number | null;
  wasSkipped?: boolean | null;
};

/**
 * Lightweight guard for whether a set should count toward baseline updates.
 * Keeps qualification strict enough to avoid noisy/partial logs.
 */
export function isSetQualifiedForBaseline(set: BaselineCandidateSet): boolean {
  if (set.wasSkipped) {
    return false;
  }
  if (set.actualReps == null || set.actualLoad == null) {
    return false;
  }
  if (set.actualReps <= 0 || set.actualLoad < 0) {
    return false;
  }
  if (set.targetReps != null && set.actualReps < set.targetReps) {
    return false;
  }
  if (set.actualRpe != null && (set.actualRpe < 1 || set.actualRpe > 10)) {
    return false;
  }
  return true;
}
