import { readSessionDecisionReceipt } from "@/lib/evidence/session-decision-receipt";

function toObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function isCloseoutSession(selectionMetadata: unknown): boolean {
  const receipt = readSessionDecisionReceipt(selectionMetadata);
  return (receipt?.exceptions ?? []).some((entry) => entry.code === "closeout_session");
}

export function isDismissedCloseoutSession(selectionMetadata: unknown): boolean {
  return isCloseoutSession(selectionMetadata) && toObject(selectionMetadata)?.closeoutDismissed === true;
}
