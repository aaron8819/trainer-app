import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PreSessionReadinessContract } from "./pre-session-readiness-contract";

const mocks = vi.hoisted(() => {
  const loadActiveMesocycle = vi.fn();
  const deriveCurrentMesocycleSession = vi.fn();
  const getDeloadSessionThreshold = vi.fn();
  const loadNextWorkoutContext = vi.fn();
  const loadProjectedWeekVolumeReport = vi.fn();
  const buildRuntimeDoseAdjustmentDiagnostics = vi.fn();
  const generateSessionFromIntent = vi.fn();
  const generateDeloadSessionFromIntent = vi.fn();
  const buildGeneratedSessionAuditSnapshot = vi.fn();
  const buildPreSessionReadinessContract = vi.fn();
  const buildCurrentWeekAuditEvaluation = vi.fn();
  const buildWeeklyRetroAuditPayload = vi.fn();
  const evaluateAcceptedMesocycleSeedProvenance = vi.fn();
  const loadCurrentPreSessionReadinessSnapshotIdentity = vi.fn();
  const invalidatePreSessionReadinessSnapshotsForIdentity = vi.fn();
  const savePreSessionReadinessSnapshot = vi.fn();

  return {
    loadActiveMesocycle,
    deriveCurrentMesocycleSession,
    getDeloadSessionThreshold,
    loadNextWorkoutContext,
    loadProjectedWeekVolumeReport,
    buildRuntimeDoseAdjustmentDiagnostics,
    generateSessionFromIntent,
    generateDeloadSessionFromIntent,
    buildGeneratedSessionAuditSnapshot,
    buildPreSessionReadinessContract,
    buildCurrentWeekAuditEvaluation,
    buildWeeklyRetroAuditPayload,
    evaluateAcceptedMesocycleSeedProvenance,
    loadCurrentPreSessionReadinessSnapshotIdentity,
    invalidatePreSessionReadinessSnapshotsForIdentity,
    savePreSessionReadinessSnapshot,
  };
});

vi.mock("@/lib/api/mesocycle-lifecycle", () => ({
  loadActiveMesocycle: (...args: unknown[]) =>
    mocks.loadActiveMesocycle(...args),
  deriveCurrentMesocycleSession: (...args: unknown[]) =>
    mocks.deriveCurrentMesocycleSession(...args),
  getDeloadSessionThreshold: (...args: unknown[]) =>
    mocks.getDeloadSessionThreshold(...args),
}));

vi.mock("@/lib/api/next-session", () => ({
  loadNextWorkoutContext: (...args: unknown[]) =>
    mocks.loadNextWorkoutContext(...args),
}));

vi.mock("@/lib/api/projected-week-volume", () => ({
  loadProjectedWeekVolumeReport: (...args: unknown[]) =>
    mocks.loadProjectedWeekVolumeReport(...args),
}));

vi.mock("@/lib/api/runtime-dose-guidance", () => ({
  buildRuntimeDoseAdjustmentDiagnostics: (...args: unknown[]) =>
    mocks.buildRuntimeDoseAdjustmentDiagnostics(...args),
}));

vi.mock("@/lib/api/template-session", () => ({
  generateSessionFromIntent: (...args: unknown[]) =>
    mocks.generateSessionFromIntent(...args),
  generateDeloadSessionFromIntent: (...args: unknown[]) =>
    mocks.generateDeloadSessionFromIntent(...args),
}));

vi.mock("@/lib/evidence/session-audit-snapshot", () => ({
  buildGeneratedSessionAuditSnapshot: (...args: unknown[]) =>
    mocks.buildGeneratedSessionAuditSnapshot(...args),
}));

vi.mock("./pre-session-readiness-contract-builder", () => ({
  buildPreSessionReadinessContract: (...args: unknown[]) =>
    mocks.buildPreSessionReadinessContract(...args),
}));

vi.mock("@/lib/audit/workout-audit/current-week-audit", () => ({
  buildCurrentWeekAuditEvaluation: (...args: unknown[]) =>
    mocks.buildCurrentWeekAuditEvaluation(...args),
}));

vi.mock("@/lib/audit/workout-audit/weekly-retro", () => ({
  buildWeeklyRetroAuditPayload: (...args: unknown[]) =>
    mocks.buildWeeklyRetroAuditPayload(...args),
}));

vi.mock("@/lib/api/accepted-mesocycle-seed-provenance", () => ({
  evaluateAcceptedMesocycleSeedProvenance: (...args: unknown[]) =>
    mocks.evaluateAcceptedMesocycleSeedProvenance(...args),
}));

vi.mock("./pre-session-readiness-snapshot", () => ({
  loadCurrentPreSessionReadinessSnapshotIdentity: (...args: unknown[]) =>
    mocks.loadCurrentPreSessionReadinessSnapshotIdentity(...args),
  invalidatePreSessionReadinessSnapshotsForIdentity: (...args: unknown[]) =>
    mocks.invalidatePreSessionReadinessSnapshotsForIdentity(...args),
  savePreSessionReadinessSnapshot: (...args: unknown[]) =>
    mocks.savePreSessionReadinessSnapshot(...args),
}));

import { preparePreSessionReadinessSnapshot } from "./pre-session-readiness-producer";

function makeCurrentIdentity(overrides: Record<string, unknown> = {}) {
  return {
    userId: "user-1",
    activeMesocycleId: "meso-1",
    mesocycleState: "ACTIVE_ACCUMULATION",
    weekInMeso: 2,
    sessionInWeek: 2,
    slotId: "lower_a",
    slotIntent: "lower",
    plannedWorkoutId: null,
    plannedWorkoutRevision: null,
    contractVersion: 1,
    slotPlanSeedHash: "seed-hash",
    slotSequenceHash: "sequence-hash",
    ...overrides,
  };
}

function makeContract(
  overrides: Partial<PreSessionReadinessContract> = {}
): PreSessionReadinessContract {
  const contract: PreSessionReadinessContract = {
    contractVersion: 1,
    scope: {
      mode: "pre-session-readiness",
      ownerSeam: "api/pre-session-readiness-contract",
      source: {
        producerMode: "persisted_snapshot",
        producer: "pre_session_readiness_snapshot",
        provenance: "app_read_model",
      },
      readOnly: true,
      auditOnly: false,
      affectsScoringOrGeneration: false,
      consumedByProduction: false,
    },
    nextSessionIdentity: {
      userId: "user-1",
      ownerEmail: "owner@local",
      activeMesocycleId: "meso-1",
      activeState: "ACTIVE_ACCUMULATION",
      currentWeek: 2,
      currentSession: 2,
      nextSlotId: "lower_a",
      nextIntent: "lower",
      existingWorkoutId: null,
      incompleteWorkoutStatus: null,
      incompleteWorkoutReadiness: "none",
      existingWorkoutAction: "none",
      generationPath: "standard_generation",
      generator: "generateSessionFromIntent",
    },
    startability: {
      status: "startable",
      safeToTrain: true,
      normalStartCoachingAllowed: true,
      action: "run_seed_as_prescribed",
      reasons: ["ready"],
      blockerSummary: "none",
    },
    seedRuntimeProof: {
      status: "valid",
      compositionSource: "persisted_slot_plan_seed",
      receiptMesocycleId: "meso-1",
      seedSource: "handoff_slot_plan_projection",
      seedExecutableShape: "set_aware",
      seedOrderSetCountsRespected: true,
      readOnlyEvidenceOnly: true,
      seedRuntimeChanged: false,
      proofLines: ["seed proof"],
    },
    projectedWeekStatus: {
      status: "no_further_action",
      currentWeek: 2,
      phase: "accumulation",
      belowMev: [],
      overMav: [],
      fatigueRisks: [],
      projectionNotes: [],
      doseGuidanceRows: [],
      noAddOnReason: "No add-ons.",
    },
    doseClosure: {
      heading: "Dose Closure",
      priority: [],
      optional: [],
      monitor: [],
      suppress: [],
      guardrails: [],
      recommendations: [],
    },
    sessionLocalCoaching: {
      defaultInstruction: "Run seed as prescribed.",
      floorBufferOpportunities: [],
      prescriptionConfidenceWatches: [],
      fatigueCautions: [],
      safeOptionalAddOns: [],
      suppressAvoid: [],
      addOnState: {
        status: "none",
        reason: "No add-ons.",
      },
    },
    calibrationWatches: {
      prescriptionConfidence: [],
      recoveryCaveats: [],
      fatigue: [],
    },
    consistencyChecks: [
      {
        id: "seed_runtime_proof_read_only",
        status: "pass",
        severity: "info",
        message: "Read-only seed proof.",
        evidence: [],
      },
    ],
    boundaries: {
      readOnly: true,
      affectsScoringOrGeneration: false,
      consumedByProduction: false,
      wouldWriteTransaction: false,
      dbMutation: false,
      workoutLogSessionCreated: false,
      seedRuntimeChanged: false,
      plannerMaterializerChanged: false,
      notes: ["producer writes only snapshot"],
    },
  };

  return {
    ...contract,
    ...overrides,
  };
}

describe("preparePreSessionReadinessSnapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadActiveMesocycle.mockResolvedValue({
      id: "meso-1",
      state: "ACTIVE_ACCUMULATION",
      accumulationSessionsCompleted: 5,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 4,
      durationWeeks: 5,
      slotPlanSeedJson: { source: "seed" },
      slotSequenceJson: { source: "sequence" },
      blocks: [],
    });
    mocks.deriveCurrentMesocycleSession.mockReturnValue({
      week: 2,
      session: 2,
      phase: "ACCUMULATION",
    });
    mocks.getDeloadSessionThreshold.mockReturnValue(4);
    mocks.loadCurrentPreSessionReadinessSnapshotIdentity
      .mockResolvedValueOnce(makeCurrentIdentity())
      .mockResolvedValueOnce(makeCurrentIdentity());
    mocks.loadNextWorkoutContext.mockResolvedValue({
      intent: "lower",
      slotId: "lower_a",
      slotSequenceIndex: 1,
      slotSequenceLength: 4,
      slotSource: "mesocycle_slot_sequence",
      existingWorkoutId: null,
      isExisting: false,
      source: "rotation",
      weekInMeso: 2,
      sessionInWeek: 2,
      selectedIncompleteStatus: null,
      selectedIncompleteReadiness: null,
      derivationTrace: [],
    });
    mocks.generateSessionFromIntent.mockResolvedValue({
      workout: { mainLifts: [], accessories: [] },
      selectionMode: "AUTO",
      sessionIntent: "LOWER",
      filteredExercises: [],
      selection: {
        sessionDecisionReceipt: {
          sessionProvenance: {
            mesocycleId: "meso-1",
            compositionSource: "persisted_slot_plan_seed",
          },
        },
      },
      audit: {},
    });
    mocks.buildGeneratedSessionAuditSnapshot.mockReturnValue({
      generated: { exercises: [], traces: { progression: {} } },
    });
    mocks.loadProjectedWeekVolumeReport.mockResolvedValue({
      currentWeek: {
        mesocycleId: "meso-1",
        week: 2,
        phase: "accumulation",
        blockType: null,
      },
      projectionNotes: [],
      completedVolumeByMuscle: {},
      projectedSessions: [
        {
          slotId: "lower_a",
          intent: "lower",
          isNext: true,
          exerciseCount: 0,
          totalSets: 0,
          projectedContributionByMuscle: {},
        },
      ],
      fullWeekByMuscle: [],
    });
    mocks.buildCurrentWeekAuditEvaluation.mockReturnValue({
      currentWeekAudit: {
        belowMEV: [],
        overMAV: [],
        underTargetClusters: [],
        belowPreferred: [],
        fatigueRisks: [],
      },
      interventionHints: [],
      sessionRisks: [],
    });
    mocks.buildRuntimeDoseAdjustmentDiagnostics.mockReturnValue([]);
    mocks.buildWeeklyRetroAuditPayload.mockResolvedValue({
      volumeTargeting: {
        overMav: [],
        overTargetOnly: [],
      },
    });
    mocks.evaluateAcceptedMesocycleSeedProvenance.mockReturnValue({
      status: "valid",
      seed: {
        source: "handoff_slot_plan_projection",
        executableShape: "set_aware",
      },
    });
    mocks.buildPreSessionReadinessContract.mockReturnValue(makeContract());
    mocks.invalidatePreSessionReadinessSnapshotsForIdentity.mockResolvedValue({
      count: 2,
    });
    mocks.savePreSessionReadinessSnapshot.mockImplementation(async (input) => ({
      id: "snapshot-1",
      createdAt: new Date("2026-06-02T12:00:00.000Z"),
      invalidatedAt: null,
      invalidatedReason: null,
      ...input,
    }));
  });

  it("prepares, replaces, saves, and returns a gym-card DTO", async () => {
    const result = await preparePreSessionReadinessSnapshot("user-1", {
      ownerEmail: "owner@local",
    });

    expect(result.status).toBe("prepared");
    if (result.status !== "prepared") {
      throw new Error("expected prepared result");
    }
    expect(result.snapshot.id).toBe("snapshot-1");
    expect(result.invalidatedSnapshotCount).toBe(2);
    expect(result.replacementPolicy).toBe("replace_matching_identity");
    expect(result.gymCard).toMatchObject({
      action: "start",
      source: {
        producerMode: "persisted_snapshot",
        auditOnly: false,
      },
    });
    expect(mocks.buildPreSessionReadinessContract).toHaveBeenCalledWith(
      expect.objectContaining({
        evidence: expect.objectContaining({
          activeMesocycle: expect.objectContaining({
            mesocycleId: "meso-1",
            state: "ACTIVE_ACCUMULATION",
          }),
        }),
        contractSource: {
          producerMode: "persisted_snapshot",
          producer: "pre_session_readiness_snapshot",
          provenance: "app_read_model",
        },
        auditOnly: false,
      })
    );
    expect(
      mocks.invalidatePreSessionReadinessSnapshotsForIdentity
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        activeMesocycleId: "meso-1",
        weekInMeso: 2,
        sessionInWeek: 2,
        slotId: "lower_a",
        slotIntent: "lower",
        invalidatedReason: "replaced_by_prepare_action",
      })
    );
    expect(mocks.savePreSessionReadinessSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        activeMesocycleId: "meso-1",
        plannedWorkoutId: null,
        slotPlanSeedHash: "seed-hash",
        slotSequenceHash: "sequence-hash",
        contract: result.contract,
      })
    );
  });

  it("does not save when no active mesocycle exists", async () => {
    mocks.loadActiveMesocycle.mockResolvedValue(null);

    const result = await preparePreSessionReadinessSnapshot("user-1");

    expect(result).toMatchObject({
      status: "blocked",
      reason: "no_active_mesocycle",
    });
    expect(mocks.savePreSessionReadinessSnapshot).not.toHaveBeenCalled();
    expect(
      mocks.invalidatePreSessionReadinessSnapshotsForIdentity
    ).not.toHaveBeenCalled();
  });

  it("does not save an invalid contract", async () => {
    mocks.buildPreSessionReadinessContract.mockReturnValue({
      contractVersion: 1,
    });

    const result = await preparePreSessionReadinessSnapshot("user-1");

    expect(result).toMatchObject({
      status: "blocked",
      reason: "invalid_contract",
    });
    expect(mocks.savePreSessionReadinessSnapshot).not.toHaveBeenCalled();
  });

  it("fails closed when next-session identity changes before save", async () => {
    mocks.loadCurrentPreSessionReadinessSnapshotIdentity
      .mockReset()
      .mockResolvedValueOnce(makeCurrentIdentity({ plannedWorkoutRevision: 7 }))
      .mockResolvedValueOnce(makeCurrentIdentity({ plannedWorkoutRevision: 8 }));
    mocks.loadNextWorkoutContext.mockResolvedValue({
      intent: "lower",
      slotId: "lower_a",
      existingWorkoutId: "planned-1",
      source: "existing_incomplete",
      weekInMeso: 2,
      sessionInWeek: 2,
      selectedIncompleteStatus: "planned",
      selectedIncompleteReadiness: {
        classification: "matching_next_planned_workout",
        action: "resume",
        safeToTrain: true,
        reason: "matching next planned workout",
      },
      derivationTrace: [],
    });
    mocks.buildPreSessionReadinessContract.mockReturnValue(
      makeContract({
        nextSessionIdentity: {
          ...makeContract().nextSessionIdentity,
          existingWorkoutId: "planned-1",
          incompleteWorkoutStatus: "planned",
          incompleteWorkoutReadiness: "matching_next_planned_workout (resume)",
          existingWorkoutAction: "matching next planned workout",
        },
      })
    );

    const result = await preparePreSessionReadinessSnapshot("user-1");

    expect(result).toMatchObject({
      status: "blocked",
      reason: "stale_identity",
    });
    expect(mocks.savePreSessionReadinessSnapshot).not.toHaveBeenCalled();
    expect(
      mocks.invalidatePreSessionReadinessSnapshotsForIdentity
    ).not.toHaveBeenCalled();
  });

  it("does not import CLI, artifact filesystem, broad audit runner, or mutation writers", () => {
    const source = readFileSync(
      "src/lib/api/pre-session-readiness-producer.ts",
      "utf8"
    );

    expect(source).toContain("./pre-session-readiness-contract-builder");
    expect(source).toContain("./pre-session-readiness-evidence");
    expect(source).not.toContain(
      "@/lib/audit/workout-audit/pre-session-readiness-contract"
    );
    expect(source).not.toContain("@/lib/audit/workout-audit/types");
    expect(source).not.toContain("PreSessionReadinessAuditPayload");
    expect(source).not.toContain("ProjectedWeekVolumeAuditPayload");
    expect(source).not.toContain("WorkoutAuditGenerationPath");
    expect(source).not.toContain("workout-audit-cli");
    expect(source).not.toContain("buildPreSessionReadinessSummary");
    expect(source).not.toContain("runWorkoutAuditGeneration");
    expect(source).not.toContain("buildWorkoutAuditContext");
    expect(source).not.toContain("artifacts/audits");
    expect(source).not.toContain("prisma.workout.create");
    expect(source).not.toContain("prisma.workout.update");
    expect(source).not.toContain("prisma.setLog");
  });
});
