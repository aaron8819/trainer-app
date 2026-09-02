import type {
  NonScheduledMaterializationPurpose,
  SessionDecisionReceipt,
  SessionMaterializationEvidence,
} from "@/lib/evidence/types";
import { isStrictOptionalGapFillSession } from "@/lib/gap-fill/classifier";
import { isCloseoutSession } from "./closeout-classifier";
import { isStrictSupplementalDeficitSession } from "./supplemental-classifier";

type GenerationMaterializationMode =
  | { kind: "accepted_v4_scheduled" }
  | { kind: "explicit_preview" }
  | { kind: "non_scheduled"; purpose: NonScheduledMaterializationPurpose }
  | { kind: "legacy" };

export const LEGACY_SESSION_MATERIALIZATION = {
  version: 1,
  generationMode: "legacy",
  materializationClass: "legacy",
} as const satisfies SessionMaterializationEvidence;

export function buildSessionMaterializationEvidence(
  mode: GenerationMaterializationMode | null | undefined,
): SessionMaterializationEvidence {
  if (!mode) return LEGACY_SESSION_MATERIALIZATION;
  switch (mode.kind) {
    case "accepted_v4_scheduled":
      return {
        version: 1,
        generationMode: mode.kind,
        materializationClass: "scheduled_required",
      };
    case "explicit_preview":
      return {
        version: 1,
        generationMode: mode.kind,
        materializationClass: "preview_only",
      };
    case "non_scheduled":
      return {
        version: 1,
        generationMode: mode.kind,
        materializationClass: "non_scheduled",
        purpose: mode.purpose,
      };
    case "legacy":
      return LEGACY_SESSION_MATERIALIZATION;
  }
}

export function resolveSessionMaterialization(
  receipt: SessionDecisionReceipt,
): SessionMaterializationEvidence {
  return receipt.materialization ?? LEGACY_SESSION_MATERIALIZATION;
}

export function sameSessionMaterialization(
  left: SessionMaterializationEvidence,
  right: SessionMaterializationEvidence,
): boolean {
  return (
    left.version === right.version &&
    left.generationMode === right.generationMode &&
    left.materializationClass === right.materializationClass &&
    (left.materializationClass !== "non_scheduled" ||
      (right.materializationClass === "non_scheduled" &&
        left.purpose === right.purpose))
  );
}

export function validateNonScheduledMaterialization(input: {
  materialization: Extract<
    SessionMaterializationEvidence,
    { materializationClass: "non_scheduled" }
  >;
  receipt: SessionDecisionReceipt;
  selectionMetadata: unknown;
  selectionMode: string | null | undefined;
  sessionIntent: string | null | undefined;
}): string | null {
  if (input.receipt.sessionSlot || input.receipt.scheduledSlotReceipt) {
    return "non_scheduled_slot_identity_forbidden";
  }

  const isGapFill = isStrictOptionalGapFillSession(input);
  const isSupplemental = isStrictSupplementalDeficitSession(input);
  const isCloseout = isCloseoutSession(input.selectionMetadata);
  const isBodyPart =
    (input.selectionMode ?? (input.sessionIntent ? "INTENT" : undefined)) ===
      "INTENT" &&
    input.sessionIntent === "BODY_PART" &&
    !isGapFill &&
    !isSupplemental &&
    !isCloseout;

  const recognizedByPurpose: Record<NonScheduledMaterializationPurpose, boolean> = {
    body_part: isBodyPart,
    gap_fill: isGapFill && !isSupplemental && !isCloseout,
    supplemental: isSupplemental && !isGapFill && !isCloseout,
    closeout: isCloseout && !isGapFill && !isSupplemental,
  };
  return recognizedByPurpose[input.materialization.purpose]
    ? null
    : `non_scheduled_purpose_conflict:${input.materialization.purpose}`;
}

export type NonScheduledMaterializationClassification =
  | { status: "not_non_scheduled" }
  | {
      status: "recognized";
      purpose: NonScheduledMaterializationPurpose;
    }
  | { status: "invalid"; reason: string };

function toObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function hasDeclaredMaterialization(selectionMetadata: unknown): boolean {
  const metadata = toObject(selectionMetadata);
  const receipt = toObject(metadata?.sessionDecisionReceipt);
  return Boolean(receipt && "materialization" in receipt);
}

export function classifyNonScheduledMaterialization(input: {
  receipt: SessionDecisionReceipt | null | undefined;
  selectionMetadata: unknown;
  selectionMode: string | null | undefined;
  sessionIntent: string | null | undefined;
}): NonScheduledMaterializationClassification {
  if (!input.receipt) {
    return hasDeclaredMaterialization(input.selectionMetadata)
      ? { status: "invalid", reason: "materialization_evidence_invalid" }
      : { status: "not_non_scheduled" };
  }

  const materialization = resolveSessionMaterialization(input.receipt);
  if (materialization.materializationClass !== "non_scheduled") {
    return { status: "not_non_scheduled" };
  }

  const reason = validateNonScheduledMaterialization({
    materialization,
    receipt: input.receipt,
    selectionMetadata: input.selectionMetadata,
    selectionMode: input.selectionMode,
    sessionIntent: input.sessionIntent,
  });
  return reason
    ? { status: "invalid", reason }
    : { status: "recognized", purpose: materialization.purpose };
}
