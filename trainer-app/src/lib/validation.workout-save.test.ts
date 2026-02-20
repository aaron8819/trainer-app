/**
 * Protects: Save API is action-based (save_plan / mark_completed / mark_partial / mark_skipped), with backward inference that cannot bypass gating.
 * Why it matters: API payload validation must enforce the action/status contract before persistence logic runs.
 */
import { describe, expect, it } from "vitest";
import { saveWorkoutSchema } from "./validation";

describe("saveWorkoutSchema", () => {
  it("accepts action commands and PARTIAL status", () => {
    const parsed = saveWorkoutSchema.parse({
      workoutId: "workout-2",
      status: "PARTIAL",
      action: "mark_partial",
      expectedRevision: 2,
    });

    expect(parsed.status).toBe("PARTIAL");
    expect(parsed.action).toBe("mark_partial");
    expect(parsed.expectedRevision).toBe(2);
  });

  it("accepts optional targetRepRange on sets", () => {
    const parsed = saveWorkoutSchema.parse({
      workoutId: "workout-1",
      exercises: [
        {
          section: "MAIN",
          exerciseId: "exercise-1",
          sets: [{ setIndex: 1, targetReps: 10, targetRepRange: { min: 10, max: 15 } }],
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
          section: "MAIN",
          exerciseId: "exercise-1",
          sets: [{ setIndex: 1, targetReps: 10, targetRepRange: { min: 15, max: 10 } }],
        },
      ],
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects workouts missing exercise section", () => {
    const parsed = saveWorkoutSchema.safeParse({
      workoutId: "workout-1",
      exercises: [
        {
          exerciseId: "exercise-1",
          sets: [{ setIndex: 1, targetReps: 8 }],
        },
      ],
    });

    expect(parsed.success).toBe(false);
  });
});
