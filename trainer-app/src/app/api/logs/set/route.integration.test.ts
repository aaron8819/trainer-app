/**
 * Protects: Schema invariants: Workout.revision (if implemented), WorkoutExercise orderIndex uniqueness, SetLog upsert idempotency.
 * Why it matters: Logging the same set repeatedly must update one canonical row rather than creating duplicates.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const workoutSetFindFirst = vi.fn();
  const setLogFindUnique = vi.fn();
  const setLogUpsert = vi.fn();
  const workoutUpdate = vi.fn();

  const tx = {
    workoutSet: { findFirst: workoutSetFindFirst },
    setLog: {
      findUnique: setLogFindUnique,
      upsert: setLogUpsert,
      deleteMany: vi.fn(),
    },
    workout: { update: workoutUpdate },
  };

  const prisma = {
    $transaction: vi.fn(async (callback: (trx: typeof tx) => Promise<unknown>) => callback(tx)),
  };

  return {
    prisma,
    workoutSetFindFirst,
    setLogFindUnique,
    setLogUpsert,
    workoutUpdate,
  };
});

vi.mock("@/lib/db/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/api/workout-context", () => ({
  resolveOwner: vi.fn(async () => ({ id: "user-1" })),
}));

import { POST } from "./route";

describe("POST /api/logs/set", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.workoutSetFindFirst.mockResolvedValue({
      id: "set-1",
      workoutExercise: { workout: { id: "workout-1", status: "PLANNED" } },
    });
    mocks.setLogUpsert.mockResolvedValue({ id: "log-1" });
    mocks.workoutUpdate.mockResolvedValue({ id: "workout-1", status: "IN_PROGRESS" });
  });

  it("uses setLog.upsert keyed by workoutSetId for idempotent writes", async () => {
    mocks.setLogFindUnique.mockResolvedValue({
      actualReps: 8,
      actualRpe: 8,
      actualLoad: 185,
      wasSkipped: false,
      notes: "prev",
    });

    const response = await POST(
      new Request("http://localhost/api/logs/set", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutSetId: "set-1",
          actualReps: 9,
          actualRpe: 8.5,
          actualLoad: 190,
        }),
      })
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.status).toBe("logged");
    expect(payload.wasCreated).toBe(false);

    expect(mocks.setLogUpsert).toHaveBeenCalledTimes(1);
    expect(mocks.setLogUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workoutSetId: "set-1" },
      })
    );
  });

  it("stores provided load value unchanged", async () => {
    mocks.setLogFindUnique.mockResolvedValue(null);

    const response = await POST(
      new Request("http://localhost/api/logs/set", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutSetId: "set-1",
          actualReps: 8,
          actualRpe: 8,
          actualLoad: 90,
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.setLogUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ actualLoad: 90 }),
        create: expect.objectContaining({ actualLoad: 90 }),
      })
    );
  });
});
