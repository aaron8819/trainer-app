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

  it("uses persisted section when present instead of warmup-count heuristic", () => {
    const result = splitExercises([
      {
        id: "we-main",
        isMainLift: true,
        orderIndex: 0,
        section: "MAIN",
        exercise: { name: "Bench Press" },
        sets: [{ id: "set-main", setIndex: 1, targetReps: 5 }],
      },
      {
        id: "we-acc-1",
        isMainLift: false,
        orderIndex: 1,
        section: "ACCESSORY",
        exercise: { name: "Incline DB Press" },
        sets: [{ id: "set-acc-1", setIndex: 1, targetReps: 10 }],
      },
      {
        id: "we-acc-2",
        isMainLift: false,
        orderIndex: 2,
        section: "ACCESSORY",
        exercise: { name: "Cable Fly" },
        sets: [{ id: "set-acc-2", setIndex: 1, targetReps: 12 }],
      },
      {
        id: "we-acc-3",
        isMainLift: false,
        orderIndex: 3,
        section: "ACCESSORY",
        exercise: { name: "Tricep Pushdown" },
        sets: [{ id: "set-acc-3", setIndex: 1, targetReps: 12 }],
      },
    ]);

    expect(result.warmup).toHaveLength(0);
    expect(result.main.map((exercise) => exercise.name)).toEqual(["Bench Press"]);
    expect(result.accessory.map((exercise) => exercise.name)).toEqual([
      "Incline DB Press",
      "Cable Fly",
      "Tricep Pushdown",
    ]);
  });

  it("falls back to legacy heuristic when section is missing", () => {
    const result = splitExercises([
      {
        id: "we-main",
        isMainLift: true,
        orderIndex: 0,
        exercise: { name: "Bench Press" },
        sets: [{ id: "set-main", setIndex: 1, targetReps: 5 }],
      },
      {
        id: "we-acc-1",
        isMainLift: false,
        orderIndex: 1,
        exercise: { name: "Incline DB Press" },
        sets: [{ id: "set-acc-1", setIndex: 1, targetReps: 10 }],
      },
      {
        id: "we-acc-2",
        isMainLift: false,
        orderIndex: 2,
        exercise: { name: "Cable Fly" },
        sets: [{ id: "set-acc-2", setIndex: 1, targetReps: 12 }],
      },
      {
        id: "we-acc-3",
        isMainLift: false,
        orderIndex: 3,
        exercise: { name: "Tricep Pushdown" },
        sets: [{ id: "set-acc-3", setIndex: 1, targetReps: 12 }],
      },
    ]);

    expect(result.warmup.map((exercise) => exercise.name)).toEqual([
      "Incline DB Press",
      "Cable Fly",
    ]);
    expect(result.accessory.map((exercise) => exercise.name)).toEqual(["Tricep Pushdown"]);
  });
});
