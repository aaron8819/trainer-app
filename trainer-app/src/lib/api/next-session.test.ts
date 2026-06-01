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
  const upperLowerSlotSequence = {
    version: 1,
    source: "handoff_draft",
    sequenceMode: "ordered_flexible",
    slots: [
      { slotId: "upper_a", intent: "UPPER" },
      { slotId: "lower_a", intent: "LOWER" },
      { slotId: "upper_b", intent: "UPPER" },
      { slotId: "lower_b", intent: "LOWER" },
    ],
  };

  function seedBackedMetadata(input: {
    mesocycleId: string;
    slotId: string;
    intent: string;
    sequenceIndex: number;
  }) {
    return {
      sessionDecisionReceipt: {
        version: 1,
        cycleContext: {
          weekInMeso: 1,
          weekInBlock: 1,
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
        sessionSlot: {
          slotId: input.slotId,
          intent: input.intent,
          sequenceIndex: input.sequenceIndex,
          sequenceLength: 4,
          source: "mesocycle_slot_sequence",
        },
        sessionProvenance: {
          mesocycleId: input.mesocycleId,
          compositionSource: "persisted_slot_plan_seed",
        },
      },
    };
  }

  function slotPlanSeedJson() {
    return {
      version: 1,
      source: "v2_materialized_seed",
      slots: [
        {
          slotId: "upper_a",
          exercises: [{ exerciseId: "bench", role: "CORE_COMPOUND", setCount: 4 }],
        },
        {
          slotId: "lower_a",
          exercises: [
            { exerciseId: "squat", role: "CORE_COMPOUND", setCount: 4 },
            { exerciseId: "leg-extension", role: "ACCESSORY", setCount: 2 },
          ],
        },
        {
          slotId: "upper_b",
          exercises: [{ exerciseId: "row", role: "CORE_COMPOUND", setCount: 3 }],
        },
        {
          slotId: "lower_b",
          exercises: [{ exerciseId: "leg-curl", role: "ACCESSORY", setCount: 2 }],
        },
      ],
    };
  }

  const lowerAPlannedExercises = [
    { exerciseId: "squat", setCount: 4 },
    { exerciseId: "leg-extension", setCount: 2 },
  ];

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
    expect(context.selectedIncompleteReadiness).toMatchObject({
      classification: "in_progress_workout",
      safeToTrain: true,
      action: "resume_logging",
    });
  });

  it("classifies a planned workout matching the next seeded slot as ready to start logging", () => {
    const mesocycleId = "meso-next";
    const context = resolveNextWorkoutContext({
      mesocycle: {
        ...baseMeso,
        id: mesocycleId,
        sessionsPerWeek: 4,
        accumulationSessionsCompleted: 1,
        slotSequenceJson: upperLowerSlotSequence,
        slotPlanSeedJson: slotPlanSeedJson(),
      },
      weeklySchedule: ["UPPER", "LOWER", "UPPER", "LOWER"],
      incompleteWorkouts: [
        {
          id: "planned-lower-a",
          status: "PLANNED",
          scheduledDate: new Date("2026-06-01T02:33:43.391Z"),
          sessionIntent: "lower",
          mesocycleId,
          mesocycleWeekSnapshot: 1,
          mesoSessionSnapshot: 2,
          performedSetLogCount: 0,
          totalSetLogCount: 0,
          plannedExercises: lowerAPlannedExercises,
          selectionMetadata: seedBackedMetadata({
            mesocycleId,
            slotId: "lower_a",
            intent: "lower",
            sequenceIndex: 1,
          }),
        },
      ],
      performedAdvancingSlotIdsThisWeek: ["upper_a"],
      performedAdvancingIntentsThisWeek: ["upper"],
    });

    expect(context.source).toBe("existing_incomplete");
    expect(context.existingWorkoutId).toBe("planned-lower-a");
    expect(context.slotId).toBe("lower_a");
    expect(context.intent).toBe("lower");
    expect(context.selectedIncompleteReadiness).toEqual({
      classification: "matching_next_planned_workout",
      safeToTrain: true,
      action: "start_logging",
      reason:
        "Planned workout matches the next expected seeded slot, exercise order, and set counts; start or resume logging it.",
    });
    expect(context.derivationTrace).toContain(
      "selected_incomplete_readiness=matching_next_planned_workout"
    );
  });

  it("classifies a stale planned workout for an old week as an unsafe blocker", () => {
    const mesocycleId = "meso-next";
    const context = resolveNextWorkoutContext({
      mesocycle: {
        ...baseMeso,
        id: mesocycleId,
        sessionsPerWeek: 4,
        accumulationSessionsCompleted: 5,
        slotSequenceJson: upperLowerSlotSequence,
        slotPlanSeedJson: slotPlanSeedJson(),
      },
      weeklySchedule: ["UPPER", "LOWER", "UPPER", "LOWER"],
      incompleteWorkouts: [
        {
          id: "stale-lower-a",
          status: "PLANNED",
          scheduledDate: new Date("2026-05-25T02:33:43.391Z"),
          sessionIntent: "lower",
          mesocycleId,
          mesocycleWeekSnapshot: 1,
          mesoSessionSnapshot: 2,
          performedSetLogCount: 0,
          totalSetLogCount: 0,
          plannedExercises: lowerAPlannedExercises,
          selectionMetadata: seedBackedMetadata({
            mesocycleId,
            slotId: "lower_a",
            intent: "lower",
            sequenceIndex: 1,
          }),
        },
      ],
      performedAdvancingSlotIdsThisWeek: ["upper_a"],
      performedAdvancingIntentsThisWeek: ["upper"],
    });

    expect(context.selectedIncompleteReadiness).toMatchObject({
      classification: "stale_or_mismatched_incomplete_workout",
      safeToTrain: false,
      action: "block_or_cleanup",
    });
  });

  it("classifies a mismatched planned slot as an unsafe blocker", () => {
    const mesocycleId = "meso-next";
    const context = resolveNextWorkoutContext({
      mesocycle: {
        ...baseMeso,
        id: mesocycleId,
        sessionsPerWeek: 4,
        accumulationSessionsCompleted: 1,
        slotSequenceJson: upperLowerSlotSequence,
        slotPlanSeedJson: slotPlanSeedJson(),
      },
      weeklySchedule: ["UPPER", "LOWER", "UPPER", "LOWER"],
      incompleteWorkouts: [
        {
          id: "planned-upper-b",
          status: "PLANNED",
          scheduledDate: new Date("2026-06-01T02:33:43.391Z"),
          sessionIntent: "upper",
          mesocycleId,
          mesocycleWeekSnapshot: 1,
          mesoSessionSnapshot: 3,
          performedSetLogCount: 0,
          totalSetLogCount: 0,
          plannedExercises: [{ exerciseId: "row", setCount: 3 }],
          selectionMetadata: seedBackedMetadata({
            mesocycleId,
            slotId: "upper_b",
            intent: "upper",
            sequenceIndex: 2,
          }),
        },
      ],
      performedAdvancingSlotIdsThisWeek: ["upper_a"],
      performedAdvancingIntentsThisWeek: ["upper"],
    });

    expect(context.intent).toBe("upper");
    expect(context.slotId).toBe("upper_b");
    expect(context.selectedIncompleteReadiness).toMatchObject({
      classification: "stale_or_mismatched_incomplete_workout",
      safeToTrain: false,
    });
  });

  it("classifies a same-session planned workout with the wrong slot as an unsafe blocker", () => {
    const mesocycleId = "meso-next";
    const context = resolveNextWorkoutContext({
      mesocycle: {
        ...baseMeso,
        id: mesocycleId,
        sessionsPerWeek: 4,
        accumulationSessionsCompleted: 1,
        slotSequenceJson: upperLowerSlotSequence,
        slotPlanSeedJson: slotPlanSeedJson(),
      },
      weeklySchedule: ["UPPER", "LOWER", "UPPER", "LOWER"],
      incompleteWorkouts: [
        {
          id: "planned-wrong-slot",
          status: "PLANNED",
          scheduledDate: new Date("2026-06-01T02:33:43.391Z"),
          sessionIntent: "upper",
          mesocycleId,
          mesocycleWeekSnapshot: 1,
          mesoSessionSnapshot: 2,
          performedSetLogCount: 0,
          totalSetLogCount: 0,
          plannedExercises: [{ exerciseId: "row", setCount: 3 }],
          selectionMetadata: seedBackedMetadata({
            mesocycleId,
            slotId: "upper_b",
            intent: "upper",
            sequenceIndex: 2,
          }),
        },
      ],
      performedAdvancingSlotIdsThisWeek: ["upper_a"],
      performedAdvancingIntentsThisWeek: ["upper"],
    });

    expect(context.selectedIncompleteReadiness).toMatchObject({
      classification: "stale_or_mismatched_incomplete_workout",
      safeToTrain: false,
    });
  });

  it("classifies a planned workout with edited seed exercises as an unsafe blocker", () => {
    const mesocycleId = "meso-next";
    const context = resolveNextWorkoutContext({
      mesocycle: {
        ...baseMeso,
        id: mesocycleId,
        sessionsPerWeek: 4,
        accumulationSessionsCompleted: 1,
        slotSequenceJson: upperLowerSlotSequence,
        slotPlanSeedJson: slotPlanSeedJson(),
      },
      weeklySchedule: ["UPPER", "LOWER", "UPPER", "LOWER"],
      incompleteWorkouts: [
        {
          id: "planned-lower-a-edited",
          status: "PLANNED",
          scheduledDate: new Date("2026-06-01T02:33:43.391Z"),
          sessionIntent: "lower",
          mesocycleId,
          mesocycleWeekSnapshot: 1,
          mesoSessionSnapshot: 2,
          performedSetLogCount: 0,
          totalSetLogCount: 0,
          plannedExercises: [{ exerciseId: "squat", setCount: 4 }],
          selectionMetadata: seedBackedMetadata({
            mesocycleId,
            slotId: "lower_a",
            intent: "lower",
            sequenceIndex: 1,
          }),
        },
      ],
      performedAdvancingSlotIdsThisWeek: ["upper_a"],
      performedAdvancingIntentsThisWeek: ["upper"],
    });

    expect(context.selectedIncompleteReadiness).toMatchObject({
      classification: "stale_or_mismatched_incomplete_workout",
      safeToTrain: false,
    });
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

  it("blocks standard accumulation when the final accumulation threshold has a pending week-close", () => {
    const context = resolveNextWorkoutContext({
      mesocycle: {
        ...baseMeso,
        id: "meso-final",
        sessionsPerWeek: 4,
        accumulationSessionsCompleted: 16,
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
      pendingWeekClose: {
        id: "week-close-4",
        targetWeek: 4,
        status: "PENDING_OPTIONAL_GAP_FILL",
      },
    });

    expect(context.source).toBe("final_week_close_pending");
    expect(context.intent).toBeNull();
    expect(context.slotId).toBeNull();
    expect(context.lifecycleBlocker).toMatchObject({
      code: "FINAL_ACCUMULATION_WEEK_CLOSE_PENDING",
      severity: "hard_blocker",
      mesocycleId: "meso-final",
      weekCloseId: "week-close-4",
      targetWeek: 4,
    });
    expect(context.lifecycleBlocker?.message).toContain("Week 4 closeout is pending");
    expect(context.lifecycleBlocker?.message).toContain("Week 5 deload");
    expect(context.derivationTrace).toContain(
      "final_accumulation_week_close_pending week_close=week-close-4 target_week=4"
    );
  });

  it("allows deload routing once the final closeout is resolved and lifecycle state advances", () => {
    const context = resolveNextWorkoutContext({
      mesocycle: {
        ...baseMeso,
        state: "ACTIVE_DELOAD",
        sessionsPerWeek: 4,
        accumulationSessionsCompleted: 16,
        deloadSessionsCompleted: 0,
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
    });

    expect(context.source).toBe("rotation");
    expect(context.intent).toBe("upper");
    expect(context.slotId).toBe("upper_a");
    expect(context.weekInMeso).toBe(5);
    expect(context.sessionInWeek).toBe(1);
    expect(context.lifecycleBlocker).toBeUndefined();
  });

  it("keeps normal accumulation routing below the final accumulation threshold", () => {
    const context = resolveNextWorkoutContext({
      mesocycle: {
        ...baseMeso,
        sessionsPerWeek: 4,
        accumulationSessionsCompleted: 15,
      },
      weeklySchedule: ["UPPER", "LOWER", "UPPER", "LOWER"],
      incompleteWorkouts: [],
      pendingWeekClose: {
        id: "week-close-4",
        targetWeek: 4,
        status: "PENDING_OPTIONAL_GAP_FILL",
      },
    });

    expect(context.source).toBe("rotation");
    expect(context.intent).toBe("lower");
    expect(context.weekInMeso).toBe(4);
    expect(context.sessionInWeek).toBe(4);
  });

  it("does not treat a pending non-final week-close as the final lifecycle blocker", () => {
    const context = resolveNextWorkoutContext({
      mesocycle: {
        ...baseMeso,
        sessionsPerWeek: 4,
        accumulationSessionsCompleted: 8,
      },
      weeklySchedule: ["UPPER", "LOWER", "UPPER", "LOWER"],
      incompleteWorkouts: [],
      pendingWeekClose: {
        id: "week-close-2",
        targetWeek: 2,
        status: "PENDING_OPTIONAL_GAP_FILL",
      },
    });

    expect(context.source).toBe("rotation");
    expect(context.intent).toBe("upper");
    expect(context.weekInMeso).toBe(3);
    expect(context.sessionInWeek).toBe(1);
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
