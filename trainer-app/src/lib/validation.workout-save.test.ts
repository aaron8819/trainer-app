import { describe, expect, it } from "vitest";
import { saveWorkoutSchema } from "./validation";

describe("saveWorkoutSchema", () => {
  it("accepts optional targetRepRange on sets", () => {
    const parsed = saveWorkoutSchema.parse({
      workoutId: "workout-1",
      exercises: [
        {
          exerciseId: "exercise-1",
          sets: [
            {
              setIndex: 1,
              targetReps: 10,
              targetRepRange: { min: 10, max: 15 },
            },
          ],
        },
      ],
    });

    expect(parsed.exercises?.[0].sets[0].targetRepRange).toEqual({ min: 10, max: 15 });
  });

  it("rejects invalid targetRepRange bounds", () => {
    const parsed = saveWorkoutSchema.safeParse({
      workoutId: "workout-1",
      exercises: [
        {
          exerciseId: "exercise-1",
          sets: [
            {
              setIndex: 1,
              targetReps: 10,
              targetRepRange: { min: 15, max: 10 },
            },
          ],
        },
      ],
    });

    expect(parsed.success).toBe(false);
  });

  it("accepts intent persistence metadata", () => {
    const parsed = saveWorkoutSchema.parse({
      workoutId: "workout-1",
      selectionMode: "INTENT",
      sessionIntent: "BODY_PART",
      selectionMetadata: {
        selectedExerciseIds: ["curl", "preacher"],
      },
    });

    expect(parsed.selectionMode).toBe("INTENT");
    expect(parsed.sessionIntent).toBe("BODY_PART");
  });
});
