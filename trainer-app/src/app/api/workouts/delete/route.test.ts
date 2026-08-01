import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const workoutFindFirst = vi.fn();
  const workoutUpdateMany = vi.fn();
  const workoutDelete = vi.fn();
  const workoutExerciseFindMany = vi.fn();
  const finisherOfferFindUnique = vi.fn();
  const setLogDeleteMany = vi.fn();
  const workoutSetDeleteMany = vi.fn();
  const workoutExerciseDeleteMany = vi.fn();
  const reconcileMesocycleLifecycle = vi.fn();
  const mesocycleFindUnique = vi.fn();
  const userUpdateMany = vi.fn();

  const tx = {
    workout: {
      findFirst: workoutFindFirst,
      updateMany: workoutUpdateMany,
      delete: workoutDelete,
    },
    workoutExercise: {
      findMany: workoutExerciseFindMany,
      deleteMany: workoutExerciseDeleteMany,
    },
    finisherOffer: {
      findUnique: finisherOfferFindUnique,
    },
    workoutSet: {
      deleteMany: workoutSetDeleteMany,
    },
    setLog: {
      deleteMany: setLogDeleteMany,
    },
    mesocycle: {
      findUnique: mesocycleFindUnique,
      update: vi.fn(),
    },
    user: {
      updateMany: userUpdateMany,
    },
  };

  const prisma = {
    workout: {
      findFirst: workoutFindFirst,
    },
    $transaction: vi.fn(async (callback: (trx: typeof tx) => Promise<void>) => callback(tx)),
  };

  return {
    prisma,
    tx,
    workoutFindFirst,
    workoutUpdateMany,
    workoutDelete,
    workoutExerciseFindMany,
    finisherOfferFindUnique,
    setLogDeleteMany,
    workoutSetDeleteMany,
    workoutExerciseDeleteMany,
    reconcileMesocycleLifecycle,
    mesocycleFindUnique,
    userUpdateMany,
  };
});

vi.mock("@/lib/db/prisma", () => ({
  prisma: mocks.prisma,
}));

vi.mock("@/lib/api/workout-context", () => ({
  provisionOwnerForMutation: vi.fn(async () => ({ id: "user-1" })),
}));

vi.mock("@/lib/api/mesocycle-lifecycle-reconciliation", () => ({
  reconcileMesocycleLifecycle: (...args: unknown[]) => mocks.reconcileMesocycleLifecycle(...args),
}));

import { POST } from "./route";

describe("POST /api/workouts/delete", () => {
  const originalRollout = process.env.TRAINER_FINISHERS_ROLLOUT;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.TRAINER_FINISHERS_ROLLOUT;
    mocks.workoutExerciseFindMany.mockResolvedValue([]);
    mocks.workoutUpdateMany.mockResolvedValue({ count: 1 });
    mocks.reconcileMesocycleLifecycle.mockResolvedValue({});
    mocks.mesocycleFindUnique.mockResolvedValue({ macroCycleId: "macro-1" });
    mocks.userUpdateMany.mockResolvedValue({ count: 1 });
  });

  afterEach(() => {
    if (originalRollout == null) {
      delete process.env.TRAINER_FINISHERS_ROLLOUT;
    } else {
      process.env.TRAINER_FINISHERS_ROLLOUT = originalRollout;
    }
  });

  it("returns 404 when the workout does not exist", async () => {
    mocks.workoutUpdateMany.mockResolvedValueOnce({ count: 0 });
    mocks.workoutFindFirst.mockResolvedValue(null);

    const response = await POST(
      new Request("http://localhost/api/workouts/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workoutId: "missing-workout", expectedRevision: 1 }),
      })
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Workout not found",
      code: "WORKOUT_NOT_FOUND",
    });
    expect(mocks.workoutDelete).not.toHaveBeenCalled();
  });

  it("reconciles active mesocycle lifecycle after deleting a workout", async () => {
    mocks.workoutFindFirst.mockResolvedValue({
      id: "workout-1",
      mesocycleId: "meso-1",
      mesocycle: {
        id: "meso-1",
        durationWeeks: 5,
        sessionsPerWeek: 3,
        state: "ACTIVE_ACCUMULATION",
        isActive: true,
      },
    });
    mocks.workoutExerciseFindMany.mockResolvedValueOnce([{ id: "we-1" }]);

    const response = await POST(
      new Request("http://localhost/api/workouts/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workoutId: "workout-1", expectedRevision: 1 }),
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.setLogDeleteMany).toHaveBeenCalledWith({
      where: { workoutSet: { workoutExerciseId: { in: ["we-1"] } } },
    });
    expect(mocks.workoutSetDeleteMany).toHaveBeenCalledWith({
      where: { workoutExerciseId: { in: ["we-1"] } },
    });
    expect(mocks.workoutExerciseDeleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["we-1"] } },
    });
    expect(mocks.workoutDelete).toHaveBeenCalledWith({ where: { id: "workout-1" } });
    expect(mocks.reconcileMesocycleLifecycle).toHaveBeenCalledWith(
      mocks.tx,
      expect.objectContaining({
        id: "meso-1",
        durationWeeks: 5,
        sessionsPerWeek: 3,
        state: "ACTIVE_ACCUMULATION",
      })
    );
  });

  it("does not reopen a completed mesocycle during delete cleanup", async () => {
    mocks.workoutFindFirst.mockResolvedValue({
      id: "workout-1",
      mesocycleId: "meso-1",
      mesocycle: {
        id: "meso-1",
        durationWeeks: 5,
        sessionsPerWeek: 3,
        state: "COMPLETED",
        isActive: false,
      },
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workoutId: "workout-1", expectedRevision: 1 }),
      })
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error:
        "Cannot delete a historical workout from a completed mesocycle after closeout finalized lifecycle history.",
      code: "WORKOUT_DELETE_CONFLICT",
    });
    expect(mocks.workoutExerciseFindMany).not.toHaveBeenCalled();
    expect(mocks.workoutDelete).not.toHaveBeenCalled();
    expect(mocks.reconcileMesocycleLifecycle).not.toHaveBeenCalled();
  });

  it("still allows deleting an inactive but non-completed mesocycle workout", async () => {
    mocks.workoutFindFirst.mockResolvedValue({
      id: "workout-1",
      mesocycleId: "meso-1",
      mesocycle: {
        id: "meso-1",
        durationWeeks: 5,
        sessionsPerWeek: 3,
        state: "ACTIVE_DELOAD",
        isActive: false,
      },
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workoutId: "workout-1", expectedRevision: 1 }),
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.workoutDelete).toHaveBeenCalledWith({ where: { id: "workout-1" } });
    expect(mocks.reconcileMesocycleLifecycle).toHaveBeenCalledWith(
      mocks.tx,
      expect.objectContaining({
        id: "meso-1",
        state: "ACTIVE_DELOAD",
        isActive: false,
      })
    );
  });

  it.each([
    "SELECTED",
    "IN_PROGRESS",
    "PARTIAL",
    "COMPLETED",
    "SKIPPED",
    "DISMISSED",
  ])(
    "rejects deletion atomically when %s Finisher truth is attached",
    async (state) => {
      process.env.TRAINER_FINISHERS_ROLLOUT = "enabled";
      mocks.workoutFindFirst.mockResolvedValue({
        id: "workout-1",
        mesocycleId: null,
        mesocycle: null,
      });
      mocks.finisherOfferFindUnique.mockResolvedValue({
        id: "finisher-offer-1",
        state,
      });

      const response = await POST(
        new Request("http://localhost/api/workouts/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workoutId: "workout-1",
            expectedRevision: 1,
          }),
        }),
      );

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({
        error: "Workout cannot be deleted because Finisher history is attached.",
        code: "WORKOUT_FINISHER_HISTORY_CONFLICT",
      });
      expect(mocks.workoutExerciseFindMany).not.toHaveBeenCalled();
      expect(mocks.workoutDelete).not.toHaveBeenCalled();
      expect(mocks.finisherOfferFindUnique).toHaveBeenCalledWith({
        where: { workoutId: "workout-1" },
        select: { id: true },
      });
    },
  );
});
