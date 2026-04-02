import { describe, expect, it, vi } from "vitest";
import {
  classifyMuscleOutcome,
  loadWeeklyMuscleOutcome,
} from "./muscle-outcome-review";

describe("classifyMuscleOutcome", () => {
  it("applies conservative threshold boundaries", () => {
    expect(classifyMuscleOutcome(20, 18)).toMatchObject({
      percentDelta: -0.1,
      status: "on_target",
    });
    expect(classifyMuscleOutcome(20, 15)).toMatchObject({
      percentDelta: -0.25,
      status: "slightly_low",
    });
    expect(classifyMuscleOutcome(20, 14.8)).toMatchObject({
      status: "meaningfully_low",
    });
    expect(classifyMuscleOutcome(20, 22)).toMatchObject({
      percentDelta: 0.1,
      status: "on_target",
    });
    expect(classifyMuscleOutcome(20, 25)).toMatchObject({
      percentDelta: 0.25,
      status: "slightly_high",
    });
    expect(classifyMuscleOutcome(20, 25.2)).toMatchObject({
      status: "meaningfully_high",
    });
  });
});

describe("loadWeeklyMuscleOutcome", () => {
  it("compares canonical lifecycle targets against canonical weighted weekly stimulus", async () => {
    const mesocycleFindFirst = vi.fn().mockResolvedValue({
      id: "meso-1",
      durationWeeks: 5,
      startWeek: 0,
      state: "ACTIVE_ACCUMULATION",
      accumulationSessionsCompleted: 3,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 3,
      macroCycle: { startDate: new Date("2026-03-02T00:00:00.000Z") },
    });
    const workoutFindMany = vi.fn().mockResolvedValue([
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

    const result = await loadWeeklyMuscleOutcome(
      {
        mesocycle: { findFirst: mesocycleFindFirst },
        workout: { findMany: workoutFindMany },
      } as never,
      "user-1"
    );

    expect(result).not.toBeNull();
    expect(result?.week).toBe(2);

    const bicepsRow = result?.rows.find((row) => row.muscle === "Biceps");
    expect(bicepsRow).toMatchObject({
      targetSets: 9,
      actualEffectiveSets: 4.1,
      delta: -4.9,
      percentDelta: -0.544,
      status: "meaningfully_low",
      contributingExerciseCount: 3,
      topContributors: [
        { exerciseName: "EZ-Bar Curl", effectiveSets: 2 },
        { exerciseName: "Barbell Row", effectiveSets: 1.2 },
        { exerciseName: "Pull-Up", effectiveSets: 0.9 },
      ],
    });
  });

  it("uses mesocycle block metadata for weekly targets without a separate blockContext", async () => {
    const mesocycleFindFirst = vi.fn().mockResolvedValue({
      id: "meso-1",
      durationWeeks: 6,
      startWeek: 0,
      state: "ACTIVE_ACCUMULATION",
      accumulationSessionsCompleted: 12,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 3,
      blocks: [
        {
          blockType: "ACCUMULATION",
          startWeek: 0,
          durationWeeks: 2,
          volumeTarget: "HIGH",
          intensityBias: "HYPERTROPHY",
        },
        {
          blockType: "INTENSIFICATION",
          startWeek: 2,
          durationWeeks: 2,
          volumeTarget: "MODERATE",
          intensityBias: "HYPERTROPHY",
        },
        {
          blockType: "REALIZATION",
          startWeek: 4,
          durationWeeks: 1,
          volumeTarget: "LOW",
          intensityBias: "STRENGTH",
        },
        {
          blockType: "DELOAD",
          startWeek: 5,
          durationWeeks: 1,
          volumeTarget: "LOW",
          intensityBias: "HYPERTROPHY",
        },
      ],
      macroCycle: { startDate: new Date("2026-03-02T00:00:00.000Z") },
    });
    const workoutFindMany = vi.fn().mockResolvedValue([]);

    const result = await loadWeeklyMuscleOutcome(
      {
        mesocycle: { findFirst: mesocycleFindFirst },
        workout: { findMany: workoutFindMany },
      } as never,
      "user-1"
    );

    expect(result?.week).toBe(5);
    expect(result?.rows.find((row) => row.muscle === "Lats")?.targetSets).toBe(13);
  });

  it("uses the exposed scope so Core absorbs Abs and broader muscles still surface when present", async () => {
    const mesocycleFindFirst = vi.fn().mockResolvedValue({
      id: "meso-1",
      durationWeeks: 5,
      startWeek: 0,
      state: "ACTIVE_ACCUMULATION",
      accumulationSessionsCompleted: 3,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 3,
      macroCycle: { startDate: new Date("2026-03-02T00:00:00.000Z") },
    });
    const workoutFindMany = vi.fn().mockResolvedValue([
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
                { role: "SECONDARY", muscle: { name: "Lower Back" } },
              ],
            },
            sets: Array.from({ length: 2 }, () => ({ logs: [{ wasSkipped: false }] })),
          },
        ],
      },
    ]);

    const result = await loadWeeklyMuscleOutcome(
      {
        mesocycle: { findFirst: mesocycleFindFirst },
        workout: { findMany: workoutFindMany },
      } as never,
      "user-1"
    );

    expect(result?.rows.map((row) => row.muscle)).toContain("Core");
    expect(result?.rows.map((row) => row.muscle)).toContain("Lower Back");
    expect(result?.rows.map((row) => row.muscle)).not.toContain("Abs");
    expect(result?.rows.find((row) => row.muscle === "Core")).toMatchObject({
      actualEffectiveSets: 3.6,
      contributingExerciseCount: 1,
      topContributors: [{ exerciseName: "Plank", effectiveSets: 3.6 }],
    });
  });
});
