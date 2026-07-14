import { describe, expect, it } from "vitest";
import type { WorkoutHistoryEntry } from "@/lib/engine/types";
import {
  createPrescriptionAnchorHistoryFixture,
  createPrescriptionAnchorHistoryLoader,
} from "./prescription-anchor-history-fixture";

function historyEntry(input: {
  date: string;
  exerciseId: string;
  load: number;
}): WorkoutHistoryEntry {
  return {
    date: input.date,
    completed: true,
    status: "COMPLETED",
    progressionEligible: true,
    performanceEligible: true,
    exercises: [
      {
        exerciseId: input.exerciseId,
        sets: [
          {
            exerciseId: input.exerciseId,
            setIndex: 1,
            reps: 8,
            rpe: 8,
            load: input.load,
          },
        ],
      },
    ],
  };
}

describe("prescription anchor history fixture", () => {
  it("represents requested exercises with the production no-history default", async () => {
    const loader = createPrescriptionAnchorHistoryLoader();

    await expect(loader("user-1", ["bench-press", "row"])).resolves.toEqual([]);
  });

  it("honors overrides in deterministic newest-first order", () => {
    const older = historyEntry({
      date: "2026-01-01T00:00:00.000Z",
      exerciseId: "bench-press",
      load: 100,
    });
    const newer = historyEntry({
      date: "2026-02-01T00:00:00.000Z",
      exerciseId: "row",
      load: 120,
    });

    const fixture = createPrescriptionAnchorHistoryFixture({
      exerciseIds: ["bench-press", "row"],
      overrides: [older, newer],
    });

    expect(fixture.map((entry) => entry.exercises[0]?.exerciseId)).toEqual([
      "row",
      "bench-press",
    ]);
  });

  it("fails clearly when an override references an unrequested exercise", () => {
    expect(() =>
      createPrescriptionAnchorHistoryFixture({
        exerciseIds: ["bench-press"],
        overrides: [
          historyEntry({
            date: "2026-01-01T00:00:00.000Z",
            exerciseId: "row",
            load: 120,
          }),
        ],
      })
    ).toThrow("unrequested exercise ID: row");
  });

  it("does not leak mutated result state across loader calls", async () => {
    const loader = createPrescriptionAnchorHistoryLoader([
      historyEntry({
        date: "2026-01-01T00:00:00.000Z",
        exerciseId: "bench-press",
        load: 100,
      }),
    ]);
    const first = await loader("user-1", ["bench-press"]);
    first[0]!.exercises[0]!.sets[0]!.load = 999;

    const second = await loader("user-1", ["bench-press"]);

    expect(second[0]!.exercises[0]!.sets[0]!.load).toBe(100);
  });
});
