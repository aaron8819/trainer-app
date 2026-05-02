import { describe, expect, it } from "vitest";

import { listWorkoutPlanExercisesInOrder } from "./workout-plan-order";

describe("listWorkoutPlanExercisesInOrder", () => {
  it("preserves interleaved Lower B seed order across main and accessory sections", () => {
    const ordered = listWorkoutPlanExercisesInOrder({
      warmup: [],
      mainLifts: [
        { id: "sldl-row", orderIndex: 0, exerciseId: "sldl" },
        { id: "split-squat-row", orderIndex: 2, exerciseId: "split-squat" },
      ],
      accessories: [
        { id: "leg-curl-row", orderIndex: 1, exerciseId: "leg-curl" },
        { id: "calf-row", orderIndex: 3, exerciseId: "calf-raise" },
      ],
    });

    expect(ordered.map(({ section, exercise }) => ({
      section,
      exerciseId: exercise.exerciseId,
    }))).toEqual([
      { section: "main", exerciseId: "sldl" },
      { section: "accessory", exerciseId: "leg-curl" },
      { section: "main", exerciseId: "split-squat" },
      { section: "accessory", exerciseId: "calf-raise" },
    ]);
  });
});
