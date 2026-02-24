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

  it("builds deload sets at 40-50%, keeps anchored load, and applies RIR 4-6 (RPE ~5)", async () => {
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
            sets: [
              { logs: [{ actualLoad: 60 }] },
              { logs: [{ actualLoad: 60 }] },
              { logs: [{ actualLoad: 55 }] },
              { logs: [{ actualLoad: 60 }] },
            ],
          },
        ],
      },
    ]);
    mocks.roleFindMany.mockResolvedValue([{ exerciseId: "row" }]);

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
    const sets = result.workout.mainLifts[0].sets;
    expect(sets.length).toBe(2); // ceil(4 * 0.45)=2
    expect(sets[0].targetLoad).toBe(60);
    expect(sets[0].targetRpe).toBe(5);
  });
});

