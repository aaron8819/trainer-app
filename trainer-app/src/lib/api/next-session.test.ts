import { describe, expect, it } from "vitest";
import {
  resolveNextWorkoutContext,
  resolveRequestedAdvancingSlotSnapshot,
} from "./next-session";

describe("resolveNextWorkoutContext", () => {
  const baseMeso = {
    durationWeeks: 5,
    accumulationSessionsCompleted: 7,
    deloadSessionsCompleted: 0,
    sessionsPerWeek: 3,
    state: "ACTIVE_ACCUMULATION" as const,
    slotSequenceJson: null,
  };

  it("prefers the highest-priority incomplete workout over rotation intent", () => {
    const context = resolveNextWorkoutContext({
      mesocycle: baseMeso,
      weeklySchedule: ["PUSH", "PULL", "LEGS"],
      incompleteWorkouts: [
        {
          id: "planned-early",
          status: "PLANNED",
          scheduledDate: new Date("2026-03-01T00:00:00.000Z"),
          sessionIntent: "legs",
        },
        {
          id: "in-progress-later",
          status: "IN_PROGRESS",
          scheduledDate: new Date("2026-03-02T00:00:00.000Z"),
          sessionIntent: "push",
        },
      ],
    });

    expect(context.source).toBe("existing_incomplete");
    expect(context.isExisting).toBe(true);
    expect(context.existingWorkoutId).toBe("in-progress-later");
    expect(context.intent).toBe("push");
    expect(context.slotId).toBeNull();
    expect(context.weekInMeso).toBeNull();
    expect(context.sessionInWeek).toBeNull();
  });

  it("ignores closeout workouts when selecting the next canonical incomplete session", () => {
    const context = resolveNextWorkoutContext({
      mesocycle: baseMeso,
      weeklySchedule: ["PUSH", "PULL", "LEGS"],
      incompleteWorkouts: [
        {
          id: "closeout-planned",
          status: "PLANNED",
          scheduledDate: new Date("2026-03-01T00:00:00.000Z"),
          sessionIntent: null,
          selectionMetadata: {
            sessionDecisionReceipt: {
              version: 1,
              cycleContext: {
                weekInMeso: 3,
                weekInBlock: 3,
                phase: "accumulation",
                blockType: "accumulation",
                isDeload: false,
                source: "computed",
              },
              lifecycleVolume: { source: "unknown" },
              sorenessSuppressedMuscles: [],
              deloadDecision: {
                mode: "none",
                reason: [],
                reductionPercent: 0,
                appliedTo: "none",
              },
              readiness: {
                wasAutoregulated: false,
                signalAgeHours: null,
                fatigueScoreOverall: null,
                intensityScaling: {
                  applied: false,
                  exerciseIds: [],
                  scaledUpCount: 0,
                  scaledDownCount: 0,
                },
              },
              exceptions: [{ code: "closeout_session", message: "Marked as closeout session." }],
            },
          },
        },
        {
          id: "push-planned",
          status: "PLANNED",
          scheduledDate: new Date("2026-03-02T00:00:00.000Z"),
          sessionIntent: "push",
        },
      ],
    });

    expect(context.source).toBe("existing_incomplete");
    expect(context.existingWorkoutId).toBe("push-planned");
    expect(context.intent).toBe("push");
  });

  it("falls back to rotation when the only incomplete workout is a dismissed closeout", () => {
    const context = resolveNextWorkoutContext({
      mesocycle: baseMeso,
      weeklySchedule: ["PUSH", "PULL", "LEGS"],
      incompleteWorkouts: [
        {
          id: "closeout-planned",
          status: "PLANNED",
          scheduledDate: new Date("2026-03-01T00:00:00.000Z"),
          sessionIntent: null,
          selectionMetadata: {
            closeoutDismissed: true,
            sessionDecisionReceipt: {
              version: 1,
              cycleContext: {
                weekInMeso: 3,
                weekInBlock: 3,
                phase: "accumulation",
                blockType: "accumulation",
                isDeload: false,
                source: "computed",
              },
              lifecycleVolume: { source: "unknown" },
              sorenessSuppressedMuscles: [],
              deloadDecision: {
                mode: "none",
                reason: [],
                reductionPercent: 0,
                appliedTo: "none",
              },
              readiness: {
                wasAutoregulated: false,
                signalAgeHours: null,
                fatigueScoreOverall: null,
                intensityScaling: {
                  applied: false,
                  exerciseIds: [],
                  scaledUpCount: 0,
                  scaledDownCount: 0,
                },
              },
              exceptions: [{ code: "closeout_session", message: "Marked as closeout session." }],
            },
          },
        },
      ],
    });

    expect(context.source).toBe("rotation");
    expect(context.existingWorkoutId).toBeNull();
    expect(context.intent).toBe("pull");
  });

  it("falls back to rotation when no incomplete workout exists", () => {
    const context = resolveNextWorkoutContext({
      mesocycle: baseMeso,
      weeklySchedule: ["PUSH", "PULL", "LEGS"],
      incompleteWorkouts: [],
    });

    expect(context.source).toBe("rotation");
    expect(context.isExisting).toBe(false);
    expect(context.existingWorkoutId).toBeNull();
    expect(context.intent).toBe("pull");
    expect(context.slotId).toBe("pull_a");
    expect(context.weekInMeso).toBe(3);
    expect(context.sessionInWeek).toBe(2);
  });

  it("falls back to first schedule entry when mesocycle is unavailable", () => {
    const context = resolveNextWorkoutContext({
      mesocycle: null,
      weeklySchedule: ["UPPER", "LOWER"],
      incompleteWorkouts: [],
    });

    expect(context.source).toBe("rotation");
    expect(context.intent).toBe("upper");
    expect(context.slotId).toBeNull();
    expect(context.weekInMeso).toBeNull();
    expect(context.sessionInWeek).toBeNull();
  });

  it("derives deterministic rotation context for identical lifecycle counters", () => {
    const input = {
      mesocycle: baseMeso,
      weeklySchedule: ["PUSH", "PULL", "LEGS"],
      incompleteWorkouts: [],
    };

    const first = resolveNextWorkoutContext(input);
    const second = resolveNextWorkoutContext(input);

    expect(first).toEqual(second);
    expect(first.intent).toBe("pull");
    expect(first.slotId).toBe("pull_a");
    expect(first.weekInMeso).toBe(3);
    expect(first.sessionInWeek).toBe(2);
  });

  it("derives next push after performed advancing intents [pull]", () => {
    const context = resolveNextWorkoutContext({
      mesocycle: {
        ...baseMeso,
        accumulationSessionsCompleted: 7,
      },
      weeklySchedule: ["PULL", "PUSH", "LEGS"],
      incompleteWorkouts: [],
      performedAdvancingIntentsThisWeek: ["pull"],
    });

    expect(context.source).toBe("rotation");
    expect(context.intent).toBe("push");
    expect(context.slotId).toBe("push_a");
    expect(context.weekInMeso).toBe(3);
    expect(context.sessionInWeek).toBe(2);
  });

  it("derives next legs after performed advancing intents [pull, push]", () => {
    const context = resolveNextWorkoutContext({
      mesocycle: {
        ...baseMeso,
        accumulationSessionsCompleted: 8,
      },
      weeklySchedule: ["PULL", "PUSH", "LEGS"],
      incompleteWorkouts: [],
      performedAdvancingIntentsThisWeek: ["pull", "push"],
    });

    expect(context.intent).toBe("legs");
    expect(context.slotId).toBe("legs_a");
    expect(context.weekInMeso).toBe(3);
    expect(context.sessionInWeek).toBe(3);
  });

  it("derives next push after off-order performed advancing intents [pull, legs]", () => {
    const context = resolveNextWorkoutContext({
      mesocycle: {
        ...baseMeso,
        accumulationSessionsCompleted: 8,
      },
      weeklySchedule: ["PULL", "PUSH", "LEGS"],
      incompleteWorkouts: [],
      performedAdvancingIntentsThisWeek: ["pull", "legs"],
    });

    expect(context.intent).toBe("push");
    expect(context.slotId).toBe("push_a");
    expect(context.weekInMeso).toBe(3);
    expect(context.sessionInWeek).toBe(3);
  });

  it("derives next push after off-order performed advancing intents [legs, pull]", () => {
    const context = resolveNextWorkoutContext({
      mesocycle: {
        ...baseMeso,
        accumulationSessionsCompleted: 8,
      },
      weeklySchedule: ["PULL", "PUSH", "LEGS"],
      incompleteWorkouts: [],
      performedAdvancingIntentsThisWeek: ["legs", "pull"],
    });

    expect(context.intent).toBe("push");
    expect(context.slotId).toBe("push_a");
    expect(context.weekInMeso).toBe(3);
    expect(context.sessionInWeek).toBe(3);
  });

  it("keeps next push after [pull] when a non-advancing gap-fill does not enter performed advancing intents", () => {
    const context = resolveNextWorkoutContext({
      mesocycle: {
        ...baseMeso,
        accumulationSessionsCompleted: 7,
      },
      weeklySchedule: ["PULL", "PUSH", "LEGS"],
      incompleteWorkouts: [],
      performedAdvancingIntentsThisWeek: ["pull"],
    });

    expect(context.intent).toBe("push");
  });

  it("uses persisted slot ids to disambiguate duplicate-intent sequences", () => {
    const context = resolveNextWorkoutContext({
      mesocycle: {
        ...baseMeso,
        sessionsPerWeek: 4,
        accumulationSessionsCompleted: 10,
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
      },
      weeklySchedule: ["UPPER", "LOWER", "UPPER", "LOWER"],
      incompleteWorkouts: [],
      performedAdvancingIntentsThisWeek: ["upper", "lower"],
      performedAdvancingSlotIdsThisWeek: ["upper_a", "lower_a"],
    });

    expect(context.intent).toBe("upper");
    expect(context.slotId).toBe("upper_b");
    expect(context.slotSequenceIndex).toBe(2);
    expect(context.weekInMeso).toBe(3);
    expect(context.sessionInWeek).toBe(3);
  });

  it("falls back to canonical session index when persisted slot ids are missing", () => {
    const context = resolveNextWorkoutContext({
      mesocycle: {
        ...baseMeso,
        sessionsPerWeek: 4,
        accumulationSessionsCompleted: 10,
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
      },
      weeklySchedule: ["UPPER", "LOWER", "UPPER", "LOWER"],
      incompleteWorkouts: [],
      performedAdvancingIntentsThisWeek: ["upper", "lower"],
      performedAdvancingSlotIdsThisWeek: [],
    });

    expect(context.intent).toBe("upper");
    expect(context.slotId).toBe("upper_b");
    expect(context.slotSequenceIndex).toBe(2);
  });

  it("resolves the earliest unresolved off-order slot for the requested advancing intent", () => {
    const slot = resolveRequestedAdvancingSlotSnapshot({
      nextWorkoutSource: "rotation",
      requestedIntent: "lower",
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
      weeklySchedule: ["UPPER", "LOWER", "UPPER", "LOWER"],
      performedAdvancingSlotsThisWeek: [],
    });

    expect(slot).toEqual({
      slotId: "lower_a",
      intent: "lower",
      sequenceIndex: 1,
      sequenceLength: 4,
      source: "mesocycle_slot_sequence",
    });
  });

  it("lets downstream sequencing treat a persisted off-order slot as consumed", () => {
    const context = resolveNextWorkoutContext({
      mesocycle: {
        ...baseMeso,
        sessionsPerWeek: 4,
        accumulationSessionsCompleted: 9,
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
      },
      weeklySchedule: ["UPPER", "LOWER", "UPPER", "LOWER"],
      incompleteWorkouts: [],
      performedAdvancingIntentsThisWeek: ["lower"],
      performedAdvancingSlotIdsThisWeek: ["lower_a"],
    });

    expect(context.intent).toBe("upper");
    expect(context.slotId).toBe("upper_a");
    expect(context.slotSequenceIndex).toBe(0);
  });
});
