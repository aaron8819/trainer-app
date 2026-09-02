import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const mocks = vi.hoisted(() => {
  const provisionOwnerForMutation = vi.fn();
  const loadActiveMesocycle = vi.fn();
  const loadPendingMesocycleHandoff = vi.fn();
  const loadNextWorkoutContext = vi.fn();
  const loadRequestedAdvancingSlotSnapshot = vi.fn();
  const resolveRequestedV4ScheduledGenerationObligation = vi.fn();
  const findPendingWeekCloseForUser = vi.fn();
  const generateSessionFromIntent = vi.fn();
  const generateDeloadSessionFromIntent = vi.fn();
  const applyAutoregulation = vi.fn();
  const applySessionCapacityReduction = vi.fn();

  return {
    provisionOwnerForMutation,
    loadActiveMesocycle,
    loadPendingMesocycleHandoff,
    loadNextWorkoutContext,
    loadRequestedAdvancingSlotSnapshot,
    resolveRequestedV4ScheduledGenerationObligation,
    findPendingWeekCloseForUser,
    generateSessionFromIntent,
    generateDeloadSessionFromIntent,
    applyAutoregulation,
    applySessionCapacityReduction,
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
  loadRequestedAdvancingSlotSnapshot: (...args: unknown[]) =>
    mocks.loadRequestedAdvancingSlotSnapshot(...args),
  resolveRequestedV4ScheduledGenerationObligation: (...args: unknown[]) =>
    mocks.resolveRequestedV4ScheduledGenerationObligation(...args),
}));

vi.mock("@/lib/api/mesocycle-week-close", () => ({
  findPendingWeekCloseForUser: (...args: unknown[]) => mocks.findPendingWeekCloseForUser(...args),
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
    generateSessionFromIntent: (...args: unknown[]) =>
      withAudit(mocks.generateSessionFromIntent(...args)),
    generateDeloadSessionFromIntent: (...args: unknown[]) =>
      withAudit(mocks.generateDeloadSessionFromIntent(...args)),
  };
});

vi.mock("@/lib/api/autoregulation", () => ({
  applyAutoregulation: (...args: unknown[]) => mocks.applyAutoregulation(...args),
}));

vi.mock("@/lib/api/template-session/session-capacity-reduction", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/lib/api/template-session/session-capacity-reduction")
  >();
  mocks.applySessionCapacityReduction.mockImplementation(
    actual.applySessionCapacityReduction,
  );
  return {
    ...actual,
    applySessionCapacityReduction: (...args: unknown[]) =>
      mocks.applySessionCapacityReduction(...args),
  };
});

import { POST } from "./route";
import { autoregulateWorkout } from "@/lib/engine/readiness/autoregulate";
import { createNumericPrescription } from "@/lib/engine/load-prescription";
import type { ApplyLoadsAudit } from "@/lib/engine/apply-loads";

const V4_HASH = "a".repeat(64);

function exactV4Revision() {
  return {
    id: "revision-1",
    revision: 1,
    seedPayload: { version: 4 },
    payloadHash: V4_HASH,
    hashAlgorithm: "sha256",
    provenanceStatus: "exact",
  };
}

function exactV4Obligation(input: {
  week: number;
  slotId: string;
  intent: "upper" | "lower" | "pull";
  sequenceIndex?: number;
}) {
  const requiredSlot = {
    weekInMeso: input.week,
    phase: input.week === 5 ? "DELOAD" as const : "ACCUMULATION" as const,
    slotId: input.slotId,
    intent: input.intent,
    sequenceIndex: input.sequenceIndex ?? 0,
    sequenceLength: 4,
  };
  const authority = {
    mesocycleId: "meso-1",
    revisionId: "revision-1",
    revisionNumber: 1,
    revisionHash: V4_HASH,
    slotsPerWeek: 4,
    requiredSlots: [requiredSlot],
  };
  return { authority, requiredSlot };
}

function exactV4Receipt(input: {
  week: number;
  phase: "accumulation" | "deload";
  slotId: string;
  intent: "pull" | "upper" | "lower";
}) {
  return {
    version: 1 as const,
    cycleContext: {
      weekInMeso: input.week,
      weekInBlock: input.phase === "deload" ? 1 : input.week,
      mesocycleLength: 5,
      phase: input.phase,
      blockType: input.phase,
      isDeload: input.phase === "deload",
      source: "computed" as const,
    },
    lifecycleVolume: { source: "unknown" as const },
    sorenessSuppressedMuscles: [],
    deloadDecision: {
      mode: "none" as const,
      reason: [],
      reductionPercent: 0,
      appliedTo: "none" as const,
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
    sessionSlot: {
      slotId: input.slotId,
      intent: input.intent,
      sequenceIndex: 0,
      sequenceLength: 4,
      source: "mesocycle_slot_sequence" as const,
    },
    sessionProvenance: {
      mesocycleId: "meso-1",
      compositionSource: "persisted_slot_plan_seed" as const,
      seedProvenance: {
        revisionId: "revision-1",
        revision: 1,
        hash: V4_HASH,
      },
    },
  };
}

function numericAudit(
  rows: Array<{ placementId: string; exerciseId: string; load: number }>,
): ApplyLoadsAudit {
  return {
    progressionTraces: {},
    prescriptions: Object.fromEntries(rows.map((row) => [
      row.placementId,
      createNumericPrescription({
        canonicalExerciseId: row.exerciseId,
        measurement: null,
        value: row.load,
        source: "exact_history",
        confidence: "high",
        reasonCodes: ["same_exercise_same_measurement"],
        evidence: [],
      }),
    ])),
    resolvedLoads: Object.fromEntries(rows.map((row) => [
      row.placementId,
      {
        placementId: row.placementId,
        canonicalExerciseId: row.exerciseId,
        source: "history" as const,
        canonicalSourceLoad: row.load,
        resolvedTopSetLoad: row.load,
        resolvedSetLoads: [row.load],
      },
    ])),
  };
}

describe("POST /api/workouts/generate-from-intent deload gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.provisionOwnerForMutation.mockResolvedValue({ id: "user-1" });
    mocks.loadPendingMesocycleHandoff.mockResolvedValue(null);
    mocks.loadActiveMesocycle.mockResolvedValue({
      id: "meso-1",
      state: "ACTIVE_ACCUMULATION",
      durationWeeks: 5,
    });
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
    mocks.loadRequestedAdvancingSlotSnapshot.mockResolvedValue(undefined);
    mocks.resolveRequestedV4ScheduledGenerationObligation.mockReturnValue(undefined);
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

  it("projects a real readiness reduction through the final prescription, target, audit, and readout", async () => {
    const workout = {
      id: "readiness-intent",
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
      accessories: [],
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
    const audit: ApplyLoadsAudit = {
      progressionTraces: {},
      prescriptions: { "workout-exercise-1": prescription },
      resolvedLoads: {
        "workout-exercise-1": {
          placementId: "workout-exercise-1",
          canonicalExerciseId: "bench",
          source: "history",
          canonicalSourceLoad: 100,
          resolvedTopSetLoad: 100,
          resolvedSetLoads: [100],
        },
      },
    };
    let finalAudit: ApplyLoadsAudit | undefined;
    mocks.generateSessionFromIntent.mockResolvedValue({
      workout,
      selectionMode: "INTENT",
      sessionIntent: "push",
      sraWarnings: [],
      substitutions: [],
      volumePlanByMuscle: {},
      prescriptionReadouts: [],
      selection: {
        selectedExerciseIds: ["bench"],
        mainLiftIds: ["bench"],
        accessoryIds: [],
        perExerciseSetTargets: { bench: 1 },
        rationale: {},
        volumePlanByMuscle: {},
      },
      filteredExercises: [],
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
      new Request("http://localhost/api/workouts/generate-from-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "push" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.workout.mainLifts[0].sets[0].targetLoad).toBe(90);
    expect(body.prescriptionReadouts[0].targetLoad).toBe(90);
    expect(finalAudit?.prescriptions["workout-exercise-1"]).toMatchObject({
      kind: "numeric",
      value: 90,
      reasonCodes: expect.arrayContaining(["readiness_adjusted", "readiness_reduce"]),
      evidence: [expect.objectContaining({ evidenceId: "selected-history-exposure" })],
    });
    expect(finalAudit?.resolvedLoads["workout-exercise-1"].resolvedTopSetLoad).toBe(90);
  });

  it.each([
    { intent: "upper", sessionCapacity: "custom" },
    {
      intent: "upper",
      sessionCapacity: "short_today",
      omittedExerciseIds: ["client-chosen"],
    },
  ])("rejects non-canonical capacity input %#", async (body) => {
    const response = await POST(
      new Request("http://localhost/api/workouts/generate-from-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
    expect(response.status).toBe(400);
    expect(mocks.provisionOwnerForMutation).not.toHaveBeenCalled();
  });

  it("captures readiness-adjusted full truth before applying Short today", () => {
    const source = readFileSync(
      "src/app/api/workouts/generate-from-intent/route.ts",
      "utf8",
    );
    const readinessIndex = source.indexOf("applyAutoregulation(");
    const auditSnapshotIndex = source.indexOf(
      "buildGeneratedSessionAuditSnapshot({",
    );
    const receiptIndex = source.indexOf(
      "readSessionDecisionReceipt(fullPlanSelectionMetadata)",
    );
    const reductionIndex = source.indexOf("applySessionCapacityReduction({");

    expect(readinessIndex).toBeGreaterThan(-1);
    expect(auditSnapshotIndex).toBeGreaterThan(readinessIndex);
    expect(receiptIndex).toBeGreaterThan(auditSnapshotIndex);
    expect(reductionIndex).toBeGreaterThan(receiptIndex);
  });

  it("projects Short Today readouts from the reduced response workout", async () => {
    const workout = {
      id: "short-today-workout",
      scheduledDate: "2026-03-03T00:00:00.000Z",
      warmup: [],
      mainLifts: [
        {
          id: "short-retained",
          exercise: { id: "bench", name: "Bench Press" },
          isMainLift: true,
          orderIndex: 0,
          sets: [
            { setIndex: 1, targetReps: 8, targetLoad: 100, targetRpe: 8 },
            { setIndex: 2, targetReps: 8, targetLoad: 100, targetRpe: 8 },
            { setIndex: 3, targetReps: 8, targetLoad: 100, targetRpe: 8 },
            { setIndex: 4, targetReps: 8, targetLoad: 100, targetRpe: 8 },
          ],
        },
      ],
      accessories: [
        {
          id: "short-removed",
          exercise: { id: "fly", name: "Cable Fly" },
          isMainLift: false,
          orderIndex: 1,
          sets: [
            { setIndex: 1, targetReps: 12, targetLoad: 40, targetRpe: 8 },
            { setIndex: 2, targetReps: 12, targetLoad: 40, targetRpe: 8 },
          ],
        },
      ],
      estimatedMinutes: 45,
    };
    mocks.generateSessionFromIntent.mockResolvedValue({
      workout,
      selectionMode: "INTENT",
      sessionIntent: "push",
      sraWarnings: [],
      substitutions: [],
      volumePlanByMuscle: {},
      selection: {
        selectedExerciseIds: ["bench", "fly"],
        mainLiftIds: ["bench"],
        accessoryIds: ["fly"],
        perExerciseSetTargets: { bench: 4, fly: 2 },
        rationale: {},
        volumePlanByMuscle: {},
      },
      filteredExercises: [],
      audit: numericAudit([
        { placementId: "short-retained", exerciseId: "bench", load: 100 },
        { placementId: "short-removed", exerciseId: "fly", load: 40 },
      ]),
    });
    mocks.applySessionCapacityReduction.mockImplementationOnce(({ plannedWorkout }) => ({
      status: "applied",
      workout: {
        ...plannedWorkout,
        mainLifts: [
          {
            ...plannedWorkout.mainLifts[0],
            sets: plannedWorkout.mainLifts[0].sets.slice(0, 2),
          },
        ],
        accessories: [],
      },
      evidence: {
        workoutId: plannedWorkout.id,
        mode: "short_today",
        reason: "user_selected_temporary_capacity",
        transformVersion: "short_today_v1",
        seedRevisionId: "revision-1",
        seedRevisionNumber: 1,
        seedPayloadHash: V4_HASH,
        executableRowsHash: V4_HASH,
        plannedStructureFingerprint: V4_HASH,
        offeredStructureFingerprint: "b".repeat(64),
        omitted: [],
        retainedProtectionClaims: [],
      },
      preview: {
        removedExercises: [{ exerciseId: "fly", exerciseName: "Cable Fly" }],
        removedSetCount: 4,
        retainedProtectionSummary: "Primary work retained.",
        estimatedMinutes: 25,
        redistributionNotice: "No volume was redistributed.",
      },
    }));

    const response = await POST(
      new Request("http://localhost/api/workouts/generate-from-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "push", sessionCapacity: "short_today" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.workout.mainLifts[0].sets).toHaveLength(2);
    expect(body.workout.accessories).toEqual([]);
    expect(body.prescriptionReadouts).toEqual([
      expect.objectContaining({
        placementId: "short-retained",
        exerciseId: "bench",
        setCount: 2,
        targetLoad: 100,
      }),
    ]);
    expect(body.prescriptionReadouts).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ placementId: "short-removed" }),
      ]),
    );
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
      new Request("http://localhost/api/workouts/generate-from-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "pull" }),
      })
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "Mesocycle handoff pending.",
      handoff: expect.objectContaining({ mesocycleId: "meso-1" }),
    });
    expect(mocks.loadActiveMesocycle).not.toHaveBeenCalled();
    expect(mocks.generateSessionFromIntent).not.toHaveBeenCalled();
  });

  it("rejects generation when the selected plan is not ready", async () => {
    mocks.loadActiveMesocycle.mockResolvedValue(null);

    const response = await POST(
      new Request("http://localhost/api/workouts/generate-from-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "pull" }),
      })
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Selected plan with an active mesocycle is required.",
    });
    expect(mocks.loadNextWorkoutContext).not.toHaveBeenCalled();
    expect(mocks.generateSessionFromIntent).not.toHaveBeenCalled();
  });

  it("rejects generation when selected-plan reads disagree", async () => {
    mocks.loadNextWorkoutContext.mockResolvedValue({
      activeMesocycleId: "meso-2",
      source: "rotation",
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/generate-from-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "pull" }),
      })
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Active plan selection changed concurrently. Retry generation.",
    });
    expect(mocks.generateSessionFromIntent).not.toHaveBeenCalled();
  });

  it("rejects standard accumulation generation while final week-close is pending", async () => {
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
      new Request("http://localhost/api/workouts/generate-from-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "upper" }),
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
    expect(mocks.loadRequestedAdvancingSlotSnapshot).not.toHaveBeenCalled();
    expect(mocks.generateSessionFromIntent).not.toHaveBeenCalled();
    expect(mocks.generateDeloadSessionFromIntent).not.toHaveBeenCalled();
  });

  it("returns deload prescription path when active mesocycle state is ACTIVE_DELOAD", async () => {
    mocks.loadActiveMesocycle.mockResolvedValue({ id: "meso-1", state: "ACTIVE_DELOAD" });
    mocks.loadRequestedAdvancingSlotSnapshot.mockResolvedValue({
      slotId: "pull_a",
      intent: "pull",
      sequenceIndex: 1,
      sequenceLength: 4,
      source: "mesocycle_slot_sequence",
    });
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
        sessionDecisionReceipt: {
          ...exactV4Receipt({
            week: 5,
            phase: "deload",
            slotId: "pull_a",
            intent: "pull",
          }),
          sessionProvenance: {
            mesocycleId: "meso-1",
            compositionSource: "deload_seed_replay",
          },
        },
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
    expect(mocks.generateDeloadSessionFromIntent).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        intent: "pull",
        advancingSlot: {
          slotId: "pull_a",
          intent: "pull",
          sequenceIndex: 1,
          sequenceLength: 4,
          source: "mesocycle_slot_sequence",
        },
      }),
    );
    expect(mocks.generateSessionFromIntent).not.toHaveBeenCalled();
    expect(body.workout.mainLifts[0].sets[0].targetRpe).toBe(5);
    expect(body.selectionMetadata.sessionDecisionReceipt.sessionSlot).toEqual({
      slotId: "pull_a",
      intent: "pull",
      sequenceIndex: 1,
      sequenceLength: 4,
      source: "mesocycle_slot_sequence",
    });
  });

  it("replays accepted V4 Week 5 through the exact seeded path without autoregulation", async () => {
    mocks.loadActiveMesocycle.mockResolvedValue({
      id: "meso-1",
      state: "ACTIVE_DELOAD",
      durationWeeks: 5,
      slotPlanSeedJson: null,
      currentSeedRevision: exactV4Revision(),
    });
    mocks.loadRequestedAdvancingSlotSnapshot.mockResolvedValue({
      slotId: "pull-a",
      intent: "pull",
      sequenceIndex: 0,
      sequenceLength: 4,
      source: "mesocycle_slot_sequence",
    });
    const exactWorkout = {
      id: "w-v4",
      scheduledDate: new Date().toISOString(),
      warmup: [],
      mainLifts: [{
        id: "ex",
        exercise: { id: "ex", name: "Row" },
        isMainLift: true,
        orderIndex: 0,
        sets: [{ setIndex: 1, targetReps: 7, targetLoad: 60, targetRpe: 5.5 }],
      }],
      accessories: [],
      estimatedMinutes: 30,
    };
    mocks.generateSessionFromIntent.mockResolvedValue({
      workout: exactWorkout,
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
        sessionDecisionReceipt: exactV4Receipt({
          week: 5,
          phase: "deload",
          slotId: "pull-a",
          intent: "pull",
        }),
      },
      filteredExercises: [],
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/generate-from-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "pull" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.generateSessionFromIntent).toHaveBeenCalledOnce();
    expect(mocks.generateDeloadSessionFromIntent).not.toHaveBeenCalled();
    expect(mocks.applyAutoregulation).not.toHaveBeenCalled();
    expect(body.workout.mainLifts[0].sets[0]).toMatchObject({
      targetReps: 7,
      targetRpe: 5.5,
    });
  });

  it("suppresses autoregulation for exact V4 accumulation replay", async () => {
    const obligation = exactV4Obligation({
      week: 3,
      slotId: "upper-a",
      intent: "upper",
    });
    mocks.loadActiveMesocycle.mockResolvedValue({
      id: "meso-1",
      state: "ACTIVE_ACCUMULATION",
      durationWeeks: 5,
      slotPlanSeedJson: null,
      currentSeedRevision: exactV4Revision(),
    });
    mocks.loadRequestedAdvancingSlotSnapshot.mockResolvedValue({
      slotId: "upper-a",
      intent: "upper",
      sequenceIndex: 0,
      sequenceLength: 4,
      source: "mesocycle_slot_sequence",
    });
    mocks.loadNextWorkoutContext.mockResolvedValue({
      activeMesocycleId: "meso-1",
      intent: "upper",
      slotId: "upper-a",
      slotSequenceIndex: 0,
      slotSequenceLength: 4,
      slotSource: "mesocycle_slot_sequence",
      existingWorkoutId: null,
      isExisting: false,
      source: "rotation",
      weekInMeso: 3,
      sessionInWeek: 1,
      derivationTrace: [],
      selectedIncompleteStatus: null,
      v4ScheduleAuthority: obligation.authority,
    });
    mocks.resolveRequestedV4ScheduledGenerationObligation.mockReturnValue(obligation);
    const exactWorkout = {
      id: "w-v4-accumulation",
      scheduledDate: new Date().toISOString(),
      warmup: [],
      mainLifts: [
        {
          id: "bench-placement-a",
          exercise: { id: "bench", name: "Bench" },
          isMainLift: true,
          orderIndex: 0,
          sets: [{ setIndex: 1, targetReps: 6, targetLoad: 105, targetRpe: 7.5 }],
        },
        {
          id: "bench-placement-b",
          exercise: { id: "bench", name: "Bench" },
          isMainLift: true,
          orderIndex: 1,
          sets: [{ setIndex: 1, targetReps: 10, targetLoad: 95, targetRpe: 7.5 }],
        },
      ],
      accessories: [],
      estimatedMinutes: 30,
    };
    const exactAudit: ApplyLoadsAudit = {
      progressionTraces: {},
      prescriptions: {
        "bench-placement-a": createNumericPrescription({
          canonicalExerciseId: "bench",
          measurement: null,
          value: 105,
          source: "existing_target",
          confidence: "high",
          reasonCodes: ["existing_target_preserved"],
          evidence: [],
        }),
        "bench-placement-b": createNumericPrescription({
          canonicalExerciseId: "bench",
          measurement: null,
          value: 95,
          source: "existing_target",
          confidence: "high",
          reasonCodes: ["existing_target_preserved"],
          evidence: [],
        }),
      },
      resolvedLoads: {
        "bench-placement-a": {
          placementId: "bench-placement-a",
          canonicalExerciseId: "bench",
          source: "existing_target_load",
          canonicalSourceLoad: 105,
          resolvedTopSetLoad: 105,
          resolvedSetLoads: [105],
        },
        "bench-placement-b": {
          placementId: "bench-placement-b",
          canonicalExerciseId: "bench",
          source: "existing_target_load",
          canonicalSourceLoad: 95,
          resolvedTopSetLoad: 95,
          resolvedSetLoads: [95],
        },
      },
    };
    mocks.generateSessionFromIntent.mockResolvedValue({
      workout: exactWorkout,
      selectionMode: "INTENT",
      sessionIntent: "upper",
      sraWarnings: [],
      substitutions: [],
      volumePlanByMuscle: {},
      selection: {
        selectedExerciseIds: ["bench", "bench"],
        mainLiftIds: ["bench", "bench"],
        accessoryIds: [],
        perExerciseSetTargets: { bench: 1 },
        rationale: {},
        volumePlanByMuscle: {},
        sessionDecisionReceipt: exactV4Receipt({
          week: 3,
          phase: "accumulation",
          slotId: "upper-a",
          intent: "upper",
        }),
      },
      filteredExercises: [],
      audit: exactAudit,
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/generate-from-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "upper" }),
      }),
    );

    const body = await response.json();
    expect(response.status).toBe(200);
    expect(mocks.applyAutoregulation).not.toHaveBeenCalled();
    expect(mocks.generateSessionFromIntent).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        generationMode: {
          kind: "accepted_v4_scheduled",
          obligation,
        },
      }),
    );
    expect(body.workout.mainLifts.map((entry: { sets: Array<{ targetLoad: number }> }) =>
      entry.sets[0].targetLoad,
    )).toEqual([105, 95]);
    expect(body.prescriptionReadouts).toMatchObject([
      { placementId: "bench-placement-a", exerciseId: "bench", targetLoad: 105 },
      { placementId: "bench-placement-b", exerciseId: "bench", targetLoad: 95 },
    ]);
    expect(exactAudit.resolvedLoads["bench-placement-a"].resolvedTopSetLoad).toBe(105);
    expect(exactAudit.resolvedLoads["bench-placement-b"].resolvedTopSetLoad).toBe(95);
  });

  it("keeps autoregulation for body-part fallback under an active V4 plan", async () => {
    const activeObligation = exactV4Obligation({
      week: 3,
      slotId: "upper-a",
      intent: "upper",
    });
    mocks.loadNextWorkoutContext.mockResolvedValueOnce({
      activeMesocycleId: "meso-1",
      source: "rotation",
      v4ScheduleAuthority: activeObligation.authority,
      v4ScheduleResolution: {
        status: "available",
        unresolvedSlotsInNextWeek: [activeObligation.requiredSlot],
      },
    });
    mocks.loadActiveMesocycle.mockResolvedValue({
      id: "meso-1",
      state: "ACTIVE_ACCUMULATION",
      durationWeeks: 5,
      currentSeedRevision: exactV4Revision(),
    });
    mocks.generateSessionFromIntent.mockResolvedValue({
      workout: {
        id: "w-v4-body-part",
        scheduledDate: new Date().toISOString(),
        warmup: [{
          id: "warmup",
          exercise: { id: "warmup", name: "General warm-up" },
          isMainLift: false,
          orderIndex: 0,
          sets: [],
        }],
        mainLifts: [{
          id: "ex",
          exercise: { id: "ex", name: "Cable Curl" },
          isMainLift: true,
          orderIndex: 0,
          sets: [{ setIndex: 1, targetReps: 12 }],
        }],
        accessories: [],
        estimatedMinutes: 30,
      },
      selectionMode: "INTENT",
      sessionIntent: "body_part",
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
        body: JSON.stringify({
          intent: "body_part",
          targetMuscles: ["biceps"],
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.generateSessionFromIntent).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        generationMode: {
          kind: "non_scheduled",
          purpose: "body_part",
        },
        advancingSlot: undefined,
      }),
    );
    expect(mocks.resolveRequestedV4ScheduledGenerationObligation).not.toHaveBeenCalled();
    expect(mocks.applyAutoregulation).toHaveBeenCalledOnce();
    expect(body.workout.warmup).toEqual([
      expect.objectContaining({ id: "warmup" }),
    ]);
  });

  it("persists the in-order advancing seeded session slot in receipt metadata", async () => {
    mocks.loadActiveMesocycle.mockResolvedValue({
      id: "meso-1",
      state: "ACTIVE_ACCUMULATION",
      durationWeeks: 5,
    });
    mocks.loadRequestedAdvancingSlotSnapshot.mockResolvedValue({
      slotId: "push_a",
      intent: "push",
      sequenceIndex: 0,
      source: "mesocycle_slot_sequence",
    });
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
      prescriptionReadouts: [
        {
          exerciseId: "ex-2",
          exerciseName: "Press",
          targetLoad: 135,
          targetReps: 6,
          repRange: { min: 6, max: 6 },
          targetRpe: 7,
          targetRir: 3,
          loadSource: "history",
          confidence: "high",
          cautionLevel: "none",
          cautionReason: null,
          suggestedAdjustmentRange: null,
        },
      ],
      audit: {
        progressionTraces: {},
        prescriptions: {
          "we-2": {
            version: 1,
            kind: "numeric",
            canonicalExerciseId: "ex-2",
            measurement: null,
            value: 135,
            source: "exact_history",
            confidence: "high",
            reasonCodes: ["same_exercise_same_measurement"],
            evidence: [],
          },
        },
        resolvedLoads: {
          "we-2": {
            placementId: "we-2",
            canonicalExerciseId: "ex-2",
            source: "history",
            canonicalSourceLoad: 135,
            resolvedTopSetLoad: 135,
            resolvedSetLoads: [135],
          },
        },
      },
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
          sessionProvenance: {
            mesocycleId: "meso-1",
            compositionSource: "persisted_slot_plan_seed",
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
    expect(body.prescriptionReadouts).toEqual([
      expect.objectContaining({
        exerciseId: "ex-2",
        exerciseName: "Press",
        confidence: "high",
        cautionLevel: "none",
      }),
    ]);
    expect(body.selectionMetadata.sessionDecisionReceipt.version).toBe(2);
    expect(mocks.generateSessionFromIntent).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        intent: "push",
        advancingSlot: expect.objectContaining({
          slotId: "push_a",
          intent: "push",
          sequenceIndex: 0,
        }),
      })
    );
    expect(body.selectionMetadata.sessionDecisionReceipt.sessionSlot).toEqual({
      slotId: "push_a",
      intent: "push",
      sequenceIndex: 0,
      source: "mesocycle_slot_sequence",
    });
    expect(body.selectionMetadata.sessionDecisionReceipt.sessionProvenance).toEqual({
      mesocycleId: "meso-1",
      compositionSource: "persisted_slot_plan_seed",
    });
  });

  it("persists an off-order Strength slot and exact seed revision in receipt metadata", async () => {
    mocks.loadActiveMesocycle.mockResolvedValue({
      id: "meso-1",
      state: "ACTIVE_ACCUMULATION",
      macroCycle: { primaryGoal: "STRENGTH" },
      currentSeedRevision: {
        id: "strength-revision-1",
        revision: 1,
        payloadHash:
          "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        hashAlgorithm: "sha256",
        provenanceStatus: "exact",
      },
    });
    mocks.loadNextWorkoutContext.mockResolvedValue({
      intent: "upper",
      slotId: "upper_a",
      slotSequenceIndex: 0,
      slotSequenceLength: 4,
      slotSource: "mesocycle_slot_sequence",
      existingWorkoutId: null,
      isExisting: false,
      source: "rotation",
      weekInMeso: 1,
      sessionInWeek: 1,
      derivationTrace: [],
      selectedIncompleteStatus: null,
    });
    mocks.loadRequestedAdvancingSlotSnapshot.mockResolvedValue({
      slotId: "lower_a",
      intent: "lower",
      sequenceIndex: 1,
      sequenceLength: 4,
      source: "mesocycle_slot_sequence",
    });
    mocks.generateSessionFromIntent.mockResolvedValue({
      workout: {
        id: "w-off-order",
        scheduledDate: new Date("2026-03-03T00:00:00.000Z").toISOString(),
        warmup: [],
        mainLifts: [
          {
            id: "we-lower-1",
            exercise: { id: "ex-lower-1", name: "Hack Squat" },
            isMainLift: true,
            orderIndex: 0,
            sets: [{ setIndex: 1, targetReps: 8, targetLoad: 225, targetRpe: 8 }],
          },
        ],
        accessories: [],
        estimatedMinutes: 45,
      },
      selectionMode: "INTENT",
      sessionIntent: "lower",
      sraWarnings: [],
      substitutions: [],
      volumePlanByMuscle: {},
      selection: {
        selectedExerciseIds: ["ex-lower-1"],
        mainLiftIds: ["ex-lower-1"],
        accessoryIds: [],
        perExerciseSetTargets: { "ex-lower-1": 3 },
        rationale: {},
        volumePlanByMuscle: {},
        sessionDecisionReceipt: {
          version: 1,
          cycleContext: {
            weekInMeso: 1,
            weekInBlock: 1,
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
          sessionProvenance: {
            mesocycleId: "meso-1",
            compositionSource: "persisted_slot_plan_seed",
            seedProvenance: {
              revisionId: "strength-revision-1",
              revision: 1,
              hash:
                "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            },
          },
        },
      },
      filteredExercises: [],
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/generate-from-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "lower", slotId: "lower_a" }),
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.loadRequestedAdvancingSlotSnapshot).toHaveBeenCalledWith({
      userId: "user-1",
      requestedIntent: "lower",
      explicitSlotId: "lower_a",
      nextWorkoutContext: expect.objectContaining({
        source: "rotation",
        intent: "upper",
        slotId: "upper_a",
      }),
    });
    expect(mocks.generateSessionFromIntent).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        intent: "lower",
        advancingSlot: expect.objectContaining({
          slotId: "lower_a",
          intent: "lower",
          sequenceIndex: 1,
          sequenceLength: 4,
        }),
      })
    );
    expect(body.selectionMetadata.sessionDecisionReceipt.sessionSlot).toEqual({
      slotId: "lower_a",
      intent: "lower",
      sequenceIndex: 1,
      sequenceLength: 4,
      source: "mesocycle_slot_sequence",
    });
    expect(
      body.selectionMetadata.sessionDecisionReceipt.sessionProvenance,
    ).toEqual({
      mesocycleId: "meso-1",
      compositionSource: "persisted_slot_plan_seed",
      seedProvenance: {
        revisionId: "strength-revision-1",
        revision: 1,
        hash:
          "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
    });
  });

  it("fails closed when an explicit planned slot is completed, invalid, or otherwise ineligible", async () => {
    mocks.loadRequestedAdvancingSlotSnapshot.mockResolvedValue(undefined);

    const response = await POST(
      new Request("http://localhost/api/workouts/generate-from-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "lower", slotId: "lower_a" }),
      })
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error:
        "Selected session is no longer eligible. Refresh Home and choose an available session.",
    });
    expect(mocks.generateSessionFromIntent).not.toHaveBeenCalled();
    expect(mocks.generateDeloadSessionFromIntent).not.toHaveBeenCalled();
  });

  it("rejects supplemental deficit generation for non-body_part intents", async () => {
    mocks.loadActiveMesocycle.mockResolvedValue({
      id: "meso-1",
      state: "ACTIVE_ACCUMULATION",
      durationWeeks: 5,
    });

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
    const activeObligation = exactV4Obligation({
      week: 3,
      slotId: "upper-a",
      intent: "upper",
    });
    mocks.loadNextWorkoutContext.mockResolvedValueOnce({
      activeMesocycleId: "meso-1",
      source: "rotation",
      v4ScheduleAuthority: activeObligation.authority,
      v4ScheduleResolution: {
        status: "available",
        unresolvedSlotsInNextWeek: [activeObligation.requiredSlot],
      },
    });
    mocks.loadActiveMesocycle.mockResolvedValue({
      id: "meso-1",
      state: "ACTIVE_ACCUMULATION",
      durationWeeks: 5,
      currentSeedRevision: exactV4Revision(),
    });
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
    expect(mocks.generateSessionFromIntent).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        generationMode: {
          kind: "non_scheduled",
          purpose: "supplemental",
        },
        intent: "body_part",
        targetMuscles: ["rear delts"],
        supplementalPlannerProfile: true,
        maxGeneratedExercises: 4,
        maxGeneratedHardSets: 8,
      })
    );
    expect(body.selectionMetadata.sessionDecisionReceipt.targetMuscles).toEqual(["rear delts"]);
    expect(body.selectionMetadata.sessionDecisionReceipt.exceptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "supplemental_deficit_session" }),
      ])
    );
    expect(body.selectionMetadata.sessionDecisionReceipt.sessionSlot).toBeUndefined();
    expect(mocks.applyAutoregulation).toHaveBeenCalledOnce();
  });

  it("pins receipt week from the pending week-close row and preserves marker + weekCloseId", async () => {
    const activeObligation = exactV4Obligation({
      week: 3,
      slotId: "upper-a",
      intent: "upper",
    });
    mocks.loadNextWorkoutContext.mockResolvedValueOnce({
      activeMesocycleId: "meso-1",
      source: "rotation",
      v4ScheduleAuthority: activeObligation.authority,
      v4ScheduleResolution: {
        status: "available",
        unresolvedSlotsInNextWeek: [activeObligation.requiredSlot],
      },
    });
    mocks.loadActiveMesocycle.mockResolvedValue({
      id: "meso-1",
      state: "ACTIVE_ACCUMULATION",
      durationWeeks: 5,
      currentSeedRevision: exactV4Revision(),
    });
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
              { setIndex: 1, targetReps: 10, targetLoad: 100 },
              { setIndex: 2, targetReps: 10, targetLoad: 100 },
            ],
          },
          {
            id: "we-2",
            exercise: { id: "ex-2", name: "Fly" },
            isMainLift: true,
            orderIndex: 1,
            sets: [{ setIndex: 1, targetReps: 12, targetLoad: 80 }],
          },
        ],
        accessories: [
          {
            id: "we-3",
            exercise: { id: "ex-3", name: "Curl" },
            isMainLift: false,
            orderIndex: 2,
            sets: [{ setIndex: 1, targetReps: 12, targetLoad: 40 }],
          },
        ],
        estimatedMinutes: 40,
      },
      selectionMode: "INTENT",
      sessionIntent: "body_part",
      sraWarnings: [],
      substitutions: [],
      volumePlanByMuscle: {},
      audit: numericAudit([
        { placementId: "we-1", exerciseId: "ex-1", load: 100 },
        { placementId: "we-2", exerciseId: "ex-2", load: 80 },
        { placementId: "we-3", exerciseId: "ex-3", load: 40 },
      ]),
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
        generationMode: {
          kind: "non_scheduled",
          purpose: "gap_fill",
        },
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
    expect(body.prescriptionReadouts).toEqual([
      expect.objectContaining({
        placementId: "we-1",
        exerciseId: "ex-1",
        setCount: 2,
        targetLoad: 100,
      }),
    ]);
    expect(body.selectionMetadata.sessionDecisionReceipt.exceptions).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "optional_gap_fill" })])
    );
    expect(body.selectionMetadata.sessionDecisionReceipt.targetMuscles).toEqual(["front delts"]);
    expect(body.selectionMetadata.weekCloseId).toBe("wc-1");
    expect(mocks.applyAutoregulation).toHaveBeenCalledOnce();
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
    mocks.loadActiveMesocycle.mockResolvedValue({
      id: "meso-1",
      state: "ACTIVE_ACCUMULATION",
      durationWeeks: 5,
    });
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
