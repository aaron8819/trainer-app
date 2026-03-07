import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const workoutFindMany = vi.fn();
  const weekCloseFindFirst = vi.fn();
  const weekCloseFindUnique = vi.fn();
  const weekCloseUpsert = vi.fn();
  const weekCloseUpdateMany = vi.fn();
  const transitionMesocycleStateInTransaction = vi.fn();

  return {
    workoutFindMany,
    weekCloseFindFirst,
    weekCloseFindUnique,
    weekCloseUpsert,
    weekCloseUpdateMany,
    transitionMesocycleStateInTransaction,
    tx: {
      workout: {
        findMany: workoutFindMany,
      },
      mesocycleWeekClose: {
        findFirst: weekCloseFindFirst,
        findUnique: weekCloseFindUnique,
        upsert: weekCloseUpsert,
        updateMany: weekCloseUpdateMany,
      },
    },
  };
});

vi.mock("./mesocycle-lifecycle-state", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./mesocycle-lifecycle-state")>();
  return {
    ...actual,
    transitionMesocycleStateInTransaction: (...args: unknown[]) =>
      mocks.transitionMesocycleStateInTransaction(...args),
  };
});

import {
  autoDismissPendingWeekCloseOnForwardProgress,
  buildWeekCloseDeficitSnapshot,
  dismissPendingWeekClose,
  evaluateWeekCloseAtBoundary,
  isAccumulationWeekBoundary,
  linkOptionalWorkoutToWeekClose,
  resolveWeekCloseOnOptionalGapFillCompletion,
} from "./mesocycle-week-close";

describe("mesocycle week close", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.workoutFindMany.mockResolvedValue([]);
    mocks.weekCloseFindFirst.mockResolvedValue(null);
    mocks.weekCloseFindUnique.mockResolvedValue(null);
    mocks.weekCloseUpsert.mockResolvedValue({
      id: "wc-1",
      status: "RESOLVED",
      resolution: "NO_GAP_FILL_NEEDED",
    });
    mocks.weekCloseUpdateMany.mockResolvedValue({ count: 1 });
    mocks.transitionMesocycleStateInTransaction.mockResolvedValue({
      mesocycle: { id: "meso-1", state: "ACTIVE_DELOAD" },
      advanced: true,
    });
  });

  it("identifies the last accumulation session as a week-close boundary", () => {
    expect(
      isAccumulationWeekBoundary({
        snapshotPhase: "ACCUMULATION",
        snapshotSession: 3,
        sessionsPerWeek: 3,
      })
    ).toBe(true);
    expect(
      isAccumulationWeekBoundary({
        snapshotPhase: "ACCUMULATION",
        snapshotSession: 2,
        sessionsPerWeek: 3,
      })
    ).toBe(false);
    expect(
      isAccumulationWeekBoundary({
        snapshotPhase: "DELOAD",
        snapshotSession: 3,
        sessionsPerWeek: 3,
      })
    ).toBe(false);
  });

  it("builds a durable deficit snapshot from performed week volume", async () => {
    mocks.workoutFindMany.mockResolvedValue([
      {
        exercises: [
          {
            exercise: {
              exerciseMuscles: [
                { role: "PRIMARY", muscle: { name: "Chest" } },
                { role: "SECONDARY", muscle: { name: "Triceps" } },
              ],
            },
            sets: [
              { logs: [{ wasSkipped: false }] },
              { logs: [{ wasSkipped: false }] },
              { logs: [{ wasSkipped: true }] },
            ],
          },
        ],
      },
    ]);

    const snapshot = await buildWeekCloseDeficitSnapshot(mocks.tx as never, {
      userId: "user-1",
      mesocycle: {
        id: "meso-1",
        durationWeeks: 5,
        sessionsPerWeek: 3,
        startWeek: 0,
        macroCycle: {
          startDate: new Date("2026-03-01T00:00:00.000Z"),
        },
      },
      targetWeek: 1,
    });

    expect(snapshot.version).toBe(1);
    expect(snapshot.policy.requiredSessionsPerWeek).toBe(3);
    expect(snapshot.summary.topTargetMuscles.length).toBeGreaterThan(0);
    expect(snapshot.muscles[0]).toEqual(
      expect.objectContaining({
        muscle: expect.any(String),
        target: expect.any(Number),
        actual: expect.any(Number),
        deficit: expect.any(Number),
      })
    );
  });

  it("creates a resolved row and advances lifecycle when no deficits remain", async () => {
    const result = await evaluateWeekCloseAtBoundary(mocks.tx as never, {
      userId: "user-1",
      mesocycle: {
        id: "meso-1",
        durationWeeks: 5,
        sessionsPerWeek: 3,
        startWeek: 0,
        macroCycle: {
          startDate: new Date("2026-03-01T00:00:00.000Z"),
        },
      },
      targetWeek: 1,
      deficitSnapshot: {
        version: 1,
        policy: {
          requiredSessionsPerWeek: 3,
          maxOptionalGapFillSessionsPerWeek: 1,
          maxGeneratedHardSets: 12,
          maxGeneratedExercises: 4,
        },
        summary: {
          totalDeficitSets: 0,
          qualifyingMuscleCount: 0,
          topTargetMuscles: [],
        },
        muscles: [],
      },
    });

    expect(mocks.weekCloseUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          mesocycleId: "meso-1",
          targetWeek: 1,
          status: "RESOLVED",
          resolution: "NO_GAP_FILL_NEEDED",
        }),
      })
    );
    expect(mocks.transitionMesocycleStateInTransaction).toHaveBeenCalledWith(mocks.tx, "meso-1");
    expect(result.status).toBe("RESOLVED");
    expect(result.advancedLifecycle).toBe(true);
  });

  it("creates a pending row and does not advance lifecycle when deficits remain", async () => {
    mocks.workoutFindMany.mockResolvedValue([
      {
        exercises: [
          {
            exercise: {
              exerciseMuscles: [{ role: "PRIMARY", muscle: { name: "Chest" } }],
            },
            sets: [{ logs: [{ wasSkipped: false }] }],
          },
        ],
      },
    ]);
    mocks.weekCloseUpsert.mockResolvedValue({
      id: "wc-2",
      status: "PENDING_OPTIONAL_GAP_FILL",
      resolution: null,
    });

    const result = await evaluateWeekCloseAtBoundary(mocks.tx as never, {
      userId: "user-1",
      mesocycle: {
        id: "meso-1",
        durationWeeks: 5,
        sessionsPerWeek: 3,
        startWeek: 0,
        macroCycle: {
          startDate: new Date("2026-03-01T00:00:00.000Z"),
        },
      },
      targetWeek: 1,
    });

    expect(mocks.weekCloseUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          status: "PENDING_OPTIONAL_GAP_FILL",
          resolution: null,
          resolvedAt: null,
        }),
      })
    );
    expect(mocks.transitionMesocycleStateInTransaction).not.toHaveBeenCalled();
    expect(result.status).toBe("PENDING_OPTIONAL_GAP_FILL");
    expect(result.advancedLifecycle).toBe(false);
  });

  it("rejects closing a new week while another week-close is pending", async () => {
    mocks.weekCloseFindFirst.mockResolvedValue({ id: "wc-pending" });

    await expect(
      evaluateWeekCloseAtBoundary(mocks.tx as never, {
        userId: "user-1",
        mesocycle: {
          id: "meso-1",
          durationWeeks: 5,
          sessionsPerWeek: 3,
          startWeek: 0,
          macroCycle: {
            startDate: new Date("2026-03-01T00:00:00.000Z"),
          },
        },
        targetWeek: 2,
      })
    ).rejects.toThrow("PENDING_WEEK_CLOSE_EXISTS");
  });

  it("resolves a linked optional gap-fill completion once and advances lifecycle once", async () => {
    mocks.weekCloseFindFirst.mockResolvedValueOnce({
      id: "wc-1",
      optionalWorkoutId: "workout-gap",
    });
    mocks.weekCloseFindUnique
      .mockResolvedValueOnce({
        id: "wc-1",
        mesocycleId: "meso-1",
        status: "PENDING_OPTIONAL_GAP_FILL",
        resolution: null,
      });

    const result = await resolveWeekCloseOnOptionalGapFillCompletion(mocks.tx as never, {
      workoutId: "workout-gap",
    });

    expect(mocks.weekCloseUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "wc-1",
        status: "PENDING_OPTIONAL_GAP_FILL",
      },
      data: expect.objectContaining({
        status: "RESOLVED",
        resolution: "GAP_FILL_COMPLETED",
      }),
    });
    expect(mocks.transitionMesocycleStateInTransaction).toHaveBeenCalledWith(mocks.tx, "meso-1");
    expect(result.outcome).toBe("resolved");
    expect(result.resolution).toBe("GAP_FILL_COMPLETED");
  });

  it("rejects optional gap-fill completion when the linked row is already resolved", async () => {
    mocks.weekCloseFindFirst.mockResolvedValueOnce({
      id: "wc-1",
      optionalWorkoutId: "workout-gap",
    });
    mocks.weekCloseFindUnique.mockResolvedValueOnce({
      id: "wc-1",
      mesocycleId: "meso-1",
      status: "RESOLVED",
      resolution: "GAP_FILL_DISMISSED",
    });

    await expect(
      resolveWeekCloseOnOptionalGapFillCompletion(mocks.tx as never, {
        workoutId: "workout-gap",
      })
    ).rejects.toThrow("WEEK_CLOSE_NOT_PENDING");
    expect(mocks.transitionMesocycleStateInTransaction).not.toHaveBeenCalled();
  });

  it("dismisses a pending row once and retries as a no-op", async () => {
    mocks.weekCloseFindUnique
      .mockResolvedValueOnce({
        id: "wc-1",
        mesocycleId: "meso-1",
        status: "PENDING_OPTIONAL_GAP_FILL",
        resolution: null,
      })
      .mockResolvedValueOnce({
        id: "wc-1",
        mesocycleId: "meso-1",
        status: "RESOLVED",
        resolution: "GAP_FILL_DISMISSED",
      });

    const first = await dismissPendingWeekClose(mocks.tx as never, { weekCloseId: "wc-1" });

    mocks.weekCloseUpdateMany.mockResolvedValueOnce({ count: 0 });
    mocks.weekCloseFindUnique.mockResolvedValueOnce({
      id: "wc-1",
      mesocycleId: "meso-1",
      status: "RESOLVED",
      resolution: "GAP_FILL_DISMISSED",
    });

    const second = await dismissPendingWeekClose(mocks.tx as never, { weekCloseId: "wc-1" });

    expect(first.outcome).toBe("resolved");
    expect(second.outcome).toBe("already_resolved");
    expect(mocks.transitionMesocycleStateInTransaction).toHaveBeenCalledTimes(1);
  });

  it("auto-dismisses a pending row when forward progress moves beyond the target week", async () => {
    mocks.weekCloseFindFirst.mockReset();
    mocks.weekCloseFindUnique.mockReset();
    mocks.weekCloseUpdateMany.mockReset();
    mocks.weekCloseFindFirst.mockResolvedValueOnce({
      id: "wc-1",
      mesocycleId: "meso-1",
      status: "PENDING_OPTIONAL_GAP_FILL",
      resolution: null,
      targetWeek: 1,
    });
    mocks.weekCloseUpdateMany.mockResolvedValueOnce({ count: 1 });
    mocks.weekCloseFindUnique.mockResolvedValueOnce({
      id: "wc-1",
      mesocycleId: "meso-1",
      status: "PENDING_OPTIONAL_GAP_FILL",
      resolution: null,
    });

    const result = await autoDismissPendingWeekCloseOnForwardProgress(mocks.tx as never, {
      mesocycleId: "meso-1",
      workoutWeek: 2,
    });

    expect(result.outcome).toBe("resolved");
    expect(result.resolution).toBe("AUTO_DISMISSED");
    expect(mocks.transitionMesocycleStateInTransaction).toHaveBeenCalledTimes(1);
  });

  it("links an optional workout to a pending week-close row idempotently", async () => {
    mocks.weekCloseUpdateMany.mockReset();
    mocks.weekCloseFindUnique.mockReset();
    mocks.weekCloseUpdateMany.mockResolvedValueOnce({ count: 1 });

    const first = await linkOptionalWorkoutToWeekClose(mocks.tx as never, {
      weekCloseId: "wc-1",
      workoutId: "workout-gap",
    });

    mocks.weekCloseUpdateMany.mockResolvedValueOnce({ count: 0 });
    mocks.weekCloseFindUnique.mockResolvedValueOnce({
      status: "PENDING_OPTIONAL_GAP_FILL",
      optionalWorkoutId: "workout-gap",
    });

    const second = await linkOptionalWorkoutToWeekClose(mocks.tx as never, {
      weekCloseId: "wc-1",
      workoutId: "workout-gap",
    });

    expect(first).toBe("linked");
    expect(second).toBe("already_linked");
  });
});
