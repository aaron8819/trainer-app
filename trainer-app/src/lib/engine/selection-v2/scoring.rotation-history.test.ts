import { describe, expect, it } from "vitest";
import { scoreRotationNovelty } from "./scoring";
import { createMockExercise } from "./test-utils";

describe("rotation novelty stable identity", () => {
  it("keeps freshness after an exercise rename", () => {
    const exercise = createMockExercise("exercise-a", [], [], {
      name: "Renamed Cable Curl",
    });
    const context = new Map([
      [
        "exercise-a",
        {
          lastUsed: new Date("2026-07-14T00:00:00.000Z"),
          weeksAgo: 0,
        },
      ],
    ]);

    expect(scoreRotationNovelty(exercise, context)).toBe(0);
  });

  it("does not merge similar-name variants", () => {
    const first = createMockExercise("machine-a", [], [], {
      name: "Machine Chest Press",
    });
    const second = createMockExercise("machine-b", [], [], {
      name: "Machine Chest Press (Alternate)",
    });
    const context = new Map([
      [
        "machine-a",
        {
          lastUsed: new Date("2026-07-14T00:00:00.000Z"),
          weeksAgo: 0,
        },
      ],
    ]);

    expect(scoreRotationNovelty(first, context)).toBe(0);
    expect(scoreRotationNovelty(second, context)).toBe(1);
  });
});
