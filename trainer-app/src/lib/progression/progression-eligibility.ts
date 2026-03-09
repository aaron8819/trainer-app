import { deriveSessionSemantics } from "@/lib/session-semantics/derive-session-semantics";

export function isProgressionEligibleWorkout(input: {
  selectionMetadata: unknown;
  selectionMode: string | null | undefined;
  sessionIntent: string | null | undefined;
}): boolean {
  return deriveSessionSemantics(input).countsTowardProgressionHistory;
}
