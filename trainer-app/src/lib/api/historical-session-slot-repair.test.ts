import { describe, expect, it } from "vitest";

import { buildSessionDecisionReceipt } from "@/lib/evidence/session-decision-receipt";
import { inferHistoricalSessionSlotRepair } from "./historical-session-slot-repair";

function buildSelectionMetadata(input?: {
  weekInMeso?: number;
  sessionSlot?: {
    slotId: string;
    intent: string;
    sequenceIndex: number;
    sequenceLength?: number;
    source: "mesocycle_slot_sequence" | "legacy_weekly_schedule";
  };
}) {
  return {
    sessionDecisionReceipt: buildSessionDecisionReceipt({
      cycleContext: {
        weekInMeso: input?.weekInMeso ?? 1,
        weekInBlock: input?.weekInMeso ?? 1,
        blockDurationWeeks: 4,
        mesocycleLength: 5,
        phase: "accumulation",
        blockType: "accumulation",
        isDeload: false,
        source: "computed",
      },
      sessionSlot: input?.sessionSlot,
      lifecycleVolumeTargets: { Quads: 10 },
    }),
  };
}

function buildSeededMesocycle(seedOverrides?: {
  lowerAExerciseIds?: string[];
  lowerBExerciseIds?: string[];
}) {
  const lowerAExerciseIds = seedOverrides?.lowerAExerciseIds ?? ["squat", "curl", "calf"];
  const lowerBExerciseIds = seedOverrides?.lowerBExerciseIds ?? ["rdl", "lunge", "calf"];

  return {
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
    slotPlanSeedJson: {
      version: 1,
      slots: [
        {
          slotId: "upper_a",
          exercises: [{ exerciseId: "bench", role: "CORE_COMPOUND" }],
        },
        {
          slotId: "lower_a",
          exercises: lowerAExerciseIds.map((exerciseId, index) => ({
            exerciseId,
            role: index === 0 ? "CORE_COMPOUND" : "ACCESSORY",
          })),
        },
        {
          slotId: "upper_b",
          exercises: [{ exerciseId: "press", role: "CORE_COMPOUND" }],
        },
        {
          slotId: "lower_b",
          exercises: lowerBExerciseIds.map((exerciseId, index) => ({
            exerciseId,
            role: index === 0 ? "CORE_COMPOUND" : "ACCESSORY",
          })),
        },
      ],
    },
  };
}

describe("inferHistoricalSessionSlotRepair", () => {
  it("marks a unique same-intent seeded match as repairable", () => {
    const result = inferHistoricalSessionSlotRepair({
      id: "workout-1",
      advancesSplit: true,
      selectionMode: "INTENT",
      sessionIntent: "LOWER",
      selectionMetadata: buildSelectionMetadata({ weekInMeso: 1 }),
      mesocycleWeekSnapshot: 1,
      exercises: [
        { exerciseId: "squat", orderIndex: 0 },
        { exerciseId: "curl", orderIndex: 1 },
        { exerciseId: "calf", orderIndex: 2 },
      ],
      mesocycle: buildSeededMesocycle(),
      conflictingWorkouts: [],
    });

    expect(result).toEqual({
      workoutId: "workout-1",
      candidateWeek: 1,
      matchedSlotIds: ["lower_a"],
      workoutExerciseIds: ["squat", "curl", "calf"],
      kind: "repairable",
      sessionSlot: {
        slotId: "lower_a",
        intent: "lower",
        sequenceIndex: 1,
        sequenceLength: 4,
        source: "mesocycle_slot_sequence",
      },
    });
  });

  it("skips when the same composition matches multiple seeded slots", () => {
    const result = inferHistoricalSessionSlotRepair({
      id: "workout-2",
      advancesSplit: true,
      selectionMode: "INTENT",
      sessionIntent: "LOWER",
      selectionMetadata: buildSelectionMetadata({ weekInMeso: 1 }),
      mesocycleWeekSnapshot: 1,
      exercises: [
        { exerciseId: "squat", orderIndex: 0 },
        { exerciseId: "curl", orderIndex: 1 },
        { exerciseId: "calf", orderIndex: 2 },
      ],
      mesocycle: buildSeededMesocycle({
        lowerAExerciseIds: ["squat", "curl", "calf"],
        lowerBExerciseIds: ["squat", "curl", "calf"],
      }),
      conflictingWorkouts: [],
    });

    expect(result.kind).toBe("skipped_ambiguous");
    expect(result.matchedSlotIds).toEqual(["lower_a", "lower_b"]);
  });

  it("skips when no same-intent seeded slot matches the workout composition", () => {
    const result = inferHistoricalSessionSlotRepair({
      id: "workout-3",
      advancesSplit: true,
      selectionMode: "INTENT",
      sessionIntent: "LOWER",
      selectionMetadata: buildSelectionMetadata({ weekInMeso: 1 }),
      mesocycleWeekSnapshot: 1,
      exercises: [
        { exerciseId: "split-squat", orderIndex: 0 },
        { exerciseId: "leg-curl", orderIndex: 1 },
      ],
      mesocycle: buildSeededMesocycle(),
      conflictingWorkouts: [],
    });

    expect(result.kind).toBe("skipped_no_match");
    expect(result.matchedSlotIds).toEqual([]);
  });

  it("skips when another performed workout already claims the matched slot in the same week", () => {
    const result = inferHistoricalSessionSlotRepair({
      id: "workout-4",
      advancesSplit: true,
      selectionMode: "INTENT",
      sessionIntent: "LOWER",
      selectionMetadata: buildSelectionMetadata({ weekInMeso: 1 }),
      mesocycleWeekSnapshot: 1,
      exercises: [
        { exerciseId: "squat", orderIndex: 0 },
        { exerciseId: "curl", orderIndex: 1 },
        { exerciseId: "calf", orderIndex: 2 },
      ],
      mesocycle: buildSeededMesocycle(),
      conflictingWorkouts: [
        {
          id: "completed-lower-a",
          advancesSplit: true,
          selectionMode: "INTENT",
          sessionIntent: "LOWER",
          mesocycleWeekSnapshot: 1,
          selectionMetadata: buildSelectionMetadata({
            weekInMeso: 1,
            sessionSlot: {
              slotId: "lower_a",
              intent: "lower",
              sequenceIndex: 1,
              sequenceLength: 4,
              source: "mesocycle_slot_sequence",
            },
          }),
        },
      ],
    });

    expect(result.kind).toBe("skipped_conflict");
    if (result.kind === "skipped_conflict") {
      expect(result.matchedSlotIds).toEqual(["lower_a"]);
      expect(result.conflictingWorkoutIds).toEqual(["completed-lower-a"]);
    }
  });
});
