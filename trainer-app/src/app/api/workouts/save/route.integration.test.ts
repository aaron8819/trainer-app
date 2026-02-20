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

import { POST } from "./route";

describe("POST /api/workouts/save", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.workoutFindUnique.mockResolvedValue(null);
    mocks.workoutUpsert.mockResolvedValue({ id: "workout-1", revision: 1 });
    mocks.workoutExerciseFindMany.mockResolvedValue([]);
    mocks.exerciseFindUnique.mockResolvedValue({ movementPatterns: [] });
    mocks.workoutExerciseCreate.mockResolvedValue({ id: "we-1" });
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
              { logs: [{ wasSkipped: false }] },
              { logs: [{ wasSkipped: false }] },
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
            sets: [{ logs: [{ wasSkipped: false }] }, { logs: [] }],
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
});
