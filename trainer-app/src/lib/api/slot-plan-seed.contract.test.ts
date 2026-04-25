import { describe, expect, it } from "vitest";

import { buildMesocycleSlotPlanSeed } from "./mesocycle-handoff-slot-plan-projection";
import { buildMesocycleSlotSequence } from "./mesocycle-slot-contract";
import { buildProgramCurrentWeekPlan } from "./program-page";

describe("slot-plan seed contract", () => {
  it("keeps projection, seed, and Program read model aligned on exercise order and setCount", () => {
    const slotSequence = buildMesocycleSlotSequence([
      { slotId: "upper_a", intent: "UPPER" },
      { slotId: "lower_a", intent: "LOWER" },
    ]);
    const projectedSlotPlans = [
      {
        slotId: "upper_a",
        intent: "UPPER" as const,
        exercises: [
          {
            exerciseId: "incline-db-bench",
            name: "Incline DB Bench",
            role: "CORE_COMPOUND" as const,
            setCount: 4,
          },
          {
            exerciseId: "tbar-row",
            name: "T-Bar Row",
            role: "ACCESSORY" as const,
            setCount: 3,
          },
        ],
      },
      {
        slotId: "lower_a",
        intent: "LOWER" as const,
        exercises: [
          {
            exerciseId: "leg-press",
            name: "Leg Press",
            role: "CORE_COMPOUND" as const,
            setCount: 5,
          },
        ],
      },
    ];

    const seed = buildMesocycleSlotPlanSeed({
      slotSequence,
      slotPlans: projectedSlotPlans,
    });
    const plan = buildProgramCurrentWeekPlan({
      week: 1,
      slotSequenceJson: slotSequence,
      slotPlanSeedJson: seed,
      seedExerciseNameById: {
        "incline-db-bench": "Incline DB Bench",
        "tbar-row": "T-Bar Row",
        "leg-press": "Leg Press",
      },
      weeklySchedule: [],
      currentWeekWorkouts: [],
      nextWorkoutContext: {
        intent: "upper",
        slotId: "upper_a",
        slotSequenceIndex: 0,
        slotSequenceLength: 2,
        slotSource: "mesocycle_slot_sequence",
        existingWorkoutId: null,
        isExisting: false,
        source: "rotation",
        weekInMeso: 1,
        sessionInWeek: 1,
        derivationTrace: [],
        selectedIncompleteStatus: null,
      },
    });

    expect(seed.slots.map((slot) => slot.slotId)).toEqual(["upper_a", "lower_a"]);
    expect(seed.slots[0]?.exercises.map(({ exerciseId, setCount }) => ({
      exerciseId,
      setCount,
    }))).toEqual([
      { exerciseId: "incline-db-bench", setCount: 4 },
      { exerciseId: "tbar-row", setCount: 3 },
    ]);
    expect(plan?.slots.map((slot) => ({
      slotId: slot.slotId,
      exercises: slot.exercises?.map(({ exerciseId, name, setCount }) => ({
        exerciseId,
        name,
        setCount,
      })),
    }))).toEqual([
      {
        slotId: "upper_a",
        exercises: [
          { exerciseId: "incline-db-bench", name: "Incline DB Bench", setCount: 4 },
          { exerciseId: "tbar-row", name: "T-Bar Row", setCount: 3 },
        ],
      },
      {
        slotId: "lower_a",
        exercises: [
          { exerciseId: "leg-press", name: "Leg Press", setCount: 5 },
        ],
      },
    ]);
  });
});
