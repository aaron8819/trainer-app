import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkoutAuditContext } from "./types";

const mocks = vi.hoisted(() => {
  const loadActiveMesocycle = vi.fn();
  const loadProjectedWeekVolumeReport = vi.fn();
  const generateSessionFromIntent = vi.fn();
  const generateDeloadSessionFromIntent = vi.fn();
  const buildWeeklyRetroAuditPayload = vi.fn();
  const buildActiveMesocycleSlotReseedAuditPayload = vi.fn();
  return {
    loadActiveMesocycle,
    loadProjectedWeekVolumeReport,
    generateSessionFromIntent,
    generateDeloadSessionFromIntent,
    buildWeeklyRetroAuditPayload,
    buildActiveMesocycleSlotReseedAuditPayload,
  };
});

vi.mock("@/lib/api/mesocycle-lifecycle", () => ({
  loadActiveMesocycle: (...args: unknown[]) => mocks.loadActiveMesocycle(...args),
}));

vi.mock("@/lib/api/projected-week-volume", () => ({
  loadProjectedWeekVolumeReport: (...args: unknown[]) =>
    mocks.loadProjectedWeekVolumeReport(...args),
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
    mocks.loadProjectedWeekVolumeReport.mockResolvedValueOnce({
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
          projectedContributionByMuscle: { Lats: 4 },
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
        week: 4,
      },
      currentWeekAudit: {
        belowMEV: ["Chest"],
        underTargetClusters: [{ muscle: "Chest", deficit: 6 }],
      },
      interventionHints: [
        {
          muscle: "Chest",
          suggestedSets: 2,
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
      week: 2,
      mesocycleId: "meso-1",
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
});
