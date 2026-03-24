/**
 * Protects: Save API is action-based (save_plan / mark_completed / mark_partial / mark_skipped), with backward inference that cannot bypass gating.
 * Why it matters: Save behavior is the highest-risk workflow boundary and must remain deterministic under mixed legacy/new payloads.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const workoutFindUnique = vi.fn();
  const workoutUpdateMany = vi.fn();
  const workoutUpsert = vi.fn();
  const workoutExerciseFindMany = vi.fn();
  const workoutExerciseCreate = vi.fn();
  const exerciseFindUnique = vi.fn();
  const transitionMesocycleStateInTransaction = vi.fn();
  const autoDismissPendingWeekCloseOnForwardProgress = vi.fn();
  const evaluateWeekCloseAtBoundary = vi.fn();
  const linkOptionalWorkoutToWeekClose = vi.fn();
  const resolveWeekCloseOnOptionalGapFillCompletion = vi.fn();

  const tx = {
    workout: {
      findUnique: workoutFindUnique,
      updateMany: workoutUpdateMany,
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
    mesocycleWeekClose: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      upsert: vi.fn(),
    },
  };

  const prisma = {
    $transaction: vi.fn(async (callback: (trx: typeof tx) => Promise<void>) => callback(tx)),
  };

  return {
    tx,
    prisma,
    workoutFindUnique,
    workoutUpdateMany,
    workoutUpsert,
    workoutExerciseFindMany,
    workoutExerciseCreate,
    exerciseFindUnique,
    transitionMesocycleStateInTransaction,
    autoDismissPendingWeekCloseOnForwardProgress,
    evaluateWeekCloseAtBoundary,
    linkOptionalWorkoutToWeekClose,
    resolveWeekCloseOnOptionalGapFillCompletion,
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
    transitionMesocycleStateInTransaction: mocks.transitionMesocycleStateInTransaction,
  };
});

vi.mock("@/lib/api/mesocycle-week-close", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/mesocycle-week-close")>();
  return {
    ...actual,
    autoDismissPendingWeekCloseOnForwardProgress: mocks.autoDismissPendingWeekCloseOnForwardProgress,
    evaluateWeekCloseAtBoundary: mocks.evaluateWeekCloseAtBoundary,
    linkOptionalWorkoutToWeekClose: mocks.linkOptionalWorkoutToWeekClose,
    resolveWeekCloseOnOptionalGapFillCompletion: mocks.resolveWeekCloseOnOptionalGapFillCompletion,
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

function buildGeneratedSnapshotSelectionMetadata() {
  return buildCanonicalSelectionMetadata({
    sessionAuditSnapshot: {
      version: 1,
      generated: {
        selectionMode: "INTENT",
        sessionIntent: "push",
        exerciseCount: 1,
        hardSetCount: 3,
        exercises: [
          {
            exerciseId: "bench",
            exerciseName: "Bench Press",
            orderIndex: 0,
            section: "main",
            isMainLift: true,
            prescribedSetCount: 3,
            prescribedSets: [
              { setIndex: 1, targetReps: 8, targetRpe: 8 },
              { setIndex: 2, targetReps: 8, targetRpe: 8 },
              { setIndex: 3, targetReps: 8, targetRpe: 8 },
            ],
          },
        ],
        semantics: {
          kind: "advancing",
          effectiveSelectionMode: "INTENT",
          isDeload: false,
          isStrictGapFill: false,
          isStrictSupplemental: false,
          advancesLifecycle: true,
          consumesWeeklyScheduleIntent: true,
          countsTowardCompliance: true,
          countsTowardRecentStimulus: true,
          countsTowardWeeklyVolume: true,
          countsTowardProgressionHistory: true,
          countsTowardPerformanceHistory: true,
          updatesProgressionAnchor: true,
          eligibleForUniqueIntentSubtraction: true,
          reasons: [],
          trace: {
            advancesSplitInput: true,
          },
        },
        traces: {
          progression: {},
        },
      },
    },
  });
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

function buildSupplementalDeficitSelectionMetadata() {
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
      exceptions: [
        {
          code: "supplemental_deficit_session",
          message: "Marked as supplemental deficit session.",
        },
      ],
    },
  });
}

describe("POST /api/workouts/save", () => {
  beforeEach(() => {
    mocks.workoutFindUnique.mockReset();
    mocks.workoutUpdateMany.mockReset();
    mocks.workoutUpsert.mockReset();
    mocks.workoutExerciseFindMany.mockReset();
    mocks.workoutExerciseCreate.mockReset();
    mocks.exerciseFindUnique.mockReset();
    mocks.transitionMesocycleStateInTransaction.mockReset();
    mocks.autoDismissPendingWeekCloseOnForwardProgress.mockReset();
    mocks.evaluateWeekCloseAtBoundary.mockReset();
    mocks.linkOptionalWorkoutToWeekClose.mockReset();
    mocks.resolveWeekCloseOnOptionalGapFillCompletion.mockReset();
    mocks.tx.mesocycle.findUnique.mockReset();
    mocks.tx.mesocycle.findFirst.mockReset();
    mocks.tx.mesocycle.update.mockReset();
    mocks.workoutFindUnique.mockResolvedValue(null);
    mocks.workoutUpdateMany.mockResolvedValue({ count: 1 });
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
    mocks.transitionMesocycleStateInTransaction.mockResolvedValue({
      mesocycle: {
        id: "meso-active",
        state: "ACTIVE_ACCUMULATION",
      },
      advanced: false,
    });
    mocks.autoDismissPendingWeekCloseOnForwardProgress.mockResolvedValue({
      weekCloseId: null,
      status: null,
      resolution: null,
      weekCloseState: null,
      advancedLifecycle: false,
      outcome: "not_found",
    });
    mocks.evaluateWeekCloseAtBoundary.mockResolvedValue({
      weekCloseId: "wc-1",
      status: "RESOLVED",
      resolution: "NO_GAP_FILL_NEEDED",
      weekCloseState: {
        workflowState: "COMPLETED",
        deficitState: "CLOSED",
        remainingDeficitSets: 0,
      },
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
      advancedLifecycle: true,
    });
    mocks.linkOptionalWorkoutToWeekClose.mockResolvedValue("linked");
    mocks.resolveWeekCloseOnOptionalGapFillCompletion.mockResolvedValue({
      weekCloseId: "wc-1",
      status: "RESOLVED",
      resolution: "GAP_FILL_COMPLETED",
      weekCloseState: {
        workflowState: "COMPLETED",
        deficitState: "PARTIAL",
        remainingDeficitSets: 4,
      },
      advancedLifecycle: false,
      outcome: "resolved",
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
      expect(body).toEqual(
        expect.objectContaining({
          status: "saved",
          workoutId: "workout-1",
          revision: expect.any(Number),
          workoutStatus: expect.any(String),
          action: "save_plan",
        })
      );
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
    expect(body).toEqual(
      expect.objectContaining({
        status: "saved",
        workoutId: "workout-1",
        revision: expect.any(Number),
        workoutStatus: "COMPLETED",
        action: "mark_completed",
      })
    );
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

    const updateMany = mocks.workoutUpdateMany.mock.calls[0][0];
    const selectionMetadata = updateMany.data.selectionMetadata as Record<string, unknown>;
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
    expect(mocks.transitionMesocycleStateInTransaction).toHaveBeenCalledWith(mocks.tx, "meso-1");

    const updateMany = mocks.workoutUpdateMany.mock.calls[0][0];
    expect(updateMany.data.mesocycleId).toBe("meso-1");
    expect(updateMany.data.mesocycleWeekSnapshot).toBe(2);
    expect(updateMany.data.mesoSessionSnapshot).toBe(1);
    expect(updateMany.data.mesocyclePhaseSnapshot).toBe("ACCUMULATION");
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
    expect(mocks.transitionMesocycleStateInTransaction).toHaveBeenCalledWith(mocks.tx, "meso-active");
    expect(mocks.tx.mesocycle.update).toHaveBeenCalledWith({
      where: { id: "meso-active" },
      data: { completedSessions: { increment: 1 }, accumulationSessionsCompleted: { increment: 1 } },
    });

    const updateMany = mocks.workoutUpdateMany.mock.calls[0][0];
    expect(updateMany.data.mesocycleId).toBe("meso-active");
    expect(updateMany.data.mesocycleWeekSnapshot).toBe(2);
    expect(updateMany.data.mesoSessionSnapshot).toBe(2);
    expect(updateMany.data.mesocyclePhaseSnapshot).toBe("ACCUMULATION");
  });

  it("evaluates a week-close window instead of advancing lifecycle at an accumulation week boundary", async () => {
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
      accumulationSessionsCompleted: 2,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 3,
      startWeek: 0,
      macroCycle: {
        startDate: new Date("2026-03-01T00:00:00.000Z"),
      },
    });
    mocks.evaluateWeekCloseAtBoundary.mockResolvedValueOnce({
      weekCloseId: "wc-1",
      status: "PENDING_OPTIONAL_GAP_FILL",
      resolution: null,
      weekCloseState: {
        workflowState: "PENDING_OPTIONAL_GAP_FILL",
        deficitState: "OPEN",
        remainingDeficitSets: 4,
      },
      deficitSnapshot: {
        version: 1,
        policy: {
          requiredSessionsPerWeek: 3,
          maxOptionalGapFillSessionsPerWeek: 1,
          maxGeneratedHardSets: 12,
          maxGeneratedExercises: 4,
        },
        summary: {
          totalDeficitSets: 4,
          qualifyingMuscleCount: 1,
          topTargetMuscles: ["Chest"],
        },
        muscles: [{ muscle: "Chest", target: 12, actual: 8, deficit: 4 }],
      },
      advancedLifecycle: false,
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workoutId: "workout-1", action: "mark_completed" }),
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      weekClose: {
        weekCloseId: "wc-1",
        resolution: null,
        workflowState: "PENDING_OPTIONAL_GAP_FILL",
        deficitState: "OPEN",
        remainingDeficitSets: 4,
      },
    });
    expect(mocks.evaluateWeekCloseAtBoundary).toHaveBeenCalledWith(mocks.tx, {
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
      targetPhase: "ACCUMULATION",
    });
    expect(mocks.transitionMesocycleStateInTransaction).not.toHaveBeenCalled();
  });

  it("does not re-trigger a stale persisted boundary snapshot when counter progression is mid-week", async () => {
    mocks.workoutFindUnique
      .mockResolvedValueOnce({
        id: "workout-1",
        userId: "user-1",
        status: "PLANNED",
        revision: 1,
        mesocycleId: "meso-1",
        mesocycleWeekSnapshot: 1,
        mesocyclePhaseSnapshot: "ACCUMULATION",
        mesoSessionSnapshot: 3,
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
      startWeek: 0,
      macroCycle: {
        startDate: new Date("2026-03-01T00:00:00.000Z"),
      },
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workoutId: "workout-1", action: "mark_completed" }),
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.evaluateWeekCloseAtBoundary).not.toHaveBeenCalled();
    expect(mocks.transitionMesocycleStateInTransaction).toHaveBeenCalledWith(mocks.tx, "meso-1");
    const updateMany = mocks.workoutUpdateMany.mock.calls[0][0];
    expect(updateMany.data.mesocycleWeekSnapshot).toBe(1);
    expect(updateMany.data.mesoSessionSnapshot).toBe(3);
    expect(updateMany.data.mesocyclePhaseSnapshot).toBe("ACCUMULATION");
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
    expect(mocks.transitionMesocycleStateInTransaction).not.toHaveBeenCalled();
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
    expect(mocks.transitionMesocycleStateInTransaction).not.toHaveBeenCalled();
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
    expect(mocks.transitionMesocycleStateInTransaction).not.toHaveBeenCalled();
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
    expect(mocks.transitionMesocycleStateInTransaction).toHaveBeenCalledWith(mocks.tx, "meso-1");
    const updateMany = mocks.workoutUpdateMany.mock.calls[0][0];
    expect(updateMany.data.advancesSplit).toBe(true);
    expect(updateMany.data.mesocycleWeekSnapshot).toBe(3);
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
    expect(mocks.transitionMesocycleStateInTransaction).toHaveBeenCalledWith(mocks.tx, "meso-1");
    const updateMany = mocks.workoutUpdateMany.mock.calls[0][0];
    expect(updateMany.data.advancesSplit).toBe(true);
    expect(updateMany.data.mesocycleWeekSnapshot).toBe(3);
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
    expect(mocks.transitionMesocycleStateInTransaction).not.toHaveBeenCalled();
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
    const updateMany = mocks.workoutUpdateMany.mock.calls[0][0];
    expect(updateMany.data.mesocycleWeekSnapshot).toBe(3);
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
    const updateMany = mocks.workoutUpdateMany.mock.calls[0][0];
    expect(updateMany.data.mesocycleWeekSnapshot).toBe(3);
    expect(updateMany.data.mesoSessionSnapshot).toBe(4);
    expect(updateMany.data.mesocyclePhaseSnapshot).toBe("ACCUMULATION");
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
    expect(mocks.transitionMesocycleStateInTransaction).not.toHaveBeenCalled();
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
    expect(mocks.transitionMesocycleStateInTransaction).toHaveBeenCalledWith(mocks.tx, "meso-1");
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
    expect(mocks.transitionMesocycleStateInTransaction).not.toHaveBeenCalled();
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
    expect(body).toEqual(
      expect.objectContaining({
        status: "saved",
        workoutId: "workout-1",
        revision: expect.any(Number),
        workoutStatus: "PARTIAL",
        action: "mark_completed",
      })
    );
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
    expect(body).toEqual(
      expect.objectContaining({
        status: "saved",
        workoutId: "workout-1",
        revision: expect.any(Number),
        workoutStatus: "PARTIAL",
        action: "mark_completed",
      })
    );
    expect(body.workoutStatus).toBe("PARTIAL");
  });

  it.each([
    ["mark_partial", "PARTIAL"],
    ["mark_skipped", "SKIPPED"],
  ] as const)("returns required workoutStatus for %s success responses", async (action, expectedStatus) => {
    mocks.workoutFindUnique.mockResolvedValueOnce({
      id: "workout-1",
      userId: "user-1",
      status: "IN_PROGRESS",
      revision: 2,
      mesocycleId: null,
      selectionMetadata: buildCanonicalSelectionMetadata(),
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workoutId: "workout-1", action }),
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(
      expect.objectContaining({
        status: "saved",
        workoutId: "workout-1",
        revision: expect.any(Number),
        workoutStatus: expectedStatus,
        action,
      })
    );
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
    expect(mocks.transitionMesocycleStateInTransaction).not.toHaveBeenCalled();
  });

  it("returns 409 before lifecycle mutation when a workout belongs to an awaiting-handoff mesocycle", async () => {
    mocks.workoutFindUnique.mockResolvedValueOnce({
      id: "workout-1",
      userId: "user-1",
      status: "PLANNED",
      revision: 1,
      mesocycleId: "meso-1",
      selectionMetadata: buildCanonicalSelectionMetadata(),
    });
    mocks.tx.mesocycle.findUnique.mockResolvedValueOnce({
      id: "meso-1",
      state: "AWAITING_HANDOFF",
      durationWeeks: 5,
      accumulationSessionsCompleted: 12,
      deloadSessionsCompleted: 3,
      sessionsPerWeek: 3,
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "workout-1",
          notes: "should fail cleanly",
        }),
      })
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "Mesocycle handoff is pending; workout saves are closed until the next cycle is accepted.",
    });
    expect(mocks.workoutUpsert).not.toHaveBeenCalled();
    expect(mocks.tx.mesocycle.update).not.toHaveBeenCalled();
    expect(mocks.transitionMesocycleStateInTransaction).not.toHaveBeenCalled();
  });

  it("returns 409 before lifecycle mutation when a workout belongs to a completed mesocycle", async () => {
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
      state: "COMPLETED",
      durationWeeks: 5,
      accumulationSessionsCompleted: 12,
      deloadSessionsCompleted: 3,
      sessionsPerWeek: 3,
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
      error: "Mesocycle is archived as completed; workout saves are closed.",
    });
    expect(mocks.workoutUpdateMany).not.toHaveBeenCalled();
    expect(mocks.tx.mesocycle.update).not.toHaveBeenCalled();
    expect(mocks.transitionMesocycleStateInTransaction).not.toHaveBeenCalled();
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

  it("persists rewrite_structure runtime edit facts when a save rewrite drifts from the generated workout", async () => {
    const selectionMetadata = buildGeneratedSnapshotSelectionMetadata();

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "workout-1",
          selectionMetadata,
          exercises: [
            {
              section: "MAIN",
              exerciseId: "bench",
              sets: [{ setIndex: 1, targetReps: 8 }],
            },
            {
              section: "ACCESSORY",
              exerciseId: "fly",
              sets: [{ setIndex: 1, targetReps: 12 }],
            },
          ],
        }),
      })
    );

    expect(response.status).toBe(200);

    const upsert = mocks.workoutUpsert.mock.calls[0][0];
    expect(upsert.create.selectionMetadata).toEqual(
      expect.objectContaining({
        runtimeEditReconciliation: expect.objectContaining({
          version: 1,
          directives: {
            continuityAlias: "none",
            progressionAlias: "none",
            futureSessionGeneration: "ignore",
            futureSeedCarryForward: "ignore",
          },
          ops: [
            expect.objectContaining({
              kind: "rewrite_structure",
              source: "api_workouts_save",
              scope: "current_workout_only",
              facts: expect.objectContaining({
                changedFields: expect.arrayContaining([
                  "exercise_added",
                  "exercise_set_count_changed",
                  "exercise_prescription_changed",
                ]),
                addedExerciseIds: ["fly"],
              }),
            }),
          ],
        }),
      })
    );
  });

  it("does not append rewrite_structure when save is structurally identical to the generated workout", async () => {
    const selectionMetadata = buildGeneratedSnapshotSelectionMetadata();

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "workout-1",
          selectionMetadata,
          exercises: [
            {
              section: "MAIN",
              exerciseId: "bench",
              sets: [
                { setIndex: 1, targetReps: 8, targetRpe: 8 },
                { setIndex: 2, targetReps: 8, targetRpe: 8 },
                { setIndex: 3, targetReps: 8, targetRpe: 8 },
              ],
            },
          ],
        }),
      })
    );

    expect(response.status).toBe(200);

    const upsert = mocks.workoutUpsert.mock.calls[0][0];
    const createMetadata = upsert.create.selectionMetadata as Record<string, unknown>;

    expect(createMetadata.workoutStructureState).toEqual(
      expect.objectContaining({
        reconciliation: expect.objectContaining({
          hasDrift: false,
        }),
      })
    );
    expect(createMetadata.runtimeEditReconciliation).toBeUndefined();
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


  it("aborts the save when transactional week-close evaluation throws", async () => {
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
      accumulationSessionsCompleted: 5,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 3,
      startWeek: 0,
      macroCycle: {
        startDate: new Date("2026-03-01T00:00:00.000Z"),
      },
    });
    mocks.evaluateWeekCloseAtBoundary.mockRejectedValueOnce(new Error("DB timeout"));

    await expect(
      POST(
        new Request("http://localhost/api/workouts/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workoutId: "workout-1", action: "mark_completed" }),
        })
      )
    ).rejects.toThrow("DB timeout");

    expect(mocks.tx.mesocycle.update).toHaveBeenCalledWith({
      where: { id: "meso-1" },
      data: { completedSessions: { increment: 1 }, accumulationSessionsCompleted: { increment: 1 } },
    });
    expect(mocks.evaluateWeekCloseAtBoundary).toHaveBeenCalledWith(
      mocks.tx,
      expect.objectContaining({
        userId: "user-1",
        targetWeek: 2,
        targetPhase: "ACCUMULATION",
      })
    );
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
    expect(mocks.transitionMesocycleStateInTransaction).not.toHaveBeenCalled();
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
    expect(mocks.transitionMesocycleStateInTransaction).not.toHaveBeenCalled();
  });

  it("persists strict supplemental deficit planned saves with advancesSplit=false", async () => {
    mocks.tx.mesocycle.findFirst.mockResolvedValueOnce({
      id: "meso-active",
      state: "ACTIVE_ACCUMULATION",
      durationWeeks: 5,
      accumulationSessionsCompleted: 7,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 3,
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "workout-supp",
          selectionMode: "INTENT",
          sessionIntent: "BODY_PART",
          advancesSplit: true,
          selectionMetadata: buildSupplementalDeficitSelectionMetadata(),
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
    expect(upsert.create.advancesSplit).toBe(false);
    expect(upsert.update.advancesSplit).toBe(false);
    expect(mocks.tx.mesocycle.update).not.toHaveBeenCalled();
    expect(mocks.transitionMesocycleStateInTransaction).not.toHaveBeenCalled();
  });

  it("preserves the supplemental marker on later save/update flows", async () => {
    mocks.workoutFindUnique.mockResolvedValueOnce({
      id: "workout-supp",
      userId: "user-1",
      status: "PLANNED",
      revision: 1,
      mesocycleId: "meso-1",
      advancesSplit: false,
      selectionMode: "INTENT",
      sessionIntent: "BODY_PART",
      selectionMetadata: buildSupplementalDeficitSelectionMetadata(),
    });
    mocks.workoutUpsert.mockResolvedValueOnce({
      id: "workout-supp",
      revision: 2,
      mesocycleId: "meso-1",
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "workout-supp",
          selectionMode: "INTENT",
          sessionIntent: "BODY_PART",
          notes: "updated note",
        }),
      })
    );

    expect(response.status).toBe(200);

    const upsert = mocks.workoutUpsert.mock.calls[0][0];
    const receipt = (upsert.update.selectionMetadata as Record<string, unknown>)
      .sessionDecisionReceipt as Record<string, unknown>;
    expect(upsert.update.advancesSplit).toBe(false);
    expect((receipt.exceptions as Array<{ code: string }>).map((entry) => entry.code)).toContain(
      "supplemental_deficit_session"
    );
  });

  it("resolves a linked optional gap-fill completion once and advances once transactionally", async () => {
    mocks.workoutFindUnique
      .mockResolvedValueOnce({
        id: "workout-gap",
        userId: "user-1",
        status: "PLANNED",
        revision: 1,
        mesocycleId: "meso-1",
        advancesSplit: false,
        selectionMode: "INTENT",
        sessionIntent: "BODY_PART",
        selectionMetadata: {
          ...buildOptionalGapFillSelectionMetadata(),
          weekCloseId: "wc-1",
        },
      })
      .mockResolvedValueOnce({
        exercises: [
          {
            sets: [{ logs: [{ wasSkipped: false, actualReps: 12, actualRpe: 8, actualLoad: 70 }] }],
          },
        ],
      });
    mocks.tx.mesocycle.findUnique.mockResolvedValueOnce({
      id: "meso-1",
      state: "ACTIVE_DELOAD",
      durationWeeks: 5,
      accumulationSessionsCompleted: 12,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 3,
      startWeek: 0,
      macroCycle: {
        startDate: new Date("2026-03-01T00:00:00.000Z"),
      },
    });
    mocks.workoutUpsert.mockResolvedValueOnce({ id: "workout-gap", revision: 2, mesocycleId: "meso-1" });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workoutId: "workout-gap", action: "mark_completed" }),
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      weekClose: {
        weekCloseId: "wc-1",
        resolution: "GAP_FILL_COMPLETED",
        workflowState: "COMPLETED",
        deficitState: "PARTIAL",
        remainingDeficitSets: 4,
      },
    });
    expect(mocks.linkOptionalWorkoutToWeekClose).toHaveBeenCalledWith(mocks.tx, {
      weekCloseId: "wc-1",
      workoutId: "workout-gap",
    });
    expect(mocks.resolveWeekCloseOnOptionalGapFillCompletion).toHaveBeenCalledWith(mocks.tx, {
      workoutId: "workout-gap",
      weekCloseId: "wc-1",
    });
    expect(mocks.tx.mesocycle.update).not.toHaveBeenCalled();
    expect(mocks.transitionMesocycleStateInTransaction).not.toHaveBeenCalled();
  });

  it("rejects linked optional gap-fill completion with 409 when the week-close row is no longer pending", async () => {
    mocks.workoutFindUnique
      .mockResolvedValueOnce({
        id: "workout-gap",
        userId: "user-1",
        status: "PLANNED",
        revision: 1,
        mesocycleId: "meso-1",
        advancesSplit: false,
        selectionMode: "INTENT",
        sessionIntent: "BODY_PART",
        selectionMetadata: {
          ...buildOptionalGapFillSelectionMetadata(),
          weekCloseId: "wc-1",
        },
      })
      .mockResolvedValueOnce({
        exercises: [
          {
            sets: [{ logs: [{ wasSkipped: false, actualReps: 12, actualRpe: 8, actualLoad: 70 }] }],
          },
        ],
      });
    mocks.tx.mesocycle.findUnique.mockResolvedValueOnce({
      id: "meso-1",
      state: "ACTIVE_DELOAD",
      durationWeeks: 5,
      accumulationSessionsCompleted: 12,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 3,
      startWeek: 0,
      macroCycle: {
        startDate: new Date("2026-03-01T00:00:00.000Z"),
      },
    });
    mocks.resolveWeekCloseOnOptionalGapFillCompletion.mockRejectedValueOnce(
      new Error("WEEK_CLOSE_NOT_PENDING")
    );

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workoutId: "workout-gap", action: "mark_completed" }),
      })
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "Linked week-close window is no longer pending.",
    });
    expect(mocks.tx.mesocycle.update).not.toHaveBeenCalled();
    expect(mocks.transitionMesocycleStateInTransaction).not.toHaveBeenCalled();
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

    const updateMany = mocks.workoutUpdateMany.mock.calls[0][0];
    expect(updateMany.data.mesocycleWeekSnapshot).toBe(5);
    expect(updateMany.data.mesoSessionSnapshot).toBe(2);
    expect(updateMany.data.mesocyclePhaseSnapshot).toBe("DELOAD");
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
    expect(mocks.tx.mesocycle.findUnique).toHaveBeenCalledWith({
      where: { id: "meso-1" },
      select: {
        id: true,
        state: true,
        durationWeeks: true,
        accumulationSessionsCompleted: true,
        deloadSessionsCompleted: true,
        sessionsPerWeek: true,
        startWeek: true,
        macroCycle: {
          select: {
            startDate: true,
          },
        },
      },
    });
    expect(mocks.tx.mesocycle.update).not.toHaveBeenCalled();
    expect(mocks.transitionMesocycleStateInTransaction).not.toHaveBeenCalled();

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
    expect(mocks.transitionMesocycleStateInTransaction).toHaveBeenCalledTimes(1);
    expect(mocks.transitionMesocycleStateInTransaction).toHaveBeenCalledWith(mocks.tx, "meso-1");
  });

  it("auto-dismisses a pending week-close window on forward performed progress and does not double-advance on retry", async () => {
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
      accumulationSessionsCompleted: 3,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 3,
      startWeek: 0,
      macroCycle: {
        startDate: new Date("2026-03-01T00:00:00.000Z"),
      },
    });
    mocks.autoDismissPendingWeekCloseOnForwardProgress
      .mockResolvedValueOnce({
        weekCloseId: "wc-1",
        status: "RESOLVED",
        resolution: "AUTO_DISMISSED",
        advancedLifecycle: false,
        outcome: "resolved",
      })
      .mockResolvedValueOnce({
        weekCloseId: null,
        status: null,
        resolution: null,
        advancedLifecycle: false,
        outcome: "not_found",
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
    expect(mocks.autoDismissPendingWeekCloseOnForwardProgress).toHaveBeenCalledTimes(1);
    expect(mocks.autoDismissPendingWeekCloseOnForwardProgress).toHaveBeenCalledWith(mocks.tx, {
      mesocycleId: "meso-1",
      workoutWeek: 2,
    });
    expect(mocks.transitionMesocycleStateInTransaction).not.toHaveBeenCalled();
    expect(mocks.tx.mesocycle.update).toHaveBeenCalledTimes(1);
  });

  it("treats a lost concurrent first-completion transition as a lifecycle no-op", async () => {
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
        revision: 2,
        mesocycleId: "meso-1",
      });
    mocks.workoutUpdateMany.mockResolvedValueOnce({ count: 0 });
    mocks.tx.mesocycle.findUnique.mockResolvedValueOnce({
      id: "meso-1",
      state: "ACTIVE_ACCUMULATION",
      durationWeeks: 5,
      accumulationSessionsCompleted: 5,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 3,
      startWeek: 0,
      macroCycle: {
        startDate: new Date("2026-03-01T00:00:00.000Z"),
      },
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workoutId: "workout-1", action: "mark_completed" }),
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.workoutUpdateMany).toHaveBeenCalledTimes(1);
    expect(mocks.tx.mesocycle.update).not.toHaveBeenCalled();
    expect(mocks.evaluateWeekCloseAtBoundary).not.toHaveBeenCalled();
    expect(mocks.transitionMesocycleStateInTransaction).not.toHaveBeenCalled();
    expect(mocks.workoutUpsert).not.toHaveBeenCalled();
  });
});
