/**
 * Protects: Readiness/autoregulation correctness (bounded scaling; no silent extreme changes).
 * Why it matters: Readiness-driven changes must be safe and stale signals must not alter workouts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const readinessFindFirst = vi.fn();
  return {
    readinessFindFirst,
    prisma: {
      readinessSignal: { findFirst: readinessFindFirst },
    },
  };
});

vi.mock("@/lib/db/prisma", () => ({ prisma: mocks.prisma }));

import { applyAutoregulation } from "@/lib/api/autoregulation";

describe("autoregulation correctness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("applies bounded scale-down for fresh low readiness and ignores stale readiness", async () => {
    const workout = {
      id: "w1",
      scheduledDate: "2026-02-20T00:00:00.000Z",
      warmup: [],
      mainLifts: [
        {
          id: "e1",
          exercise: { name: "Bench Press" },
          isMainLift: true,
          sets: [{ setIndex: 1, targetReps: 8, targetLoad: 200, targetRpe: 8 }],
        },
      ],
      accessories: [],
      estimatedMinutes: 45,
    } as const;

    mocks.readinessFindFirst.mockResolvedValueOnce({
      timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000),
      userId: "user-1",
      whoopRecovery: null,
      whoopStrain: null,
      whoopHrv: null,
      whoopSleepQuality: null,
      whoopSleepHours: null,
      subjectiveReadiness: 2,
      subjectiveMotivation: 2,
      subjectiveSoreness: { Chest: 2 },
      subjectiveStress: 3,
      performanceRpeDeviation: 0.5,
      performanceStalls: 1,
      performanceCompliance: 0.9,
    });

    const fresh = await applyAutoregulation("user-1", workout as never);
    const adjustedLoad = fresh.adjusted.mainLifts[0].sets[0].targetLoad ?? 0;

    expect(fresh.applied).toBe(true);
    expect(adjustedLoad).toBe(180);
    expect(adjustedLoad).toBeGreaterThanOrEqual(200 * 0.9);

    mocks.readinessFindFirst.mockResolvedValueOnce({
      timestamp: new Date(Date.now() - 72 * 60 * 60 * 1000),
      userId: "user-1",
      whoopRecovery: null,
      whoopStrain: null,
      whoopHrv: null,
      whoopSleepQuality: null,
      whoopSleepHours: null,
      subjectiveReadiness: 2,
      subjectiveMotivation: 2,
      subjectiveSoreness: { Chest: 2 },
      subjectiveStress: 3,
      performanceRpeDeviation: 0.5,
      performanceStalls: 1,
      performanceCompliance: 0.9,
    });

    const stale = await applyAutoregulation("user-1", workout as never);

    expect(stale.applied).toBe(false);
    expect(stale.adjusted).toEqual(workout);
    expect(stale.reason).toContain("No recent readiness signal");
  });
});
