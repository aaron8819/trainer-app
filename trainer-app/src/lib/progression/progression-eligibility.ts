import { deriveSessionSemantics } from "@/lib/session-semantics/derive-session-semantics";

// Progression eligibility is centralized in session semantics so deload stays
// excluded consistently anywhere this helper is used.
export function isProgressionEligibleWorkout(input: {
  selectionMetadata: unknown;
  selectionMode: string | null | undefined;
  sessionIntent: string | null | undefined;
  mesocyclePhase?: string | null | undefined;
}): boolean {
  return deriveSessionSemantics(input).countsTowardProgressionHistory;
}

export function isPartialExposureAdequateForProgression(input: {
  plannedWorkingSetCount: number;
  performedWorkingSetCount: number;
}): boolean {
  const plannedWorkingSetCount = Math.max(0, input.plannedWorkingSetCount);
  const performedWorkingSetCount = Math.max(0, input.performedWorkingSetCount);
  if (plannedWorkingSetCount === 0) return false;

  const minimumPerformedSetCount = plannedWorkingSetCount <= 1 ? 1 : 2;
  return (
    performedWorkingSetCount >= minimumPerformedSetCount &&
    performedWorkingSetCount / plannedWorkingSetCount >= 2 / 3
  );
}
