import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalWritePause = process.env.TRAINER_WRITE_PAUSE;

afterEach(() => {
  if (originalWritePause === undefined) delete process.env.TRAINER_WRITE_PAUSE;
  else process.env.TRAINER_WRITE_PAUSE = originalWritePause;
});

const mocks = vi.hoisted(() => {
  const provisionOwnerForMutation = vi.fn();
  const loadActiveMesocycle = vi.fn();
  const loadPendingMesocycleHandoff = vi.fn();
  const loadNextWorkoutContext = vi.fn();
  const generateSessionFromTemplate = vi.fn();
  const generateDeloadSessionFromTemplate = vi.fn();
  const applyAutoregulation = vi.fn();

  return {
    provisionOwnerForMutation,
    loadActiveMesocycle,
    loadPendingMesocycleHandoff,
    loadNextWorkoutContext,
    generateSessionFromTemplate,
    generateDeloadSessionFromTemplate,
    applyAutoregulation,
  };
});

vi.mock("@/lib/api/workout-context", () => ({
  provisionOwnerForMutation: (...args: unknown[]) => mocks.provisionOwnerForMutation(...args),
}));

vi.mock("@/lib/api/mesocycle-lifecycle", () => ({
  loadActiveMesocycle: (...args: unknown[]) => mocks.loadActiveMesocycle(...args),
}));

vi.mock("@/lib/api/mesocycle-handoff", () => ({
  loadPendingMesocycleHandoff: (...args: unknown[]) => mocks.loadPendingMesocycleHandoff(...args),
}));

vi.mock("@/lib/api/next-session", () => ({
  loadNextWorkoutContext: (...args: unknown[]) => mocks.loadNextWorkoutContext(...args),
}));

vi.mock("@/lib/api/template-session", () => {
  const withAudit = async (result: Promise<unknown>) => {
    const resolved = await result;
    if (
      !resolved ||
      typeof resolved !== "object" ||
      "error" in resolved ||
      "audit" in resolved
    ) {
      return resolved;
    }
    return {
      ...resolved,
      audit: { progressionTraces: {}, prescriptions: {}, resolvedLoads: {} },
    };
  };
  return {
    generateSessionFromTemplate: (...args: unknown[]) =>
      withAudit(mocks.generateSessionFromTemplate(...args)),
    generateDeloadSessionFromTemplate: (...args: unknown[]) =>
      withAudit(mocks.generateDeloadSessionFromTemplate(...args)),
  };
});

vi.mock("@/lib/api/autoregulation", () => ({
  applyAutoregulation: (...args: unknown[]) => mocks.applyAutoregulation(...args),
}));

import { POST } from "./route";
import { autoregulateWorkout } from "@/lib/engine/readiness/autoregulate";
import {
  createNumericPrescription,
  createSemanticZeroPrescription,
} from "@/lib/engine/load-prescription";
import type { ApplyLoadsAudit } from "@/lib/engine/apply-loads";
import { buildPrescriptionConfidenceReadouts } from "@/lib/api/prescription-confidence-readout";

describe("POST /api/workouts/generate-from-template", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.TRAINER_WRITE_PAUSE;
    mocks.provisionOwnerForMutation.mockResolvedValue({ id: "user-1" });
    mocks.loadActiveMesocycle.mockResolvedValue({
      id: "meso-1",
      state: "ACTIVE_ACCUMULATION",
      durationWeeks: 5,
    });
    mocks.loadPendingMesocycleHandoff.mockResolvedValue(null);
    mocks.loadNextWorkoutContext.mockResolvedValue({
      activeMesocycleId: "meso-1",
      intent: "push",
      slotId: "push_a",
      slotSequenceIndex: 0,
      slotSource: "mesocycle_slot_sequence",
      existingWorkoutId: null,
      isExisting: false,
      source: "rotation",
      weekInMeso: 2,
      sessionInWeek: 1,
      derivationTrace: [],
      selectedIncompleteStatus: null,
    });
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

  it("projects a real readiness reduction through the template route's final authority", async () => {
    const workout = {
      id: "readiness-template",
      scheduledDate: "2026-03-03T00:00:00.000Z",
      warmup: [],
      mainLifts: [
        {
          id: "workout-exercise-1",
          exercise: { id: "bench", name: "Bench Press" },
          isMainLift: true,
          orderIndex: 0,
          sets: [{ setIndex: 1, targetReps: 8, targetLoad: 100, targetRpe: 8 }],
        },
      ],
      accessories: [
        {
          id: "workout-exercise-2",
          exercise: { id: "machine-hold", name: "Machine Hold" },
          isMainLift: false,
          orderIndex: 1,
          sets: [{ setIndex: 1, targetReps: 10, targetLoad: 100, targetRpe: 8 }],
        },
        {
          id: "workout-exercise-3",
          exercise: { id: "calibration", name: "Calibration Machine" },
          isMainLift: false,
          orderIndex: 2,
          sets: [{ setIndex: 1, targetReps: 10, targetRpe: 8 }],
        },
        {
          id: "workout-exercise-4",
          exercise: { id: "semantic-zero", name: "Bodyweight Movement" },
          isMainLift: false,
          orderIndex: 3,
          zeroLoadMeaning: "BODYWEIGHT_NO_ADDED_LOAD" as const,
          sets: [{ setIndex: 1, targetReps: 10, targetLoad: 0, targetRpe: 8 }],
        },
        {
          id: "workout-exercise-5",
          exercise: { id: "unavailable", name: "Unavailable Load" },
          isMainLift: false,
          orderIndex: 4,
          sets: [{ setIndex: 1, targetReps: 10, targetRpe: 8 }],
        },
        {
          id: "workout-exercise-6",
          exercise: { id: "not-applicable", name: "Not Applicable Load" },
          isMainLift: false,
          orderIndex: 5,
          sets: [{ setIndex: 1, targetReps: 10, targetRpe: 8 }],
        },
      ],
      estimatedMinutes: 45,
    };
    const prescription = createNumericPrescription({
      canonicalExerciseId: "bench",
      measurement: null,
      value: 100,
      source: "exact_history",
      confidence: "high",
      reasonCodes: ["same_exercise_same_measurement", "hold"],
      evidence: [{ evidenceId: "selected-history-exposure" }] as never,
    });
    const constrainedMachine = createNumericPrescription({
      canonicalExerciseId: "machine-hold",
      measurement: null,
      value: 100,
      source: "exact_history",
      confidence: "reduced",
      reasonCodes: ["missing_effort", "hold"],
      evidence: [{ evidenceId: "machine-history-exposure" }] as never,
    });
    const semanticZero = createSemanticZeroPrescription({
      canonicalExerciseId: "semantic-zero",
      measurement: null,
      zeroLoadMeaning: "BODYWEIGHT_NO_ADDED_LOAD",
    });
    const audit: ApplyLoadsAudit = {
      progressionTraces: {},
      prescriptions: {
        bench: prescription,
        "machine-hold": constrainedMachine,
        calibration: {
          version: 1,
          kind: "calibration_required",
          canonicalExerciseId: "calibration",
          measurement: null,
          confidence: "low",
          reasonCodes: ["legacy_machine_calibration_only"],
          evidence: [],
        },
        "semantic-zero": semanticZero,
        unavailable: {
          version: 1,
          kind: "unavailable",
          canonicalExerciseId: "unavailable",
          measurement: null,
          reasonCodes: ["no_comparable_history"],
          evidence: [],
          blockingFields: ["evidence"],
        },
        "not-applicable": {
          version: 1,
          kind: "not_applicable",
          canonicalExerciseId: "not-applicable",
          measurement: null,
          reasonCodes: ["bodyweight_no_load_not_applicable"],
          evidence: [],
        },
      },
      resolvedLoads: {
        bench: {
          source: "history",
          canonicalSourceLoad: 100,
          resolvedTopSetLoad: 100,
          resolvedSetLoads: [100],
        },
        "machine-hold": {
          source: "history",
          canonicalSourceLoad: 100,
          resolvedTopSetLoad: 100,
          resolvedSetLoads: [100],
        },
        calibration: {
          source: "none",
          canonicalSourceLoad: null,
          resolvedTopSetLoad: null,
          resolvedSetLoads: [],
        },
        "semantic-zero": {
          source: "existing_target_load",
          canonicalSourceLoad: 0,
          resolvedTopSetLoad: 0,
          resolvedSetLoads: [0],
        },
        unavailable: {
          source: "none",
          canonicalSourceLoad: null,
          resolvedTopSetLoad: null,
          resolvedSetLoads: [],
        },
        "not-applicable": {
          source: "none",
          canonicalSourceLoad: null,
          resolvedTopSetLoad: null,
          resolvedSetLoads: [],
        },
      },
    };
    let finalAudit: ApplyLoadsAudit | undefined;
    mocks.generateSessionFromTemplate.mockResolvedValue({
      workout,
      templateId: "template-1",
      selectionMode: "AUTO",
      sessionIntent: "push",
      sraWarnings: [],
      substitutions: [],
      volumePlanByMuscle: {},
      prescriptionReadouts: [],
      selection: {
        selectedExerciseIds: ["bench"],
        mainLiftIds: ["bench"],
        accessoryIds: [
          "machine-hold",
          "calibration",
          "semantic-zero",
          "unavailable",
          "not-applicable",
        ],
        perExerciseSetTargets: {
          bench: 1,
          "machine-hold": 1,
          calibration: 1,
          "semantic-zero": 1,
          unavailable: 1,
          "not-applicable": 1,
        },
        rationale: {},
        volumePlanByMuscle: {},
      },
      audit,
    });
    mocks.applyAutoregulation.mockImplementationOnce(async (_userId, inputWorkout, inputAudit) => {
      const fatigueScore = {
        overall: 0.4,
        perMuscle: {},
        weights: { whoop: 0, subjective: 0.6, performance: 0.4 },
        components: {
          whoopContribution: 0,
          subjectiveContribution: 0.2,
          performanceContribution: 0.2,
        },
      };
      const transformed = autoregulateWorkout(
        inputWorkout as never,
        inputAudit as ApplyLoadsAudit,
        fatigueScore,
      );
      finalAudit = transformed.loadAudit;
      return {
        original: inputWorkout,
        adjusted: transformed.adjustedWorkout,
        loadAudit: transformed.loadAudit,
        prescriptionReadouts: buildPrescriptionConfidenceReadouts({
          workout: transformed.adjustedWorkout,
          loadAudit: transformed.loadAudit,
        }),
        modifications: transformed.modifications,
        fatigueScore,
        rationale: transformed.rationale,
        wasAutoregulated: true,
        applied: true,
        reason: transformed.rationale,
        signalAgeHours: 1,
      };
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/generate-from-template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: "template-1" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.workout.mainLifts[0].sets[0].targetLoad).toBe(90);
    expect(body.prescriptionReadouts[0].targetLoad).toBe(90);
    expect(finalAudit?.prescriptions.bench).toMatchObject({
      kind: "numeric",
      value: 90,
      reasonCodes: expect.arrayContaining(["readiness_adjusted", "readiness_reduce"]),
      evidence: [expect.objectContaining({ evidenceId: "selected-history-exposure" })],
    });
    expect(finalAudit?.resolvedLoads.bench.resolvedTopSetLoad).toBe(90);
    expect(body.workout.accessories.map((exercise: { sets: Array<{ targetLoad?: number }> }) =>
      exercise.sets[0].targetLoad ?? null,
    )).toEqual([90, null, 0, null, null]);
    expect(body.prescriptionReadouts.slice(1).map((readout: { targetLoad: number | null }) =>
      readout.targetLoad,
    )).toEqual([90, null, 0, null, null]);
    expect(finalAudit?.prescriptions["machine-hold"]).toMatchObject({
      kind: "numeric",
      value: 90,
      confidence: "reduced",
      reasonCodes: expect.arrayContaining([
        "missing_effort",
        "hold",
        "readiness_adjusted",
        "readiness_reduce",
      ]),
    });
    expect(finalAudit?.prescriptions.calibration.kind).toBe("calibration_required");
    expect(finalAudit?.prescriptions["semantic-zero"]).toMatchObject({
      kind: "semantic_zero",
      value: 0,
      zeroLoadMeaning: "BODYWEIGHT_NO_ADDED_LOAD",
    });
    expect(finalAudit?.prescriptions.unavailable.kind).toBe("unavailable");
    expect(finalAudit?.prescriptions["not-applicable"].kind).toBe("not_applicable");
  });

  it("returns 503 before owner resolution or workout materialization when writes are paused", async () => {
    process.env.TRAINER_WRITE_PAUSE = "enabled";
    const response = await POST(
      new Request("http://localhost/api/workouts/generate-from-template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: "template-1" }),
      }),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("60");
    await expect(response.json()).resolves.toMatchObject({ code: "PRODUCTION_WRITE_PAUSED" });
    expect(mocks.provisionOwnerForMutation).not.toHaveBeenCalled();
    expect(mocks.generateSessionFromTemplate).not.toHaveBeenCalled();
  });

  it("rejects generation while mesocycle handoff is pending", async () => {
    mocks.loadPendingMesocycleHandoff.mockResolvedValue({
      mesocycleId: "meso-1",
      mesoNumber: 1,
      focus: "Hypertrophy",
      closedAt: "2026-03-10T00:00:00.000Z",
      summary: null,
      draft: null,
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/generate-from-template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: "template-1" }),
      })
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "Mesocycle handoff pending.",
      handoff: expect.objectContaining({ mesocycleId: "meso-1" }),
    });
    expect(mocks.loadActiveMesocycle).not.toHaveBeenCalled();
    expect(mocks.generateSessionFromTemplate).not.toHaveBeenCalled();
  });

  it("rejects generation when the selected plan is not ready", async () => {
    mocks.loadActiveMesocycle.mockResolvedValue(null);

    const response = await POST(
      new Request("http://localhost/api/workouts/generate-from-template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: "template-1" }),
      })
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Selected plan with an active mesocycle is required.",
    });
    expect(mocks.loadNextWorkoutContext).not.toHaveBeenCalled();
    expect(mocks.generateSessionFromTemplate).not.toHaveBeenCalled();
  });

  it("rejects generation when selected-plan reads disagree", async () => {
    mocks.loadNextWorkoutContext.mockResolvedValue({
      activeMesocycleId: "meso-2",
      source: "rotation",
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/generate-from-template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: "template-1" }),
      })
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Active plan selection changed concurrently. Retry generation.",
    });
    expect(mocks.generateSessionFromTemplate).not.toHaveBeenCalled();
  });

  it("rejects template generation while final week-close is pending", async () => {
    mocks.loadActiveMesocycle.mockResolvedValue({
      id: "meso-1",
      state: "ACTIVE_ACCUMULATION",
    });
    mocks.loadNextWorkoutContext.mockResolvedValue({
      intent: null,
      slotId: null,
      slotSequenceIndex: null,
      slotSequenceLength: 4,
      slotSource: null,
      existingWorkoutId: null,
      isExisting: false,
      source: "final_week_close_pending",
      weekInMeso: null,
      sessionInWeek: null,
      derivationTrace: [],
      selectedIncompleteStatus: null,
      lifecycleBlocker: {
        code: "FINAL_ACCUMULATION_WEEK_CLOSE_PENDING",
        severity: "hard_blocker",
        message:
          "Week 4 closeout is pending. Resolve or dismiss the optional gap-fill before generating the Week 5 deload. Standard accumulation generation is blocked to prevent an unintended extra accumulation session.",
        mesocycleId: "meso-1",
        weekCloseId: "wc-4",
        targetWeek: 4,
      },
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/generate-from-template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: "template-1" }),
      })
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error:
        "Week 4 closeout is pending. Resolve or dismiss the optional gap-fill before generating the Week 5 deload. Standard accumulation generation is blocked to prevent an unintended extra accumulation session.",
      blocker: expect.objectContaining({
        code: "FINAL_ACCUMULATION_WEEK_CLOSE_PENDING",
        weekCloseId: "wc-4",
      }),
    });
    expect(mocks.generateSessionFromTemplate).not.toHaveBeenCalled();
    expect(mocks.generateDeloadSessionFromTemplate).not.toHaveBeenCalled();
  });

  it("returns canonical selectionMetadata for template generation", async () => {
    mocks.generateSessionFromTemplate.mockResolvedValue({
      workout: {
        id: "w1",
        scheduledDate: new Date("2026-03-03T00:00:00.000Z").toISOString(),
        warmup: [],
        mainLifts: [
          {
            id: "we-1",
            exercise: { id: "ex-1", name: "Bench Press" },
            isMainLift: true,
            orderIndex: 0,
            sets: [{ setIndex: 1, targetReps: 8, targetLoad: 185, targetRpe: 8 }],
          },
        ],
        accessories: [],
        estimatedMinutes: 45,
      },
      templateId: "template-1",
      selectionMode: "AUTO",
      sessionIntent: "push",
      sraWarnings: [],
      substitutions: [],
      volumePlanByMuscle: {},
      prescriptionReadouts: [
        {
          exerciseId: "ex-1",
          exerciseName: "Bench Press",
          targetLoad: 185,
          targetReps: 8,
          repRange: { min: 8, max: 8 },
          targetRpe: 8,
          targetRir: 2,
          loadSource: "history",
          confidence: "high",
          cautionLevel: "none",
          cautionReason: null,
          suggestedAdjustmentRange: null,
        },
      ],
      selection: {
        selectedExerciseIds: ["ex-1"],
        mainLiftIds: ["ex-1"],
        accessoryIds: [],
        perExerciseSetTargets: { "ex-1": 3 },
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
          sessionProvenance: {
            mesocycleId: null,
            compositionSource: "runtime_selection",
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
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/generate-from-template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: "template-1" }),
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.selectionMetadata).toBeDefined();
    expect(body.selection).toBeUndefined();
    expect(body.autoregulation).toBeUndefined();
    expect(body.prescriptionReadouts).toEqual([
      expect.objectContaining({
        exerciseId: "ex-1",
        exerciseName: "Bench Press",
        confidence: "high",
        cautionLevel: "none",
      }),
    ]);
    expect(body.selectionMetadata.sessionDecisionReceipt.version).toBe(2);
    expect(body.selectionMetadata.sessionDecisionReceipt.sessionSlot).toEqual({
      slotId: "push_a",
      intent: "push",
      sequenceIndex: 0,
      source: "mesocycle_slot_sequence",
    });
    expect(body.selectionMetadata.sessionDecisionReceipt.sessionProvenance).toEqual({
      mesocycleId: null,
      compositionSource: "runtime_selection",
    });
  });
});
