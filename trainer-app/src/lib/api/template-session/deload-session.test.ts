import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const workoutFindFirst = vi.fn();
  const workoutFindMany = vi.fn();
  const roleFindMany = vi.fn();
  return {
    workoutFindFirst,
    workoutFindMany,
    roleFindMany,
    prisma: {
      workout: {
        findFirst: workoutFindFirst,
        findMany: workoutFindMany,
      },
      mesocycleExerciseRole: {
        findMany: roleFindMany,
      },
    },
  };
});

vi.mock("@/lib/db/prisma", () => ({
  prisma: mocks.prisma,
}));

import { generateDeloadSessionFromIntentContext } from "./deload-session";

describe("deload-session generation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps exercise continuity, cuts sets roughly in half, and leaves load assignment to the canonical engine", async () => {
    const latestAccumWorkout = {
      exercises: [
        {
          exerciseId: "row",
          isMainLift: true,
          sets: [
            { logs: [{ actualReps: 10, actualLoad: 60 }] },
            { logs: [{ actualReps: 10, actualLoad: 60 }] },
            { logs: [{ actualReps: 10, actualLoad: 60 }] },
            { logs: [{ actualReps: 10, actualLoad: 60 }] },
          ],
        },
      ],
    };
    mocks.workoutFindFirst.mockResolvedValue(latestAccumWorkout);
    mocks.workoutFindMany.mockResolvedValue([
      {
        exercises: [
          {
            exerciseId: "row",
            isMainLift: true,
            sets: [
              { logs: [{ actualLoad: 60 }] },
              { logs: [{ actualLoad: 60 }] },
              { logs: [{ actualLoad: 55 }] },
              { logs: [{ actualLoad: 60 }] },
            ],
          },
          {
            exerciseId: "bench",
            isMainLift: true,
            sets: [
              { logs: [{ actualReps: 8, actualLoad: 200 }] },
              { logs: [{ actualReps: 8, actualLoad: 200 }] },
              { logs: [{ actualReps: 8, actualLoad: 180 }] },
              { logs: [{ actualReps: 8, actualLoad: 180 }] },
            ],
          },
        ],
      },
    ]);
    mocks.roleFindMany.mockResolvedValue([{ exerciseId: "row" }, { exerciseId: "bench" }]);

    const result = await generateDeloadSessionFromIntentContext(
      "user-1",
      {
        exerciseLibrary: [
          {
            id: "row",
            name: "Row",
            movementPatterns: ["horizontal_pull"],
            splitTags: ["pull"],
            jointStress: "medium",
            isMainLiftEligible: true,
            isCompound: true,
            fatigueCost: 3,
            equipment: ["machine"],
            primaryMuscles: ["Upper Back"],
            secondaryMuscles: ["Biceps"],
          },
          {
            id: "bench",
            name: "Bench Press",
            movementPatterns: ["horizontal_push"],
            splitTags: ["push"],
            jointStress: "medium",
            isMainLiftEligible: true,
            isCompound: true,
            fatigueCost: 4,
            equipment: ["barbell"],
            primaryMuscles: ["Chest"],
            secondaryMuscles: ["Triceps"],
          },
        ],
        activeMesocycle: {
          id: "meso-1",
          state: "ACTIVE_DELOAD",
          accumulationSessionsCompleted: 12,
          deloadSessionsCompleted: 0,
          sessionsPerWeek: 3,
          macroCycleId: "macro",
          mesoNumber: 1,
          startWeek: 0,
          durationWeeks: 5,
          focus: "hypertrophy",
          volumeTarget: "MODERATE",
          intensityBias: "HYPERTROPHY",
          completedSessions: 12,
          splitType: "PPL",
          daysPerWeek: 3,
          isActive: true,
          volumeRampConfig: {},
          rirBandConfig: {},
        },
      } as never,
      "pull"
    );

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.workout.notes).toContain("lighter loads assigned canonically");
    expect(result.note).toContain("canonical load engine");

    const row = result.workout.mainLifts.find((entry) => entry.exercise.id === "row");
    const bench = result.workout.mainLifts.find((entry) => entry.exercise.id === "bench");

    expect(row?.sets).toHaveLength(2);
    expect(row?.sets[0].targetReps).toBe(10);
    expect(row?.sets[0].targetLoad).toBeUndefined();
    expect(row?.sets[0].targetRpe).toBe(4.5);
    expect(result.trace.targetRpe).toBe(4.5);
    expect(result.trace.exercises.find((entry) => entry.exerciseId === "row")).toMatchObject({
      baselineSetCount: 4,
      deloadSetCount: 2,
      anchoredLoad: 60,
      anchoredLoadSource: "latest_accumulation",
      latestAccumulationLoadCount: 4,
    });
    expect(result.trace.exercises.find((entry) => entry.exerciseId === "bench")).toMatchObject({
      anchoredLoad: 200,
      anchoredLoadSource: "peak_accumulation",
      peakAccumulationLoadCount: 4,
    });

    expect(bench?.sets).toHaveLength(2);
    expect(bench?.sets[0].targetReps).toBe(8);
    expect(bench?.sets[0].targetLoad).toBeUndefined();
  });

  it("handles 2-set and 1-set deload edge cases without inventing extra work", async () => {
    mocks.workoutFindFirst.mockResolvedValue({
      exercises: [
        {
          exerciseId: "two-set-row",
          isMainLift: true,
          sets: [
            { logs: [{ actualReps: 10, actualLoad: 70 }] },
            { logs: [{ actualReps: 10, actualLoad: 70 }] },
          ],
        },
        {
          exerciseId: "one-set-curl",
          isMainLift: false,
          sets: [{ logs: [{ actualReps: 12, actualLoad: 25 }] }],
        },
      ],
    });
    mocks.workoutFindMany.mockResolvedValue([
      {
        exercises: [
          {
            exerciseId: "two-set-row",
            isMainLift: true,
            sets: [
              { logs: [{ actualReps: 10, actualLoad: 70 }] },
              { logs: [{ actualReps: 10, actualLoad: 70 }] },
            ],
          },
          {
            exerciseId: "one-set-curl",
            isMainLift: false,
            sets: [{ logs: [{ actualReps: 12, actualLoad: 25 }] }],
          },
        ],
      },
    ]);
    mocks.roleFindMany.mockResolvedValue([{ exerciseId: "two-set-row" }]);

    const result = await generateDeloadSessionFromIntentContext(
      "user-1",
      {
        exerciseLibrary: [
          {
            id: "two-set-row",
            name: "Row",
            movementPatterns: ["horizontal_pull"],
            splitTags: ["pull"],
            jointStress: "medium",
            isMainLiftEligible: true,
            isCompound: true,
            fatigueCost: 3,
            equipment: ["machine"],
            primaryMuscles: ["Upper Back"],
            secondaryMuscles: ["Biceps"],
          },
          {
            id: "one-set-curl",
            name: "Curl",
            movementPatterns: ["flexion"],
            splitTags: ["pull"],
            jointStress: "low",
            isMainLiftEligible: false,
            isCompound: false,
            fatigueCost: 1,
            equipment: ["cable"],
            primaryMuscles: ["Biceps"],
            secondaryMuscles: [],
          },
        ],
        activeMesocycle: {
          id: "meso-1",
          state: "ACTIVE_DELOAD",
          accumulationSessionsCompleted: 12,
          deloadSessionsCompleted: 0,
          sessionsPerWeek: 3,
          macroCycleId: "macro",
          mesoNumber: 1,
          startWeek: 0,
          durationWeeks: 5,
          focus: "hypertrophy",
          volumeTarget: "MODERATE",
          intensityBias: "HYPERTROPHY",
          completedSessions: 12,
          splitType: "PPL",
          daysPerWeek: 3,
          isActive: true,
          volumeRampConfig: {},
          rirBandConfig: {},
        },
      } as never,
      "pull"
    );

    expect("error" in result).toBe(false);
    if ("error" in result) return;

    const row = result.workout.mainLifts.find((entry) => entry.exercise.id === "two-set-row");
    const curl = result.workout.accessories.find((entry) => entry.exercise.id === "one-set-curl");

    expect(row?.sets).toHaveLength(1);
    expect(curl?.sets).toHaveLength(1);
    expect(row?.sets[0].targetLoad).toBeUndefined();
    expect(curl?.sets[0].targetLoad).toBeUndefined();
  });
});
