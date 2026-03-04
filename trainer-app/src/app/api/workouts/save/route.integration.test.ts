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

function buildCanonicalSelectionMetadata(overrides?: Record<string, unknown>) {
  return {
    sessionDecisionReceipt: {
      version: 1,
      cycleContext: {
        weekInMeso: 4,
        weekInBlock: 2,
        phase: "accumulation",
        blockType: "accumulation",
        isDeload: false,
        source: "computed",
      },
      lifecycleVolume: {
        source: "unknown",
      },
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
    ...overrides,
  };
}

describe("POST /api/workouts/save", () => {
  beforeEach(() => {
    mocks.workoutFindUnique.mockReset();
    mocks.workoutUpsert.mockReset();
    mocks.workoutExerciseFindMany.mockReset();
    mocks.workoutExerciseCreate.mockReset();
    mocks.exerciseFindUnique.mockReset();
    mocks.loadCurrentBlockContext.mockReset();
    mocks.transitionMesocycleState.mockReset();
    mocks.getCurrentMesoWeek.mockReset();
    mocks.tx.mesocycle.findUnique.mockReset();
    mocks.tx.mesocycle.findFirst.mockReset();
    mocks.tx.mesocycle.update.mockReset();
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
          selectionMetadata: buildCanonicalSelectionMetadata(),
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
        selectionMetadata: buildCanonicalSelectionMetadata(),
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

  it("preserves persisted canonical selectionMetadata for mark_completed when the request omits it", async () => {
    const persistedReceipt = {
      version: 1,
      cycleContext: {
        weekInMeso: 4,
        weekInBlock: 2,
        phase: "accumulation",
        blockType: "accumulation",
        isDeload: false,
        source: "computed",
      },
      lifecycleRirTarget: { min: 1, max: 2 },
      lifecycleVolume: {
        targets: { Chest: 16 },
        source: "lifecycle",
      },
      sorenessSuppressedMuscles: ["Chest"],
      deloadDecision: {
        mode: "none",
        reason: [],
        reductionPercent: 0,
        appliedTo: "none",
      },
      readiness: {
        wasAutoregulated: true,
        signalAgeHours: 6,
        fatigueScoreOverall: 0.41,
        intensityScaling: {
          applied: true,
          exerciseIds: ["bench"],
          scaledUpCount: 0,
          scaledDownCount: 1,
        },
        rationale: "Readiness scaled pressing volume.",
      },
      exceptions: [
        {
          code: "readiness_scale",
          message: "Readiness scaled 1 exercise(s): 1 down, 0 up.",
        },
      ],
    };

    mocks.workoutFindUnique
      .mockResolvedValueOnce({
        id: "workout-1",
        userId: "user-1",
        status: "IN_PROGRESS",
        revision: 3,
        mesocycleId: "meso-1",
        selectionMetadata: {
          rationale: { bench: { selectedStep: "pin", score: 0.9, components: { pinned: 1 }, hardFilterPass: true } },
          selectedExerciseIds: ["bench"],
          sessionDecisionReceipt: persistedReceipt,
        },
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

    const upsert = mocks.workoutUpsert.mock.calls[0][0];
    const selectionMetadata = upsert.update.selectionMetadata as Record<string, unknown>;
    const receipt = selectionMetadata.sessionDecisionReceipt as Record<string, unknown>;
    const lifecycleVolume = receipt.lifecycleVolume as Record<string, unknown>;
    const readiness = receipt.readiness as Record<string, unknown>;
    const intensityScaling = readiness.intensityScaling as Record<string, unknown>;

    expect(selectionMetadata.rationale).toEqual({
      bench: { selectedStep: "pin", score: 0.9, components: { pinned: 1 }, hardFilterPass: true },
    });
    expect(selectionMetadata.selectedExerciseIds).toEqual(["bench"]);
    expect(receipt.cycleContext).toEqual(
      expect.objectContaining({
        weekInMeso: 4,
        weekInBlock: 2,
        phase: "accumulation",
        blockType: "accumulation",
        isDeload: false,
        source: "computed",
      })
    );
    expect(receipt.lifecycleRirTarget).toEqual({ min: 1, max: 2 });
    expect((lifecycleVolume.targets as Record<string, unknown>).Chest).toBe(16);
    expect(readiness.wasAutoregulated).toBe(true);
    expect(readiness.signalAgeHours).toBe(6);
    expect(readiness.fatigueScoreOverall).toBe(0.41);
    expect(intensityScaling.exerciseIds).toEqual(["bench"]);
    expect(intensityScaling.scaledDownCount).toBe(1);
    expect(mocks.loadCurrentBlockContext).not.toHaveBeenCalled();
  });

  it("calls lifecycle transition for first performed save when workout has mesocycleId", async () => {
    mocks.workoutFindUnique
      .mockResolvedValueOnce({
        id: "workout-1",
        userId: "user-1",
        status: "PLANNED",
        revision: 1,
        mesocycleId: "meso-1",
        selectionMetadata: buildCanonicalSelectionMetadata(),
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
        selectionMetadata: buildCanonicalSelectionMetadata(),
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
          selectionMetadata: buildCanonicalSelectionMetadata(),
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
        selectionMetadata: buildCanonicalSelectionMetadata(),
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

  it.each([
    ["mark_partial", "PARTIAL"],
    ["mark_skipped", "SKIPPED"],
  ] as const)(
    "%s preserves persisted canonical selectionMetadata when the request omits it",
    async (action, expectedStatus) => {
      const persistedReceipt = {
        version: 1,
        cycleContext: {
          weekInMeso: 5,
          weekInBlock: 1,
          phase: "deload",
          blockType: "deload",
          isDeload: true,
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
      };

      mocks.workoutFindUnique.mockResolvedValueOnce({
        id: "workout-1",
        userId: "user-1",
        status: "IN_PROGRESS",
        revision: 2,
        mesocycleId: null,
        selectionMetadata: {
          sessionDecisionReceipt: persistedReceipt,
          selectedExerciseIds: ["bench"],
        },
      });

      const response = await POST(
        new Request("http://localhost/api/workouts/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workoutId: "workout-1", action }),
        })
      );

      expect(response.status).toBe(200);
      const upsert = mocks.workoutUpsert.mock.calls[0][0];
      expect(upsert.update.status).toBe(expectedStatus);
      expect(upsert.update.selectionMetadata).toEqual({
        sessionDecisionReceipt: persistedReceipt,
        selectedExerciseIds: ["bench"],
      });
      expect(mocks.loadCurrentBlockContext).not.toHaveBeenCalled();
    }
  );

  it("treats LOGGED_EMPTY rows as unresolved and marks completion as PARTIAL", async () => {
    mocks.workoutFindUnique
      .mockResolvedValueOnce({
        id: "workout-1",
        userId: "user-1",
        status: "PLANNED",
        revision: 1,
        selectionMetadata: buildCanonicalSelectionMetadata(),
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
        selectionMetadata: buildCanonicalSelectionMetadata(),
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
        selectionMetadata: buildCanonicalSelectionMetadata(),
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
      selectionMetadata: buildCanonicalSelectionMetadata(),
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "workout-1",
          status: "COMPLETED",
          selectionMetadata: buildCanonicalSelectionMetadata(),
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
      selectionMetadata: buildCanonicalSelectionMetadata(),
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "workout-1",
          expectedRevision: 2,
          selectionMetadata: buildCanonicalSelectionMetadata(),
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
      selectionMetadata: buildCanonicalSelectionMetadata(),
    });

    await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "workout-1",
          expectedRevision: 1,
          selectionMetadata: buildCanonicalSelectionMetadata(),
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

  it("rejects save_plan when canonical receipt metadata is missing", async () => {
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
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "Canonical selectionMetadata.sessionDecisionReceipt is required.",
    });
    expect(mocks.workoutUpsert).not.toHaveBeenCalled();
  });

  it("persists canonical receipt cycle context as-is and skips DB cycle-context load", async () => {
    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "workout-1",
          selectionMetadata: {
            sessionDecisionReceipt: {
              version: 1,
              cycleContext: {
                weekInMeso: 6,
                weekInBlock: 2,
                phase: "deload",
                blockType: "deload",
                isDeload: true,
                source: "computed",
              },
              lifecycleVolume: {
                source: "unknown",
              },
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
    expect(createMetadata.cycleContext).toBeUndefined();
    expect((createMetadata.sessionDecisionReceipt as Record<string, unknown>).cycleContext).toEqual({
      weekInMeso: 6,
      weekInBlock: 2,
      phase: "deload",
      blockType: "deload",
      isDeload: true,
      source: "computed",
    });
    expect(mocks.loadCurrentBlockContext).not.toHaveBeenCalled();
  });

  it("rejects legacy top-level cycleContext in selection metadata", async () => {
    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "workout-1",
          selectionMetadata: {
            cycleContext: {
              weekInMeso: 9,
              weekInBlock: 1,
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
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Invalid request",
    });
    expect(mocks.workoutUpsert).not.toHaveBeenCalled();
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
        selectionMetadata: buildCanonicalSelectionMetadata(),
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

  it("rejects performed save when neither request nor persisted workout has canonical receipt metadata", async () => {
    mocks.workoutFindUnique.mockResolvedValueOnce({
      id: "workout-1",
      userId: "user-1",
      status: "IN_PROGRESS",
      revision: 1,
      mesocycleId: null,
      selectionMetadata: null,
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "workout-1",
          action: "mark_partial",
        }),
      })
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "Canonical selectionMetadata.sessionDecisionReceipt is required.",
    });
    expect(mocks.workoutUpsert).not.toHaveBeenCalled();
  });

  it("preserves canonical receipt readiness fields without a compatibility save shim", async () => {
    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "workout-1",
          selectionMetadata: {
            sessionDecisionReceipt: {
              version: 1,
              cycleContext: {
                weekInMeso: 4,
                weekInBlock: 4,
                mesocycleLength: 6,
                phase: "accumulation",
                blockType: "accumulation",
                isDeload: false,
                source: "computed",
              },
              lifecycleRirTarget: { min: 1, max: 2 },
              lifecycleVolume: {
                targets: { Chest: 16 },
                source: "lifecycle",
              },
              sorenessSuppressedMuscles: ["Chest"],
              deloadDecision: {
                mode: "none",
                reason: [],
                reductionPercent: 0,
                appliedTo: "none",
              },
              readiness: {
                wasAutoregulated: true,
                signalAgeHours: 6,
                fatigueScoreOverall: 0.41,
                intensityScaling: {
                  applied: true,
                  exerciseIds: ["bench"],
                  scaledUpCount: 0,
                  scaledDownCount: 1,
                },
                rationale: "Readiness scaled pressing volume.",
              },
              exceptions: [
                {
                  code: "soreness_suppression",
                  message: "Held back weekly volume for Chest due to soreness.",
                },
                {
                  code: "readiness_scale",
                  message: "Readiness scaled 1 exercise(s): 1 down, 0 up.",
                },
              ],
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
    const receipt = createMetadata.sessionDecisionReceipt as Record<string, unknown>;
    const readiness = receipt.readiness as Record<string, unknown>;
    const intensityScaling = readiness.intensityScaling as Record<string, unknown>;
    const lifecycleVolume = receipt.lifecycleVolume as Record<string, unknown>;

    expect((receipt.lifecycleRirTarget as Record<string, unknown>).min).toBe(1);
    expect((lifecycleVolume.targets as Record<string, unknown>).Chest).toBe(16);
    expect(receipt.sorenessSuppressedMuscles).toEqual(["Chest"]);
    expect((receipt.deloadDecision as Record<string, unknown>).mode).toBe("none");
    expect(readiness.wasAutoregulated).toBe(true);
    expect(readiness.signalAgeHours).toBe(6);
    expect(readiness.fatigueScoreOverall).toBe(0.41);
    expect(intensityScaling.applied).toBe(true);
    expect(intensityScaling.exerciseIds).toEqual(["bench"]);
    expect(intensityScaling.scaledDownCount).toBe(1);
  });

  it("rejects removed top-level autoregulationLog compatibility input", async () => {
    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "workout-1",
          autoregulationLog: {
            wasAutoregulated: true,
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

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Invalid request",
    });
    expect(mocks.workoutUpsert).not.toHaveBeenCalled();
  });

  it("rejects legacy top-level session mirrors in selection metadata", async () => {
    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "workout-1",
          selectionMetadata: {
            adaptiveDeloadApplied: true,
            periodizationWeek: 7,
            lifecycleRirTarget: { min: 4, max: 5 },
            lifecycleVolumeTargets: { Chest: 8 },
            sorenessSuppressedMuscles: ["Legs"],
            deloadDecision: {
              mode: "reactive",
              reason: ["legacy"],
              reductionPercent: 25,
              appliedTo: "load",
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

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Invalid request",
    });
    expect(mocks.workoutUpsert).not.toHaveBeenCalled();
  });
});
