/**
 * Protects: Schema invariants: Workout.revision (if implemented), WorkoutExercise orderIndex uniqueness, SetLog upsert idempotency.
 * Why it matters: Logging the same set repeatedly must update one canonical row rather than creating duplicates.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const workoutSetFindFirst = vi.fn();
  const workoutSetCreate = vi.fn();
  const workoutExerciseFindFirst = vi.fn();
  const workoutExerciseFindMany = vi.fn();
  const setLogFindUnique = vi.fn();
  const setLogUpsert = vi.fn();
  const setLogCreate = vi.fn();
  const workoutUpdate = vi.fn();
  const workoutUpdateMany = vi.fn();
  const workoutFindFirst = vi.fn();

  const tx = {
    workoutSet: { findFirst: workoutSetFindFirst, create: workoutSetCreate },
    workoutExercise: {
      findFirst: workoutExerciseFindFirst,
      findMany: workoutExerciseFindMany,
    },
    setLog: {
      findUnique: setLogFindUnique,
      upsert: setLogUpsert,
      create: setLogCreate,
      deleteMany: vi.fn(),
    },
    workout: {
      update: workoutUpdate,
      updateMany: workoutUpdateMany,
      findFirst: workoutFindFirst,
    },
  };

  const prisma = {
    workoutSet: { findFirst: workoutSetFindFirst },
    workoutExercise: { findFirst: workoutExerciseFindFirst },
    $transaction: vi.fn(async (callback: (trx: typeof tx) => Promise<unknown>) => callback(tx)),
  };

  return {
    prisma,
    workoutSetFindFirst,
    workoutSetCreate,
    workoutExerciseFindFirst,
    workoutExerciseFindMany,
    setLogFindUnique,
    setLogUpsert,
    setLogCreate,
    workoutUpdate,
    workoutUpdateMany,
    workoutFindFirst,
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
    mocks.workoutUpdateMany.mockResolvedValue({ count: 1 });
    mocks.workoutFindFirst.mockResolvedValue({
      id: "workout-1",
      revision: 2,
      status: "IN_PROGRESS",
      mesocycleId: null,
    });
    mocks.workoutSetFindFirst.mockResolvedValue({
      id: "set-1",
      targetLoad: 185,
      workoutExercise: {
        workoutId: "workout-1",
        workout: { id: "workout-1", status: "PLANNED", mesocycleId: null, mesocycle: null },
      },
    });
    mocks.setLogUpsert.mockResolvedValue({ id: "log-1" });
    mocks.setLogCreate.mockResolvedValue({ id: "warmup-log-1" });
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
          expectedRevision: 1,
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
          expectedRevision: 1,
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

  it("defaults omitted set intent to work", async () => {
    mocks.setLogFindUnique.mockResolvedValue(null);

    const response = await POST(
      new Request("http://localhost/api/logs/set", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedRevision: 1,
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
        update: expect.objectContaining({ setIntent: "WORK" }),
        create: expect.objectContaining({ setIntent: "WORK" }),
      })
    );
  });

  it("persists warmup/ramp set intent when provided", async () => {
    mocks.setLogFindUnique.mockResolvedValue(null);

    const response = await POST(
      new Request("http://localhost/api/logs/set", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedRevision: 1,
          workoutSetId: "set-1",
          actualReps: 12,
          actualRpe: 8,
          actualLoad: 55,
          setIntent: "WARMUP",
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.setLogUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ setIntent: "WARMUP" }),
        create: expect.objectContaining({ setIntent: "WARMUP" }),
      })
    );
  });

  it("creates and logs a session-local warmup set by workoutExerciseId", async () => {
    mocks.workoutExerciseFindFirst.mockResolvedValue({
      id: "we-1",
      workoutId: "workout-1",
      exerciseId: "bench",
      section: "MAIN",
      isMainLift: true,
      workout: {
        id: "workout-1",
        status: "PLANNED",
        selectionMetadata: {
          sessionDecisionReceipt: {
            version: 1,
            cycleContext: {
              weekInMeso: 1,
              weekInBlock: 1,
              phase: "accumulation",
              blockType: "accumulation",
              isDeload: false,
              source: "computed",
            },
            lifecycleVolume: { source: "unknown" },
            sorenessSuppressedMuscles: [],
            deloadDecision: {
              mode: "none",
              reason: [],
              reductionPercent: 0,
              appliedTo: "none",
            },
            readiness: {
              wasAutoregulated: false,
              signalAgeHours: null,
              fatigueScoreOverall: null,
              intensityScaling: {
                applied: false,
                exerciseIds: [],
                scaledUpCount: 0,
                scaledDownCount: 0,
              },
            },
            exceptions: [],
          },
          sessionAuditSnapshot: {
            version: 1,
            generated: {
              selectionMode: "INTENT",
              sessionIntent: "push",
              exerciseCount: 1,
              hardSetCount: 2,
              exercises: [
                {
                  exerciseId: "bench",
                  exerciseName: "Bench Press",
                  orderIndex: 0,
                  section: "main",
                  isMainLift: true,
                  prescribedSetCount: 2,
                  prescribedSets: [
                    { setIndex: 1, targetReps: 8, targetRpe: 8 },
                    { setIndex: 2, targetReps: 8, targetRpe: 8 },
                  ],
                },
              ],
            },
          },
        },
        selectionMode: "INTENT",
        sessionIntent: "PUSH",
        mesocycleId: null,
        mesocycle: null,
      },
      sets: [
        {
          setIndex: 1,
          targetReps: 8,
          targetRepMin: 6,
          targetRepMax: 10,
          targetRpe: 8,
          targetLoad: 185,
          restSeconds: 180,
        },
      ],
    });
    mocks.workoutSetCreate.mockResolvedValueOnce({
      id: "warmup-set-1",
      setIndex: 0,
      targetReps: 8,
      targetRepMin: 6,
      targetRepMax: 10,
      targetRpe: 8,
      targetLoad: 185,
      restSeconds: 60,
    });
    mocks.workoutExerciseFindMany.mockResolvedValueOnce([
      {
        exerciseId: "bench",
        orderIndex: 0,
        section: "MAIN",
        exercise: { name: "Bench Press" },
        sets: [
          { setIndex: 0, targetReps: 8, targetRepMin: 6, targetRepMax: 10, targetRpe: 8 },
          { setIndex: 1, targetReps: 8, targetRepMin: 6, targetRepMax: 10, targetRpe: 8 },
          { setIndex: 2, targetReps: 8, targetRepMin: 6, targetRepMax: 10, targetRpe: 8 },
        ],
      },
    ]);

    const response = await POST(
      new Request("http://localhost/api/logs/set", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedRevision: 1,
          workoutExerciseId: "we-1",
          actualReps: 8,
          actualRpe: 6,
          actualLoad: 95,
          setIntent: "WARMUP",
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.workoutSetCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          workoutExerciseId: "we-1",
          setIndex: 0,
          restSeconds: 60,
        }),
      })
    );
    expect(mocks.setLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workoutSetId: "warmup-set-1",
        setIntent: "WARMUP",
        actualReps: 8,
        actualRpe: 6,
        actualLoad: 95,
        wasSkipped: false,
      }),
    });
    expect(mocks.workoutUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "workout-1" },
        data: expect.objectContaining({
          status: "IN_PROGRESS",
          selectionMetadata: expect.objectContaining({
            runtimeEditReconciliation: expect.objectContaining({
              ops: [
                expect.objectContaining({
                  kind: "add_set",
                  source: "api_workouts_add_set",
                  scope: "current_workout_only",
                  facts: expect.objectContaining({
                    workoutExerciseId: "we-1",
                    workoutSetId: "warmup-set-1",
                    setIndex: 0,
                    clonedFromSetIndex: 1,
                  }),
                }),
              ],
            }),
          }),
        }),
      })
    );
    await expect(response.json()).resolves.toMatchObject({
      status: "logged",
      wasCreated: true,
      set: {
        setId: "warmup-set-1",
        setIndex: 0,
        setIntent: "WARMUP",
        isRuntimeAdded: true,
        restSeconds: 60,
      },
    });
  });

  it("normalizes bodyweight performed-set load to 0 when targetLoad is 0 and actualLoad is omitted", async () => {
    mocks.workoutSetFindFirst.mockResolvedValue({
      id: "set-bw",
      targetLoad: 0,
      workoutExercise: {
        workoutId: "workout-1",
        workout: { id: "workout-1", status: "PLANNED", mesocycleId: null, mesocycle: null },
      },
    });
    mocks.setLogFindUnique.mockResolvedValue(null);

    const response = await POST(
      new Request("http://localhost/api/logs/set", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedRevision: 1,
          workoutSetId: "set-bw",
          actualReps: 10,
          actualRpe: 8,
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.setLogUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ actualLoad: 0 }),
        create: expect.objectContaining({ actualLoad: 0 }),
      })
    );
  });

  it("rejects empty non-skipped logs so unresolved sets remain missing", async () => {
    mocks.setLogFindUnique.mockResolvedValue(null);

    const response = await POST(
      new Request("http://localhost/api/logs/set", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedRevision: 1,
          workoutSetId: "set-1",
        }),
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Add reps or RPE to log this set, or skip it.",
    });
    expect(mocks.setLogUpsert).not.toHaveBeenCalled();
  });

  it("rejects load-only performed logs using the shared validity helper", async () => {
    mocks.setLogFindUnique.mockResolvedValue(null);

    const response = await POST(
      new Request("http://localhost/api/logs/set", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedRevision: 1,
          workoutSetId: "set-1",
          actualLoad: 90,
        }),
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Load alone will not save. Add reps or RPE, or skip the set.",
    });
    expect(mocks.setLogUpsert).not.toHaveBeenCalled();
  });

  it("blocks set logging when the workout belongs to a closed mesocycle", async () => {
    mocks.workoutSetFindFirst.mockResolvedValue({
      id: "set-1",
      targetLoad: 185,
      workoutExercise: {
        workoutId: "workout-1",
        workout: {
          id: "workout-1",
          status: "PLANNED",
          mesocycleId: "meso-1",
          mesocycle: { state: "COMPLETED", isActive: false },
        },
      },
    });

    const response = await POST(
      new Request("http://localhost/api/logs/set", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedRevision: 1,
          workoutSetId: "set-1",
          actualReps: 8,
          actualRpe: 8,
        }),
      })
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "This workout belongs to a completed mesocycle and can no longer be resumed.",
    });
    expect(mocks.setLogUpsert).not.toHaveBeenCalled();
    expect(mocks.workoutUpdate).not.toHaveBeenCalled();
  });
});
