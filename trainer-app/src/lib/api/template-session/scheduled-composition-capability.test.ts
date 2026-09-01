import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  revalidate: vi.fn(),
}));

vi.mock("../next-session", () => ({
  revalidateV4ScheduledGenerationObligation: mocks.revalidate,
}));

import type { V4ScheduledGenerationObligation } from "../v4-scheduled-slot-resolution";
import {
  consumeV4ScheduledCompositionCapability,
  validateV4ScheduledCompositionCapability,
} from "./scheduled-composition-capability";

function obligation(
  overrides: Partial<V4ScheduledGenerationObligation["requiredSlot"]> = {},
  authorityOverrides: Partial<V4ScheduledGenerationObligation["authority"]> = {},
): V4ScheduledGenerationObligation {
  return {
    authority: {
      mesocycleId: "meso-v4",
      revisionId: "revision-v4",
      revisionNumber: 3,
      revisionHash: "hash-v4",
      slotsPerWeek: 4,
      requiredSlots: [],
      ...authorityOverrides,
    },
    requiredSlot: {
      weekInMeso: 3,
      phase: "ACCUMULATION",
      slotId: "lower-a",
      intent: "lower",
      sequenceIndex: 0,
      sequenceLength: 4,
      ...overrides,
    },
  };
}

describe("scheduled composition capability", () => {
  it("issues a one-use capability only after current exact revalidation", async () => {
    const current = obligation();
    mocks.revalidate.mockResolvedValueOnce({ status: "available", obligation: current });

    const validated = await validateV4ScheduledCompositionCapability({
      userId: "user-v4",
      obligation: current,
    });

    expect(mocks.revalidate).toHaveBeenCalledWith({
      userId: "user-v4",
      obligation: current,
    });
    expect(validated.status).toBe("available");
    if (validated.status !== "available") return;
    expect(
      consumeV4ScheduledCompositionCapability({
        capability: validated.capability,
        obligation: current,
      }),
    ).toBe(true);
    expect(
      consumeV4ScheduledCompositionCapability({
        capability: validated.capability,
        obligation: current,
      }),
    ).toBe(false);
  });

  it.each([
    ["same-week different slot", obligation({ slotId: "upper-a", intent: "upper", sequenceIndex: 1 })],
    ["sequence index", obligation({ sequenceIndex: 2 })],
    ["sequence length", obligation({ sequenceLength: 5 })],
    ["revision", obligation({}, { revisionId: "revision-old", revisionNumber: 2 })],
  ])("rejects capability reuse with a %s mismatch", async (_label, mismatched) => {
    const current = obligation();
    mocks.revalidate.mockResolvedValueOnce({ status: "available", obligation: current });
    const validated = await validateV4ScheduledCompositionCapability({
      userId: "user-v4",
      obligation: current,
    });
    if (validated.status !== "available") throw new Error("expected capability");

    expect(
      consumeV4ScheduledCompositionCapability({
        capability: validated.capability,
        obligation: mismatched,
      }),
    ).toBe(false);
  });

  it("rejects structurally identical objects that were not issued by revalidation", () => {
    const current = obligation();
    expect(
      consumeV4ScheduledCompositionCapability({
        capability: { obligation: current },
        obligation: current,
      }),
    ).toBe(false);
  });

  it("does not issue a capability after the persisted claim makes the old obligation stale", async () => {
    mocks.revalidate.mockResolvedValueOnce({ status: "blocked", reason: "V4_SCHEDULE_STALE" });
    await expect(
      validateV4ScheduledCompositionCapability({
        userId: "user-v4",
        obligation: obligation(),
      }),
    ).resolves.toEqual({ status: "blocked", reason: "V4_SCHEDULE_STALE" });
  });
});
