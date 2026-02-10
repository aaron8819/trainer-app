import { describe, expect, it } from "vitest";
import { splitExercises } from "./workout-sections";

describe("splitExercises", () => {
  it("maps persisted targetRepMin/targetRepMax back to targetRepRange", () => {
    const result = splitExercises([
      {
        id: "we-1",
        isMainLift: false,
        orderIndex: 0,
        exercise: { name: "Cable Curl" },
        sets: [
          {
            id: "set-1",
            setIndex: 1,
            targetReps: 10,
            targetRepMin: 10,
            targetRepMax: 15,
            targetLoad: null,
            targetRpe: null,
          },
        ],
      },
      {
        id: "we-2",
        isMainLift: true,
        orderIndex: 1,
        exercise: { name: "Bench Press" },
        sets: [
          {
            id: "set-2",
            setIndex: 1,
            targetReps: 6,
            targetRepMin: null,
            targetRepMax: null,
            targetLoad: null,
            targetRpe: 8,
          },
        ],
      },
    ]);

    expect(result.warmup[0].sets[0].targetRepRange).toEqual({ min: 10, max: 15 });
    expect(result.main[0].sets[0].targetRepRange).toBeUndefined();
  });
});
