import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkoutAuditContext } from "./types";

const mocks = vi.hoisted(() => {
  const loadActiveMesocycle = vi.fn();
  const deriveCurrentMesocycleSession = vi.fn();
  const loadProjectedWeekVolumeReport = vi.fn();
  const buildPreSessionReadinessProjectedWeekEvidence = vi.fn();
  const generateSessionFromIntent = vi.fn();
  const generateDeloadSessionFromIntent = vi.fn();
  const buildWeeklyRetroAuditPayload = vi.fn();
  const buildActiveMesocycleSlotReseedAuditPayload = vi.fn();
  const buildV2AcceptedSeedPrepareCompareAuditPayload = vi.fn();
  const buildNextMesocycleHandoffDryRunAuditPayload = vi.fn();
  const buildNextMesocycleAcceptanceGateAuditPayload = vi.fn();
  const buildNextMesocyclePostAcceptVerificationAuditPayload = vi.fn();
  const buildMesocycleExplainAuditPayload = vi.fn();
  return {
    loadActiveMesocycle,
    deriveCurrentMesocycleSession,
    loadProjectedWeekVolumeReport,
    buildPreSessionReadinessProjectedWeekEvidence,
    generateSessionFromIntent,
    generateDeloadSessionFromIntent,
    buildWeeklyRetroAuditPayload,
    buildActiveMesocycleSlotReseedAuditPayload,
    buildV2AcceptedSeedPrepareCompareAuditPayload,
    buildNextMesocycleHandoffDryRunAuditPayload,
    buildNextMesocycleAcceptanceGateAuditPayload,
    buildNextMesocyclePostAcceptVerificationAuditPayload,
    buildMesocycleExplainAuditPayload,
  };
});

vi.mock("@/lib/api/mesocycle-lifecycle", () => ({
  loadActiveMesocycle: (...args: unknown[]) => mocks.loadActiveMesocycle(...args),
  deriveCurrentMesocycleSession: (...args: unknown[]) =>
    mocks.deriveCurrentMesocycleSession(...args),
  getDeloadSessionThreshold: (mesocycle: { sessionsPerWeek: number }) =>
    Math.max(1, mesocycle.sessionsPerWeek),
}));

vi.mock("@/lib/api/projected-week-volume", () => ({
  loadProjectedWeekVolumeReport: (...args: unknown[]) =>
    mocks.loadProjectedWeekVolumeReport(...args),
}));

vi.mock("@/lib/api/pre-session-readiness-evidence-builder", () => ({
  buildPreSessionReadinessProjectedWeekEvidence: (...args: unknown[]) =>
    mocks.buildPreSessionReadinessProjectedWeekEvidence(...args),
}));

vi.mock("@/lib/api/template-session", () => ({
  generateSessionFromIntent: (...args: unknown[]) => mocks.generateSessionFromIntent(...args),
  generateDeloadSessionFromIntent: (...args: unknown[]) =>
    mocks.generateDeloadSessionFromIntent(...args),
}));

vi.mock("./weekly-retro", () => ({
  buildWeeklyRetroAuditPayload: (...args: unknown[]) =>
    mocks.buildWeeklyRetroAuditPayload(...args),
}));

vi.mock("./active-mesocycle-slot-reseed", () => ({
  buildActiveMesocycleSlotReseedAuditPayload: (...args: unknown[]) =>
    mocks.buildActiveMesocycleSlotReseedAuditPayload(...args),
}));

vi.mock("./v2-accepted-seed-prepare-compare", () => ({
  buildV2AcceptedSeedPrepareCompareAuditPayload: (...args: unknown[]) =>
    mocks.buildV2AcceptedSeedPrepareCompareAuditPayload(...args),
}));

vi.mock("./next-mesocycle-handoff-dry-run", () => ({
  buildNextMesocycleHandoffDryRunAuditPayload: (...args: unknown[]) =>
    mocks.buildNextMesocycleHandoffDryRunAuditPayload(...args),
}));

vi.mock("./next-mesocycle-acceptance-gate", () => ({
  buildNextMesocycleAcceptanceGateAuditPayload: (...args: unknown[]) =>
    mocks.buildNextMesocycleAcceptanceGateAuditPayload(...args),
}));

vi.mock("./next-mesocycle-post-accept-verification", () => ({
  buildNextMesocyclePostAcceptVerificationAuditPayload: (...args: unknown[]) =>
    mocks.buildNextMesocyclePostAcceptVerificationAuditPayload(...args),
}));

vi.mock("./mesocycle-explain", () => ({
  buildMesocycleExplainAuditPayload: (...args: unknown[]) =>
    mocks.buildMesocycleExplainAuditPayload(...args),
}));

import { runWorkoutAuditGeneration } from "./generation-runner";

const okGenerationResult = {
  workout: {
    id: "w1",
    scheduledDate: "2026-03-04",
    warmup: [],
    mainLifts: [],
    accessories: [],
    estimatedMinutes: 45,
  },
  selectionMode: "INTENT" as const,
  sessionIntent: "push" as const,
  sraWarnings: [],
  substitutions: [],
  volumePlanByMuscle: {},
  selection: {
    selectedExerciseIds: [],
    mainLiftIds: [],
    accessoryIds: [],
    perExerciseSetTargets: {},
    rationale: {},
    volumePlanByMuscle: {},
  },
};

describe("runWorkoutAuditGeneration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadActiveMesocycle.mockResolvedValue({ state: "ACTIVE_ACCUMULATION" });
    mocks.deriveCurrentMesocycleSession.mockReturnValue({ week: 4, session: 1 });
    mocks.loadProjectedWeekVolumeReport.mockResolvedValue({
      currentWeek: {
        mesocycleId: "meso-1",
        week: 2,
        phase: "accumulation",
        blockType: "accumulation",
      },
      projectionNotes: [],
      completedVolumeByMuscle: {},
      projectedSessions: [],
      fullWeekByMuscle: [],
    });
    mocks.buildPreSessionReadinessProjectedWeekEvidence.mockResolvedValue({
      version: 1,
      currentWeek: {
        mesocycleId: "meso-1",
        week: 2,
        phase: "accumulation",
        blockType: "accumulation",
      },
      projectionNotes: [],
      completedVolumeByMuscle: {},
      projectedSessions: [],
      fullWeekByMuscle: [],
      currentWeekAudit: {
        belowMEV: [],
        overMAV: [],
        underTargetClusters: [],
        belowPreferred: [],
        fatigueRisks: [],
      },
      interventionHints: [],
      sessionRisks: [],
      runtimeDoseAdjustmentDiagnostics: [],
    });
    mocks.buildWeeklyRetroAuditPayload.mockResolvedValue({
      version: 1,
      week: 2,
      mesocycleId: "meso-1",
      executiveSummary: {
        status: "stable",
        generatedLayerCoverage: "full",
        sessionCount: 3,
        advancingSessionCount: 3,
        progressionEligibleCount: 3,
        progressionExcludedCount: 0,
        driftSessionCount: 0,
        belowMevCount: 0,
        underTargetCount: 0,
        overMavCount: 0,
        slotIdentityIssueCount: 0,
        highlights: [],
      },
      loadCalibration: {
        status: "aligned",
        comparableSessionCount: 3,
        driftSessionCount: 0,
        prescriptionChangeCount: 0,
        selectionDriftCount: 0,
        legacyLimitedSessionCount: 0,
        highlightedSessions: [],
      },
      slotBalance: {
        status: "balanced",
        advancingSessionCount: 3,
        identifiedSlotCount: 3,
        missingSlotIdentityCount: 0,
        duplicateSlotCount: 0,
        intentMismatchCount: 0,
        missingSlotIdentityWorkoutIds: [],
        duplicateSlots: [],
        intentMismatches: [],
      },
      volumeTargeting: {
        status: "within_expected_band",
        belowMev: [],
        underTargetOnly: [],
        overMav: [],
        overTargetOnly: [],
        muscles: [],
      },
      planAdherence: {
        plannedWorkCompletedPercent: 100,
        plannedWorkMissedSets: 0,
        plannedWorkTotalSets: 45,
        plannedWorkCompletedSets: 45,
        explainedAdditions: {
          totalSets: 0,
          byIntent: {},
        },
        substitutions: 0,
        painFatigueDeviations: 0,
        unclassifiedDrift: 0,
        engineConfidenceImpact: "none",
        interpretations: [],
      },
      interventions: [],
      rootCauses: [],
      recommendedPriorities: [],
    });
    mocks.buildActiveMesocycleSlotReseedAuditPayload.mockResolvedValue({
      version: 1,
      activeMesocycle: {
        mesocycleId: "meso-1",
        mesoNumber: 3,
        state: "ACTIVE_ACCUMULATION",
        week: 3,
        splitType: "UPPER_LOWER",
        targetSlotIds: ["upper_a", "upper_b"],
      },
      executiveSummary: ["Verdict: safe_to_apply_bounded_reseed."],
      persistedSeedResolution: {
        sourceModule: "slot-plan-seed.ts",
        sourceFunction: "readPersistedSeedSlots",
        runtimeRule: "normalize persisted slot seed",
      },
      freshReprojection: {
        sourceModule: "mesocycle-handoff-slot-plan-projection.ts",
        sourceFunction: "projectSuccessorSlotPlansFromSnapshot",
        runtimeRule: "reproject candidate slot seed",
      },
      candidateSessionEvaluation: {
        sourceModule: "projected-week-volume-shared.ts",
        sourceFunction: "generateProjectedSession",
        runtimeRule: "generate candidate seeded sessions",
      },
      diffArtifactDescription: "upper-slot dry-run diff",
      slotDiffs: [],
      aggregateMuscleDiff: [],
      flags: {
        improvesChestSupport: true,
        improvesTricepsSupport: true,
        improvesSideDeltSupport: false,
        improvesRearDeltSupport: false,
        improvesTierBSupport: false,
        reducesStackingPressure: false,
        reducesLowerFatigue: false,
        reducesUpperSessionDuration: false,
        preservesRowAndVerticalPullWhereAppropriate: true,
        avoidsNewObviousOvershoot: true,
        preservesSlotIdentity: true,
        materiallyChangesExerciseSelection: true,
      },
      recommendation: {
        verdict: "safe_to_apply_bounded_reseed",
        reasons: ["push support improved"],
      },
    });
    mocks.buildV2AcceptedSeedPrepareCompareAuditPayload.mockResolvedValue({
      version: 1,
      source: "v2_accepted_seed_prepare_compare_audit",
      readOnly: true,
      affectsScoringOrGeneration: false,
      consumedByProduction: false,
      wouldWriteTransaction: false,
      compareStatus: "available",
      handoffCandidate: {
        found: true,
        mesocycleId: "meso-1",
      },
      boundaryFacts: {
        readOnly: true,
        noWrite: true,
        consumedByProduction: false,
        v2PreviewAvailable: true,
        v2ProductionWriteEligible: false,
        seedSerializer: "buildMesocycleSlotPlanSeed",
        legacyProjectionCalledByV2Path: false,
        repairCalledByV2Path: false,
        transactionStatus: "no_write",
      },
    });
    mocks.buildNextMesocycleHandoffDryRunAuditPayload.mockResolvedValue({
      version: 1,
      source: "next_mesocycle_handoff_dry_run_audit",
      readOnly: true,
      affectsScoringOrGeneration: false,
      consumedByProduction: false,
      wouldWriteTransaction: false,
      summary: {
        writes: "no",
        sourceMesocycleId: "meso-source",
        sourceState: "ACTIVE_DELOAD",
        candidateAvailable: false,
        handoffReady: false,
        blockingReason: "source_not_awaiting_handoff",
        preparationPath: "not_called_source_not_awaiting_handoff",
        transactionStatus: "not_started",
      },
      wouldPrepareWriteSummary: null,
      persistedDraftTruth: {
        status: "not_available",
        source: null,
        seedShape: "not_available",
        slotCount: 0,
        exerciseCount: 0,
        minimalExecutableRowsOnly: false,
        parserCompatible: false,
      },
      candidateIdentity: {
        status: "not_available_until_handoff",
        rows: [],
      },
      seedShapeSummary: {
        slotPlanSeedJson: "not_available",
        truthBasis: "none",
        wouldBeBuilt: false,
        minimalExecutableRowsOnly: false,
        executableFields: ["exerciseId", "role", "setCount"],
        serializerPath: "buildMesocycleSlotPlanSeed",
        slotCount: 0,
        exerciseCount: 0,
        seedSource: null,
      },
      weeklyVolumeFloorCapSummary: {
        status: "not_available",
        basis: "not ready",
        rows: [],
      },
      acceptanceGatePayloadSummary: {
        checks: [],
      },
      weekOneRuntimeReplayPreview: {
        status: "not_available",
        runtimeReplayInstantiated: false,
        rows: [],
        limitation: "successor not persisted",
      },
      modeComparison: [],
      safety: {
        writes: "no",
        dbMutated: false,
        mesocycleCreated: false,
        workoutLogSessionCreated: false,
        seedRuntimeBehaviorChanged: false,
        plannerMaterializerBehaviorChanged: false,
        transactionExecuted: false,
      },
    });
    mocks.buildNextMesocycleAcceptanceGateAuditPayload.mockResolvedValue({
      version: 1,
      source: "next_mesocycle_acceptance_gate_audit",
      readOnly: true,
      affectsScoringOrGeneration: false,
      consumedByProduction: false,
      wouldWriteTransaction: false,
      gateResult: "not_runnable",
      candidateFound: false,
      why: ["no persisted handoff candidate"],
      recommendation: "rerun after handoff exists",
      decisionSummary: {
        trainability: "fail",
        plannerMaterializerQuality: "pass",
        repairBurden: "low",
        repairBurdenEvidence:
          "planning_shape=unknown materialRepairCount=unknown majorRepairCount=unknown source=missing_planning_reality classification=legacy_diagnostic_context",
        repairBurdenSource: "missing_planning_reality",
        repairBurdenClassification: "legacy_diagnostic_context",
        shadowConsumptionClassification: "not_available",
        shadowConsumptionNextSafeAction: "not_available",
        shadowConsumptionEvidence:
          "no v2 base-plan shadow consumption trial reported",
        materializerGuardrailClassification: "not_available",
        materializerGuardrailNextSafeAction: "not_available",
        materializerGuardrailEvidence:
          "no planning-reality or V2 materializer diagnostics reported",
      },
      candidateIdentity: {
        sourceMesocycleId: "meso-source",
        sourceState: "ACTIVE_DELOAD",
        candidateKind: "absent",
        candidateDraftAvailable: false,
        persistedHandoffCandidateFound: false,
        writeNeededToInspect: false,
      },
      gates: [],
      weeklyMuscleTable: [],
      priorBlockRecurringRisks: [],
      completedBlockEvidence: [],
      watchItems: [],
      findings: [],
      doNotFixNotes: [],
      diagnosticPreview: {
        available: false,
        label: "not_available",
        canBeAccepted: false,
        notes: [],
      },
      blockers: ["no persisted handoff candidate"],
      supportingEvidence: {
        mesocycleExplainPreviewAvailable: false,
      },
    });
    mocks.buildNextMesocyclePostAcceptVerificationAuditPayload.mockResolvedValue({
      version: 1,
      source: "next_mesocycle_post_accept_verification_audit",
      readOnly: true,
      affectsScoringOrGeneration: false,
      consumedByProduction: false,
      wouldWriteTransaction: false,
      verificationResult: "safe_to_train",
      recommendation: "persisted successor is safe to train from for Week 1",
      sourceMesocycle: {
        id: "meso-source",
        state: "COMPLETED",
        isActive: false,
        macroCycleId: "macro-1",
        mesoNumber: 1,
      },
      successorMesocycle: {
        id: "meso-next",
        requestedId: "meso-next",
        state: "ACTIVE_ACCUMULATION",
        isActive: true,
        macroCycleId: "macro-1",
        mesoNumber: 2,
        activeMesocycleId: "meso-next",
      },
      seedContract: {
        slotPlanSeedJson: "available",
        source: "handoff_slot_plan_projection",
        slotCount: 1,
        exerciseCount: 1,
        minimalExecutableRowsOnly: true,
        executableFields: ["exerciseId", "role", "setCount"],
        missingSetCount: 0,
        extraExecutableRowFieldCount: 0,
      },
      slotSequence: {
        available: true,
        hasPersistedSequence: true,
        orderStable: true,
        slotOrder: ["upper_a"],
        seedSlotOrder: ["upper_a"],
      },
      futureWeekReplay: {
        status: "available",
        compositionSource: "persisted_slot_plan_seed",
        generationPath: "standard_generation",
        nextSlotId: "upper_a",
        generatedExerciseOrder: ["bench"],
        seedExerciseOrder: ["bench"],
        exerciseOrderMatchesSeed: true,
        generatedExerciseCount: 1,
        progressionTraceCount: 1,
        cautionCount: 0,
      },
      prescriptionConfidence: {
        status: "available",
        summary: {
          rowCount: 1,
          lowConfidenceCount: 0,
          cautionCount: 0,
          runtimeOnlyCount: 0,
          classificationCounts: { exact_history: 1 },
        },
        rows: [
          {
            exerciseId: "bench",
            exerciseName: "Bench Press",
            classification: "exact_history",
            confidence: "high",
            loadSource: "history",
            cautionLevel: "none",
            cautionReason: null,
            targetLoad: 205,
            ownerSeam: "future-week prescription readout",
            evidence: "loadSource=history confidence=high caution=none",
          },
        ],
      },
      projectedWeekVolume: {
        status: "available",
        currentWeek: 1,
        mesocycleId: "meso-next",
        projectedSessionCount: 1,
        allProjectedSessionsSeedBacked: true,
        mismatchedSlots: [],
      },
      readModels: {
        homeNextSessionSlotSource: "mesocycle_slot_sequence",
        programExerciseSources: ["persisted_slot_plan_seed"],
        allProgramRowsSeedBacked: true,
      },
      provenance: {
        status: "valid",
        warningCodes: [],
        receiptCompositionSource: "persisted_slot_plan_seed",
      },
      checks: [],
      safety: {
        writes: "no",
        dbMutated: false,
        mesocycleCreated: false,
        workoutLogSessionCreated: false,
        seedRuntimeBehaviorChanged: false,
        plannerMaterializerBehaviorChanged: false,
        transactionExecuted: false,
      },
    });
    mocks.buildMesocycleExplainAuditPayload.mockResolvedValue({
      version: 1,
      sourceMesocycleId: "meso-source",
      retrospectiveMesocycleId: "meso-retro",
      preview: {
        sourceMesocycleId: "meso-source",
        rationaleBasis: "reconstructed_now",
        designBasis: {
          focus: "hypertrophy",
          splitType: "UPPER_LOWER",
          sessionsPerWeek: 4,
          daysPerWeek: 4,
          durationWeeks: 5,
          volumeTarget: "MEDIUM",
          intensityBias: "MODERATE",
          profileReasonCodes: [],
          structureReasonCodes: [],
          startingPointReasonCodes: [],
        },
        carryForwardReasons: [],
        slotPlans: [],
        projectedSessions: [],
        projectionDiagnostics: {
          label: "projection diagnostics",
          readOnly: true,
          affectsScoringOrGeneration: false,
          summary: {
            setStackingPressure: 0,
            duplicateExercisePressure: 0,
            diversityPenalties: 0,
            hingeSquatBalance: 0,
            isolationInjectionTriggers: 0,
            softCapsOverriddenByP0: 0,
          },
          constraintsTriggered: [],
          tradeoffs: [],
          softCapOverridesByP0: [],
        },
        exerciseRationale: [],
      },
      seed: {
        mesocycleId: "meso-retro",
        available: false,
        slotPlans: [],
        exerciseRationale: [],
      },
      reality: {
        mesocycleId: "meso-retro",
        workoutCount: 0,
        generatedVsSaved: [],
        runtimeDrift: [],
        exerciseRationale: [],
      },
      comparison: {
        previewVsSeed: {
          comparable: false,
          slotDiffs: [],
        },
        seedVsReality: {
          comparable: false,
          workoutDrift: [],
        },
        previewVsReality: {
          comparable: false,
          comparisonBasis: "none",
          slotDiffs: [],
        },
      },
      limitations: [],
    });
    mocks.generateSessionFromIntent.mockResolvedValue(okGenerationResult);
    mocks.generateDeloadSessionFromIntent.mockResolvedValue(okGenerationResult);
  });

  it("forwards standard diagnostics mode for derived future-week path", async () => {
    const context: WorkoutAuditContext = {
      mode: "future-week",
      requestedMode: "future-week",
      userId: "user-1",
      plannerDiagnosticsMode: "standard",
      generationInput: { intent: "legs" },
      nextSession: {
        intent: "legs",
        slotId: "legs_a",
        slotSequenceIndex: 2,
        slotSequenceLength: 4,
        slotSource: "legacy_weekly_schedule",
        existingWorkoutId: null,
        isExisting: false,
        source: "rotation",
        weekInMeso: 2,
        sessionInWeek: 3,
        derivationTrace: [],
        selectedIncompleteStatus: null,
      },
    };

    await runWorkoutAuditGeneration(context);

    expect(mocks.generateSessionFromIntent).toHaveBeenCalledWith("user-1", {
      advancingSlot: {
        slotId: "legs_a",
        intent: "legs",
        sequenceIndex: 2,
        sequenceLength: 4,
        source: "legacy_weekly_schedule",
      },
      intent: "legs",
      targetMuscles: undefined,
      plannerDiagnosticsMode: "standard",
    });
  });

  it("forwards debug diagnostics mode for explicit-intent future-week path", async () => {
    const context: WorkoutAuditContext = {
      mode: "future-week",
      requestedMode: "future-week",
      userId: "user-1",
      plannerDiagnosticsMode: "debug",
      generationInput: { intent: "push", targetMuscles: ["Chest"] },
    };

    await runWorkoutAuditGeneration(context);

    expect(mocks.generateSessionFromIntent).toHaveBeenCalledWith("user-1", {
      intent: "push",
      targetMuscles: ["Chest"],
      plannerDiagnosticsMode: "debug",
    });
  });

  it("adds read-only accepted seed provenance consistency for future-week generation", async () => {
    mocks.loadActiveMesocycle.mockResolvedValue({
      id: "meso-1",
      state: "ACTIVE_ACCUMULATION",
      slotPlanSeedJson: {
        version: 1,
        source: "handoff_slot_plan_projection",
        slots: [
          {
            slotId: "upper_a",
            exercises: [
              { exerciseId: "bench", role: "CORE_COMPOUND", setCount: 4 },
            ],
          },
        ],
      },
    });
    mocks.generateSessionFromIntent.mockResolvedValue({
      ...okGenerationResult,
      selection: {
        ...okGenerationResult.selection,
        sessionDecisionReceipt: {
          sessionProvenance: {
            mesocycleId: "meso-1",
            compositionSource: "persisted_slot_plan_seed",
          },
        },
      },
    });
    const context: WorkoutAuditContext = {
      mode: "future-week",
      requestedMode: "future-week",
      userId: "user-1",
      plannerDiagnosticsMode: "standard",
      generationInput: { intent: "upper" },
    };

    const run = await runWorkoutAuditGeneration(context);

    expect(run.acceptedSeedProvenanceConsistency).toMatchObject({
      readOnly: true,
      affectsScoringOrGeneration: false,
      consumedByProduction: false,
      status: "valid",
      seed: {
        source: "handoff_slot_plan_projection",
        executableShape: "set_aware",
      },
      warnings: [
        expect.objectContaining({
          code: "RUNTIME_REPLAY_PROVENANCE_NOT_AUTHORSHIP",
          severity: "info",
        }),
      ],
    });
  });

  it("uses deload generation path when active mesocycle is deload", async () => {
    mocks.loadActiveMesocycle.mockResolvedValue({ state: "ACTIVE_DELOAD" });
    const context: WorkoutAuditContext = {
      mode: "future-week",
      requestedMode: "future-week",
      userId: "user-1",
      plannerDiagnosticsMode: "debug",
      generationInput: { intent: "legs" },
      nextSession: {
        intent: "legs",
        slotId: "legs_a",
        slotSequenceIndex: 0,
        slotSequenceLength: 4,
        slotSource: "legacy_weekly_schedule",
        existingWorkoutId: "w-in-progress",
        isExisting: true,
        source: "existing_incomplete",
        weekInMeso: 5,
        sessionInWeek: 1,
        derivationTrace: [],
        selectedIncompleteStatus: "in_progress",
      },
    };

    const run = await runWorkoutAuditGeneration(context);

    expect(mocks.generateDeloadSessionFromIntent).toHaveBeenCalledWith("user-1", {
      intent: "legs",
      targetMuscles: undefined,
      plannerDiagnosticsMode: "debug",
    });
    expect(mocks.generateSessionFromIntent).not.toHaveBeenCalled();
    expect(run.generationPath).toEqual({
      requestedMode: "future-week",
      executionMode: "active_deload_reroute",
      generator: "generateDeloadSessionFromIntent",
      reason: "active_mesocycle_state_active_deload",
    });
  });

  it("routes projected-week-volume through the canonical reporting helper without touching future-week generation", async () => {
    const context: WorkoutAuditContext = {
      mode: "projected-week-volume",
      requestedMode: "projected-week-volume",
      userId: "user-1",
      plannerDiagnosticsMode: "debug",
      projectedWeekVolume: {
        enabled: true,
      },
    };

    const run = await runWorkoutAuditGeneration(context);

    expect(mocks.loadProjectedWeekVolumeReport).toHaveBeenCalledWith({
      userId: "user-1",
      plannerDiagnosticsMode: "debug",
    });
    expect(mocks.generateSessionFromIntent).not.toHaveBeenCalled();
    expect(mocks.generateDeloadSessionFromIntent).not.toHaveBeenCalled();
    expect(run.projectedWeekVolume).toMatchObject({
      version: 1,
      currentWeek: {
        mesocycleId: "meso-1",
        week: 2,
      },
    });
    expect(run.projectedWeekVolume?.currentWeekAudit).toBeUndefined();
  });

  it("routes current-week-audit through projection and attaches audit-only guidance", async () => {
    mocks.buildPreSessionReadinessProjectedWeekEvidence.mockResolvedValueOnce({
      version: 1,
      currentWeek: {
        mesocycleId: "meso-1",
        week: 4,
        phase: "accumulation",
        blockType: "accumulation",
      },
      projectionNotes: [],
      completedVolumeByMuscle: {},
      projectedSessions: [
        {
          slotId: "upper_b",
          intent: "upper",
          isNext: true,
          exerciseCount: 6,
          totalSets: 18,
          estimatedMinutes: 65,
          movementPatternCounts: {
            horizontal_pull: 3,
            vertical_pull: 1,
            horizontal_push: 1,
          },
          exercises: [
            {
              exerciseId: "db-bench",
              name: "Dumbbell Bench Press",
              setCount: 3,
              role: "primary",
              effectiveStimulusByMuscle: { Chest: 3 },
            },
          ],
          projectedContributionByMuscle: { Chest: 3, Lats: 4 },
        },
      ],
      fullWeekByMuscle: [
        {
          muscle: "Chest",
          completedEffectiveSets: 0,
          projectedNextSessionEffectiveSets: 3,
          projectedRemainingWeekEffectiveSets: 3,
          projectedFullWeekEffectiveSets: 6,
          weeklyTarget: 12,
          mev: 8,
          mav: 16,
          deltaToTarget: -6,
          deltaToMev: -2,
          deltaToMav: -10,
        },
      ],
      currentWeekAudit: {
        belowMEV: ["Chest"],
        overMAV: [],
        underTargetClusters: [],
        belowPreferred: [],
        fatigueRisks: [],
      },
      interventionHints: [
        {
          muscle: "Chest",
          suggestedSets: 2,
          reason: "below_mev: projected 2.0 sets below MEV; bounded floor closure only",
        },
      ],
      sessionRisks: [
        {
          slotId: "upper_b",
          issue: "redundant pattern stacking: horizontal pull appears 3 times",
        },
        {
          slotId: "upper_b",
          issue: "excessive pull vs push imbalance: pull-pattern exercises 4 vs push 1",
        },
      ],
      runtimeDoseAdjustmentDiagnostics: [
        {
          muscle: "Chest",
          plannedRemainingVolume: {
            effectiveSets: 6,
            bySlot: [],
          },
          performedWeekToDateVolume: {
            effectiveSets: 0,
            source: "weekly_volume_read_model",
          },
          projectedEndOfWeekVolume: {
            effectiveSets: 6,
            weeklyTarget: 12,
            mev: 8,
            mav: 16,
          },
          targetStatus: "below_mev",
          fatigueDensityConcern: {
            level: "none",
            drivers: [],
          },
          recoveryReadinessCaveat: {
            status: "none",
          },
          recommendedAction: {
            kind: "add_set",
            slotId: "upper_b",
            exerciseName: "Dumbbell Bench Press",
            setDelta: 1,
          },
          reasonCode: "mev_floor_deficit",
          guidance:
            "below MEV floor; bounded low-fatigue closure if readiness and time allow",
          confidence: 0.8,
          readOnly: true,
          affectsAcceptedSeed: false,
        },
      ],
    });
    const context: WorkoutAuditContext = {
      mode: "current-week-audit",
      requestedMode: "current-week-audit",
      userId: "user-1",
      plannerDiagnosticsMode: "debug",
      projectedWeekVolume: {
        enabled: true,
      },
    };

    const run = await runWorkoutAuditGeneration(context);

    expect(
      mocks.buildPreSessionReadinessProjectedWeekEvidence
    ).toHaveBeenCalledWith({
      userId: "user-1",
      plannerDiagnosticsMode: "debug",
    });
    expect(mocks.generateSessionFromIntent).not.toHaveBeenCalled();
    expect(mocks.generateDeloadSessionFromIntent).not.toHaveBeenCalled();
    expect(run.projectedWeekVolume).toMatchObject({
      version: 1,
      currentWeek: {
        mesocycleId: "meso-1",
        week: 4,
      },
      currentWeekAudit: {
        belowMEV: ["Chest"],
        underTargetClusters: [],
        belowPreferred: [],
      },
      interventionHints: [
        {
          muscle: "Chest",
          suggestedSets: 2,
          reason: "below_mev: projected 2.0 sets below MEV; bounded floor closure only",
        },
      ],
      sessionRisks: [
        {
          slotId: "upper_b",
          issue: "redundant pattern stacking: horizontal pull appears 3 times",
        },
        {
          slotId: "upper_b",
          issue: "excessive pull vs push imbalance: pull-pattern exercises 4 vs push 1",
        },
      ],
    });
    const runtimeDoseDiagnostics =
      run.projectedWeekVolume?.runtimeDoseAdjustmentDiagnostics ?? [];
    expect(runtimeDoseDiagnostics).toEqual([
      expect.objectContaining({
        muscle: "Chest",
        readOnly: true,
        affectsAcceptedSeed: false,
        recommendedAction: expect.objectContaining({
          kind: "add_set",
          slotId: "upper_b",
          exerciseName: "Dumbbell Bench Press",
          setDelta: 1,
        }),
        reasonCode: "mev_floor_deficit",
      }),
    ]);
    expect(
      runtimeDoseDiagnostics
        .filter((diagnostic) => diagnostic.recommendedAction.setDelta !== 0)
        .every(
          (diagnostic) =>
            Boolean(diagnostic.recommendedAction.slotId) &&
            Boolean(diagnostic.recommendedAction.exerciseName)
        )
    ).toBe(true);
  });

  it("builds pre-session-readiness from existing generation and dose readout paths without write helpers", async () => {
    mocks.loadActiveMesocycle.mockResolvedValueOnce({
      id: "meso-1",
      state: "ACTIVE_ACCUMULATION",
      accumulationSessionsCompleted: 12,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 4,
      durationWeeks: 5,
      slotPlanSeedJson: {
        version: 1,
        source: "handoff_slot_plan_projection",
        slots: [
          {
            slotId: "upper_a",
            exercises: [
              { exerciseId: "incline", role: "CORE_COMPOUND", setCount: 4 },
            ],
          },
        ],
      },
    });
    mocks.buildPreSessionReadinessProjectedWeekEvidence.mockResolvedValueOnce({
      version: 1,
      currentWeek: {
        mesocycleId: "meso-1",
        week: 4,
        phase: "accumulation",
        blockType: "accumulation",
      },
      projectionNotes: [],
      completedVolumeByMuscle: {},
      projectedSessions: [
        {
          slotId: "upper_a",
          intent: "upper",
          isNext: true,
          exerciseCount: 1,
          totalSets: 4,
          exercises: [
            {
              exerciseId: "incline",
              name: "Incline Machine Press",
              setCount: 4,
              role: "primary",
              effectiveStimulusByMuscle: { Chest: 4 },
            },
          ],
          projectedContributionByMuscle: { Chest: 4 },
        },
      ],
      fullWeekByMuscle: [
        {
          muscle: "Chest",
          completedEffectiveSets: 4,
          projectedNextSessionEffectiveSets: 4,
          projectedRemainingWeekEffectiveSets: 0,
          projectedFullWeekEffectiveSets: 8,
          weeklyTarget: 10,
          mev: 8,
          mav: 16,
          deltaToTarget: -2,
          deltaToMev: 0,
          deltaToMav: -8,
        },
      ],
      currentWeekAudit: {
        belowMEV: [],
        overMAV: [],
        underTargetClusters: [],
        belowPreferred: [],
        fatigueRisks: [],
      },
      interventionHints: [],
      sessionRisks: [],
      runtimeDoseAdjustmentDiagnostics: [
        {
          muscle: "Chest",
          plannedRemainingVolume: {
            effectiveSets: 8,
            bySlot: [],
          },
          performedWeekToDateVolume: {
            effectiveSets: 4,
            source: "weekly_volume_read_model",
          },
          projectedEndOfWeekVolume: {
            effectiveSets: 8,
            weeklyTarget: 10,
            mev: 8,
            mav: 16,
          },
          targetStatus: "below_preferred",
          fatigueDensityConcern: {
            level: "none",
            drivers: [],
          },
          recoveryReadinessCaveat: {
            status: "none",
          },
          recommendedAction: {
            kind: "hold_seed",
            setDelta: 0,
          },
          reasonCode: "below_preferred_monitor",
          guidance:
            "productive floor achieved; below preferred target; monitor, no default add-on",
          confidence: 0.8,
          readOnly: true,
          affectsAcceptedSeed: false,
        },
      ],
    });
    mocks.generateSessionFromIntent.mockResolvedValueOnce({
      ...okGenerationResult,
      selection: {
        ...okGenerationResult.selection,
        sessionDecisionReceipt: {
          sessionProvenance: {
            mesocycleId: "meso-1",
            compositionSource: "persisted_slot_plan_seed",
          },
        },
      },
    });
    const context: WorkoutAuditContext = {
      mode: "pre-session-readiness",
      requestedMode: "pre-session-readiness",
      userId: "user-1",
      ownerEmail: "owner@test.local",
      plannerDiagnosticsMode: "debug",
      generationInput: { intent: "upper" },
      nextSession: {
        intent: "upper",
        slotId: "upper_a",
        slotSequenceIndex: 0,
        slotSequenceLength: 4,
        slotSource: "mesocycle_slot_sequence",
        existingWorkoutId: null,
        isExisting: false,
        source: "rotation",
        weekInMeso: 4,
        sessionInWeek: 1,
        derivationTrace: [],
        selectedIncompleteStatus: null,
      },
      projectedWeekVolume: { enabled: true },
      preSessionReadiness: {
        enabled: true,
        requestedMesocycleId: "meso-1",
      },
    };

    const run = await runWorkoutAuditGeneration(context);

    expect(mocks.generateSessionFromIntent).toHaveBeenCalledWith("user-1", {
      intent: "upper",
      targetMuscles: undefined,
      advancingSlot: {
        slotId: "upper_a",
        intent: "upper",
        sequenceIndex: 0,
        sequenceLength: 4,
        source: "mesocycle_slot_sequence",
      },
      plannerDiagnosticsMode: "debug",
    });
    expect(
      mocks.buildPreSessionReadinessProjectedWeekEvidence
    ).toHaveBeenCalledWith({
      userId: "user-1",
      plannerDiagnosticsMode: "debug",
    });
    expect(mocks.buildWeeklyRetroAuditPayload).toHaveBeenCalledWith({
      userId: "user-1",
      ownerEmail: "owner@test.local",
      week: 3,
      mesocycleId: "meso-1",
      projectionArtifactPath: undefined,
    });
    expect(mocks.generateDeloadSessionFromIntent).not.toHaveBeenCalled();
    expect(run.preSessionReadiness).toMatchObject({
      readOnly: true,
      affectsScoringOrGeneration: false,
      consumedByProduction: false,
      wouldWriteTransaction: false,
      activeMesocycle: {
        mesocycleId: "meso-1",
        state: "ACTIVE_ACCUMULATION",
        completedAccumulationSessions: 12,
        deloadSessionsCompleted: 0,
        deloadSessionsExpected: 4,
        deloadSessionPosition: null,
        currentWeek: 4,
        currentSession: 1,
        requestedMesocycleId: "meso-1",
        mesocycleIdMatchesRequest: true,
      },
    });
    expect(run.preSessionReadiness?.contract).toMatchObject({
      contractVersion: 1,
      scope: {
        mode: "pre-session-readiness",
        ownerSeam: "api/pre-session-readiness-contract",
        source: {
          producerMode: "audit_readout",
          producer: "workout_audit",
          provenance: "operator_audit",
        },
        readOnly: true,
        auditOnly: true,
        affectsScoringOrGeneration: false,
        consumedByProduction: false,
      },
      startability: {
        safeToTrain: true,
        normalStartCoachingAllowed: true,
      },
      boundaries: {
        readOnly: true,
        dbMutation: false,
        workoutLogSessionCreated: false,
        seedRuntimeChanged: false,
        plannerMaterializerChanged: false,
      },
    });
    expect(run.projectedWeekVolume?.runtimeDoseAdjustmentDiagnostics?.[0]).toMatchObject({
      muscle: "Chest",
      readOnly: true,
      affectsAcceptedSeed: false,
    });
  });

  it("adds deload session progress to pre-session-readiness from lifecycle context", async () => {
    mocks.loadActiveMesocycle.mockResolvedValueOnce({
      id: "meso-1",
      state: "ACTIVE_DELOAD",
      accumulationSessionsCompleted: 16,
      deloadSessionsCompleted: 1,
      sessionsPerWeek: 4,
      durationWeeks: 5,
      slotPlanSeedJson: {
        version: 1,
        source: "handoff_slot_plan_projection",
        slots: [
          {
            slotId: "lower_a",
            exercises: [
              { exerciseId: "squat", role: "CORE_COMPOUND", setCount: 4 },
            ],
          },
        ],
      },
    });
    mocks.deriveCurrentMesocycleSession.mockReturnValueOnce({
      week: 5,
      session: 2,
      phase: "DELOAD",
    });
    mocks.buildPreSessionReadinessProjectedWeekEvidence.mockResolvedValueOnce({
      version: 1,
      currentWeek: {
        mesocycleId: "meso-1",
        week: 5,
        phase: "deload",
        blockType: "deload",
      },
      projectionNotes: [],
      completedVolumeByMuscle: {},
      projectedSessions: [],
      fullWeekByMuscle: [],
      currentWeekAudit: {
        belowMEV: [],
        overMAV: [],
        underTargetClusters: [],
        belowPreferred: [],
        fatigueRisks: [],
      },
      interventionHints: [],
      sessionRisks: [],
      runtimeDoseAdjustmentDiagnostics: [],
    });
    mocks.generateDeloadSessionFromIntent.mockResolvedValueOnce({
      ...okGenerationResult,
      selection: {
        ...okGenerationResult.selection,
        sessionDecisionReceipt: {
          sessionProvenance: {
            mesocycleId: "meso-1",
            compositionSource: "deload_seed_replay",
          },
        },
      },
    });
    const context: WorkoutAuditContext = {
      mode: "pre-session-readiness",
      requestedMode: "pre-session-readiness",
      userId: "user-1",
      ownerEmail: "owner@test.local",
      plannerDiagnosticsMode: "debug",
      generationInput: { intent: "lower" },
      nextSession: {
        intent: "lower",
        slotId: "lower_a",
        slotSequenceIndex: 1,
        slotSequenceLength: 4,
        slotSource: "mesocycle_slot_sequence",
        existingWorkoutId: null,
        isExisting: false,
        source: "rotation",
        weekInMeso: 5,
        sessionInWeek: 2,
        derivationTrace: [],
        selectedIncompleteStatus: null,
      },
      projectedWeekVolume: { enabled: true },
      preSessionReadiness: {
        enabled: true,
        requestedMesocycleId: "meso-1",
      },
    };

    const run = await runWorkoutAuditGeneration(context);

    expect(mocks.generateDeloadSessionFromIntent).toHaveBeenCalledWith("user-1", {
      intent: "lower",
      targetMuscles: undefined,
      plannerDiagnosticsMode: "debug",
    });
    expect(run.preSessionReadiness?.activeMesocycle).toMatchObject({
      mesocycleId: "meso-1",
      state: "ACTIVE_DELOAD",
      completedAccumulationSessions: 16,
      deloadSessionsCompleted: 1,
      deloadSessionsExpected: 4,
      deloadSessionPosition: {
        current: 2,
        total: 4,
      },
      currentWeek: 5,
      currentSession: 2,
      requestedMesocycleId: "meso-1",
      mesocycleIdMatchesRequest: true,
    });
  });

  it("surfaces closeout-required blocker for pre-session-readiness without generation", async () => {
    mocks.loadActiveMesocycle.mockResolvedValueOnce({
      id: "meso-1",
      state: "ACTIVE_ACCUMULATION",
      accumulationSessionsCompleted: 16,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 4,
      durationWeeks: 5,
    });
    mocks.deriveCurrentMesocycleSession.mockReturnValueOnce({
      week: 4,
      session: 4,
      phase: "ACCUMULATION",
    });
    mocks.buildPreSessionReadinessProjectedWeekEvidence.mockResolvedValueOnce({
      version: 1,
      currentWeek: {
        mesocycleId: "meso-1",
        week: 4,
        phase: "accumulation",
        blockType: "accumulation",
      },
      projectionNotes: [
        "Week 4 closeout is pending. Resolve or dismiss the optional gap-fill before generating the Week 5 deload. Standard accumulation generation is blocked to prevent an unintended extra accumulation session.",
      ],
      completedVolumeByMuscle: {},
      projectedSessions: [],
      fullWeekByMuscle: [],
      currentWeekAudit: {
        belowMEV: [],
        overMAV: [],
        underTargetClusters: [],
        belowPreferred: [],
        fatigueRisks: [],
      },
      interventionHints: [],
      sessionRisks: [],
      runtimeDoseAdjustmentDiagnostics: [],
    });
    const context: WorkoutAuditContext = {
      mode: "pre-session-readiness",
      requestedMode: "pre-session-readiness",
      userId: "user-1",
      ownerEmail: "owner@test.local",
      plannerDiagnosticsMode: "debug",
      nextSession: {
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
      },
      projectedWeekVolume: { enabled: true },
      preSessionReadiness: {
        enabled: true,
        requestedMesocycleId: "meso-1",
      },
    };

    const run = await runWorkoutAuditGeneration(context);

    expect(mocks.generateSessionFromIntent).not.toHaveBeenCalled();
    expect(mocks.generateDeloadSessionFromIntent).not.toHaveBeenCalled();
    expect(run.generationResult).toEqual({
      error:
        "Week 4 closeout is pending. Resolve or dismiss the optional gap-fill before generating the Week 5 deload. Standard accumulation generation is blocked to prevent an unintended extra accumulation session.",
    });
    expect(run.generationPath).toEqual({
      requestedMode: "pre-session-readiness",
      executionMode: "blocked_closeout_required",
      generator: "none",
      reason: "final_accumulation_week_close_pending",
    });
    expect(run.preSessionReadiness).toMatchObject({
      readOnly: true,
      activeMesocycle: {
        mesocycleId: "meso-1",
        state: "ACTIVE_ACCUMULATION",
        completedAccumulationSessions: 16,
        deloadSessionsCompleted: 0,
        deloadSessionsExpected: 4,
        deloadSessionPosition: null,
        requestedMesocycleId: "meso-1",
        mesocycleIdMatchesRequest: true,
      },
    });
    expect(run.projectedWeekVolume?.projectedSessions).toEqual([]);
  });

  it("routes weekly-retro through the composed audit builder without touching generation helpers", async () => {
    const context: WorkoutAuditContext = {
      mode: "weekly-retro",
      requestedMode: "weekly-retro",
      userId: "user-1",
      plannerDiagnosticsMode: "standard",
      weeklyRetro: {
        week: 2,
        mesocycleId: "meso-1",
      },
    };

    const run = await runWorkoutAuditGeneration(context);

    expect(mocks.buildWeeklyRetroAuditPayload).toHaveBeenCalledWith({
      userId: "user-1",
      ownerEmail: undefined,
      week: 2,
      mesocycleId: "meso-1",
      projectionArtifactPath: undefined,
    });
    expect(mocks.generateSessionFromIntent).not.toHaveBeenCalled();
    expect(mocks.generateDeloadSessionFromIntent).not.toHaveBeenCalled();
    expect(run.weeklyRetro).toMatchObject({
      version: 1,
      week: 2,
      mesocycleId: "meso-1",
    });
  });

  it("routes active-mesocycle-slot-reseed through the dry-run audit builder without touching generation helpers", async () => {
    const context: WorkoutAuditContext = {
      mode: "active-mesocycle-slot-reseed",
      requestedMode: "active-mesocycle-slot-reseed",
      userId: "user-1",
      plannerDiagnosticsMode: "debug",
      activeMesocycleSlotReseed: {
        enabled: true,
      },
    };

    const run = await runWorkoutAuditGeneration(context);

    expect(mocks.buildActiveMesocycleSlotReseedAuditPayload).toHaveBeenCalledWith({
      userId: "user-1",
      plannerDiagnosticsMode: "debug",
    });
    expect(mocks.generateSessionFromIntent).not.toHaveBeenCalled();
    expect(mocks.generateDeloadSessionFromIntent).not.toHaveBeenCalled();
    expect(run.activeMesocycleSlotReseed).toMatchObject({
      version: 1,
      activeMesocycle: {
        mesocycleId: "meso-1",
        week: 3,
      },
      recommendation: {
        verdict: "safe_to_apply_bounded_reseed",
      },
    });
  });

  it("routes v2 accepted-seed prepare compare through the read-only audit builder without touching generation helpers", async () => {
    const context: WorkoutAuditContext = {
      mode: "v2-accepted-seed-prepare-compare",
      requestedMode: "v2-accepted-seed-prepare-compare",
      userId: "user-1",
      ownerEmail: "owner@test.local",
      plannerDiagnosticsMode: "debug",
      v2AcceptedSeedPrepareCompare: {
        mesocycleId: "meso-1",
        requestedIdSource: "mesocycle_id",
      },
    };

    const run = await runWorkoutAuditGeneration(context);

    expect(
      mocks.buildV2AcceptedSeedPrepareCompareAuditPayload,
    ).toHaveBeenCalledWith({
      userId: "user-1",
      ownerEmail: "owner@test.local",
      mesocycleId: "meso-1",
      requestedIdSource: "mesocycle_id",
    });
    expect(mocks.generateSessionFromIntent).not.toHaveBeenCalled();
    expect(mocks.generateDeloadSessionFromIntent).not.toHaveBeenCalled();
    expect(run.generationResult).toBeUndefined();
    expect(run.v2AcceptedSeedPrepareCompare).toMatchObject({
      readOnly: true,
      wouldWriteTransaction: false,
      consumedByProduction: false,
      compareStatus: "available",
      boundaryFacts: {
        v2PreviewAvailable: true,
        v2ProductionWriteEligible: false,
        transactionStatus: "no_write",
      },
    });
  });

  it("routes next-mesocycle acceptance gate through the read-only audit builder without touching generation helpers", async () => {
    const context: WorkoutAuditContext = {
      mode: "next-mesocycle-acceptance-gate",
      requestedMode: "next-mesocycle-acceptance-gate",
      userId: "user-1",
      ownerEmail: "owner@test.local",
      plannerDiagnosticsMode: "debug",
      nextMesocycleAcceptanceGate: {
        sourceMesocycleId: "meso-source",
      },
    };

    const run = await runWorkoutAuditGeneration(context);

    expect(
      mocks.buildNextMesocycleAcceptanceGateAuditPayload,
    ).toHaveBeenCalledWith({
      userId: "user-1",
      ownerEmail: "owner@test.local",
      sourceMesocycleId: "meso-source",
      plannerDiagnosticsMode: "debug",
    });
    expect(mocks.generateSessionFromIntent).not.toHaveBeenCalled();
    expect(mocks.generateDeloadSessionFromIntent).not.toHaveBeenCalled();
    expect(run.generationResult).toBeUndefined();
    expect(run.nextMesocycleAcceptanceGate).toMatchObject({
      readOnly: true,
      wouldWriteTransaction: false,
      consumedByProduction: false,
      gateResult: "not_runnable",
      candidateFound: false,
    });
  });

  it("routes post-accept successor verification through the read-only audit builder without touching generation helpers", async () => {
    const context: WorkoutAuditContext = {
      mode: "next-mesocycle-post-accept-verification",
      requestedMode: "next-mesocycle-post-accept-verification",
      userId: "user-1",
      ownerEmail: "owner@test.local",
      plannerDiagnosticsMode: "debug",
      nextMesocyclePostAcceptVerification: {
        sourceMesocycleId: "meso-source",
        successorMesocycleId: "meso-next",
      },
    };

    const run = await runWorkoutAuditGeneration(context);

    expect(
      mocks.buildNextMesocyclePostAcceptVerificationAuditPayload,
    ).toHaveBeenCalledWith({
      userId: "user-1",
      ownerEmail: "owner@test.local",
      sourceMesocycleId: "meso-source",
      successorMesocycleId: "meso-next",
      plannerDiagnosticsMode: "debug",
    });
    expect(mocks.generateSessionFromIntent).not.toHaveBeenCalled();
    expect(mocks.generateDeloadSessionFromIntent).not.toHaveBeenCalled();
    expect(run.generationResult).toBeUndefined();
    expect(run.nextMesocyclePostAcceptVerification).toMatchObject({
      readOnly: true,
      wouldWriteTransaction: false,
      consumedByProduction: false,
      verificationResult: "safe_to_train",
      safety: {
        dbMutated: false,
        transactionExecuted: false,
      },
    });
  });

  it("routes next-mesocycle handoff dry-run through the read-only audit builder without touching generation helpers", async () => {
    const context: WorkoutAuditContext = {
      mode: "next-mesocycle-handoff-dry-run",
      requestedMode: "next-mesocycle-handoff-dry-run",
      userId: "user-1",
      ownerEmail: "owner@test.local",
      plannerDiagnosticsMode: "debug",
      nextMesocycleHandoffDryRun: {
        sourceMesocycleId: "meso-source",
      },
    };

    const run = await runWorkoutAuditGeneration(context);

    expect(
      mocks.buildNextMesocycleHandoffDryRunAuditPayload,
    ).toHaveBeenCalledWith({
      userId: "user-1",
      ownerEmail: "owner@test.local",
      sourceMesocycleId: "meso-source",
    });
    expect(mocks.generateSessionFromIntent).not.toHaveBeenCalled();
    expect(mocks.generateDeloadSessionFromIntent).not.toHaveBeenCalled();
    expect(run.generationResult).toBeUndefined();
    expect(run.nextMesocycleHandoffDryRun).toMatchObject({
      readOnly: true,
      wouldWriteTransaction: false,
      consumedByProduction: false,
      summary: {
        writes: "no",
        handoffReady: false,
      },
      safety: {
        transactionExecuted: false,
      },
    });
  });

  it("routes mesocycle-explain through the dedicated read-only builder", async () => {
    const context: WorkoutAuditContext = {
      mode: "mesocycle-explain",
      requestedMode: "mesocycle-explain",
      userId: "user-1",
      ownerEmail: "owner@test.local",
      plannerDiagnosticsMode: "debug",
      mesocycleExplain: {
        sourceMesocycleId: "meso-source",
        retrospectiveMesocycleId: "meso-retro",
      },
    };

    const run = await runWorkoutAuditGeneration(context);

    expect(mocks.buildMesocycleExplainAuditPayload).toHaveBeenCalledWith({
      userId: "user-1",
      ownerEmail: "owner@test.local",
      sourceMesocycleId: "meso-source",
      retrospectiveMesocycleId: "meso-retro",
      plannerDiagnosticsMode: "debug",
      plannerOnlyDryRun: undefined,
      plannerOnlyNoRepair: undefined,
    });
    expect(run.mesocycleExplain?.sourceMesocycleId).toBe("meso-source");
    expect(run.generationResult).toBeUndefined();
  });
});
