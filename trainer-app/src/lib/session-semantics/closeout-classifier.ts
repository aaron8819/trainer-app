import { readSessionDecisionReceipt } from "@/lib/evidence/session-decision-receipt";

export function isCloseoutSession(selectionMetadata: unknown): boolean {
  const receipt = readSessionDecisionReceipt(selectionMetadata);
  return (receipt?.exceptions ?? []).some((entry) => entry.code === "closeout_session");
}
