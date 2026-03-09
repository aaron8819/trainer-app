import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const resolveOwner = vi.fn();
  const loadActiveMesocycle = vi.fn();
  const findPendingWeekCloseForUser = vi.fn();
  const generateSessionFromIntent = vi.fn();
  const generateDeloadSessionFromIntent = vi.fn();
  const applyAutoregulation = vi.fn();

  return {
    resolveOwner,
    loadActiveMesocycle,
    findPendingWeekCloseForUser,
    generateSessionFromIntent,
    generateDeloadSessionFromIntent,
    applyAutoregulation,
  };
});

vi.mock("@/lib/api/workout-context", () => ({
  resolveOwner: (...args: unknown[]) => mocks.resolveOwner(...args),
}));

vi.mock("@/lib/api/mesocycle-lifecycle", () => ({
  loadActiveMesocycle: (...args: unknown[]) => mocks.loadActiveMesocycle(...args),
}));

vi.mock("@/lib/api/mesocycle-week-close", () => ({
  findPendingWeekCloseForUser: (...args: unknown[]) => mocks.findPendingWeekCloseForUser(...args),
}));

vi.mock("@/lib/api/template-session", () => ({
  generateSessionFromIntent: (...args: unknown[]) => mocks.generateSessionFromIntent(...args),
  generateDeloadSessionFromIntent: (...args: unknown[]) =>
    mocks.generateDeloadSessionFromIntent(...args),
}));

vi.mock("@/lib/api/autoregulation", () => ({
  applyAutoregulation: (...args: unknown[]) => mocks.applyAutoregulation(...args),
}));

import { POST } from "./route";

describe("POST /api/workouts/generate-from-intent deload gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveOwner.mockResolvedValue({ id: "user-1" });
    mocks.findPendingWeekCloseForUser.mockResolvedValue(null);
    mocks.applyAutoregulation.mockImplementation(async (_userId, workout) => ({
      adjusted: workout,
      applied: false,
      reason: null,
      signalAgeHours: null,
      fatigueScore: null,
      modifications: [],
      rationale: null,
      wasAutoregulated: false,
    }));
  });

  it("returns deload prescription path when active mesocycle state is ACTIVE_DELOAD", async () => {
    mocks.loadActiveMesocycle.mockResolvedValue({ id: "meso-1", state: "ACTIVE_DELOAD" });
    mocks.generateDeloadSessionFromIntent.mockResolvedValue({
      workout: {
        id: "w1",
        scheduledDate: new Date().toISOString(),
        warmup: [],
        mainLifts: [{ id: "ex", exercise: { id: "ex", name: "Row" }, isMainLift: true, orderIndex: 0, sets: [{ setIndex: 1, targetReps: 8, targetLoad: 60, targetRpe: 5 }] }],
        accessories: [],
        estimatedMinutes: 30,
      },
      selectionMode: "INTENT",
      sessionIntent: "pull",
      sraWarnings: [],
      substitutions: [],
      volumePlanByMuscle: {},
      selection: {
        selectedExerciseIds: ["ex"],
        mainLiftIds: ["ex"],
        accessoryIds: [],
        perExerciseSetTargets: { ex: 1 },
        rationale: {},
        volumePlanByMuscle: {},
      },
      filteredExercises: [],
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/generate-from-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "pull" }),
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.generateDeloadSessionFromIntent).toHaveBeenCalledOnce();
    expect(mocks.generateSessionFromIntent).not.toHaveBeenCalled();
    expect(body.workout.mainLifts[0].sets[0].targetRpe).toBe(5);
  });

  it("returns receipt-first selection metadata without top-level autoregulation", async () => {
    mocks.loadActiveMesocycle.mockResolvedValue(null);
    mocks.generateSessionFromIntent.mockResolvedValue({
      workout: {
        id: "w2",
        scheduledDate: new Date("2026-03-03T00:00:00.000Z").toISOString(),
        warmup: [],
        mainLifts: [
          {
            id: "we-2",
            exercise: { id: "ex-2", name: "Press" },
            isMainLift: true,
            orderIndex: 0,
            sets: [{ setIndex: 1, targetReps: 6, targetLoad: 135, targetRpe: 7 }],
          },
        ],
        accessories: [],
        estimatedMinutes: 40,
      },
      selectionMode: "INTENT",
      sessionIntent: "push",
      sraWarnings: [],
      substitutions: [],
      volumePlanByMuscle: {},
      selection: {
        selectedExerciseIds: ["ex-2"],
        mainLiftIds: ["ex-2"],
        accessoryIds: [],
        perExerciseSetTargets: { "ex-2": 3 },
        rationale: {},
        volumePlanByMuscle: {},
        sessionDecisionReceipt: {
          version: 1,
          cycleContext: {
            weekInMeso: 2,
            weekInBlock: 2,
            mesocycleLength: 5,
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
      },
      filteredExercises: [],
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/generate-from-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "push" }),
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.selectionMetadata).toBeDefined();
    expect(body.selection).toBeUndefined();
    expect(body.autoregulation).toBeUndefined();
    expect(body.selectionMetadata.sessionDecisionReceipt.version).toBe(1);
  });

  it("rejects supplemental deficit generation for non-body_part intents", async () => {
    mocks.loadActiveMesocycle.mockResolvedValue(null);

    const response = await POST(
      new Request("http://localhost/api/workouts/generate-from-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent: "push",
          supplementalDeficitSession: true,
        }),
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Invalid request",
    });
    expect(mocks.generateSessionFromIntent).not.toHaveBeenCalled();
  });

  it("returns supplemental deficit metadata already stamped by the backend", async () => {
    mocks.loadActiveMesocycle.mockResolvedValue(null);
    mocks.generateSessionFromIntent.mockResolvedValue({
      workout: {
        id: "w-supp-1",
        scheduledDate: new Date("2026-03-03T00:00:00.000Z").toISOString(),
        warmup: [],
        mainLifts: [
          {
            id: "we-2",
            exercise: { id: "ex-2", name: "Cable Fly" },
            isMainLift: true,
            orderIndex: 0,
            sets: [{ setIndex: 1, targetReps: 12, targetLoad: 40, targetRpe: 8 }],
          },
        ],
        accessories: [],
        estimatedMinutes: 30,
      },
      selectionMode: "INTENT",
      sessionIntent: "body_part",
      sraWarnings: [],
      substitutions: [],
      volumePlanByMuscle: {},
      selection: {
        selectedExerciseIds: ["ex-2"],
        mainLiftIds: ["ex-2"],
        accessoryIds: [],
        perExerciseSetTargets: { "ex-2": 2 },
        rationale: {},
        volumePlanByMuscle: {},
        sessionDecisionReceipt: {
          version: 1,
          cycleContext: {
            weekInMeso: 2,
            weekInBlock: 2,
            mesocycleLength: 5,
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
      },
      filteredExercises: [],
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/generate-from-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent: "body_part",
          targetMuscles: ["rear delts"],
          supplementalDeficitSession: true,
        }),
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.selectionMetadata.sessionDecisionReceipt.targetMuscles).toEqual(["rear delts"]);
    expect(body.selectionMetadata.sessionDecisionReceipt.exceptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "supplemental_deficit_session" }),
      ])
    );
  });

  it("pins receipt week from the pending week-close row and preserves marker + weekCloseId", async () => {
    mocks.loadActiveMesocycle.mockResolvedValue({ id: "meso-1", state: "ACTIVE_ACCUMULATION", durationWeeks: 5 });
    mocks.findPendingWeekCloseForUser.mockResolvedValue({
      id: "wc-1",
      mesocycleId: "meso-1",
      targetWeek: 3,
      targetPhase: "ACCUMULATION",
      status: "PENDING_OPTIONAL_GAP_FILL",
      deficitSnapshot: {
        version: 1,
        policy: {
          requiredSessionsPerWeek: 3,
          maxOptionalGapFillSessionsPerWeek: 1,
          maxGeneratedHardSets: 2,
          maxGeneratedExercises: 1,
        },
        summary: {
          totalDeficitSets: 4,
          qualifyingMuscleCount: 1,
          topTargetMuscles: ["front delts"],
        },
        muscles: [{ muscle: "front delts", target: 6, actual: 2, deficit: 4 }],
      },
      optionalWorkout: null,
    });
    mocks.generateSessionFromIntent.mockResolvedValue({
      workout: {
        id: "w-gap",
        scheduledDate: new Date("2026-03-03T00:00:00.000Z").toISOString(),
        warmup: [],
        mainLifts: [
          {
            id: "we-1",
            exercise: { id: "ex-1", name: "Press" },
            isMainLift: true,
            orderIndex: 0,
            sets: [
              { setIndex: 1, targetReps: 10 },
              { setIndex: 2, targetReps: 10 },
            ],
          },
          {
            id: "we-2",
            exercise: { id: "ex-2", name: "Fly" },
            isMainLift: true,
            orderIndex: 1,
            sets: [{ setIndex: 1, targetReps: 12 }],
          },
        ],
        accessories: [
          {
            id: "we-3",
            exercise: { id: "ex-3", name: "Curl" },
            isMainLift: false,
            orderIndex: 2,
            sets: [{ setIndex: 1, targetReps: 12 }],
          },
        ],
        estimatedMinutes: 40,
      },
      selectionMode: "INTENT",
      sessionIntent: "body_part",
      sraWarnings: [],
      substitutions: [],
      volumePlanByMuscle: {},
      selection: {
        selectedExerciseIds: ["ex-1", "ex-2", "ex-3"],
        mainLiftIds: ["ex-1", "ex-2"],
        accessoryIds: ["ex-3"],
        perExerciseSetTargets: { "ex-1": 2, "ex-2": 1, "ex-3": 1 },
        rationale: {},
        volumePlanByMuscle: {},
        sessionDecisionReceipt: {
          version: 1,
          cycleContext: {
            weekInMeso: 3,
            weekInBlock: 3,
            mesocycleLength: 5,
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
      },
      filteredExercises: [],
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/generate-from-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent: "body_part",
          weekCloseId: "wc-1",
          optionalGapFill: true,
        }),
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.findPendingWeekCloseForUser).toHaveBeenCalledWith({
      userId: "user-1",
      weekCloseId: "wc-1",
      mesocycleId: "meso-1",
    });
    expect(mocks.generateSessionFromIntent).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        weekCloseId: "wc-1",
        optionalGapFillContext: {
          weekCloseId: "wc-1",
          targetWeek: 3,
        },
        targetMuscles: ["front delts"],
        maxGeneratedHardSets: 2,
        maxGeneratedExercises: 1,
      })
    );
    expect(body.selectionMetadata.sessionDecisionReceipt.cycleContext.weekInMeso).toBe(3);
    expect(body.selectionMetadata.sessionDecisionReceipt.cycleContext.weekInBlock).toBe(3);
    expect(body.workout.mainLifts.length).toBe(1);
    expect(body.workout.accessories.length).toBe(0);
    expect(body.workout.mainLifts[0].sets.length).toBe(2);
    expect(body.selectionMetadata.sessionDecisionReceipt.exceptions).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "optional_gap_fill" })])
    );
    expect(body.selectionMetadata.sessionDecisionReceipt.targetMuscles).toEqual(["front delts"]);
    expect(body.selectionMetadata.weekCloseId).toBe("wc-1");
  });

  it("bypasses deload route semantics for pending optional gap-fill after lifecycle advances", async () => {
    mocks.loadActiveMesocycle.mockResolvedValue({ id: "meso-1", state: "ACTIVE_DELOAD", durationWeeks: 5 });
    mocks.findPendingWeekCloseForUser.mockResolvedValue({
      id: "wc-1",
      mesocycleId: "meso-1",
      targetWeek: 4,
      targetPhase: "ACCUMULATION",
      status: "PENDING_OPTIONAL_GAP_FILL",
      deficitSnapshot: {
        version: 1,
        policy: {
          requiredSessionsPerWeek: 3,
          maxOptionalGapFillSessionsPerWeek: 1,
          maxGeneratedHardSets: 12,
          maxGeneratedExercises: 4,
        },
        summary: {
          totalDeficitSets: 3,
          qualifyingMuscleCount: 1,
          topTargetMuscles: ["front delts"],
        },
        muscles: [{ muscle: "front delts", target: 5, actual: 2, deficit: 3 }],
      },
      optionalWorkout: null,
    });
    mocks.generateSessionFromIntent.mockResolvedValue({
      workout: {
        id: "w-gap",
        scheduledDate: new Date("2026-03-24T00:00:00.000Z").toISOString(),
        warmup: [],
        mainLifts: [
          {
            id: "we-1",
            exercise: { id: "ex-1", name: "Press" },
            isMainLift: true,
            orderIndex: 0,
            sets: [{ setIndex: 1, targetReps: 8, targetRpe: 9 }],
          },
        ],
        accessories: [],
        estimatedMinutes: 35,
      },
      selectionMode: "INTENT",
      sessionIntent: "body_part",
      sraWarnings: [],
      substitutions: [],
      volumePlanByMuscle: {},
      selection: {
        selectedExerciseIds: ["ex-1"],
        mainLiftIds: ["ex-1"],
        accessoryIds: [],
        perExerciseSetTargets: { "ex-1": 1 },
        rationale: {},
        volumePlanByMuscle: {},
        sessionDecisionReceipt: {
          version: 1,
          cycleContext: {
            weekInMeso: 4,
            weekInBlock: 4,
            mesocycleLength: 5,
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
      },
      filteredExercises: [],
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/generate-from-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent: "body_part",
          weekCloseId: "wc-1",
          optionalGapFill: true,
        }),
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.generateSessionFromIntent).toHaveBeenCalledOnce();
    expect(mocks.generateDeloadSessionFromIntent).not.toHaveBeenCalled();
    expect(body.selectionMetadata.sessionDecisionReceipt.cycleContext).toEqual(
      expect.objectContaining({
        weekInMeso: 4,
        weekInBlock: 4,
        mesocycleLength: 5,
        phase: "accumulation",
        blockType: "accumulation",
        isDeload: false,
      })
    );
    expect(body.selectionMetadata.weekCloseId).toBe("wc-1");
  });

  it("rejects optional gap-fill generation when the pending row is missing or stale", async () => {
    mocks.loadActiveMesocycle.mockResolvedValue({ id: "meso-1", state: "ACTIVE_ACCUMULATION", durationWeeks: 5 });
    mocks.findPendingWeekCloseForUser.mockResolvedValue(null);

    const response = await POST(
      new Request("http://localhost/api/workouts/generate-from-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent: "body_part",
          weekCloseId: "wc-stale",
          optionalGapFill: true,
        }),
      })
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "Pending week-close window not found.",
    });
    expect(mocks.generateSessionFromIntent).not.toHaveBeenCalled();
  });

  it("rejects optional gap-fill generation when a workout is already linked", async () => {
    mocks.loadActiveMesocycle.mockResolvedValue({ id: "meso-1", state: "ACTIVE_ACCUMULATION", durationWeeks: 5 });
    mocks.findPendingWeekCloseForUser.mockResolvedValue({
      id: "wc-1",
      mesocycleId: "meso-1",
      targetWeek: 3,
      targetPhase: "ACCUMULATION",
      status: "PENDING_OPTIONAL_GAP_FILL",
      deficitSnapshot: {
        version: 1,
        policy: {
          requiredSessionsPerWeek: 3,
          maxOptionalGapFillSessionsPerWeek: 1,
          maxGeneratedHardSets: 12,
          maxGeneratedExercises: 4,
        },
        summary: {
          totalDeficitSets: 3,
          qualifyingMuscleCount: 1,
          topTargetMuscles: ["front delts"],
        },
        muscles: [{ muscle: "front delts", target: 5, actual: 2, deficit: 3 }],
      },
      optionalWorkout: {
        id: "w-gap-1",
        status: "PLANNED",
        scheduledDate: new Date("2026-03-03T00:00:00.000Z"),
      },
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/generate-from-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent: "body_part",
          weekCloseId: "wc-1",
          optionalGapFill: true,
        }),
      })
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "A gap-fill workout is already linked to this week-close window.",
      workoutId: "w-gap-1",
    });
  });

  it("keeps lifecycle-derived receipt week when optionalGapFill is false", async () => {
    mocks.loadActiveMesocycle.mockResolvedValue(null);
    mocks.generateSessionFromIntent.mockResolvedValue({
      workout: {
        id: "w-pull",
        scheduledDate: new Date("2026-03-03T00:00:00.000Z").toISOString(),
        warmup: [],
        mainLifts: [
          {
            id: "we-1",
            exercise: { id: "ex-1", name: "Row" },
            isMainLift: true,
            orderIndex: 0,
            sets: [{ setIndex: 1, targetReps: 8 }],
          },
        ],
        accessories: [],
        estimatedMinutes: 35,
      },
      selectionMode: "INTENT",
      sessionIntent: "pull",
      sraWarnings: [],
      substitutions: [],
      volumePlanByMuscle: {},
      selection: {
        selectedExerciseIds: ["ex-1"],
        mainLiftIds: ["ex-1"],
        accessoryIds: [],
        perExerciseSetTargets: { "ex-1": 1 },
        rationale: {},
        volumePlanByMuscle: {},
        sessionDecisionReceipt: {
          version: 1,
          cycleContext: {
            weekInMeso: 4,
            weekInBlock: 4,
            mesocycleLength: 5,
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
      },
      filteredExercises: [],
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/generate-from-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent: "pull",
          optionalGapFill: false,
        }),
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.selectionMetadata.sessionDecisionReceipt.cycleContext.weekInMeso).toBe(4);
    expect(body.selectionMetadata.sessionDecisionReceipt.exceptions).toEqual([]);
  });
});
