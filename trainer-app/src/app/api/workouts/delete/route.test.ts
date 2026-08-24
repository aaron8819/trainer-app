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
  const assessClosedHandoffDeletionInTransaction = vi.fn();
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
    assessClosedHandoffDeletionInTransaction,
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
  assessClosedHandoffDeletionInTransaction: (...args: unknown[]) =>
    mocks.assessClosedHandoffDeletionInTransaction(...args),
}));

import { POST } from "./route";
import { normalizeAcceptedHypertrophySeedV4 } from "@/lib/api/mesocycle-seed-revision";
import { buildAcceptedCompatibilityProjections } from "@/lib/engine/hypertrophy-plan-authoring";
import { buildV4CustomPlanReferenceAcceptedSeed } from "@/lib/engine/hypertrophy-plan-authoring-v4.fixture";

function exactV4Mesocycle() {
  const seedPayload = buildV4CustomPlanReferenceAcceptedSeed();
  const normalized = normalizeAcceptedHypertrophySeedV4(seedPayload);
  return {
    id: "meso-v4",
    durationWeeks: 5,
    sessionsPerWeek: 4,
    state: "AWAITING_HANDOFF",
    isActive: false,
    completedSessions: 20,
    accumulationSessionsCompleted: 16,
    deloadSessionsCompleted: 4,
    slotSequenceJson: buildAcceptedCompatibilityProjections(seedPayload).slotSequenceJson,
    currentSeedRevisionId: "revision-v4",
    currentSeedRevision: {
      id: "revision-v4",
      mesocycleId: "meso-v4",
      revision: 1,
      seedPayload,
      payloadHash: normalized.hash,
      hashAlgorithm: "sha256",
      provenanceStatus: "exact",
    },
  };
}

describe("POST /api/workouts/delete", () => {
  const originalRollout = process.env.TRAINER_FINISHERS_ROLLOUT;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.TRAINER_FINISHERS_ROLLOUT;
    mocks.workoutExerciseFindMany.mockResolvedValue([]);
    mocks.workoutUpdateMany.mockResolvedValue({ count: 1 });
    mocks.reconcileMesocycleLifecycle.mockResolvedValue({});
    mocks.assessClosedHandoffDeletionInTransaction.mockResolvedValue({
      safe: true,
    });
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

  it("rejects a closed-handoff deletion when reconciliation would reactivate it", async () => {
    mocks.workoutFindFirst.mockResolvedValue({
      id: "workout-1",
      mesocycleId: "meso-1",
      mesocycle: {
        id: "meso-1",
        durationWeeks: 5,
        sessionsPerWeek: 4,
        state: "AWAITING_HANDOFF",
        isActive: false,
        completedSessions: 19,
        accumulationSessionsCompleted: 16,
        deloadSessionsCompleted: 3,
        slotSequenceJson: { version: 1 },
        currentSeedRevision: null,
      },
    });
    mocks.assessClosedHandoffDeletionInTransaction.mockResolvedValue({
      safe: false,
      reason: "authored_obligation_unresolved",
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workoutId: "workout-1", expectedRevision: 1 }),
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error:
        "Cannot delete this workout because the closed mesocycle would become unresolved.",
      code: "WORKOUT_DELETE_CLOSED_LIFECYCLE_REGRESSION",
    });
    expect(mocks.workoutDelete).toHaveBeenCalled();
    expect(mocks.reconcileMesocycleLifecycle).not.toHaveBeenCalled();
  });

  it("allows closed-handoff deletion when strict obligations remain resolved", async () => {
    mocks.workoutFindFirst.mockResolvedValue({
      id: "workout-1",
      mesocycleId: "meso-1",
      mesocycle: {
        id: "meso-1",
        durationWeeks: 5,
        sessionsPerWeek: 4,
        state: "AWAITING_HANDOFF",
        isActive: false,
        completedSessions: 19,
        accumulationSessionsCompleted: 16,
        deloadSessionsCompleted: 3,
        slotSequenceJson: { version: 1 },
        currentSeedRevision: null,
      },
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workoutId: "workout-1", expectedRevision: 1 }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.assessClosedHandoffDeletionInTransaction).toHaveBeenCalled();
    expect(mocks.reconcileMesocycleLifecycle).toHaveBeenCalled();
  });

  it("leaves accepted V4 deletion dispatch unchanged", async () => {
    mocks.workoutFindFirst.mockResolvedValue({
      id: "workout-v4",
      mesocycleId: "meso-v4",
      mesocycle: exactV4Mesocycle(),
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workoutId: "workout-v4", expectedRevision: 1 }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.assessClosedHandoffDeletionInTransaction).not.toHaveBeenCalled();
    expect(mocks.reconcileMesocycleLifecycle).toHaveBeenCalled();
  });

  it("rejects raw version 4 without exact authority before deletion", async () => {
    mocks.workoutFindFirst.mockResolvedValue({
      id: "workout-v4-like",
      mesocycleId: "meso-v4-like",
      mesocycle: {
        id: "meso-v4-like",
        durationWeeks: 5,
        sessionsPerWeek: 4,
        state: "AWAITING_HANDOFF",
        isActive: false,
        completedSessions: 20,
        accumulationSessionsCompleted: 16,
        deloadSessionsCompleted: 4,
        slotSequenceJson: { version: 1 },
        currentSeedRevision: { seedPayload: { version: 4 } },
      },
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "workout-v4-like",
          expectedRevision: 1,
        }),
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error:
        "Cannot delete this workout because exact V4 schedule authority could not be validated.",
      code: "V4_SCHEDULE_RESOLUTION_BLOCKED",
    });
    expect(mocks.workoutDelete).not.toHaveBeenCalled();
    expect(mocks.assessClosedHandoffDeletionInTransaction).not.toHaveBeenCalled();
    expect(mocks.reconcileMesocycleLifecycle).not.toHaveBeenCalled();
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
