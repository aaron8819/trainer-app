/**
 * Protects: Save API is action-based (save_plan / mark_completed / mark_partial / mark_skipped), with backward inference that cannot bypass gating.
 * Why it matters: Save behavior is the highest-risk workflow boundary and must remain deterministic under mixed legacy/new payloads.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const workoutFindUnique = vi.fn();
  const workoutUpsert = vi.fn();
  const workoutExerciseFindMany = vi.fn();
  const workoutExerciseCreate = vi.fn();
  const exerciseFindUnique = vi.fn();
  const loadCurrentBlockContext = vi.fn();
  const transitionMesocycleState = vi.fn();
  const getCurrentMesoWeek = vi.fn();

  const tx = {
    workout: {
      findUnique: workoutFindUnique,
      upsert: workoutUpsert,
    },
    workoutTemplate: {
      findFirst: vi.fn(),
    },
    mesocycle: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    workoutExercise: {
      findMany: workoutExerciseFindMany,
      deleteMany: vi.fn(),
      create: workoutExerciseCreate,
    },
    workoutSet: {
      deleteMany: vi.fn(),
    },
    exercise: {
      findUnique: exerciseFindUnique,
    },
    filteredExercise: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
  };

  const prisma = {
    $transaction: vi.fn(async (callback: (trx: typeof tx) => Promise<void>) => callback(tx)),
  };

  return {
    tx,
    prisma,
    workoutFindUnique,
    workoutUpsert,
    workoutExerciseFindMany,
    workoutExerciseCreate,
    exerciseFindUnique,
    loadCurrentBlockContext,
    transitionMesocycleState,
    getCurrentMesoWeek,
  };
});

vi.mock("@/lib/db/prisma", () => ({
  prisma: mocks.prisma,
}));

vi.mock("@/lib/api/workout-context", () => ({
  resolveOwner: vi.fn(async () => ({ id: "user-1" })),
}));

vi.mock("@/lib/api/exercise-exposure", () => ({
  updateExerciseExposure: vi.fn(async () => undefined),
}));

vi.mock("@/lib/api/periodization", () => ({
  loadCurrentBlockContext: mocks.loadCurrentBlockContext,
}));

vi.mock("@/lib/api/mesocycle-lifecycle", () => ({
  transitionMesocycleState: mocks.transitionMesocycleState,
  getCurrentMesoWeek: mocks.getCurrentMesoWeek,
}));

import { POST } from "./route";

describe("POST /api/workouts/save", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.workoutFindUnique.mockResolvedValue(null);
    mocks.workoutUpsert.mockResolvedValue({ id: "workout-1", revision: 1 });
    mocks.workoutExerciseFindMany.mockResolvedValue([]);
    mocks.exerciseFindUnique.mockResolvedValue({ movementPatterns: [] });
    mocks.workoutExerciseCreate.mockResolvedValue({ id: "we-1" });
    mocks.tx.mesocycle.findUnique.mockResolvedValue(null);
    mocks.tx.mesocycle.findFirst.mockResolvedValue({ id: "meso-active" });
    mocks.tx.mesocycle.update.mockResolvedValue({});
    mocks.transitionMesocycleState.mockResolvedValue({});
    mocks.getCurrentMesoWeek.mockReturnValue(1);
    mocks.loadCurrentBlockContext.mockResolvedValue({
      blockContext: {
        weekInBlock: 3,
        block: { blockType: "accumulation" },
      },
      weekInMeso: 3,
    });
  });

  it.each(["COMPLETED", "PARTIAL", "SKIPPED"] as const)(
    "save_plan with exercise rewrite ignores terminal status %s",
    async (terminalStatus) => {
      const request = new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "workout-1",
          status: terminalStatus,
          exercises: [
            {
              section: "MAIN",
              exerciseId: "bench",
              sets: [{ setIndex: 1, targetReps: 8 }],
            },
          ],
        }),
      });

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.action).toBe("save_plan");
      expect(body.workoutStatus).toBe("PLANNED");

      const upsert = mocks.workoutUpsert.mock.calls[0][0];
      expect(upsert.create.status).toBe("PLANNED");
      expect(upsert.update.status).toBe("PLANNED");
    }
  );

  it("mark_completed resolves to COMPLETED when all sets have logs", async () => {
    mocks.workoutFindUnique
      .mockResolvedValueOnce({
        id: "workout-1",
        userId: "user-1",
        status: "PLANNED",
        revision: 1,
      })
      .mockResolvedValueOnce({
        exercises: [
          {
            sets: [
              { logs: [{ wasSkipped: false, actualReps: 8, actualRpe: 8, actualLoad: 135 }] },
              { logs: [{ wasSkipped: false, actualReps: 8, actualRpe: 8, actualLoad: 135 }] },
            ],
          },
        ],
      });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workoutId: "workout-1", action: "mark_completed" }),
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.workoutStatus).toBe("COMPLETED");
  });

  it("calls lifecycle transition for first performed save when workout has mesocycleId", async () => {
    mocks.workoutFindUnique
      .mockResolvedValueOnce({
        id: "workout-1",
        userId: "user-1",
        status: "PLANNED",
        revision: 1,
        mesocycleId: "meso-1",
      })
      .mockResolvedValueOnce({
        exercises: [
          {
            sets: [{ logs: [{ wasSkipped: false, actualReps: 8, actualRpe: 8, actualLoad: 135 }] }],
          },
        ],
      });
    mocks.tx.mesocycle.findUnique.mockResolvedValueOnce({
      id: "meso-1",
      state: "ACTIVE_ACCUMULATION",
      accumulationSessionsCompleted: 3,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 3,
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workoutId: "workout-1", action: "mark_completed" }),
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.transitionMesocycleState).toHaveBeenCalledWith("meso-1");

    const upsert = mocks.workoutUpsert.mock.calls[0][0];
    expect(upsert.update.mesocycleId).toBe("meso-1");
    expect(upsert.update.mesocycleWeekSnapshot).toBe(1);
    expect(upsert.update.mesoSessionSnapshot).toBe(1);
    expect(upsert.update.mesocyclePhaseSnapshot).toBe("ACCUMULATION");
  });

  it("attaches active mesocycle and transitions lifecycle when first performed save has null mesocycleId", async () => {
    mocks.workoutFindUnique
      .mockResolvedValueOnce({
        id: "workout-1",
        userId: "user-1",
        status: "PLANNED",
        revision: 1,
        mesocycleId: null,
      })
      .mockResolvedValueOnce({
        exercises: [
          {
            sets: [{ logs: [{ wasSkipped: false, actualReps: 8, actualRpe: 8, actualLoad: 135 }] }],
          },
        ],
      });
    mocks.tx.mesocycle.findFirst.mockResolvedValueOnce({
      id: "meso-active",
      state: "ACTIVE_ACCUMULATION",
      accumulationSessionsCompleted: 4,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 3,
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workoutId: "workout-1", action: "mark_completed" }),
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.transitionMesocycleState).toHaveBeenCalledWith("meso-active");
    expect(mocks.tx.mesocycle.update).toHaveBeenCalledWith({
      where: { id: "meso-active" },
      data: { completedSessions: { increment: 1 }, accumulationSessionsCompleted: { increment: 1 } },
    });

    const upsert = mocks.workoutUpsert.mock.calls[0][0];
    expect(upsert.update.mesocycleId).toBe("meso-active");
    expect(upsert.update.mesocycleWeekSnapshot).toBe(1);
    expect(upsert.update.mesoSessionSnapshot).toBe(2);
    expect(upsert.update.mesocyclePhaseSnapshot).toBe("ACCUMULATION");
  });

  it("does not call lifecycle transition for non-performed save", async () => {
    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "workout-1",
          status: "IN_PROGRESS",
          notes: "still training",
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.transitionMesocycleState).not.toHaveBeenCalled();
  });

  it("mark_completed resolves to PARTIAL when unresolved sets remain", async () => {
    mocks.workoutFindUnique
      .mockResolvedValueOnce({
        id: "workout-1",
        userId: "user-1",
        status: "PLANNED",
        revision: 1,
      })
      .mockResolvedValueOnce({
        exercises: [
          {
            sets: [{ logs: [{ wasSkipped: false, actualReps: 8, actualRpe: 8, actualLoad: 135 }] }, { logs: [] }],
          },
        ],
      });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workoutId: "workout-1", action: "mark_completed" }),
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.workoutStatus).toBe("PARTIAL");
  });

  it("treats LOGGED_EMPTY rows as unresolved and marks completion as PARTIAL", async () => {
    mocks.workoutFindUnique
      .mockResolvedValueOnce({
        id: "workout-1",
        userId: "user-1",
        status: "PLANNED",
        revision: 1,
      })
      .mockResolvedValueOnce({
        exercises: [
          {
            sets: [
              { logs: [{ wasSkipped: false, actualReps: 8, actualRpe: 8, actualLoad: 135 }] },
              { logs: [{ wasSkipped: false, actualReps: null, actualRpe: null, actualLoad: null }] },
            ],
          },
        ],
      });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workoutId: "workout-1", action: "mark_completed" }),
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.workoutStatus).toBe("PARTIAL");
  });

  it("mark_completed rejects empty effective completion", async () => {
    mocks.workoutFindUnique
      .mockResolvedValueOnce({
        id: "workout-1",
        userId: "user-1",
        status: "PLANNED",
        revision: 1,
      })
      .mockResolvedValueOnce({
        exercises: [
          {
            sets: [{ logs: [{ wasSkipped: true }] }, { logs: [] }],
          },
        ],
      });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workoutId: "workout-1", action: "mark_completed" }),
      })
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "Cannot mark completed without at least one performed (non-skipped) set log.",
    });
  });

  it("returns 409 for performed saves when no active mesocycle can be resolved", async () => {
    mocks.workoutFindUnique
      .mockResolvedValueOnce({
        id: "workout-1",
        userId: "user-1",
        status: "PLANNED",
        revision: 1,
        mesocycleId: null,
      })
      .mockResolvedValueOnce({
        exercises: [
          {
            sets: [{ logs: [{ wasSkipped: false, actualReps: 8, actualRpe: 8, actualLoad: 135 }] }],
          },
        ],
      });
    mocks.tx.mesocycle.findFirst.mockResolvedValueOnce(null);

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workoutId: "workout-1", action: "mark_completed" }),
      })
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "No active mesocycle found for performed workout save.",
    });
    expect(mocks.transitionMesocycleState).not.toHaveBeenCalled();
  });

  it("cannot bypass rewrite gating via inferred action", async () => {
    mocks.workoutFindUnique.mockResolvedValueOnce({
      id: "workout-1",
      userId: "user-1",
      status: "PARTIAL",
      revision: 2,
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "workout-1",
          status: "COMPLETED",
          exercises: [
            {
              section: "MAIN",
              exerciseId: "bench",
              sets: [{ setIndex: 1, targetReps: 8 }],
            },
          ],
        }),
      })
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "Only PLANNED workouts can be rewritten with a new exercise list",
    });
  });

  it("enforces revision conflict on rewrites", async () => {
    mocks.workoutFindUnique.mockResolvedValueOnce({
      id: "workout-1",
      userId: "user-1",
      status: "PLANNED",
      revision: 3,
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "workout-1",
          expectedRevision: 2,
          exercises: [
            {
              section: "MAIN",
              exerciseId: "bench",
              sets: [{ setIndex: 1, targetReps: 8 }],
            },
          ],
        }),
      })
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "Workout revision conflict. Refresh and try again.",
    });
  });

  it("increments revision for planned workout rewrites", async () => {
    mocks.workoutFindUnique.mockResolvedValueOnce({
      id: "workout-1",
      userId: "user-1",
      status: "PLANNED",
      revision: 1,
    });

    await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "workout-1",
          expectedRevision: 1,
          exercises: [
            {
              section: "MAIN",
              exerciseId: "bench",
              sets: [{ setIndex: 1, targetReps: 8 }],
            },
          ],
        }),
      })
    );

    const upsert = mocks.workoutUpsert.mock.calls[0][0];
    expect(upsert.update.revision).toEqual({ increment: 1 });
  });

  it("persists computed cycle context from DB when payload cycleContext is missing and active mesocycle exists", async () => {
    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "workout-1",
          exercises: [
            {
              section: "MAIN",
              exerciseId: "bench",
              sets: [{ setIndex: 1, targetReps: 8 }],
            },
          ],
        }),
      })
    );
    expect(response.status).toBe(200);

    const upsert = mocks.workoutUpsert.mock.calls[0][0];
    const createMetadata = upsert.create.selectionMetadata as Record<string, unknown>;
    const cycleContext = createMetadata.cycleContext as Record<string, unknown>;
    expect(cycleContext.source).toBe("computed");
    expect(cycleContext.weekInMeso).toBe(3);
    expect(cycleContext.weekInBlock).toBe(3);
    expect(mocks.loadCurrentBlockContext).toHaveBeenCalledTimes(1);
  });

  it("persists valid incoming cycle context as-is and skips DB cycle-context load", async () => {
    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "workout-1",
          selectionMetadata: {
            cycleContext: {
              weekInMeso: 6,
              weekInBlock: 2,
              phase: "deload",
              blockType: "deload",
              isDeload: true,
              source: "computed",
            },
          },
          exercises: [
            {
              section: "MAIN",
              exerciseId: "bench",
              sets: [{ setIndex: 1, targetReps: 8 }],
            },
          ],
        }),
      })
    );
    expect(response.status).toBe(200);

    const upsert = mocks.workoutUpsert.mock.calls[0][0];
    const createMetadata = upsert.create.selectionMetadata as Record<string, unknown>;
    expect(createMetadata.cycleContext).toEqual({
      weekInMeso: 6,
      weekInBlock: 2,
      phase: "deload",
      blockType: "deload",
      isDeload: true,
      source: "computed",
    });
    expect(mocks.loadCurrentBlockContext).not.toHaveBeenCalled();
  });

  it("counters remain consistent when state transition throws after transaction commits", async () => {
    // Both completedSessions and the lifecycle counter (accumulationSessionsCompleted) are written
    // inside the transaction. Even if transitionMesocycleState throws afterward, both counters
    // were already incremented atomically and the save response is still 200.
    mocks.workoutFindUnique
      .mockResolvedValueOnce({
        id: "workout-1",
        userId: "user-1",
        status: "PLANNED",
        revision: 1,
        mesocycleId: "meso-1",
      })
      .mockResolvedValueOnce({
        exercises: [
          {
            sets: [{ logs: [{ wasSkipped: false, actualReps: 8, actualRpe: 8, actualLoad: 135 }] }],
          },
        ],
      });
    mocks.tx.mesocycle.findUnique.mockResolvedValueOnce({
      id: "meso-1",
      state: "ACTIVE_ACCUMULATION",
      accumulationSessionsCompleted: 5,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 3,
    });
    mocks.transitionMesocycleState.mockRejectedValueOnce(new Error("DB timeout"));

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workoutId: "workout-1", action: "mark_completed" }),
      })
    );

    // Save succeeds (lifecycle error is caught and logged, not re-thrown)
    expect(response.status).toBe(200);

    // Both counters were written atomically in the same update inside the transaction
    expect(mocks.tx.mesocycle.update).toHaveBeenCalledWith({
      where: { id: "meso-1" },
      data: { completedSessions: { increment: 1 }, accumulationSessionsCompleted: { increment: 1 } },
    });

    // State transition was attempted (it failed, but the counters are still consistent)
    expect(mocks.transitionMesocycleState).toHaveBeenCalledWith("meso-1");
  });

  it("persists fallback cycle context when payload is missing cycleContext and no active mesocycle exists", async () => {
    mocks.loadCurrentBlockContext.mockResolvedValueOnce({
      blockContext: null,
      weekInMeso: 4,
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "workout-1",
          exercises: [
            {
              section: "MAIN",
              exerciseId: "bench",
              sets: [{ setIndex: 1, targetReps: 8 }],
            },
          ],
        }),
      })
    );
    expect(response.status).toBe(200);

    const upsert = mocks.workoutUpsert.mock.calls[0][0];
    const createMetadata = upsert.create.selectionMetadata as Record<string, unknown>;
    const cycleContext = createMetadata.cycleContext as Record<string, unknown>;
    expect(cycleContext.source).toBe("fallback");
    expect(cycleContext.weekInMeso).toBe(1);
  });
});
