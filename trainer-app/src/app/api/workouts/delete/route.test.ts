import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const workoutFindFirst = vi.fn();
  const workoutDelete = vi.fn();
  const workoutExerciseFindMany = vi.fn();
  const setLogDeleteMany = vi.fn();
  const workoutSetDeleteMany = vi.fn();
  const workoutExerciseDeleteMany = vi.fn();
  const reconcileMesocycleLifecycle = vi.fn();

  const tx = {
    workout: {
      delete: workoutDelete,
    },
    workoutExercise: {
      findMany: workoutExerciseFindMany,
      deleteMany: workoutExerciseDeleteMany,
    },
    workoutSet: {
      deleteMany: workoutSetDeleteMany,
    },
    setLog: {
      deleteMany: setLogDeleteMany,
    },
    mesocycle: {
      update: vi.fn(),
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
    workoutDelete,
    workoutExerciseFindMany,
    setLogDeleteMany,
    workoutSetDeleteMany,
    workoutExerciseDeleteMany,
    reconcileMesocycleLifecycle,
  };
});

vi.mock("@/lib/db/prisma", () => ({
  prisma: mocks.prisma,
}));

vi.mock("@/lib/api/workout-context", () => ({
  resolveOwner: vi.fn(async () => ({ id: "user-1" })),
}));

vi.mock("@/lib/api/mesocycle-lifecycle-reconciliation", () => ({
  reconcileMesocycleLifecycle: (...args: unknown[]) => mocks.reconcileMesocycleLifecycle(...args),
}));

import { POST } from "./route";

describe("POST /api/workouts/delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.workoutExerciseFindMany.mockResolvedValue([]);
    mocks.reconcileMesocycleLifecycle.mockResolvedValue({});
  });

  it("returns 404 when the workout does not exist", async () => {
    mocks.workoutFindFirst.mockResolvedValueOnce(null);

    const response = await POST(
      new Request("http://localhost/api/workouts/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workoutId: "missing-workout" }),
      })
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Workout not found" });
    expect(mocks.workoutDelete).not.toHaveBeenCalled();
  });

  it("reconciles active mesocycle lifecycle after deleting a workout", async () => {
    mocks.workoutFindFirst.mockResolvedValueOnce({
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
        body: JSON.stringify({ workoutId: "workout-1" }),
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
    mocks.workoutFindFirst.mockResolvedValueOnce({
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
        body: JSON.stringify({ workoutId: "workout-1" }),
      })
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error:
        "Cannot delete a historical workout from a completed mesocycle after rollover finalized lifecycle history.",
    });
    expect(mocks.workoutExerciseFindMany).not.toHaveBeenCalled();
    expect(mocks.workoutDelete).not.toHaveBeenCalled();
    expect(mocks.reconcileMesocycleLifecycle).not.toHaveBeenCalled();
  });

  it("still allows deleting an inactive but non-completed mesocycle workout", async () => {
    mocks.workoutFindFirst.mockResolvedValueOnce({
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
        body: JSON.stringify({ workoutId: "workout-1" }),
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
});
