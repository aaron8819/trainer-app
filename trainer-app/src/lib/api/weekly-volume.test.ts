import { describe, expect, it, vi } from "vitest";
import { loadMesocycleWeekMuscleVolume } from "./weekly-volume";

function workSets(count: number) {
  return Array.from({ length: count }, () => ({
    logs: [{ wasSkipped: false, actualReps: 10, actualRpe: 8, actualLoad: 100, setIntent: "WORK" }],
  }));
}

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
            sets: workSets(3),
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
            sets: workSets(2),
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
            sets: workSets(2),
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

  it("keeps Plank to one external Core contribution without emitting a separate Abs row", async () => {
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
            sets: workSets(2),
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
      effectiveSets: 2,
      contributions: [
        {
          exerciseId: "plank",
          exerciseName: "Plank",
          effectiveSets: 2,
          performedSets: 2,
          directSets: 2,
          indirectSets: 2,
        },
      ],
    });
    expect(result.Abs).toBeUndefined();
  });

  it("does not add lower-back volume from supported seated rows or cable pull-throughs", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "workout-1",
        exercises: [
          {
            exercise: {
              id: "seated-cable-row",
              name: "Seated Cable Row",
              aliases: [],
              exerciseMuscles: [
                { role: "PRIMARY", muscle: { name: "Lats" } },
                { role: "PRIMARY", muscle: { name: "Upper Back" } },
                { role: "SECONDARY", muscle: { name: "Biceps" } },
                { role: "SECONDARY", muscle: { name: "Forearms" } },
              ],
            },
            sets: workSets(3),
          },
          {
            exercise: {
              id: "close-grip-seated-cable-row",
              name: "Close-Grip Seated Cable Row",
              aliases: [],
              exerciseMuscles: [
                { role: "PRIMARY", muscle: { name: "Lats" } },
                { role: "PRIMARY", muscle: { name: "Upper Back" } },
                { role: "SECONDARY", muscle: { name: "Biceps" } },
                { role: "SECONDARY", muscle: { name: "Forearms" } },
              ],
            },
            sets: workSets(2),
          },
          {
            exercise: {
              id: "cable-pull-through",
              name: "Cable Pull-Through",
              aliases: [],
              exerciseMuscles: [
                { role: "PRIMARY", muscle: { name: "Glutes" } },
                { role: "PRIMARY", muscle: { name: "Hamstrings" } },
              ],
            },
            sets: workSets(2),
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

    expect(result["Lower Back"]).toBeUndefined();
    expect(result["Upper Back"]?.effectiveSets).toBe(5);
    expect(result.Lats?.effectiveSets).toBe(4);
    expect(result.Glutes?.effectiveSets).toBe(2);
    expect(result.Hamstrings?.effectiveSets).toBe(1.5);
  });

  it("counts Reverse Hyperextension lower back as secondary rather than dominant", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "workout-1",
        exercises: [
          {
            exercise: {
              id: "reverse-hyperextension",
              name: "Reverse Hyperextension",
              aliases: [],
              exerciseMuscles: [
                { role: "PRIMARY", muscle: { name: "Glutes" } },
                { role: "PRIMARY", muscle: { name: "Hamstrings" } },
                { role: "SECONDARY", muscle: { name: "Lower Back" } },
              ],
            },
            sets: workSets(2),
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

    expect(result.Glutes?.effectiveSets).toBe(2);
    expect(result.Hamstrings?.effectiveSets).toBe(1.5);
    expect(result["Lower Back"]).toMatchObject({
      effectiveSets: 0.7,
      indirectSets: 2,
    });
  });

  it("excludes warmup/ramp sets from weekly volume", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "workout-1",
        exercises: [
          {
            exercise: {
              id: "leg-extension",
              name: "Leg Extension",
              aliases: [],
              exerciseMuscles: [{ role: "PRIMARY", muscle: { name: "Quads" } }],
            },
            sets: [
              {
                logs: [
                  {
                    wasSkipped: false,
                    actualReps: 12,
                    actualRpe: 8,
                    actualLoad: 55,
                    setIntent: "WARMUP",
                  },
                ],
              },
              ...workSets(2),
            ],
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

    expect(result.Quads).toMatchObject({
      directSets: 2,
      effectiveSets: 2,
      contributions: [
        {
          exerciseId: "leg-extension",
          exerciseName: "Leg Extension",
          effectiveSets: 2,
          performedSets: 2,
          directSets: 2,
        },
      ],
    });
  });

  it("includes performed closeout sessions in actual weekly volume totals", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "workout-closeout",
        advancesSplit: false,
        selectionMode: "MANUAL",
        sessionIntent: null,
        selectionMetadata: {
          sessionDecisionReceipt: {
            exceptions: [{ code: "closeout_session", message: "Marked as closeout session." }],
          },
        },
        mesocyclePhaseSnapshot: "ACCUMULATION",
        exercises: [
          {
            exercise: {
              id: "curl",
              name: "EZ-Bar Curl",
              aliases: [],
              exerciseMuscles: [{ role: "PRIMARY", muscle: { name: "Biceps" } }],
            },
            sets: workSets(2),
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
      }
    );

    expect(result.Biceps).toMatchObject({
      directSets: 2,
      effectiveSets: 2,
    });
  });
});
