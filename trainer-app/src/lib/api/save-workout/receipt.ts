import {
  extractSessionDecisionReceipt,
  normalizeSelectionMetadataWithReceipt,
} from "@/lib/evidence/session-decision-receipt";
import {
  attachSessionAuditSnapshotToSelectionMetadata,
  buildSavedSessionAuditSnapshot,
} from "@/lib/evidence/session-audit-snapshot";
import { reconcileRuntimeEditSelectionMetadata } from "@/lib/api/runtime-edit-reconciliation";

export {
  extractSessionDecisionReceipt,
  normalizeSelectionMetadataWithReceipt,
  reconcileRuntimeEditSelectionMetadata,
};

export type JsonObject = Record<string, unknown>;

export function toObject(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as JsonObject;
}

export function mergeSelectionMetadata(
  base: unknown,
  overrides: unknown,
): JsonObject {
  return {
    ...toObject(base),
    ...toObject(overrides),
  };
}

export function stripCloseoutSlotIdentity(
  selectionMetadata: unknown,
): JsonObject {
  const record = toObject(selectionMetadata);
  const withoutTopLevelSlot = { ...record };
  delete withoutTopLevelSlot.sessionSlot;
  const receipt = extractSessionDecisionReceipt(withoutTopLevelSlot);
  if (!receipt?.sessionSlot) {
    return withoutTopLevelSlot;
  }

  const receiptWithoutSlot = { ...receipt };
  delete receiptWithoutSlot.sessionSlot;
  return {
    ...withoutTopLevelSlot,
    sessionDecisionReceipt: receiptWithoutSlot,
  };
}

export function attachSavedSessionAuditSnapshot(input: {
  selectionMetadata: unknown;
  workoutId: string;
  revision?: number;
  status: string;
  advancesSplit: boolean;
  selectionMode?: string | null;
  sessionIntent?: string | null;
  mesocycleId?: string | null;
  mesocycleWeekSnapshot?: number | null;
  mesoSessionSnapshot?: number | null;
  mesocyclePhaseSnapshot?: string | null;
}): JsonObject {
  return attachSessionAuditSnapshotToSelectionMetadata(
    input.selectionMetadata,
    buildSavedSessionAuditSnapshot(input),
  );
}
