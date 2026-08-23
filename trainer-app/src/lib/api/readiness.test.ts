/**
 * Protects: Readiness canonicalized to ReadinessSignal.
 * Why it matters: Autoregulation should consume one canonical readiness source and preserve performed-status semantics.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PERFORMED_WORKOUT_STATUSES } from "@/lib/workout-status";

const mocks = vi.hoisted(() => {
  const findMany = vi.fn();
  const findFirst = vi.fn();
  return {
    findMany,
    findFirst,
    prisma: {
      workout: { findMany },
      readinessSignal: { findFirst },
    },
  };
});

vi.mock("@/lib/db/prisma", () => ({
  prisma: mocks.prisma,
}));

import {
  computePerformanceSignals,
  getLatestReadinessSignal,
  SIGNAL_STALENESS_THRESHOLD_MS,
} from "./readiness";

describe("readiness API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("queries performed workout statuses (COMPLETED + PARTIAL)", async () => {
    mocks.findMany.mockResolvedValue([]);

    await computePerformanceSignals("user-1", 3);

    const query = mocks.findMany.mock.calls[0][0];
    expect(query.where.status.in).toEqual([...PERFORMED_WORKOUT_STATUSES]);
  });

  it.each([
    [
      "semantic-zero external-load",
      {
        measurementProfile: "REPS_EXTERNAL_LOAD",
        loadConvention: "IMPLEMENT_WEIGHT",
        repBasis: "PER_SIDE",
      },
      0,
      0,
    ],
    [
      "positive external-load",
      {
        measurementProfile: "REPS_EXTERNAL_LOAD",
        loadConvention: "IMPLEMENT_WEIGHT",
        repBasis: "PER_SIDE",
      },
      20,
      1,
    ],
    [
      "true reps-only",
      {
        measurementProfile: "REPS_BODYWEIGHT",
        loadConvention: null,
        repBasis: "TOTAL",
      },
      null,
      1,
    ],
  ])("scores %s readiness evidence intentionally", async (_label, measurement, load, expectedStalls) => {
    mocks.findMany.mockResolvedValue(
      ["latest", "previous"].map((id) => ({
        id,
        exercises: [
          {
            exerciseId: "exercise-1",
            ...measurement,
            sets: [
              {
                targetRpe: 8,
                logs: [
                  {
                    actualLoad: load,
                    actualReps: 10,
                    actualRpe: 8,
                    wasSkipped: false,
                  },
                ],
              },
            ],
          },
        ],
      }))
    );

    await expect(computePerformanceSignals("user-1", 2)).resolves.toMatchObject({
      stallCount: expectedStalls,
    });
  });

  it("maps latest ReadinessSignal into canonical readiness shape", async () => {
    const now = new Date();
    mocks.findFirst.mockResolvedValue({
      timestamp: now,
      userId: "user-1",
      whoopRecovery: 82,
      whoopStrain: 12,
      whoopHrv: 56,
      whoopSleepQuality: 88,
      whoopSleepHours: 7.2,
      subjectiveReadiness: 4,
      subjectiveMotivation: 4,
      subjectiveSoreness: { chest: 2 },
      subjectiveStress: 2,
      performanceRpeDeviation: 0.4,
      performanceStalls: 1,
      performanceCompliance: 0.9,
    });

    const signal = await getLatestReadinessSignal("user-1");

    expect(signal?.userId).toBe("user-1");
    expect(signal?.subjective.readiness).toBe(4);
    expect(signal?.performance.stallCount).toBe(1);
    expect(signal?.whoop?.recovery).toBe(82);
  });

  it("drops stale ReadinessSignal records", async () => {
    const staleTimestamp = new Date(Date.now() - SIGNAL_STALENESS_THRESHOLD_MS - 1);
    mocks.findFirst.mockResolvedValue({
      timestamp: staleTimestamp,
      userId: "user-1",
      whoopRecovery: null,
      whoopStrain: null,
      whoopHrv: null,
      whoopSleepQuality: null,
      whoopSleepHours: null,
      subjectiveReadiness: 3,
      subjectiveMotivation: 3,
      subjectiveSoreness: {},
      subjectiveStress: null,
      performanceRpeDeviation: 0,
      performanceStalls: 0,
      performanceCompliance: 1,
    });

    await expect(getLatestReadinessSignal("user-1")).resolves.toBeNull();
  });
});
