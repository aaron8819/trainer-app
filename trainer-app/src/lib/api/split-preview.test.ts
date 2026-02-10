import { describe, expect, it } from "vitest";
import { getSplitPreview } from "./split-preview";
import type { Constraints, WorkoutHistoryEntry } from "../engine/types";

function exampleConstraints(splitType: Constraints["splitType"]): Constraints {
  return {
    splitType,
    daysPerWeek: 4,
    sessionMinutes: 60,
    availableEquipment: [],
  };
}

describe("getSplitPreview", () => {
  it("uses history-based PPL selection", () => {
    const history: WorkoutHistoryEntry[] = [
      {
        date: "2026-02-10T00:00:00.000Z",
        completed: true,
        status: "COMPLETED",
        advancesSplit: true,
        exercises: [
          {
            exerciseId: "ex-push",
            movementPattern: "push",
            primaryMuscles: ["Chest"],
            sets: [{ exerciseId: "ex-push", setIndex: 1, reps: 8 }],
          },
        ],
      },
    ];

    const preview = getSplitPreview(exampleConstraints("ppl"), history, []);
    expect(preview.nextAutoLabel).toBe("Pull");
    expect(preview.queuePreview).toContain("Pull");
  });

  it("uses split queue day index for non-PPL", () => {
    const history: WorkoutHistoryEntry[] = [
      {
        date: "2026-02-08T00:00:00.000Z",
        completed: true,
        status: "COMPLETED",
        advancesSplit: true,
        exercises: [
          {
            exerciseId: "ex-1",
            movementPattern: "push",
            sets: [{ exerciseId: "ex-1", setIndex: 1, reps: 8 }],
          },
        ],
      },
    ];

    const preview = getSplitPreview(exampleConstraints("upper_lower"), history, []);
    expect(preview.nextAutoLabel).toBe("Legs");
    expect(preview.queuePreview).toContain("Legs");
  });
});
