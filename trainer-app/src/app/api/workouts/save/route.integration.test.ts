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
  const transitionMesocycleState = vi.fn();

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
    transitionMesocycleState,
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

vi.mock("@/lib/api/mesocycle-lifecycle-state", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/mesocycle-lifecycle-state")>();
  return {
    ...actual,
    transitionMesocycleState: mocks.transitionMesocycleState,
  };
});

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

function buildOptionalGapFillSelectionMetadata() {
  return buildCanonicalSelectionMetadata({
    sessionDecisionReceipt: {
      version: 1,
      cycleContext: {
        weekInMeso: 4,
        weekInBlock: 4,
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
      exceptions: [{ code: "optional_gap_fill", message: "Marked as optional gap-fill session." }],
    },
  });
}

describe("POST /api/workouts/save", () => {
  beforeEach(() => {
    mocks.workoutFindUnique.mockReset();
    mocks.workoutUpsert.mockReset();
    mocks.workoutExerciseFindMany.mockReset();
    mocks.workoutExerciseCreate.mockReset();
    mocks.exerciseFindUnique.mockReset();
    mocks.transitionMesocycleState.mockReset();
    mocks.tx.mesocycle.findUnique.mockReset();
    mocks.tx.mesocycle.findFirst.mockReset();
    mocks.tx.mesocycle.update.mockReset();
    mocks.workoutFindUnique.mockResolvedValue(null);
    mocks.workoutUpsert.mockResolvedValue({ id: "workout-1", revision: 1 });
    mocks.workoutExerciseFindMany.mockResolvedValue([]);
    mocks.exerciseFindUnique.mockResolvedValue({ movementPatterns: [] });
    mocks.workoutExerciseCreate.mockResolvedValue({ id: "we-1" });
    mocks.tx.mesocycle.findUnique.mockResolvedValue(null);
    mocks.tx.mesocycle.findFirst.mockResolvedValue({
      id: "meso-active",
      state: "ACTIVE_ACCUMULATION",
      durationWeeks: 5,
      accumulationSessionsCompleted: 0,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 3,
    });
    mocks.tx.mesocycle.update.mockResolvedValue({});
    mocks.transitionMesocycleState.mockResolvedValue({});
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
      durationWeeks: 5,
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
      durationWeeks: 5,
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
    expect(upsert.update.mesocycleWeekSnapshot).toBe(2);
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
      durationWeeks: 5,
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
    expect(upsert.update.mesocycleWeekSnapshot).toBe(2);
    expect(upsert.update.mesoSessionSnapshot).toBe(2);
    expect(upsert.update.mesocyclePhaseSnapshot).toBe("ACCUMULATION");
  });

  it("does not advance lifecycle for first performed mark_partial when advancesSplit=false", async () => {
    mocks.workoutFindUnique.mockResolvedValueOnce({
      id: "workout-1",
      userId: "user-1",
      status: "PLANNED",
      revision: 1,
      mesocycleId: "meso-1",
      advancesSplit: undefined,
      selectionMetadata: buildCanonicalSelectionMetadata(),
    });
    mocks.tx.mesocycle.findUnique.mockResolvedValueOnce({
      id: "meso-1",
      state: "ACTIVE_ACCUMULATION",
      durationWeeks: 5,
      accumulationSessionsCompleted: 4,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 3,
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "workout-1",
          action: "mark_partial",
          advancesSplit: false,
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.tx.mesocycle.update).not.toHaveBeenCalled();
    expect(mocks.transitionMesocycleState).not.toHaveBeenCalled();
  });

  it("does not advance lifecycle for first performed mark_completed when persisted advancesSplit=false", async () => {
    mocks.workoutFindUnique
      .mockResolvedValueOnce({
        id: "workout-1",
        userId: "user-1",
        status: "PLANNED",
        revision: 1,
        mesocycleId: "meso-1",
        advancesSplit: false,
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
      durationWeeks: 5,
      accumulationSessionsCompleted: 4,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 3,
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "workout-1",
          action: "mark_completed",
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.tx.mesocycle.update).not.toHaveBeenCalled();
    expect(mocks.transitionMesocycleState).not.toHaveBeenCalled();
  });

  it("cannot bypass non-advancing persistence: mark_completed with payload advancesSplit=true stays non-lifecycle when persisted is false", async () => {
    mocks.workoutFindUnique
      .mockResolvedValueOnce({
        id: "workout-1",
        userId: "user-1",
        status: "PLANNED",
        revision: 1,
        mesocycleId: "meso-1",
        advancesSplit: false,
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
      durationWeeks: 5,
      accumulationSessionsCompleted: 4,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 3,
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "workout-1",
          action: "mark_completed",
          advancesSplit: true,
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.tx.mesocycle.update).not.toHaveBeenCalled();
    expect(mocks.transitionMesocycleState).not.toHaveBeenCalled();
    const upsert = mocks.workoutUpsert.mock.calls[0][0];
    expect(upsert.update.advancesSplit).toBe(false);
  });

  it("does not enforce gap-fill behavior when marker is present but intent is non-BODY_PART", async () => {
    mocks.workoutFindUnique
      .mockResolvedValueOnce({
        id: "workout-1",
        userId: "user-1",
        status: "PLANNED",
        revision: 1,
        mesocycleId: "meso-1",
        advancesSplit: undefined,
        selectionMetadata: buildOptionalGapFillSelectionMetadata(),
      })
      .mockResolvedValueOnce({
        exercises: [{ sets: [{ logs: [{ wasSkipped: false, actualReps: 8, actualRpe: 8, actualLoad: 135 }] }] }],
      });
    mocks.tx.mesocycle.findUnique.mockResolvedValueOnce({
      id: "meso-1",
      state: "ACTIVE_ACCUMULATION",
      durationWeeks: 5,
      accumulationSessionsCompleted: 6,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 3,
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "workout-1",
          action: "mark_completed",
          selectionMode: "INTENT",
          sessionIntent: "PULL",
          advancesSplit: true,
          mesocycleWeekSnapshot: 99,
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.tx.mesocycle.update).toHaveBeenCalledWith({
      where: { id: "meso-1" },
      data: { completedSessions: { increment: 1 }, accumulationSessionsCompleted: { increment: 1 } },
    });
    expect(mocks.transitionMesocycleState).toHaveBeenCalledWith("meso-1");
    const upsert = mocks.workoutUpsert.mock.calls[0][0];
    expect(upsert.update.advancesSplit).toBe(true);
    expect(upsert.update.mesocycleWeekSnapshot).toBe(3);
  });

  it("does not enforce gap-fill behavior when BODY_PART intent has no optional marker", async () => {
    mocks.workoutFindUnique
      .mockResolvedValueOnce({
        id: "workout-1",
        userId: "user-1",
        status: "PLANNED",
        revision: 1,
        mesocycleId: "meso-1",
        advancesSplit: undefined,
        selectionMetadata: buildCanonicalSelectionMetadata(),
      })
      .mockResolvedValueOnce({
        exercises: [{ sets: [{ logs: [{ wasSkipped: false, actualReps: 8, actualRpe: 8, actualLoad: 135 }] }] }],
      });
    mocks.tx.mesocycle.findUnique.mockResolvedValueOnce({
      id: "meso-1",
      state: "ACTIVE_ACCUMULATION",
      durationWeeks: 5,
      accumulationSessionsCompleted: 6,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 3,
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "workout-1",
          action: "mark_completed",
          selectionMode: "INTENT",
          sessionIntent: "BODY_PART",
          advancesSplit: true,
          mesocycleWeekSnapshot: 99,
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.tx.mesocycle.update).toHaveBeenCalledWith({
      where: { id: "meso-1" },
      data: { completedSessions: { increment: 1 }, accumulationSessionsCompleted: { increment: 1 } },
    });
    expect(mocks.transitionMesocycleState).toHaveBeenCalledWith("meso-1");
    const upsert = mocks.workoutUpsert.mock.calls[0][0];
    expect(upsert.update.advancesSplit).toBe(true);
    expect(upsert.update.mesocycleWeekSnapshot).toBe(3);
  });

  it("enforces gap-fill behavior only for marker + INTENT + BODY_PART", async () => {
    mocks.workoutFindUnique
      .mockResolvedValueOnce({
        id: "workout-1",
        userId: "user-1",
        status: "PLANNED",
        revision: 1,
        mesocycleId: "meso-1",
        advancesSplit: undefined,
        selectionMetadata: buildOptionalGapFillSelectionMetadata(),
      })
      .mockResolvedValueOnce({
        exercises: [{ sets: [{ logs: [{ wasSkipped: false, actualReps: 8, actualRpe: 8, actualLoad: 135 }] }] }],
      });
    mocks.tx.mesocycle.findUnique.mockResolvedValueOnce({
      id: "meso-1",
      state: "ACTIVE_ACCUMULATION",
      durationWeeks: 5,
      accumulationSessionsCompleted: 6,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 3,
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "workout-1",
          action: "mark_completed",
          selectionMode: "INTENT",
          sessionIntent: "BODY_PART",
          advancesSplit: true,
          mesocycleWeekSnapshot: 2,
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.tx.mesocycle.update).not.toHaveBeenCalled();
    expect(mocks.transitionMesocycleState).not.toHaveBeenCalled();
    const upsert = mocks.workoutUpsert.mock.calls[0][0];
    expect(upsert.update.advancesSplit).toBe(false);
    expect(upsert.update.mesocycleWeekSnapshot).toBe(2);
  });

  it("ignores client mesocycleWeekSnapshot override for non-gap-fill payloads", async () => {
    mocks.workoutFindUnique
      .mockResolvedValueOnce({
        id: "workout-1",
        userId: "user-1",
        status: "PLANNED",
        revision: 1,
        mesocycleId: "meso-1",
        advancesSplit: undefined,
        selectionMetadata: buildCanonicalSelectionMetadata(),
      })
      .mockResolvedValueOnce({
        exercises: [{ sets: [{ logs: [{ wasSkipped: false, actualReps: 8, actualRpe: 8, actualLoad: 135 }] }] }],
      });
    mocks.tx.mesocycle.findUnique.mockResolvedValueOnce({
      id: "meso-1",
      state: "ACTIVE_ACCUMULATION",
      durationWeeks: 5,
      accumulationSessionsCompleted: 6,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 3,
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "workout-1",
          action: "mark_completed",
          selectionMode: "INTENT",
          sessionIntent: "PUSH",
          advancesSplit: true,
          mesocycleWeekSnapshot: 1,
        }),
      })
    );

    expect(response.status).toBe(200);
    const upsert = mocks.workoutUpsert.mock.calls[0][0];
    expect(upsert.update.mesocycleWeekSnapshot).toBe(3);
  });

  it("preserves existing planned snapshot week for normal workouts when completed later", async () => {
    mocks.workoutFindUnique
      .mockResolvedValueOnce({
        id: "workout-1",
        userId: "user-1",
        status: "PLANNED",
        revision: 1,
        mesocycleId: "meso-1",
        mesocycleWeekSnapshot: 3,
        mesocyclePhaseSnapshot: "ACCUMULATION",
        mesoSessionSnapshot: 4,
        advancesSplit: true,
        selectionMetadata: buildCanonicalSelectionMetadata(),
      })
      .mockResolvedValueOnce({
        exercises: [{ sets: [{ logs: [{ wasSkipped: false, actualReps: 8, actualRpe: 8, actualLoad: 135 }] }] }],
      });
    // Lifecycle has advanced to week 4 by completion time.
    mocks.tx.mesocycle.findUnique.mockResolvedValueOnce({
      id: "meso-1",
      state: "ACTIVE_ACCUMULATION",
      durationWeeks: 5,
      accumulationSessionsCompleted: 9,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 3,
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "workout-1",
          action: "mark_completed",
        }),
      })
    );

    expect(response.status).toBe(200);
    const upsert = mocks.workoutUpsert.mock.calls[0][0];
    expect(upsert.update.mesocycleWeekSnapshot).toBe(3);
    expect(upsert.update.mesoSessionSnapshot).toBe(4);
    expect(upsert.update.mesocyclePhaseSnapshot).toBe("ACCUMULATION");
  });

  it("preserves existing anchor week for gap-fill completion when active week has advanced", async () => {
    mocks.workoutFindUnique
      .mockResolvedValueOnce({
        id: "workout-1",
        userId: "user-1",
        status: "PLANNED",
        revision: 1,
        mesocycleId: "meso-1",
        mesocycleWeekSnapshot: 3,
        mesocyclePhaseSnapshot: "ACCUMULATION",
        mesoSessionSnapshot: 4,
        advancesSplit: false,
        selectionMode: "INTENT",
        sessionIntent: "BODY_PART",
        selectionMetadata: buildOptionalGapFillSelectionMetadata(),
      })
      .mockResolvedValueOnce({
        exercises: [{ sets: [{ logs: [{ wasSkipped: false, actualReps: 8, actualRpe: 8, actualLoad: 135 }] }] }],
      });
    // Lifecycle moved to week 4 after planning the anchored week-3 gap-fill.
    mocks.tx.mesocycle.findUnique.mockResolvedValueOnce({
      id: "meso-1",
      state: "ACTIVE_ACCUMULATION",
      durationWeeks: 5,
      accumulationSessionsCompleted: 9,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 3,
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "workout-1",
          action: "mark_completed",
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.tx.mesocycle.update).not.toHaveBeenCalled();
    const upsert = mocks.workoutUpsert.mock.calls[0][0];
    expect(upsert.update.advancesSplit).toBe(false);
    expect(upsert.update.mesocycleWeekSnapshot).toBe(3);
    expect(upsert.update.mesocyclePhaseSnapshot).toBe("ACCUMULATION");
    expect(upsert.update.mesoSessionSnapshot).toBe(4);
  });

  it("does not advance lifecycle when a workout is only marked partial", async () => {
    mocks.workoutFindUnique.mockResolvedValueOnce({
      id: "workout-1",
      userId: "user-1",
      status: "PLANNED",
      revision: 1,
      mesocycleId: "meso-1",
      advancesSplit: undefined,
      selectionMetadata: buildCanonicalSelectionMetadata(),
    });
    mocks.tx.mesocycle.findUnique.mockResolvedValueOnce({
      id: "meso-1",
      state: "ACTIVE_ACCUMULATION",
      durationWeeks: 5,
      accumulationSessionsCompleted: 4,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 3,
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "workout-1",
          action: "mark_partial",
          advancesSplit: true,
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.tx.mesocycle.update).not.toHaveBeenCalled();
    expect(mocks.transitionMesocycleState).not.toHaveBeenCalled();
  });

  it("advances lifecycle when a partial workout is later completed for the first time", async () => {
    mocks.workoutFindUnique
      .mockResolvedValueOnce({
        id: "workout-1",
        userId: "user-1",
        status: "PARTIAL",
        revision: 2,
        mesocycleId: "meso-1",
        advancesSplit: true,
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
      durationWeeks: 5,
      accumulationSessionsCompleted: 4,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 3,
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "workout-1",
          action: "mark_completed",
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.tx.mesocycle.update).toHaveBeenCalledWith({
      where: { id: "meso-1" },
      data: { completedSessions: { increment: 1 }, accumulationSessionsCompleted: { increment: 1 } },
    });
    expect(mocks.transitionMesocycleState).toHaveBeenCalledWith("meso-1");
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
      expect(upsert.update.selectionMetadata).toEqual(
        expect.objectContaining({
          selectedExerciseIds: ["bench"],
          sessionDecisionReceipt: expect.objectContaining(persistedReceipt),
        })
      );
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

  it("stamps initial planned saves with the pre-increment canonical lifecycle snapshot", async () => {
    mocks.tx.mesocycle.findFirst.mockResolvedValueOnce({
      id: "meso-active",
      state: "ACTIVE_ACCUMULATION",
      durationWeeks: 5,
      accumulationSessionsCompleted: 4,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 3,
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "workout-1",
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

    expect(response.status).toBe(200);

    const upsert = mocks.workoutUpsert.mock.calls[0][0];
    expect(upsert.create.mesocycleId).toBe("meso-active");
    expect(upsert.create.mesocycleWeekSnapshot).toBe(2);
    expect(upsert.create.mesoSessionSnapshot).toBe(2);
    expect(upsert.create.mesocyclePhaseSnapshot).toBe("ACCUMULATION");
    expect(mocks.tx.mesocycle.update).not.toHaveBeenCalled();
    expect(mocks.transitionMesocycleState).not.toHaveBeenCalled();
  });

  it("pins strict optional gap-fill planned saves to the anchored accumulation snapshot", async () => {
    mocks.tx.mesocycle.findFirst.mockResolvedValueOnce({
      id: "meso-active",
      state: "ACTIVE_DELOAD",
      durationWeeks: 5,
      accumulationSessionsCompleted: 12,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 3,
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "workout-gap",
          selectionMode: "INTENT",
          sessionIntent: "BODY_PART",
          advancesSplit: false,
          mesocycleWeekSnapshot: 4,
          selectionMetadata: buildOptionalGapFillSelectionMetadata(),
          exercises: [
            {
              section: "MAIN",
              exerciseId: "bench",
              sets: [{ setIndex: 1, targetReps: 12 }],
            },
          ],
        }),
      })
    );

    expect(response.status).toBe(200);

    const upsert = mocks.workoutUpsert.mock.calls[0][0];
    expect(upsert.create.mesocycleId).toBe("meso-active");
    expect(upsert.create.mesocycleWeekSnapshot).toBe(4);
    expect(upsert.create.mesocyclePhaseSnapshot).toBe("ACCUMULATION");
    expect(upsert.create.mesoSessionSnapshot).toBe(4);
    expect(upsert.create.advancesSplit).toBe(false);
    expect(mocks.tx.mesocycle.update).not.toHaveBeenCalled();
    expect(mocks.transitionMesocycleState).not.toHaveBeenCalled();
  });

  it("increments only the deload lifecycle counter for first performed deload saves", async () => {
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
            sets: [{ logs: [{ wasSkipped: false, actualReps: 5, actualRpe: 7, actualLoad: 185 }] }],
          },
        ],
      });
    mocks.tx.mesocycle.findUnique.mockResolvedValueOnce({
      id: "meso-1",
      state: "ACTIVE_DELOAD",
      durationWeeks: 5,
      accumulationSessionsCompleted: 12,
      deloadSessionsCompleted: 1,
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
    expect(mocks.tx.mesocycle.update).toHaveBeenCalledWith({
      where: { id: "meso-1" },
      data: { completedSessions: { increment: 1 }, deloadSessionsCompleted: { increment: 1 } },
    });

    const upsert = mocks.workoutUpsert.mock.calls[0][0];
    expect(upsert.update.mesocycleWeekSnapshot).toBe(5);
    expect(upsert.update.mesoSessionSnapshot).toBe(2);
    expect(upsert.update.mesocyclePhaseSnapshot).toBe("DELOAD");
  });

  it("does not double-advance lifecycle counters when an already completed workout is saved again", async () => {
    mocks.workoutFindUnique
      .mockResolvedValueOnce({
        id: "workout-1",
        userId: "user-1",
        status: "COMPLETED",
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

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workoutId: "workout-1", action: "mark_completed" }),
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.tx.mesocycle.findUnique).not.toHaveBeenCalled();
    expect(mocks.tx.mesocycle.update).not.toHaveBeenCalled();
    expect(mocks.transitionMesocycleState).not.toHaveBeenCalled();

    const upsert = mocks.workoutUpsert.mock.calls[0][0];
    expect(upsert.update.mesocycleWeekSnapshot).toBeUndefined();
    expect(upsert.update.mesoSessionSnapshot).toBeUndefined();
    expect(upsert.update.mesocyclePhaseSnapshot).toBeUndefined();
  });

  it("keeps lifecycle counters idempotent across repeated identical mark_completed saves", async () => {
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
      })
      .mockResolvedValueOnce({
        id: "workout-1",
        userId: "user-1",
        status: "COMPLETED",
        revision: 2,
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
      durationWeeks: 5,
      accumulationSessionsCompleted: 4,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 3,
    });

    const firstResponse = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workoutId: "workout-1", action: "mark_completed" }),
      })
    );
    const secondResponse = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workoutId: "workout-1", action: "mark_completed" }),
      })
    );

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(mocks.tx.mesocycle.update).toHaveBeenCalledTimes(1);
    expect(mocks.transitionMesocycleState).toHaveBeenCalledTimes(1);
    expect(mocks.transitionMesocycleState).toHaveBeenCalledWith("meso-1");
  });
});
