import { isStrictSupplementalDeficitSession } from "@/lib/session-semantics/supplemental-classifier";

export function isProgressionEligibleWorkout(input: {
  selectionMetadata: unknown;
  selectionMode: string | null | undefined;
  sessionIntent: string | null | undefined;
}): boolean {
  if (
    isStrictSupplementalDeficitSession({
      selectionMetadata: input.selectionMetadata,
      selectionMode: input.selectionMode,
      sessionIntent: input.sessionIntent,
    })
  ) {
    return false;
  }

  return true;
}
