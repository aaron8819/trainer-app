import { describe, expect, it } from "vitest";

import {
  getFutureSlotOpportunityBias,
  resolveSessionSlotPolicy,
} from "./session-slot-profile";

describe("resolveSessionSlotPolicy", () => {
  const slotSequence = {
    slots: [
      { slotId: "upper_a", intent: "upper", sequenceIndex: 0 },
      { slotId: "lower_a", intent: "lower", sequenceIndex: 1 },
      { slotId: "upper_b", intent: "upper", sequenceIndex: 2 },
      { slotId: "lower_b", intent: "lower", sequenceIndex: 3 },
    ],
  };

  it("resolves horizontal versus vertical upper-slot profiles from canonical slot order", () => {
    expect(
      resolveSessionSlotPolicy({
        sessionIntent: "upper",
        slotId: "upper_a",
        slotSequence,
      }).currentSession
    ).toEqual({
      sessionIntent: "upper",
      slotId: "upper_a",
      sequenceIndex: 0,
      repeatedSlot: {
        occurrenceIndex: 0,
        totalSlots: 2,
      },
      compoundBias: {
        preferredMovementPatterns: ["horizontal_push", "horizontal_pull"],
      },
    });

    expect(
      resolveSessionSlotPolicy({
        sessionIntent: "upper",
        slotId: "upper_b",
        slotSequence,
      }).currentSession
    ).toEqual({
      sessionIntent: "upper",
      slotId: "upper_b",
      sequenceIndex: 2,
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
      resolveSessionSlotPolicy({
        sessionIntent: "lower",
        slotId: "lower_a",
        slotSequence,
      }).currentSession
    ).toEqual({
      sessionIntent: "lower",
      slotId: "lower_a",
      sequenceIndex: 1,
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
      resolveSessionSlotPolicy({
        sessionIntent: "lower",
        slotId: "lower_b",
        slotSequence,
      }).currentSession
    ).toEqual({
      sessionIntent: "lower",
      slotId: "lower_b",
      sequenceIndex: 3,
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

  it("returns null when current slot identity is absent and keeps unsupported intents un-biased", () => {
    expect(
      resolveSessionSlotPolicy({
        sessionIntent: "upper",
        slotSequence,
      }).currentSession
    ).toBeNull();

    expect(
      resolveSessionSlotPolicy({
        sessionIntent: "full_body",
        slotId: "full_body_a",
        slotSequence: {
          slots: [{ slotId: "full_body_a", intent: "full_body", sequenceIndex: 0 }],
        },
      }).currentSession
    ).toEqual({
      sessionIntent: "full_body",
      slotId: "full_body_a",
      sequenceIndex: 0,
    });
  });

  it("resolves canonical future slots into the same policy seam", () => {
    const policy = resolveSessionSlotPolicy({
      sessionIntent: "upper",
      slotId: "upper_a",
      slotSequence,
      futureSlots: [
        { slotId: "lower_a", intent: "lower", sequenceIndex: 1 },
        { slotId: "upper_b", intent: "upper", sequenceIndex: 2 },
      ],
    });

    expect(policy.futurePlanning.futureSlots).toEqual([
      {
        sessionIntent: "lower",
        slotId: "lower_a",
        sequenceIndex: 1,
        repeatedSlot: {
          occurrenceIndex: 0,
          totalSlots: 2,
        },
        compoundBias: {
          preferredMovementPatterns: ["squat"],
          preferredPrimaryMuscles: ["Quads"],
        },
      },
      {
        sessionIntent: "upper",
        slotId: "upper_b",
        sequenceIndex: 2,
        repeatedSlot: {
          occurrenceIndex: 1,
          totalSlots: 2,
        },
        compoundBias: {
          preferredMovementPatterns: ["vertical_push", "vertical_pull"],
        },
      },
    ]);
  });

  it("applies only a minimal future opportunity bias from preferred primary muscles", () => {
    const lowerB = resolveSessionSlotPolicy({
      sessionIntent: "lower",
      slotId: "lower_b",
      slotSequence,
    }).currentSession;

    expect(lowerB).not.toBeNull();
    if (!lowerB) {
      return;
    }

    expect(getFutureSlotOpportunityBias("Hamstrings", lowerB)).toBeGreaterThan(1);
    expect(getFutureSlotOpportunityBias("Quads", lowerB)).toBe(1);
  });
});
