import { readSessionDecisionReceipt } from "@/lib/evidence/session-decision-receipt";

export function resolveEffectiveSelectionMode(input: {
  selectionMode: string | null | undefined;
  sessionIntent: string | null | undefined;
}): string | undefined {
  return input.selectionMode ?? (input.sessionIntent ? "INTENT" : undefined);
}

export function hasOptionalGapFillMarker(selectionMetadata: unknown): boolean {
  const receipt = readSessionDecisionReceipt(selectionMetadata);
  return (receipt?.exceptions ?? []).some((entry) => entry.code === "optional_gap_fill");
}

export function isStrictOptionalGapFillSession(input: {
  selectionMetadata: unknown;
  selectionMode: string | null | undefined;
  sessionIntent: string | null | undefined;
}): boolean {
  return (
    hasOptionalGapFillMarker(input.selectionMetadata) &&
    resolveEffectiveSelectionMode({
      selectionMode: input.selectionMode,
      sessionIntent: input.sessionIntent,
    }) === "INTENT" &&
    input.sessionIntent === "BODY_PART"
  );
}
