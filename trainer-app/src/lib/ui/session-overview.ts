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
  isRuntimeAdded?: boolean;
}): string {
  const { targetLoad, isBodyweightExercise, hasHistory, isRuntimeAdded } = input;
  if (targetLoad != null) {
    if (isRuntimeAdded) {
      return hasHistory
        ? "Added exercise. Load target came from recent performed history."
        : "Added exercise. No recent performed history found; use the suggested load as a starting point and let RPE govern.";
    }

    return hasHistory
      ? "Load target came from recent performed history."
      : "Load target follows the written plan because no recent performed history is available.";
  }

  if (isBodyweightExercise) {
    return "Bodyweight movement. Add load during logging only if you make it weighted.";
  }

  return "Choose the load while logging.";
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
