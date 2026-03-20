import { describe, expect, it } from "vitest";

import { resolveSessionSlotProfile } from "./session-slot-profile";

describe("resolveSessionSlotProfile", () => {
  const slotSequence = {
    slots: [
      { slotId: "upper_a", intent: "upper" },
      { slotId: "lower_a", intent: "lower" },
      { slotId: "upper_b", intent: "upper" },
      { slotId: "lower_b", intent: "lower" },
    ],
  };

  it("resolves horizontal versus vertical upper-slot profiles from canonical slot order", () => {
    expect(
      resolveSessionSlotProfile({
        sessionIntent: "upper",
        slotId: "upper_a",
        slotSequence,
      })
    ).toEqual({
      sessionIntent: "upper",
      slotId: "upper_a",
      repeatedSlot: {
        occurrenceIndex: 0,
        totalSlots: 2,
      },
      compoundBias: {
        preferredMovementPatterns: ["horizontal_push", "horizontal_pull"],
      },
    });

    expect(
      resolveSessionSlotProfile({
        sessionIntent: "upper",
        slotId: "upper_b",
        slotSequence,
      })
    ).toEqual({
      sessionIntent: "upper",
      slotId: "upper_b",
      repeatedSlot: {
        occurrenceIndex: 1,
        totalSlots: 2,
      },
      compoundBias: {
        preferredMovementPatterns: ["vertical_push", "vertical_pull"],
      },
    });
  });

  it("resolves squat versus hinge lower-slot profiles from canonical slot order", () => {
    expect(
      resolveSessionSlotProfile({
        sessionIntent: "lower",
        slotId: "lower_a",
        slotSequence,
      })
    ).toEqual({
      sessionIntent: "lower",
      slotId: "lower_a",
      repeatedSlot: {
        occurrenceIndex: 0,
        totalSlots: 2,
      },
      compoundBias: {
        preferredMovementPatterns: ["squat"],
        preferredPrimaryMuscles: ["Quads"],
      },
    });

    expect(
      resolveSessionSlotProfile({
        sessionIntent: "lower",
        slotId: "lower_b",
        slotSequence,
      })
    ).toEqual({
      sessionIntent: "lower",
      slotId: "lower_b",
      repeatedSlot: {
        occurrenceIndex: 1,
        totalSlots: 2,
      },
      compoundBias: {
        preferredMovementPatterns: ["hinge"],
        preferredPrimaryMuscles: ["Hamstrings", "Glutes"],
      },
    });
  });

  it("returns null when slot identity is absent or the intent is not repeated", () => {
    expect(
      resolveSessionSlotProfile({
        sessionIntent: "upper",
        slotSequence,
      })
    ).toBeNull();

    expect(
      resolveSessionSlotProfile({
        sessionIntent: "full_body",
        slotId: "full_body_a",
        slotSequence: {
          slots: [{ slotId: "full_body_a", intent: "full_body" }],
        },
      })
    ).toBeNull();
  });
});
