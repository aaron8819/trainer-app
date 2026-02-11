import { describe, expect, it } from "vitest";
import { computeNextLoad } from "./progression";

describe("computeNextLoad progression models", () => {
  it("uses linear progression for beginners", () => {
    const nextUpper = computeNextLoad(
      [{ reps: 8, rpe: 7, load: 135 }],
      [6, 10],
      8,
      undefined,
      { trainingAge: "beginner", isUpperBody: true }
    );
    const nextLower = computeNextLoad(
      [{ reps: 8, rpe: 7, load: 225 }],
      [6, 10],
      8,
      undefined,
      { trainingAge: "beginner", isUpperBody: false }
    );

    expect(nextUpper).toBe(137.5);
    expect(nextLower).toBe(230);
  });

  it("switches stalled beginners to double progression behavior", () => {
    const next = computeNextLoad(
      [
        { reps: 8, rpe: 8, load: 100 },
        { reps: 8, rpe: 8, load: 100 },
      ],
      [8, 12],
      8,
      undefined,
      {
        trainingAge: "beginner",
        recentSessions: [
          [
            { reps: 8, rpe: 8, load: 100 },
            { reps: 8, rpe: 8, load: 100 },
          ],
          [
            { reps: 8, rpe: 8, load: 100 },
            { reps: 8, rpe: 8, load: 100 },
          ],
        ],
      }
    );

    expect(next).toBe(100);
  });

  it("uses double progression for intermediates and increases only at rep ceiling", () => {
    const next = computeNextLoad(
      [
        { reps: 12, rpe: 8, load: 100 },
        { reps: 12, rpe: 8, load: 100 },
      ],
      [8, 12],
      8,
      undefined,
      { trainingAge: "intermediate" }
    );

    expect(next).toBe(102.5);
  });

  it("flags intermediate regression with a deload load reduction", () => {
    const next = computeNextLoad(
      [
        { reps: 8, rpe: 8, load: 100 },
        { reps: 8, rpe: 8, load: 100 },
      ],
      [8, 12],
      8,
      undefined,
      {
        trainingAge: "intermediate",
        recentSessions: [
          [
            { reps: 9, rpe: 8, load: 100 },
            { reps: 9, rpe: 8, load: 100 },
          ],
          [
            { reps: 10, rpe: 8, load: 100 },
            { reps: 10, rpe: 8, load: 100 },
          ],
        ],
      }
    );

    expect(next).toBe(94);
  });

  it("uses periodized progression for advanced lifters", () => {
    const weekThree = computeNextLoad(
      [{ reps: 6, rpe: 8.5, load: 200 }],
      [3, 6],
      8.5,
      undefined,
      {
        trainingAge: "advanced",
        weekInBlock: 2,
      }
    );
    const deload = computeNextLoad(
      [{ reps: 6, rpe: 8.5, load: 200 }],
      [3, 6],
      8.5,
      undefined,
      {
        trainingAge: "advanced",
        weekInBlock: 3,
        isDeloadWeek: true,
        backOffMultiplier: 0.75,
      }
    );

    expect(weekThree).toBe(204);
    expect(deload).toBe(150);
  });
});
