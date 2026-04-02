import { describe, expect, it, vi } from "vitest";
import { loadMesocycleWeekMuscleVolume } from "./weekly-volume";

describe("loadMesocycleWeekMuscleVolume", () => {
  it("derives per-exercise contribution breakdowns from the canonical weighted accounting", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "workout-1",
        exercises: [
          {
            exercise: {
              id: "row",
              name: "Barbell Row",
              aliases: [],
              exerciseMuscles: [
                { role: "PRIMARY", muscle: { name: "Upper Back" } },
                { role: "PRIMARY", muscle: { name: "Lats" } },
                { role: "SECONDARY", muscle: { name: "Biceps" } },
              ],
            },
            sets: Array.from({ length: 3 }, () => ({ logs: [{ wasSkipped: false }] })),
          },
          {
            exercise: {
              id: "pullup",
              name: "Pull-Up",
              aliases: [],
              exerciseMuscles: [
                { role: "PRIMARY", muscle: { name: "Lats" } },
                { role: "SECONDARY", muscle: { name: "Biceps" } },
                { role: "SECONDARY", muscle: { name: "Upper Back" } },
              ],
            },
            sets: Array.from({ length: 2 }, () => ({ logs: [{ wasSkipped: false }] })),
          },
          {
            exercise: {
              id: "curl",
              name: "EZ-Bar Curl",
              aliases: [],
              exerciseMuscles: [
                { role: "PRIMARY", muscle: { name: "Biceps" } },
                { role: "SECONDARY", muscle: { name: "Forearms" } },
              ],
            },
            sets: Array.from({ length: 2 }, () => ({ logs: [{ wasSkipped: false }] })),
          },
        ],
      },
    ]);

    const result = await loadMesocycleWeekMuscleVolume(
      { workout: { findMany } } as never,
      {
        userId: "user-1",
        mesocycleId: "meso-1",
        targetWeek: 1,
        weekStart: new Date("2026-03-02T00:00:00.000Z"),
        includeBreakdowns: true,
      }
    );

    expect(result.Biceps).toMatchObject({
      effectiveSets: 4.1,
      directSets: 2,
      indirectSets: 5,
    });
    expect(result.Biceps?.contributions).toEqual([
      {
        exerciseId: "curl",
        exerciseName: "EZ-Bar Curl",
        effectiveSets: 2,
        performedSets: 2,
        directSets: 2,
      },
      {
        exerciseId: "row",
        exerciseName: "Barbell Row",
        effectiveSets: 1.2,
        performedSets: 3,
        indirectSets: 3,
      },
      {
        exerciseId: "pullup",
        exerciseName: "Pull-Up",
        effectiveSets: 0.9,
        performedSets: 2,
        indirectSets: 2,
      },
    ]);
  });

  it("folds Abs stimulus into external Core without emitting a separate Abs row", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "workout-1",
        exercises: [
          {
            exercise: {
              id: "plank",
              name: "Plank",
              aliases: [],
              exerciseMuscles: [
                { role: "PRIMARY", muscle: { name: "Abs" } },
                { role: "SECONDARY", muscle: { name: "Core" } },
              ],
            },
            sets: Array.from({ length: 2 }, () => ({ logs: [{ wasSkipped: false }] })),
          },
        ],
      },
    ]);

    const result = await loadMesocycleWeekMuscleVolume(
      { workout: { findMany } } as never,
      {
        userId: "user-1",
        mesocycleId: "meso-1",
        targetWeek: 1,
        weekStart: new Date("2026-03-02T00:00:00.000Z"),
        includeBreakdowns: true,
      }
    );

    expect(result.Core).toMatchObject({
      directSets: 2,
      indirectSets: 2,
      effectiveSets: 3.6,
      contributions: [
        {
          exerciseId: "plank",
          exerciseName: "Plank",
          effectiveSets: 3.6,
          performedSets: 2,
          directSets: 2,
          indirectSets: 2,
        },
      ],
    });
    expect(result.Abs).toBeUndefined();
  });
});
