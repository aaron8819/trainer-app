import { describe, expect, it } from "vitest";
import {
  buildRemainingFutureSlotsFromRuntime,
  deriveNextRuntimeSlotSession,
  readRuntimeSlotSequence,
} from "./mesocycle-slot-runtime";

describe("mesocycle-slot-runtime", () => {
  it("treats slotSequenceJson as authoritative whenever a persisted sequence is present", () => {
    const slotSequence = readRuntimeSlotSequence({
      slotSequenceJson: {
        version: 1,
        source: "handoff_draft",
        sequenceMode: "ordered_flexible",
        slots: [
          { slotId: "upper_a", intent: "UPPER" },
          { slotId: "lower_a", intent: "LOWER" },
        ],
      },
      weeklySchedule: ["PUSH", "PULL"],
    });

    expect(slotSequence).toEqual({
      slots: [
        { slotId: "upper_a", intent: "upper", sequenceIndex: 0 },
        { slotId: "lower_a", intent: "lower", sequenceIndex: 1 },
      ],
      source: "mesocycle_slot_sequence",
      hasPersistedSequence: true,
    });
  });

  it("falls back to weeklySchedule only when the persisted slot sequence is unreadable", () => {
    const slotSequence = readRuntimeSlotSequence({
      slotSequenceJson: {
        version: 1,
        source: "handoff_draft",
        sequenceMode: "ordered_flexible",
        slots: [{ slotId: "", intent: "" }],
      },
      weeklySchedule: ["PULL", "PUSH", "LEGS"],
    });

    expect(slotSequence).toEqual({
      slots: [
        { slotId: "pull_a", intent: "pull", sequenceIndex: 0 },
        { slotId: "push_a", intent: "push", sequenceIndex: 1 },
        { slotId: "legs_a", intent: "legs", sequenceIndex: 2 },
      ],
      source: "legacy_weekly_schedule",
      hasPersistedSequence: false,
    });
  });

  it("derives the next duplicate-intent slot from persisted slot ids instead of the weeklySchedule mirror", () => {
    const next = deriveNextRuntimeSlotSession({
      mesocycle: {
        state: "ACTIVE_ACCUMULATION",
        accumulationSessionsCompleted: 10,
        deloadSessionsCompleted: 0,
        sessionsPerWeek: 4,
        durationWeeks: 5,
      },
      slotSequenceJson: {
        version: 1,
        source: "handoff_draft",
        sequenceMode: "ordered_flexible",
        slots: [
          { slotId: "upper_a", intent: "UPPER" },
          { slotId: "lower_a", intent: "LOWER" },
          { slotId: "upper_b", intent: "UPPER" },
          { slotId: "lower_b", intent: "LOWER" },
        ],
      },
      weeklySchedule: ["LOWER", "UPPER", "LOWER", "UPPER"],
      performedAdvancingSlotIdsThisWeek: ["upper_a", "lower_a"],
      performedAdvancingIntentsThisWeek: ["upper", "lower"],
    });

    expect(next.intent).toBe("upper");
    expect(next.slotId).toBe("upper_b");
    expect(next.slotSequenceIndex).toBe(2);
    expect(next.slotSource).toBe("mesocycle_slot_sequence");
  });

  it("removes future slots by slot identity before falling back to intent matching", () => {
    const remaining = buildRemainingFutureSlotsFromRuntime({
      slotSequenceJson: {
        version: 1,
        source: "handoff_draft",
        sequenceMode: "ordered_flexible",
        slots: [
          { slotId: "upper_a", intent: "UPPER" },
          { slotId: "lower_a", intent: "LOWER" },
          { slotId: "upper_b", intent: "UPPER" },
        ],
      },
      weeklySchedule: ["UPPER", "LOWER", "UPPER"],
      performedAdvancingSlotsThisWeek: [{ slotId: "upper_a", intent: "upper" }],
      currentSlotId: "lower_a",
      currentIntent: "lower",
    });

    expect(remaining).toEqual([{ slotId: "upper_b", intent: "upper", sequenceIndex: 2 }]);
  });
});
