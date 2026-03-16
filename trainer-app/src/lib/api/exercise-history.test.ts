/**
 * Protects: Performed-work-only adaptation: no planned fallback in history/progression/explainability/readiness.
 * Why it matters: Progression quality depends on filtering to truly performed work only.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PERFORMED_WORKOUT_STATUSES } from "@/lib/workout-status";

const mocks = vi.hoisted(() => {
  const findMany = vi.fn();
  return {
    findMany,
    prisma: {
      workoutExercise: {
        findMany,
      },
    },
  };
});

vi.mock("@/lib/db/prisma", () => ({
  prisma: mocks.prisma,
}));

import { loadExerciseHistory } from "./exercise-history";

describe("loadExerciseHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("queries performed workout statuses and returns performed non-skipped logs only", async () => {
    mocks.findMany.mockResolvedValue([
      {
        workout: { scheduledDate: new Date("2026-02-20T00:00:00.000Z") },
        sets: [
          {
            setIndex: 1,
            logs: [{ actualReps: 8, actualLoad: 185, actualRpe: 8, wasSkipped: false }],
          },
          {
            setIndex: 2,
            logs: [],
          },
          {
            setIndex: 3,
            logs: [{ actualReps: null, actualLoad: null, actualRpe: null, wasSkipped: true }],
          },
        ],
      },
    ]);

    const result = await loadExerciseHistory("bench", "user-1", 3);

    expect(mocks.findMany).toHaveBeenCalled();
    const query = mocks.findMany.mock.calls[0][0];
    expect(query.where.workout.status.in).toEqual([...PERFORMED_WORKOUT_STATUSES]);

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].sets).toEqual([{ setIndex: 1, reps: 8, load: 185, rpe: 8 }]);
  });

  it("excludes deload sessions from exercise performance history and trends", async () => {
    mocks.findMany.mockResolvedValue([
      {
        workout: {
          scheduledDate: new Date("2026-02-20T00:00:00.000Z"),
          selectionMetadata: {
            sessionDecisionReceipt: {
              version: 1,
              cycleContext: {
                weekInMeso: 5,
                weekInBlock: 1,
                phase: "deload",
                blockType: "deload",
                isDeload: true,
                source: "computed",
              },
              lifecycleVolume: { source: "unknown" },
              sorenessSuppressedMuscles: [],
              deloadDecision: {
                mode: "scheduled",
                reason: ["Scheduled deload week."],
                reductionPercent: 50,
                appliedTo: "volume",
              },
              readiness: {
                wasAutoregulated: false,
                signalAgeHours: null,
                fatigueScoreOverall: null,
                intensityScaling: {
                  applied: false,
                  exerciseIds: [],
                  scaledUpCount: 0,
                  scaledDownCount: 0,
                },
              },
              exceptions: [],
            },
          },
          selectionMode: "INTENT",
          sessionIntent: "PUSH",
          advancesSplit: true,
          mesocyclePhaseSnapshot: "DELOAD",
        },
        sets: [
          {
            setIndex: 1,
            logs: [{ actualReps: 8, actualLoad: 155, actualRpe: 5, wasSkipped: false }],
          },
        ],
      },
      {
        workout: {
          scheduledDate: new Date("2026-02-13T00:00:00.000Z"),
          selectionMetadata: {},
          selectionMode: "INTENT",
          sessionIntent: "PUSH",
          advancesSplit: true,
          mesocyclePhaseSnapshot: "ACCUMULATION",
        },
        sets: [
          {
            setIndex: 1,
            logs: [{ actualReps: 8, actualLoad: 200, actualRpe: 8, wasSkipped: false }],
          },
        ],
      },
    ]);

    const result = await loadExerciseHistory("bench", "user-1", 3);

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].date).toBe("2026-02-13T00:00:00.000Z");
    expect(result.personalBests.maxLoad).toBe(200);
    expect(result.trend).toBe("insufficient_data");
  });
});
