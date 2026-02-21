export function isPerformedWorkoutStatus(status: string): boolean {
  return status === "COMPLETED" || status === "PARTIAL";
}

export function getPrescriptionBasisLabel(status: string): string {
  return isPerformedWorkoutStatus(status)
    ? "Prescription basis: performed session (non-skipped logged sets)."
    : "Prescription basis: planned session targets (not yet performed).";
}

export function getLoadProvenanceNote(input: {
  targetLoad: number | null | undefined;
  isBodyweightExercise: boolean;
  hasHistory: boolean;
}): string {
  const { targetLoad, isBodyweightExercise, hasHistory } = input;
  if (targetLoad != null) {
    return hasHistory
      ? "Estimated load (from workout history)."
      : "Planned load target. No performed history available.";
  }

  if (isBodyweightExercise) {
    return "Bodyweight movement (BW). Add load during logging only for weighted variations.";
  }

  return "Load to be chosen during logging.";
}

export function hasPerformedHistory(receipt: {
  lastPerformed: { reps: number | null; load: number | null; rpe: number | null } | null;
} | null | undefined): boolean {
  if (!receipt?.lastPerformed) {
    return false;
  }

  const { reps, load, rpe } = receipt.lastPerformed;
  return reps != null || load != null || rpe != null;
}
