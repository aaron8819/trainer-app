/**
 * Protects: Readiness canonicalized to ReadinessSignal; session-checkins is a compatibility shim.
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
