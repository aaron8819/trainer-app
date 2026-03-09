import { readSessionDecisionReceipt } from "@/lib/evidence/session-decision-receipt";
import { resolveEffectiveSelectionMode } from "@/lib/gap-fill/classifier";

export function hasSupplementalDeficitMarker(selectionMetadata: unknown): boolean {
  const receipt = readSessionDecisionReceipt(selectionMetadata);
  return (receipt?.exceptions ?? []).some(
    (entry) => entry.code === "supplemental_deficit_session"
  );
}

export function isStrictSupplementalDeficitSession(input: {
  selectionMetadata: unknown;
  selectionMode: string | null | undefined;
  sessionIntent: string | null | undefined;
}): boolean {
  return (
    hasSupplementalDeficitMarker(input.selectionMetadata) &&
    resolveEffectiveSelectionMode({
      selectionMode: input.selectionMode,
      sessionIntent: input.sessionIntent,
    }) === "INTENT" &&
    input.sessionIntent === "BODY_PART"
  );
}
