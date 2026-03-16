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
