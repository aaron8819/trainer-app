import { describe, expect, it } from "vitest";

import { buildSessionDecisionReceipt } from "@/lib/evidence/session-decision-receipt";
import {
  buildSessionMaterializationEvidence,
  classifyNonScheduledMaterialization,
} from "./materialization";

describe("session materialization evidence", () => {
  it.each([
    [
      { kind: "accepted_v4_scheduled" } as const,
      {
        version: 1,
        generationMode: "accepted_v4_scheduled",
        materializationClass: "scheduled_required",
      },
    ],
    [
      { kind: "explicit_preview" } as const,
      {
        version: 1,
        generationMode: "explicit_preview",
        materializationClass: "preview_only",
      },
    ],
    [
      { kind: "non_scheduled", purpose: "body_part" } as const,
      {
        version: 1,
        generationMode: "non_scheduled",
        materializationClass: "non_scheduled",
        purpose: "body_part",
      },
    ],
    [
      { kind: "legacy" } as const,
      {
        version: 1,
        generationMode: "legacy",
        materializationClass: "legacy",
      },
    ],
  ])("maps %j to its canonical receipt class", (mode, expected) => {
    expect(buildSessionMaterializationEvidence(mode)).toEqual(expected);
  });

  it("normalizes a pre-classification generation context to legacy", () => {
    expect(buildSessionMaterializationEvidence(undefined)).toEqual({
      version: 1,
      generationMode: "legacy",
      materializationClass: "legacy",
    });
  });

  it("recognizes canonical body-part evidence and rejects scheduled identity", () => {
    const receipt = buildSessionDecisionReceipt({
      cycleContext: {
        weekInMeso: 1,
        weekInBlock: 1,
        mesocycleLength: 5,
        phase: "accumulation",
        blockType: "accumulation",
        isDeload: false,
        source: "computed",
      },
      materialization: buildSessionMaterializationEvidence({
        kind: "non_scheduled",
        purpose: "body_part",
      }),
    });
    const selectionMetadata = { sessionDecisionReceipt: receipt };

    expect(
      classifyNonScheduledMaterialization({
        receipt,
        selectionMetadata,
        selectionMode: "INTENT",
        sessionIntent: "BODY_PART",
      }),
    ).toEqual({ status: "recognized", purpose: "body_part" });

    const scheduledReceipt = {
      ...receipt,
      sessionSlot: {
        slotId: "upper-a",
        intent: "upper",
        sequenceIndex: 1,
        sequenceLength: 4,
        source: "mesocycle_slot_sequence" as const,
      },
    };
    expect(
      classifyNonScheduledMaterialization({
        receipt: scheduledReceipt,
        selectionMetadata: { sessionDecisionReceipt: scheduledReceipt },
        selectionMode: "INTENT",
        sessionIntent: "BODY_PART",
      }),
    ).toEqual({
      status: "invalid",
      reason: "non_scheduled_slot_identity_forbidden",
    });
  });

  it("fails closed when declared modern materialization evidence is malformed", () => {
    expect(
      classifyNonScheduledMaterialization({
        receipt: undefined,
        selectionMetadata: {
          sessionDecisionReceipt: {
            materialization: {
              version: 1,
              generationMode: "non_scheduled",
              materializationClass: "non_scheduled",
              purpose: "unknown",
            },
          },
        },
        selectionMode: "INTENT",
        sessionIntent: "BODY_PART",
      }),
    ).toEqual({
      status: "invalid",
      reason: "materialization_evidence_invalid",
    });
  });
});
