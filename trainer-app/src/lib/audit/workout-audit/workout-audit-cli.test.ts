import { describe, expect, it, vi } from "vitest";
import {
  buildV2PlannerMesocyclePolicy,
  buildV2MesocycleStrategyDiagnostic,
  type V2MesocycleStrategyInput,
} from "@/lib/engine/planning/v2";
import { buildPreSessionReadinessContract } from "./pre-session-readiness-contract";
import {
  toPreSessionReadinessEvidence,
  toPreSessionReadinessProjectedWeekEvidence,
  toPreSessionReadinessWeeklyRetroEvidence,
} from "./pre-session-readiness-evidence";
import type { PreSessionReadinessAuditPayload } from "./types";
import { buildV2LaneSelectionIntentAudit } from "@/lib/engine/planning/v2/lane-selection-intent-audit";
import {
  buildAuditTimingSummaryLines,
  buildWorkoutAuditHelpText,
  buildWorkoutAuditModeLine,
  buildActiveMesocycleSlotReseedApplySummary,
  buildActiveMesocycleSlotReseedSummary,
  buildCurrentWeekAuditOperatorSummary,
  buildFutureWeekOperatorDebugSummary,
  buildPlanningRealitySummary,
  buildPlanningRealitySizeBudgetSummary,
  buildPlannerOnlyDryRunSummary,
  buildPlannerOnlyNoRepairSummary,
  buildNextMesocycleHandoffDryRunSummary,
  buildNextMesocycleAcceptanceGateSummary,
  buildNextMesocyclePostAcceptVerificationSummary,
  buildPreSessionReadinessSummary,
  buildProjectedWeekDebugSummary,
  buildProjectedWeekOperatorSummary,
  buildV2AcceptedSeedPrepareCompareSummary,
  buildV2DebugArtifactSummary,
  buildWeeklyRetroOperatorSummary,
  computePlanningRealitySizeBudget,
  createAuditCliTiming,
  assertNoArtifactWriteCompatibility,
  isWorkoutAuditHelpRequested,
  main,
  normalizeAuditIntentArg,
  runAuditCliWithTeardown,
  shouldSuppressAuditArtifactWrites,
  shouldPrintAuditTimingReadout,
  writeAuditArtifactFiles,
} from "../../../../scripts/workout-audit";

function makePlannerOwnedAccumulationProjection() {
  return {
    version: 1 as const,
    source: "v2_planner_policy" as const,
    readOnly: true as const,
    affectsScoringOrGeneration: false as const,
    weeks: ([2, 3, 4] as const).map((week) => ({
      week,
      phase:
        week === 4
          ? ("peak_overreach_lite" as const)
          : week === 3
            ? ("hard_accumulation" as const)
            : ("accumulation" as const),
      volumeMultiplier: week === 4 ? 1.125 : week === 3 ? 1.075 : 1,
      projectionStatus: "planner_owned_read_only" as const,
      safeForBehaviorPromotion: false as const,
      slots: [],
      validation: {
        unresolvedDemand: [],
        concentrationWarnings: [],
        duplicateWarnings: [],
        missingInputs: [],
      },
    })),
  };
}

function makeV2ExerciseSelectionPlanDiagnostic() {
  return {
    version: 1 as const,
    source: "v2_planner_policy" as const,
    readOnly: true as const,
    affectsScoringOrGeneration: false as const,
    status: "projected_with_limitations" as const,
    identityBasis: "week_1_selected_identities" as const,
    projectionBasis:
      "planner_owned_accumulation_projection_plus_week_1_identity_continuity" as const,
    summary: {
      weeksEvaluated: 4,
      lanesEvaluated: 1,
      preservedIdentityCount: 1,
      candidateAvailableCount: 0,
      missingCandidateCount: 0,
      classMismatchCount: 0,
      duplicateRequiresJustificationCount: 0,
      concentrationWarningCount: 1,
      blockedLaneCount: 0,
    },
    weeks: [],
    blockers: [],
    warnings: ["week_1:upper_a:chest_anchor:concentration_quality_warning"],
    missingInputs: [],
    safeForBehaviorPromotion: false as const,
  };
}

function makePromotionDiffStrategyInput(): V2MesocycleStrategyInput {
  return {
    version: 1,
    userProfile: {
      trainingGoal: "hypertrophy",
      trainingAge: "intermediate",
      availableTrainingDays: 4,
      confidence: "medium",
    },
    currentTrainingContext: {
      split: "upper_lower",
      currentPhase: "AWAITING_HANDOFF",
      currentMesocycleStatus: "COMPLETED",
      weekCount: 5,
      slotSequence: ["upper_a", "lower_a", "upper_b", "lower_b"],
      volumeTarget: "MODERATE",
      intensityBias: "HYPERTROPHY",
    },
    historicalMesocycles: [
      {
        mesocycleId: "history-a",
        sourcePlanner: "legacy_projection",
        status: "COMPLETED",
      },
      {
        mesocycleId: "history-b",
        sourcePlanner: "legacy_projection",
        status: "COMPLETED",
      },
    ],
    blockResponseSignals: [
      {
        mesocycleId: "history-a",
        sourcePlanner: "legacy_projection",
        adherence: {
          completedSessions: 14,
          skippedSetCount: 1,
          skippedSetTrend: "stable",
        },
        effortProgression: {
          averageRpeByWeek: [{ week: 4, averageRpe: 8.1 }],
          hardWeekEffortReached: true,
          deloadExecuted: true,
        },
        muscleDistribution: {
          recurringUnderHitMuscles: ["Side Delts"],
          belowMevFlags: ["Side Delts:below_target_or_mev_evidence"],
        },
        fatigueDistribution: {
          systemicFatigueFlag: false,
          likelyFatigueDrivers: [],
          evidence: ["hard_week_effort_reached"],
        },
        strategyImplications: ["protect_lagging_muscles_earlier"],
        confidence: "medium",
      },
      {
        mesocycleId: "history-b",
        sourcePlanner: "legacy_projection",
        adherence: {
          completedSessions: 13,
          skippedSetCount: 6,
          skippedSetTrend: "rising",
        },
        effortProgression: {
          averageRpeByWeek: [{ week: 4, averageRpe: 8.8 }],
          hardWeekEffortReached: true,
          deloadExecuted: true,
        },
        muscleDistribution: {
          recurringUnderHitMuscles: ["Side Delts", "Calves"],
          belowMevFlags: [
            "Side Delts:below_target_or_mev_evidence",
            "Calves:below_target_or_mev_evidence",
          ],
        },
        fatigueDistribution: {
          systemicFatigueFlag: true,
          likelyFatigueDrivers: ["Glutes"],
          evidence: ["late_block_skipped_sets_rising"],
        },
        strategyImplications: [
          "protect_lagging_muscles_earlier",
          "cap_late_block_volume",
        ],
        confidence: "medium",
      },
    ],
    exerciseResponseSignals: [],
    readinessAndRecoverySignals: {
      available: ["subjective_readiness"],
      missing: [],
    },
    evidenceLimitations: [
      "historical_mesocycles_are_validation_data_not_policy_targets",
    ],
  };
}

function makeV2SupportLaneProjectionDiagnostic() {
  return {
    version: 1 as const,
    source: "v2_planner_policy" as const,
    readOnly: true as const,
    affectsScoringOrGeneration: false as const,
    status: "projected_with_limitations" as const,
    summary: {
      supportMusclesEvaluated: 4,
      directFloorsMet: 1,
      directFloorsBelow: 3,
      optionalActivations: 1,
      expansionRecommendations: 3,
      unrecoverableExpansions: 0,
      supportPolicyMissCount: 0,
      setBudgetAuthoredCount: 1,
      authoredDroppedCount: 1,
      selectionPreservedCount: 0,
      highRiskDroppedCount: 1,
      diagnosticOnlyWarnings: 4,
    },
    laneBoundaryRows: [
      {
        muscle: "Triceps" as const,
        slotId: "upper_b",
        laneId: "optional_triceps_if_under_target",
        laneKind: "optional_top_up" as const,
        supportPolicyAuthored: true,
        setDistributionBudgeted: true,
        setBudget: { min: 2, preferred: 2, max: 2 },
        exerciseSelectionPreserved: false,
        exerciseSelectionStatus: "missing_candidate" as const,
        weeklyTargetStatus: "below" as const,
        projectedEffectiveSets: 5,
        mevFloor: 6,
        likelyOwnerSeam: "materializer_exercise_selection_capacity" as const,
        status: "authored_support_lane_dropped" as const,
        severity: "high_risk" as const,
        mustFixBeforeWeek1: true,
        evidence: [
          "supportPolicyAuthored:yes",
          "setDistributionBudgeted:yes",
          "exerciseSelectionPreserved:no",
        ],
        limitations: [
          "authored_budget_not_preserved_after_exercise_selection",
        ],
      },
    ],
    muscles: [],
    blockers: [],
    warnings: ["Triceps:optional_activation_triggered_diagnostic_only"],
    missingInputs: [],
    safeForBehaviorPromotion: false as const,
  };
}

function makeV2SelectionCapacityPlanDiagnostic() {
  return {
    version: 1 as const,
    source: "v2_planner_policy" as const,
    readOnly: true as const,
    affectsScoringOrGeneration: false as const,
    status: "projected_with_limitations" as const,
    summary: {
      weeksEvaluated: 1,
      slotsEvaluated: 1,
      lanesEvaluated: 1,
      targetMetNoActionCount: 0,
      capacityPressureCount: 1,
      capAwareExpansionNeededCount: 0,
      optionalSuppressedCount: 0,
      blockerCount: 0,
      laneInspectionCategoryCounts: {
        must_preserve: 1,
        floor_critical: 0,
        productive_support: 0,
        optional_stretch: 0,
        redundant_duplicate: 0,
        high_fatigue_trim_candidate: 0,
        unknown: 0,
      },
    },
    weeks: [
      {
        week: 1,
        slots: [
          {
            slotId: "upper_a",
            exerciseCount: 6,
            maxExerciseCount: 6,
            setCount: 18,
            targetSessionSets: { min: 12, preferred: 16, max: 18 },
            lanes: [
              {
                laneId: "row_anchor",
                classification: "capacity_pressure" as const,
                inspectionCategory: "must_preserve" as const,
                selectedExercise: "Chest-Supported Row",
                selectedSets: 4,
                setBudget: { min: 3, preferred: 4, max: 4 },
                perExerciseCap: 5,
                weeklyTargetStatus: "within" as const,
                slotHeadroom: 0,
                setHeadroom: 0,
                cleanAlternativeCount: null,
                optionalEligibility: "not_applicable" as const,
                evidence: ["capacityPressure:upper_pull_distribution"],
                limitations: [
                  "slot_at_exercise_capacity_no_clean_additional_headroom",
                ],
              },
            ],
          },
        ],
      },
    ],
    blockers: [],
    warnings: ["week_1:upper_a:row_anchor:capacity_pressure"],
    missingInputs: [],
    capacityPolicyTrialDesign: {
      version: 1 as const,
      source: "v2_selection_capacity_plan_diagnostic" as const,
      readOnly: true as const,
      affectsScoringOrGeneration: false as const,
      consumedByDemandOrMaterializer: false as const,
      status: "design_only" as const,
      trialId: "upper_a_max_exercise_count_plus_one_projection_only",
      scope: "read_only_projection_only" as const,
      candidateChange: {
        kind: "slot_max_exercise_count_delta" as const,
        slotId: "upper_a",
        delta: 1 as const,
        reason: "zero_headroom_capacity_pressure_or_floor_critical_lanes",
      },
      targetSlots: ["upper_a"],
      basis: {
        targetSlotId: "upper_a",
        targetSlotWeek: 1,
        targetSlotExerciseCount: 6,
        targetSlotMaxExerciseCount: 6,
        targetSlotSetCount: 18,
        targetSlotMaxSets: 18,
        targetSlotFloorCriticalLaneCount: 0,
        targetSlotCapacityPressureLaneCount: 1,
        targetSlotMustPreserveLaneCount: 1,
        targetSlotProductiveSupportLaneCount: 0,
        totalFloorCriticalLaneCount: 0,
        totalCapacityPressureLaneCount: 1,
        totalOptionalStretchLaneCount: 0,
        totalHighFatigueTrimCandidateLaneCount: 0,
        totalRedundantDuplicateLaneCount: 0,
      },
      gates: ([
        "hard_floors",
        "over_mav",
        "session_size",
        "five_set_stacking",
        "lane_survival",
        "duplicates",
        "materializer_validity",
        "acceptance_result",
      ] as const).map((gateId) => ({
        gateId,
        status: "requires_projection" as const,
        ownerSeam: "diagnostic_projection",
        requiredEvidence: ["read_only_projection"],
        currentEvidence: ["not_run"],
        failureMeaning: "do_not_promote_behavior",
      })),
      blockersBeforeBehavior: [
        "read_only_capacity_projection_not_run",
        "materializer_validity_not_measured",
        "acceptance_gate_not_rerun",
        "candidate_impact_not_measured",
      ],
      nextSafeAction: "run_read_only_capacity_behavior_projection" as const,
      limitations: ["design_only_not_a_simulation"],
      safeForBehaviorPromotion: false as const,
    },
    capacityBehaviorProjection: {
      version: 1 as const,
      source: "v2_selection_capacity_plan_diagnostic" as const,
      readOnly: true as const,
      affectsScoringOrGeneration: false as const,
      consumedByDemandOrMaterializer: false as const,
      status: "projected_with_limitations" as const,
      projectionMode: "slot_cap_delta_existing_evidence_only" as const,
      trialId: "upper_a_max_exercise_count_plus_one_projection_only",
      candidateImpact: {
        selectedIdentityDelta: 0 as const,
        weeklyVolumeDelta: 0 as const,
        capacityPressureRowsBefore: 1,
        capacityPressureRowsAfter: 0,
        capacityPressureRowsRelieved: 1,
        floorCriticalRowsBefore: 0,
        floorCriticalRowsAfter: 0,
        optionalStretchRowsActivated: 0 as const,
        regressionCount: 0,
        regressions: [],
        improvements: ["capacity_pressure_rows_relieved:1"],
      },
      projectedSlots: [
        {
          week: 1,
          slotId: "upper_a",
          exerciseCount: 6,
          maxExerciseCountBefore: 6,
          maxExerciseCountAfter: 7,
          slotHeadroomBefore: 0,
          slotHeadroomAfter: 1,
          setCount: 18,
          targetSessionMaxSets: 18,
          setHeadroom: 0,
          capacityPressureRowsBefore: 1,
          capacityPressureRowsAfter: 0,
          floorCriticalRowsBefore: 0,
          floorCriticalRowsAfter: 0,
          mustPreserveRows: 1,
          productiveSupportRows: 0,
          sessionSizeStatus: "within_limits" as const,
        },
      ],
      gates: ([
        ["hard_floors", "pass"],
        ["over_mav", "pass"],
        ["session_size", "pass"],
        ["five_set_stacking", "pass"],
        ["lane_survival", "pass"],
        ["duplicates", "pass"],
        ["materializer_validity", "unknown"],
        ["acceptance_result", "unknown"],
      ] as const).map(([gateId, status]) => ({
        gateId,
        status,
        measured: status !== "unknown",
        ownerSeam: "diagnostic_projection",
        evidence: ["read_only_projection"],
        regressions: [],
        requiredNextEvidence:
          status === "unknown" ? ["stronger_projection_evidence"] : [],
      })),
      blockersBeforeBehavior: [
        "materializer_validity_not_measured",
        "acceptance_gate_not_rerun",
        "candidate_identity_impact_not_measured",
      ],
      nextSafeAction: "run_read_only_materializer_capacity_projection" as const,
      limitations: ["cap_delta_only_existing_evidence_projection"],
      safeForBehaviorPromotion: false as const,
    },
    safeForBehaviorPromotion: false as const,
  };
}

function makeV2BasePlanCompareFixture() {
  return {
    version: 1,
    source: "v2_base_plan_compare",
    readOnly: true,
    affectsScoringOrGeneration: false,
    status: "available",
    comparedPlans: {
      v2BasePlanAvailable: true,
      plannerOnlyNoRepairAvailable: true,
      repairedPlanAvailable: true,
    },
    summary: {
      v2BaseValidationStatus: "pass",
      v2TotalSets: 55,
      noRepairTotalSets: 25,
      repairedTotalSets: 55,
      repairDependencyCount: 9,
      v2ImprovementCount: 12,
      v2RegressionCount: 0,
      unclearCount: 2,
    },
    nextSafeAction: "add_shadow_consumption_trial",
  };
}

function makeV2BasePlanShadowConsumptionTrialFixture() {
  return {
    version: 1,
    source: "v2_base_plan_shadow_consumption_trial",
    readOnly: true,
    affectsScoringOrGeneration: false,
    status: "available",
    consumedByProduction: false,
    comparedPlans: {
      v2BasePlanAvailable: true,
      shadowConsumedPlanAvailable: true,
      plannerOnlyNoRepairAvailable: true,
      repairedPlanAvailable: true,
    },
    summary: {
      shadowTotalSets: 55,
      v2BaseTotalSets: 55,
      noRepairTotalSets: 25,
      repairedTotalSets: 55,
      currentRepairDependencyCount: 9,
      shadowRemainingRepairDependencyCount: 1,
      repairDependencyDelta: -8,
      improvementCount: 14,
      preservationCount: 10,
      regressionCount: 0,
      unclearCount: 1,
      notComparableCount: 0,
      categorizedIdentityDifferenceCount: 4,
    },
    nextSafeAction: "inspect_shadow_consumption",
  };
}

function makeV2PlanQualityBenchmarkFixture() {
  return {
    version: 1,
    source: "v2_candidate_quality_benchmark",
    readOnly: true,
    affectsScoringOrGeneration: false,
    consumedByProduction: false,
    repairedProjectionUsedAs: "evidence_only_not_target_policy",
    status: "warning",
    summary: {
      passCount: 6,
      warningCount: 2,
      failCount: 0,
      missingEvidenceCount: 0,
      mustFixBeforeWeek1Count: 0,
      nextSafeAction: "review_warning_gates_before_deprecation",
    },
    gates: [
      {
        gate: "session_size",
        status: "pass",
        ownerSeam: "v2_base_plan_validation.slot_shape",
        evidenceSource: "pure_v2_base_plan",
        evidence: ["sessionSizeUnclearRows=none"],
        missingEvidence: [],
        candidateImpact: "supports_deprecation_review",
        mustFixBeforeWeek1: false,
      },
      {
        gate: "duplicate_concentration_risk",
        status: "warning",
        ownerSeam: "v2_base_plan_validation.duplicate_distinctness",
        evidenceSource: "pure_v2_base_plan",
        evidence: [
          "exerciseIdentityClassification=v2_preserves",
          "v2DuplicateExactExercises=1",
          "watch:exact_duplicate_reuse_needs_variant_or_continuity_justification",
          "v2DuplicateExact:Standing Calf Raise",
        ],
        missingEvidence: [],
        candidateImpact: "needs_more_evidence",
        mustFixBeforeWeek1: false,
      },
    ],
    deprecationReadiness: {
      status: "ready_for_review",
      evidence: ["session_size:pass"],
      missingEvidence: [],
    },
    guardrails: {
      seedRuntimeChanged: false,
      productionMaterializerChanged: false,
      acceptanceThresholdChanged: false,
      persistenceChanged: false,
    },
  };
}

describe("normalizeAuditIntentArg", () => {
  it("normalizes uppercase explicit intents into canonical lower-case session intents", () => {
    expect(normalizeAuditIntentArg("UPPER")).toBe("upper");
    expect(normalizeAuditIntentArg("PULL")).toBe("pull");
  });

  it("fails fast with a clear error for invalid explicit intents", () => {
    expect(() => normalizeAuditIntentArg("TORSO")).toThrow(
      'Invalid --intent value "TORSO". Expected one of: push, pull, legs, upper, lower, full_body, body_part.',
    );
  });
});

describe("workout audit CLI help", () => {
  it("detects help flags before other parsed options", () => {
    expect(isWorkoutAuditHelpRequested(["--help"])).toBe(true);
    expect(isWorkoutAuditHelpRequested(["-h"])).toBe(true);
    expect(isWorkoutAuditHelpRequested(["--no-artifact", "--help"])).toBe(true);
    expect(isWorkoutAuditHelpRequested(["--help", "--no-artifact"])).toBe(true);
    expect(isWorkoutAuditHelpRequested(["--mode", "future-week"])).toBe(false);
  });

  it("prints clear usage text", () => {
    const help = buildWorkoutAuditHelpText();

    expect(help).toContain("Usage: npm run audit:workout -- [options]");
    expect(help).toContain("-h, --help");
    expect(help).toContain("Without --mode, the default audit mode is future-week.");
    expect(help).toContain("pre-session-readiness");
    expect(help).toContain("next-mesocycle-acceptance-gate");
    expect(help).toContain("next-mesocycle-post-accept-verification");
    expect(help).toContain(
      "Help exits before owner resolution, DB preflight, audit execution, artifact directory creation, and artifact writing.",
    );
  });

  it.each([["--help"], ["-h"], ["--help", "--no-artifact"], ["--no-artifact", "--help"]])(
    "prints help and exits before audit work for %s",
    async (...argv) => {
      const originalDatabaseUrl = process.env.DATABASE_URL;
      const timing = createAuditCliTiming({ now: () => 0 });
      const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

      delete process.env.DATABASE_URL;
      try {
        await main({ argv, timing });
        expect(log).toHaveBeenCalledTimes(1);
        expect(log.mock.calls[0]?.[0]).toContain("Usage: npm run audit:workout -- [options]");
        expect(timing.records().map((record) => record.span)).toEqual([
          "argument_parsing",
          "total_measured_work",
        ]);
      } finally {
        if (originalDatabaseUrl === undefined) {
          delete process.env.DATABASE_URL;
        } else {
          process.env.DATABASE_URL = originalDatabaseUrl;
        }
        log.mockRestore();
      }
    },
  );
});

describe("audit CLI timing and teardown", () => {
  it("recognizes no-artifact and stdout-only as artifact suppression aliases", () => {
    expect(shouldSuppressAuditArtifactWrites({})).toBe(false);
    expect(shouldSuppressAuditArtifactWrites({ "no-artifact": true })).toBe(true);
    expect(shouldSuppressAuditArtifactWrites({ "stdout-only": true })).toBe(true);
  });

  it("rejects no-artifact when an explicit write-oriented flag is present", () => {
    expect(() =>
      assertNoArtifactWriteCompatibility({ "no-artifact": true, write: true }),
    ).toThrow("--no-artifact/--stdout-only cannot be combined with --write");
    expect(() =>
      assertNoArtifactWriteCompatibility({
        "stdout-only": true,
        "apply-bounded-reseed": true,
      }),
    ).toThrow(
      "--no-artifact/--stdout-only cannot be combined with --apply-bounded-reseed",
    );
    expect(() =>
      assertNoArtifactWriteCompatibility({
        "no-artifact": true,
        "accept-slot-plan-upgrade": true,
      }),
    ).toThrow(
      "--no-artifact/--stdout-only cannot be combined with --accept-slot-plan-upgrade",
    );
    expect(() =>
      assertNoArtifactWriteCompatibility({
        "no-artifact": true,
        "v2-debug-artifact": true,
      }),
    ).toThrow(
      "--no-artifact/--stdout-only cannot be combined with --v2-debug-artifact",
    );
  });

  it("skips artifact directory creation, main file writes, and sidecar writes when suppressed", async () => {
    const ensureOutputDir = vi.fn().mockResolvedValue(undefined);
    const writeTextFile = vi.fn().mockResolvedValue(undefined);
    const timing = createAuditCliTiming({ now: () => 0 });

    const result = await writeAuditArtifactFiles({
      suppressWrites: true,
      outputDir: "C:\\artifacts\\audits",
      outputPath: "C:\\artifacts\\audits\\audit.json",
      serialized: "{}",
      v2DebugArtifact: {
        fileName: "audit-v2-debug-index.json",
        serialized: "{}",
        shards: [{ fileName: "audit-v2-strategy.json", serialized: "{}" }],
      },
      timing,
      ensureOutputDir,
      writeTextFile,
      joinPath: (...parts) => parts.join("\\"),
    });

    expect(result).toEqual({
      artifactOutputPath: null,
      v2DebugOutputPath: null,
      sidecarFileCount: 0,
    });
    expect(ensureOutputDir).not.toHaveBeenCalled();
    expect(writeTextFile).not.toHaveBeenCalled();
    expect(timing.records().map((record) => record.span)).toEqual([
      "artifact_write",
      "sidecar_write",
    ]);
  });

  it("writes no files for a normal no-artifact acceptance-gate run", async () => {
    const ensureOutputDir = vi.fn().mockResolvedValue(undefined);
    const writeTextFile = vi.fn().mockResolvedValue(undefined);
    const timing = createAuditCliTiming({ now: () => 0 });

    const result = await writeAuditArtifactFiles({
      suppressWrites: true,
      outputDir: "C:\\artifacts\\audits",
      outputPath:
        "C:\\artifacts\\audits\\next-mesocycle-acceptance-gate.json",
      serialized: "{\"mode\":\"next-mesocycle-acceptance-gate\"}",
      timing,
      ensureOutputDir,
      writeTextFile,
      joinPath: (...parts) => parts.join("\\"),
    });

    expect(result).toEqual({
      artifactOutputPath: null,
      v2DebugOutputPath: null,
      sidecarFileCount: 0,
    });
    expect(ensureOutputDir).not.toHaveBeenCalled();
    expect(writeTextFile).not.toHaveBeenCalled();
  });

  it("preserves default artifact, sidecar, and shard writes", async () => {
    const ensureOutputDir = vi.fn().mockResolvedValue(undefined);
    const writeTextFile = vi.fn().mockResolvedValue(undefined);
    const timing = createAuditCliTiming({ now: () => 0 });

    const result = await writeAuditArtifactFiles({
      suppressWrites: false,
      outputDir: "C:\\artifacts\\audits",
      outputPath: "C:\\artifacts\\audits\\audit.json",
      serialized: "{\"main\":true}",
      v2DebugArtifact: {
        fileName: "audit-v2-debug-index.json",
        serialized: "{\"index\":true}",
        shards: [{ fileName: "audit-v2-strategy.json", serialized: "{\"shard\":true}" }],
      },
      timing,
      ensureOutputDir,
      writeTextFile,
      joinPath: (...parts) => parts.join("\\"),
    });

    expect(result).toEqual({
      artifactOutputPath: "C:\\artifacts\\audits\\audit.json",
      v2DebugOutputPath: "C:\\artifacts\\audits\\audit-v2-debug-index.json",
      sidecarFileCount: 2,
    });
    expect(ensureOutputDir).toHaveBeenCalledWith("C:\\artifacts\\audits");
    expect(writeTextFile).toHaveBeenCalledWith(
      "C:\\artifacts\\audits\\audit.json",
      "{\"main\":true}",
    );
    expect(writeTextFile).toHaveBeenCalledWith(
      "C:\\artifacts\\audits\\audit-v2-debug-index.json",
      "{\"index\":true}",
    );
    expect(writeTextFile).toHaveBeenCalledWith(
      "C:\\artifacts\\audits\\audit-v2-strategy.json",
      "{\"shard\":true}",
    );
  });

  it("prints timing readout only for operator-debug or debug runs", () => {
    expect(shouldPrintAuditTimingReadout({})).toBe(false);
    expect(shouldPrintAuditTimingReadout({ "operator-debug": true })).toBe(
      true,
    );
    expect(shouldPrintAuditTimingReadout({ debug: true })).toBe(true);

    expect(
      buildAuditTimingSummaryLines({
        enabled: false,
        records: [{ span: "audit_generation", ms: 12.34 }],
      }),
    ).toBeNull();
    expect(
      buildAuditTimingSummaryLines({
        enabled: true,
        records: [{ span: "audit_generation", ms: 12.34 }],
      }),
    ).toEqual(["[workout-audit:timing] audit_generation_ms=12.3"]);
  });

  it("invokes teardown after a successful CLI run", async () => {
    let now = 0;
    const timing = createAuditCliTiming({ now: () => now++ });
    const run = vi.fn().mockResolvedValue(undefined);
    const teardown = vi.fn().mockResolvedValue(undefined);

    await runAuditCliWithTeardown({
      run,
      teardown,
      timing,
      printTiming: () => false,
    });

    expect(run).toHaveBeenCalledTimes(1);
    expect(teardown).toHaveBeenCalledTimes(1);
    expect(timing.records().map((record) => record.span)).toContain("teardown");
  });

  it("invokes teardown after a failed CLI run and preserves the original error", async () => {
    const timing = createAuditCliTiming({ now: () => 0 });
    const originalError = new Error("audit failed");
    const teardownError = new Error("teardown failed");
    const teardown = vi.fn().mockRejectedValue(teardownError);
    const teardownLog = vi.fn();

    await expect(
      runAuditCliWithTeardown({
        run: vi.fn().mockRejectedValue(originalError),
        teardown,
        timing,
        printTiming: () => false,
        logTeardownError: teardownLog,
      }),
    ).rejects.toBe(originalError);

    expect(teardown).toHaveBeenCalledTimes(1);
    expect(teardownLog).toHaveBeenCalledWith(
      "[workout-audit] teardown failed: teardown failed",
    );
  });
});

describe("buildV2DebugArtifactSummary", () => {
  it("prints the index and shard paths, sizes, and hashes for CLI readout", () => {
    expect(
      buildV2DebugArtifactSummary({
        filePath:
          "C:\\repo\\trainer-app\\artifacts\\audits\\parent-v2-debug-index.json",
        sizeBytes: 1234,
        sha256: "a".repeat(64),
        shards: [
          {
            id: "strategy",
            filePath:
              "C:\\repo\\trainer-app\\artifacts\\audits\\parent-v2-strategy.json",
            detailLevel: "compact",
            sizeBytes: 456,
            sha256: "b".repeat(64),
          },
        ],
      }),
    ).toEqual([
      "[workout-audit:v2-debug] index=C:\\repo\\trainer-app\\artifacts\\audits\\parent-v2-debug-index.json",
      `[workout-audit:v2-debug] index_size_bytes=1234 sha256=${"a".repeat(64)}`,
      `[workout-audit:v2-debug] shard=strategy detail=compact artifact=C:\\repo\\trainer-app\\artifacts\\audits\\parent-v2-strategy.json size_bytes=456 sha256=${"b".repeat(64)}`,
    ]);
  });
});

describe("buildProjectedWeekOperatorSummary", () => {
  it("formats a compact projected-week verdict and recommends deeper investigation for meaningful risks", () => {
    const summary = buildProjectedWeekOperatorSummary({
      artifact: {
        projectedWeekVolume: {
          version: 1,
          currentWeek: {
            mesocycleId: "meso-1",
            week: 3,
            phase: "accumulation",
            blockType: "accumulation",
          },
          projectionNotes: ["ignored incomplete workout"],
          completedVolumeByMuscle: {},
          projectedSessions: [
            {
              slotId: "slot-1",
              intent: "push",
              isNext: true,
              exerciseCount: 6,
              totalSets: 18,
              projectedContributionByMuscle: { Chest: 3 },
            },
          ],
          fullWeekByMuscle: [
            {
              muscle: "Chest",
              completedEffectiveSets: 4,
              projectedNextSessionEffectiveSets: 2,
              projectedRemainingWeekEffectiveSets: 0,
              projectedFullWeekEffectiveSets: 6,
              weeklyTarget: 10,
              mev: 8,
              mav: 16,
              deltaToTarget: -4,
              deltaToMev: -2,
              deltaToMav: -10,
            },
            {
              muscle: "Calves",
              completedEffectiveSets: 7,
              projectedNextSessionEffectiveSets: 1,
              projectedRemainingWeekEffectiveSets: 0,
              projectedFullWeekEffectiveSets: 8,
              weeklyTarget: 9,
              mev: 8,
              mav: 14,
              deltaToTarget: -1,
              deltaToMev: 0,
              deltaToMav: -6,
            },
            {
              muscle: "Lats",
              completedEffectiveSets: 10,
              projectedNextSessionEffectiveSets: 1,
              projectedRemainingWeekEffectiveSets: 0,
              projectedFullWeekEffectiveSets: 11,
              weeklyTarget: 9,
              mev: 8,
              mav: 10,
              deltaToTarget: 2,
              deltaToMev: 3,
              deltaToMav: 1,
            },
            {
              muscle: "Rear Delts",
              completedEffectiveSets: 7,
              projectedNextSessionEffectiveSets: 0,
              projectedRemainingWeekEffectiveSets: 0,
              projectedFullWeekEffectiveSets: 7,
              weeklyTarget: 6,
              mev: 4,
              mav: 12,
              deltaToTarget: 1,
              deltaToMev: 3,
              deltaToMav: -5,
            },
          ],
        },
        warningSummary: {
          blockingErrors: [],
          semanticWarnings: ["planner mismatch"],
          backgroundWarnings: [],
          counts: {
            blockingErrors: 0,
            semanticWarnings: 1,
            backgroundWarnings: 0,
          },
        },
      },
      outputPath: "C:\\artifacts\\week.json",
    });

    expect(summary).toEqual([
      "[workout-audit:week] current_week=3 phase=accumulation block=accumulation",
      "[workout-audit:week] below_mev=Chest (-2.0)",
      "[workout-audit:week] below_target_only=Calves (-1.0)",
      "[workout-audit:week] over_mav=Lats (+1.0)",
      "[workout-audit:week] over_target_only=Rear Delts (+1.0)",
      "[workout-audit:week] projected_sessions=1 projection_notes=1 warnings=blocking:0,semantic:1,background:0",
      "[workout-audit:week] artifact=C:\\artifacts\\week.json",
      "[workout-audit:week] recommendation=inspect_full_artifact reasons=semantic_warnings,projection_notes,below_mev,over_mav",
    ]);
  });

  it("returns a no-action summary when the projected week stays within the expected bands", () => {
    const summary = buildProjectedWeekOperatorSummary({
      artifact: {
        projectedWeekVolume: {
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
          fullWeekByMuscle: [
            {
              muscle: "Chest",
              completedEffectiveSets: 8,
              projectedNextSessionEffectiveSets: 0,
              projectedRemainingWeekEffectiveSets: 0,
              projectedFullWeekEffectiveSets: 8,
              weeklyTarget: 8,
              mev: 6,
              mav: 12,
              deltaToTarget: 0,
              deltaToMev: 2,
              deltaToMav: -4,
            },
          ],
        },
        warningSummary: {
          blockingErrors: [],
          semanticWarnings: [],
          backgroundWarnings: [],
          counts: {
            blockingErrors: 0,
            semanticWarnings: 0,
            backgroundWarnings: 0,
          },
        },
      },
      outputPath: "C:\\artifacts\\week.json",
    });

    expect(summary?.[1]).toBe("[workout-audit:week] below_mev=none");
    expect(summary?.[2]).toBe("[workout-audit:week] below_target_only=none");
    expect(summary?.[3]).toBe("[workout-audit:week] over_mav=none");
    expect(summary?.[4]).toBe("[workout-audit:week] over_target_only=none");
    expect(summary?.[7]).toBe(
      "[workout-audit:week] recommendation=no_further_action reasons=none",
    );
  });
});

describe("buildProjectedWeekDebugSummary", () => {
  it("prints a richer projected-week debug view from the existing artifact payload", () => {
    const summary = buildProjectedWeekDebugSummary({
      artifact: {
        projectedWeekVolume: {
          version: 1,
          currentWeek: {
            mesocycleId: "meso-1",
            week: 3,
            phase: "accumulation",
            blockType: "accumulation",
          },
          projectionNotes: ["ignored incomplete workout"],
          completedVolumeByMuscle: {},
          projectedSessions: [
            {
              slotId: "slot-1",
              intent: "push",
              isNext: true,
              exerciseCount: 6,
              totalSets: 18,
              projectedContributionByMuscle: { Chest: 3, Triceps: 2 },
            },
            {
              slotId: "slot-2",
              intent: "legs",
              isNext: false,
              exerciseCount: 5,
              totalSets: 15,
              projectedContributionByMuscle: { Chest: 0.5, Calves: 1.5 },
            },
          ],
          fullWeekByMuscle: [
            {
              muscle: "Chest",
              completedEffectiveSets: 4,
              projectedNextSessionEffectiveSets: 3,
              projectedRemainingWeekEffectiveSets: 0.5,
              projectedFullWeekEffectiveSets: 7.5,
              weeklyTarget: 10,
              mev: 8,
              mav: 16,
              deltaToTarget: -2.5,
              deltaToMev: -0.5,
              deltaToMav: -8.5,
            },
            {
              muscle: "Calves",
              completedEffectiveSets: 7,
              projectedNextSessionEffectiveSets: 0,
              projectedRemainingWeekEffectiveSets: 1.5,
              projectedFullWeekEffectiveSets: 8.5,
              weeklyTarget: 9,
              mev: 8,
              mav: 14,
              deltaToTarget: -0.5,
              deltaToMev: 0.5,
              deltaToMav: -5.5,
            },
          ],
        },
        warningSummary: {
          blockingErrors: ["projection exploded once"],
          semanticWarnings: ["planner mismatch"],
          backgroundWarnings: ["fallback mapper used"],
          counts: {
            blockingErrors: 1,
            semanticWarnings: 1,
            backgroundWarnings: 1,
          },
        },
      },
    });

    expect(summary).toEqual([
      "[workout-audit:week:debug] recommendation_reasons=blocking_errors,semantic_warnings,projection_notes,below_mev",
      "[workout-audit:week:debug] projected_session_order=push@slot-1 -> legs@slot-2",
      "[workout-audit:week:debug] below_mev muscle=Chest full=7.5 mev=8.0 target=10.0 delta_to_mev=-0.5 next=3.0 remaining=0.5 contributors=push@slot-1:+3.0, legs@slot-2:+0.5",
      "[workout-audit:week:debug] below_target_only muscle=Calves full=8.5 target=9.0 delta_to_target=-0.5 mev=8.0 contributors=legs@slot-2:+1.5",
      "[workout-audit:week:debug] projection_note[1]=ignored incomplete workout",
      "[workout-audit:week:debug] blocking_warning[1]=projection exploded once",
      "[workout-audit:week:debug] semantic_warning[1]=planner mismatch",
      "[workout-audit:week:debug] background_warning[1]=fallback mapper used",
      "[workout-audit:week:debug] projected_session[1] label=push@slot-1 is_next=true exercises=6 total_sets=18 top_contributors=Chest:+3.0, Triceps:+2.0",
      "[workout-audit:week:debug] projected_session[2] label=legs@slot-2 is_next=false exercises=5 total_sets=15 top_contributors=Calves:+1.5, Chest:+0.5",
    ]);
  });

  it("prints explicit none markers when there is nothing deeper to inspect", () => {
    const summary = buildProjectedWeekDebugSummary({
      artifact: {
        projectedWeekVolume: {
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
          fullWeekByMuscle: [
            {
              muscle: "Chest",
              completedEffectiveSets: 8,
              projectedNextSessionEffectiveSets: 0,
              projectedRemainingWeekEffectiveSets: 0,
              projectedFullWeekEffectiveSets: 8,
              weeklyTarget: 8,
              mev: 6,
              mav: 12,
              deltaToTarget: 0,
              deltaToMev: 2,
              deltaToMav: -4,
            },
          ],
        },
        warningSummary: {
          blockingErrors: [],
          semanticWarnings: [],
          backgroundWarnings: [],
          counts: {
            blockingErrors: 0,
            semanticWarnings: 0,
            backgroundWarnings: 0,
          },
        },
      },
    });

    expect(summary).toEqual([
      "[workout-audit:week:debug] recommendation_reasons=none",
      "[workout-audit:week:debug] projected_session_order=none",
      "[workout-audit:week:debug] below_mev_detail=none",
      "[workout-audit:week:debug] below_target_only_detail=none",
      "[workout-audit:week:debug] projection_note=none",
      "[workout-audit:week:debug] blocking_warning=none",
      "[workout-audit:week:debug] semantic_warning=none",
      "[workout-audit:week:debug] background_warning=none",
    ]);
  });
});

describe("planningReality size budget summary", () => {
  const planningReality = {
    label: "weekly demand / slot allocation diagnostics",
    readOnly: true,
    affectsScoringOrGeneration: false,
    summary: {
      planningShape: "mostly_repair_shaped",
      materialRepairCount: 2,
      majorRepairCount: 1,
    },
    repairMateriality: [
      {
        slotId: "upper_a",
        muscle: "Chest",
        exerciseName: "Incline DB Bench",
        notes: ["added late", "material identity change"],
      },
      {
        slotId: "upper_b",
        muscle: "Side Delts",
        exerciseName: "Cable Lateral Raise",
        notes: ["support floor closed late"],
      },
    ],
    exerciseClassAlignment: [
      {
        slotId: "upper_a",
        muscle: "Chest",
        intendedClass: "press",
        evidence: [
          "initial selection missed distinct class intent",
          "final repair improved class alignment",
        ],
      },
    ],
  } as unknown as NonNullable<
    Parameters<typeof computePlanningRealitySizeBudget>[0]["planningReality"]
  >;

  const artifact: Parameters<
    typeof buildPlanningRealitySizeBudgetSummary
  >[0]["artifact"] = {
    mesocycleExplain: {
      preview: {
        projectionDiagnostics: {
          planningReality,
        },
      },
    },
  };

  it("computes total and top-level planningReality section sizes", () => {
    const budget = computePlanningRealitySizeBudget({
      planningReality,
      largestSectionLimit: 2,
    });

    expect(budget?.totalBytes).toBeGreaterThan(0);
    expect(budget?.largestSections).toEqual([
      {
        field: "repairMateriality",
        bytes: expect.any(Number),
      },
      {
        field: "exerciseClassAlignment",
        bytes: expect.any(Number),
      },
    ]);
  });

  it("prints the breakdown when the configured artifact limit is exceeded", () => {
    const summary = buildPlanningRealitySizeBudgetSummary({
      artifact,
      sizeBytes: 110,
      thresholdBytes: 100,
      largestSectionLimit: 2,
    });

    expect(summary).toEqual([
      "planningReality size breakdown",
      "-------------------------------",
      "artifact bytes: 110",
      "artifact limit bytes: 100",
      "artifact budget status: exceeded",
      `total planningReality bytes: ${computePlanningRealitySizeBudget({ planningReality })?.totalBytes}`,
      "largest sections:",
      `- repairMateriality: ${computePlanningRealitySizeBudget({ planningReality })?.largestSections[0]?.bytes}`,
      `- exerciseClassAlignment: ${computePlanningRealitySizeBudget({ planningReality })?.largestSections[1]?.bytes}`,
    ]);
  });

  it("prints the breakdown when the artifact approaches the configured limit", () => {
    const summary = buildPlanningRealitySizeBudgetSummary({
      artifact,
      sizeBytes: 90,
      thresholdBytes: 100,
      largestSectionLimit: 1,
    });

    expect(summary).toContain("artifact budget status: approaching");
    expect(summary).toContain("largest sections:");
  });

  it("does not print for small artifacts unless operator debug asks for it", () => {
    expect(
      buildPlanningRealitySizeBudgetSummary({
        artifact,
        sizeBytes: 30,
        thresholdBytes: 100,
      }),
    ).toBeNull();

    expect(
      buildPlanningRealitySizeBudgetSummary({
        artifact,
        sizeBytes: 30,
        thresholdBytes: 100,
        operatorDebug: true,
      }),
    ).toContain("artifact budget status: operator_debug");
  });

  it("leaves existing planningReality diagnostics unchanged", () => {
    const before = JSON.stringify(artifact);

    buildPlanningRealitySizeBudgetSummary({
      artifact,
      sizeBytes: 110,
      thresholdBytes: 100,
    });

    expect(JSON.stringify(artifact)).toBe(before);
  });
});

describe("buildPlanningRealitySummary", () => {
  it("prints the compact top-down mesocycle plan summary when present", () => {
    const summary = buildPlanningRealitySummary({
      artifact: {
        mesocycleExplain: {
          preview: {
            projectionDiagnostics: {
              planningReality: {
                label: "weekly demand / slot allocation diagnostics",
                readOnly: true,
                affectsScoringOrGeneration: false,
                summary: {
                  planningShape: "mostly_repair_shaped",
                  explicitWeeklyDemandMuscles: 0,
                  inferredDemandMuscles: 0,
                  slotsWithExplicitWeeklyDemand: 0,
                  slotsWithOnlyLocalOrInferredSemantics: 0,
                  materialRepairCount: 20,
                  majorRepairCount: 10,
                  highExerciseConcentrationCount: 0,
                  warningCodes: [],
                },
                topDownMesocyclePlan: {
                  version: 1,
                  source: "first_principles_target_spec",
                  targetSpecPath:
                    "docs/10_HYPERTROPHY_MESOCYCLE_ENGINE_TARGET_SPEC.md",
                  readOnly: true,
                  affectsScoringOrGeneration: false,
                  planStatus: "blocked_by_repair_shape",
                  targetFlow: ["MesocycleDemand", "Runtime"],
                  slotTargets: [],
                  targetAcceptanceChecks: [],
                  summary: {
                    matchedTargetLanes: 8,
                    partialTargetLanes: 10,
                    missingTargetLanes: 3,
                    repairShapedTargetLanes: 5,
                    blockedMigrationCandidates: 4,
                    readyMigrationCandidates: 0,
                  },
                  migrationReadiness: [
                    {
                      candidate: "chest_upper_distinct_class_distribution",
                      readiness: "blocked_by_repair_materiality",
                      reason: "repair materiality gate failed",
                      evidenceRefs: ["material:20"],
                      gateMetricsRequired: [
                        "materialRepairCount_non_increasing",
                      ],
                    },
                    {
                      candidate: "calf_duplicate_distribution",
                      readiness: "blocked_by_feasibility",
                      reason: "single calf variant cannot satisfy floor",
                      evidenceRefs: [
                        "cleanupCandidateFeasibility.recommendation:do_not_trial_behavior",
                      ],
                      gateMetricsRequired: ["calf_floor_preserved"],
                    },
                  ],
                },
              },
            },
          },
        },
      },
    });

    expect(summary).toEqual(
      expect.arrayContaining([
        "Top-Down Mesocycle Plan",
        "Status: blocked_by_repair_shape",
        "Matched lanes: 8",
        "- chest_upper_distinct_class_distribution: blocked_by_repair_materiality",
        "- calf_duplicate_distribution: blocked_by_feasibility",
      ]),
    );
  });

  it("prints a compact deterministic planningReality readout from mesocycle-explain", () => {
    const summary = buildPlanningRealitySummary({
      artifact: {
        mesocycleExplain: {
          preview: {
            projectionDiagnostics: {
              preselectionDemands: [
                {
                  slotId: "upper_b",
                  muscle: "Side Delts",
                  role: "support",
                  targetStatus: "soft",
                  preferredEffectiveSets: 2,
                  minEffectiveSets: 2,
                  source: "authored_slot_support",
                  selectedEffectiveSets: 2,
                  consumedBySelection: true,
                  targetMet: true,
                },
              ],
              planningReality: {
                label: "weekly demand / slot allocation diagnostics",
                readOnly: true,
                affectsScoringOrGeneration: false,
                summary: {
                  planningShape: "mostly_repair_shaped",
                  explicitWeeklyDemandMuscles: 4,
                  inferredDemandMuscles: 3,
                  slotsWithExplicitWeeklyDemand: 2,
                  slotsWithOnlyLocalOrInferredSemantics: 1,
                  materialRepairCount: 29,
                  majorRepairCount: 20,
                  highExerciseConcentrationCount: 1,
                  warningCodes: [
                    "REPAIR_ADDED_EXERCISE_IDENTITY",
                    "EXERCISE_CONCENTRATION_HIGH",
                  ],
                },
                weeklyMuscleDemand: [
                  {
                    muscle: "Chest",
                    targetTier: "A_PRIMARY",
                    targetKind: "hard",
                    targetStatus: "hard",
                    targetRange: null,
                    preferredTarget: 10,
                    mev: 8,
                    mav: 16,
                    explicitUpstream: true,
                    inferredDownstream: false,
                    source: [],
                  },
                  {
                    muscle: "Lats",
                    targetTier: "A_PRIMARY",
                    targetKind: "hard",
                    targetStatus: "hard",
                    targetRange: null,
                    preferredTarget: 10,
                    mev: 8,
                    mav: 16,
                    explicitUpstream: true,
                    inferredDownstream: false,
                    source: [],
                  },
                  {
                    muscle: "Side Delts",
                    targetTier: "B_SUPPORT",
                    targetKind: "soft",
                    targetStatus: "soft",
                    targetRange: null,
                    preferredTarget: 8,
                    mev: 6,
                    mav: 16,
                    explicitUpstream: false,
                    inferredDownstream: true,
                    source: [],
                  },
                ],
                slotDemandAllocation: [
                  {
                    slotId: "upper_a",
                    slotLabel: "upper_a",
                    slotProfile: {
                      slotArchetype: "upper_horizontal_balanced",
                      continuityScope: "slot",
                      requiredMovementPatterns: [],
                      preferredPrimaryMuscles: [],
                      preferredSupportMuscles: [],
                      protectedCoverageMuscles: [],
                    },
                    slotIndex: 0,
                    intent: "UPPER",
                    authoredSlotRole: null,
                    expectedMuscleObligations: [
                      {
                        muscle: "Chest",
                        source: "weekly_obligation",
                        targetStatus: "hard",
                        explicitUpstream: true,
                        minEffectiveSets: 4,
                        priority: "primary",
                      },
                    ],
                    projectedEffectiveStimulusByMuscle: { Chest: 4 },
                    meaningfullyServedMuscles: ["Chest"],
                    allocationBasis: "explicit_weekly_demand",
                    satisfiesKnownWeeklyDemand: true,
                  },
                  {
                    slotId: "upper_b",
                    slotLabel: "upper_b",
                    slotProfile: {
                      slotArchetype: "upper_vertical_balanced",
                      continuityScope: "slot",
                      requiredMovementPatterns: [],
                      preferredPrimaryMuscles: [],
                      preferredSupportMuscles: [],
                      protectedCoverageMuscles: [],
                    },
                    slotIndex: 2,
                    intent: "UPPER",
                    authoredSlotRole: null,
                    expectedMuscleObligations: [
                      {
                        muscle: "Lats",
                        source: "weekly_obligation",
                        targetStatus: "hard",
                        explicitUpstream: true,
                        minEffectiveSets: 4,
                        priority: "primary",
                      },
                    ],
                    projectedEffectiveStimulusByMuscle: { Lats: 2 },
                    meaningfullyServedMuscles: [],
                    allocationBasis: "explicit_weekly_demand",
                    satisfiesKnownWeeklyDemand: false,
                  },
                ],
                shadowWeeklyDemand: [],
                shadowSlotDemandAllocation: [],
                initialSlotComposition: [],
                finalSlotPlan: [],
                allocationVsInitialDelta: [],
                allocationVsFinalDelta: [
                  {
                    slotId: "upper_b",
                    slotIndex: 2,
                    comparison: "allocation_vs_final",
                    responsibilityLoad: "clear",
                    underAllocatedMuscles: [
                      {
                        muscle: "Lats",
                        role: "primary",
                        targetStatus: "hard",
                        expectedEffectiveSets: 4,
                        actualEffectiveSets: 2,
                        shortfall: 2,
                      },
                    ],
                    unallocatedStimulusMuscles: [],
                    notes: [],
                  },
                ],
                projectedDelivery: [],
                repairMaterialityAfterShadowAllocation: [
                  {
                    repairMechanism: "support_floor:added",
                    materiality: "major",
                    muscle: "Side Delts",
                    slotId: "upper_b",
                    exerciseId: "lat-raise",
                    exerciseName: "Cable Lateral Raise",
                    action: "added",
                    effectiveStimulusAdded: 3,
                    effectiveStimulusDelta: 3,
                    rawSetsAdded: 3,
                    rawSetDelta: 3,
                    changedExerciseIdentity: true,
                    changedSlotShapeMaterially: true,
                    behaviorClass: "program_shaping",
                    source: "protected_coverage_support_floor",
                    rationale: "support-floor repair",
                    likelyAvoidableWithShadowAllocation: true,
                    shadowAllocationBasis: "slot_owned_muscle_before_selection",
                    shadowRationale: [
                      "shadow_slot_allocation:support:soft",
                      "repair likely represents demand that should move upstream before exercise selection",
                    ],
                  },
                  {
                    repairMechanism: "support_floor:added",
                    materiality: "major",
                    muscle: "Chest",
                    slotId: "lower_b",
                    exerciseId: "cable-crossover",
                    exerciseName: "Cable Crossover",
                    action: "added",
                    effectiveStimulusAdded: 3,
                    effectiveStimulusDelta: 3,
                    rawSetsAdded: 3,
                    rawSetDelta: 3,
                    changedExerciseIdentity: true,
                    changedSlotShapeMaterially: true,
                    behaviorClass: "program_shaping",
                    source: "protected_coverage_support_floor",
                    rationale: "support-floor repair",
                    likelyAvoidableWithShadowAllocation: false,
                    shadowAllocationBasis: "weekly_demand_owned_elsewhere",
                    shadowRationale: [
                      "shadow_weekly_demand:primary:hard",
                      "repair remains cap cleanup, unowned stimulus, or unresolved by current shadow allocation",
                    ],
                  },
                  {
                    repairMechanism: "program_quality:set_trimmed",
                    materiality: "moderate",
                    muscle: "Quads",
                    slotId: "lower_a",
                    exerciseId: "squat",
                    exerciseName: "Barbell Back Squat",
                    action: "set_trimmed",
                    effectiveStimulusAdded: 0,
                    effectiveStimulusDelta: -1,
                    rawSetsAdded: 0,
                    rawSetDelta: -1,
                    changedExerciseIdentity: false,
                    changedSlotShapeMaterially: true,
                    behaviorClass: "program_shaping",
                    source: "program_quality",
                    rationale: "set cap cleanup",
                    likelyAvoidableWithShadowAllocation: false,
                    shadowAllocationBasis: "diagnostic_or_cap_cleanup",
                    shadowRationale: [
                      "repair remains cap cleanup, unowned stimulus, or unresolved by current shadow allocation",
                    ],
                  },
                ],
                shadowRepairSummary: {
                  materialRepairCount: 29,
                  majorRepairCount: 20,
                  likelyAvoidableMaterialRepairCount: 1,
                  remainingMaterialRepairCount: 28,
                  likelyAvoidableMajorRepairCount: 1,
                  remainingMajorRepairCount: 19,
                  likelyAvoidableByMuscle: { "Side Delts": 1 },
                  remainingByMuscle: { Chest: 1, Quads: 1 },
                },
                suspiciousRepairsNotEligibleForPromotion: [
                  {
                    slotId: "lower_b",
                    muscle: "Chest",
                    exerciseName: "Cable Crossover",
                    repairMechanism: "support_floor:added",
                    reason:
                      "shadow allocation marks this muscle as weekly_demand_owned_elsewhere",
                    recommendation: "Do not promote this repair upstream.",
                  },
                ],
                promotionCandidates: [
                  {
                    slotId: "upper_b",
                    muscle: "Side Delts",
                    role: "support",
                    targetStatus: "soft",
                    evidence: ["shadow_slot_allocation:support:soft"],
                    suggestedPromotion: "selection_scoring_hint",
                  },
                ],
                repairMateriality: [
                  {
                    repairMechanism: "support_floor:added",
                    materiality: "major",
                    muscle: "Side Delts",
                    slotId: "upper_b",
                    exerciseId: "lat-raise",
                    exerciseName: "Cable Lateral Raise",
                    action: "added",
                    effectiveStimulusAdded: 3,
                    effectiveStimulusDelta: 3,
                    rawSetsAdded: 3,
                    rawSetDelta: 3,
                    changedExerciseIdentity: true,
                    changedSlotShapeMaterially: true,
                    behaviorClass: "program_shaping",
                    source: "protected_coverage_support_floor",
                    rationale: "support-floor repair",
                  },
                ],
                exerciseConcentration: [
                  {
                    slotId: "lower_a",
                    intent: "LOWER",
                    exerciseId: "squat",
                    exerciseName: "Barbell Back Squat",
                    setCount: 6,
                    role: "main",
                    isCompound: true,
                    primaryMuscles: ["Quads"],
                    effectiveStimulusContributionByMuscle: { Quads: 6 },
                    percentageOfWeeklyProjectedStimulusByMuscle: { Quads: 60 },
                    producedOrIncreasedByRepair: false,
                    flags: [
                      "COMPOUND_GT_5_SETS",
                      "EXERCISE_SUPPLIES_OVER_60_PERCENT_WEEKLY_STIMULUS",
                    ],
                  },
                ],
                warnings: [
                  {
                    code: "EXERCISE_CONCENTRATION_HIGH",
                    severity: "warning",
                    message: "One exercise supplies a high share.",
                    evidence: ["lower_a:Barbell Back Squat"],
                  },
                  {
                    code: "REPAIR_ADDED_EXERCISE_IDENTITY",
                    severity: "warning",
                    message: "Repair added exercise identity.",
                    evidence: ["upper_b:Cable Lateral Raise"],
                  },
                ],
                limitations: [],
              },
            },
          },
        },
      },
      outputPath: "C:\\artifacts\\audits\\mesocycle-explain.json",
    });

    expect(summary).toEqual([
      "Planning Reality Summary",
      "------------------------",
      "Artifact: C:\\artifacts\\audits\\mesocycle-explain.json",
      "Planning shape: mostly_repair_shaped",
      "",
      "Architecture Signal:",
      "- planningShape: mostly_repair_shaped",
      "- materialRepairCount: 29",
      "- majorRepairCount: 20",
      "- likelyUpstreamAvoidableMaterialRepairs: 1",
      "- remainingMaterialRepairs: 28",
      "- suspiciousRepairsNotEligibleForPromotion: 1",
      "- promotionCandidates: upper_b Side Delts -> selection_scoring_hint",
      "- highest-leverage next move: Suspicious downstream repairs block promotion. Resolve ownership smells first, then promote only bounded slot-owned demand.",
      "",
      "Demand:",
      "- Explicit upstream muscles: Chest, Lats",
      "- Inferred downstream muscles: Side Delts",
      "",
      "Repair:",
      "- Material repairs: 29",
      "- Major repairs: 20",
      "- Added exercise identities:",
      "  - upper_b: Cable Lateral Raise",
      "",
      "Shadow Repair Summary",
      "---------------------",
      "Material repairs: 29",
      "Major repairs: 20",
      "Likely upstream-avoidable: 1",
      "Remaining: 28",
      "Likely upstream-avoidable major: 1",
      "Remaining major: 19",
      "",
      "Likely avoidable by muscle:",
      "- Side Delts: 1",
      "",
      "Remaining by muscle:",
      "- Chest: 1",
      "- Quads: 1",
      "",
      "Remaining repair/cap cleanup:",
      "- lower_a Quads via Barbell Back Squat",
      "",
      "Suspicious repairs not eligible for promotion:",
      "- lower_b: Chest via Cable Crossover",
      "",
      "Promotion candidates:",
      "- upper_b: Side Delts (support, soft) -> selection_scoring_hint",
      "",
      "Pre-selection demand consumed:",
      "- upper_b: Side Delts (support, soft, authored_slot_support) selected 2 effective sets; consumed=yes targetMet=yes",
      "",
      "Warnings:",
      "- EXERCISE_CONCENTRATION_HIGH: lower_a:Barbell Back Squat",
      "- REPAIR_ADDED_EXERCISE_IDENTITY: upper_b:Cable Lateral Raise",
      "",
      "Exercise concentration:",
      "- lower_a Barbell Back Squat: 6 sets (COMPOUND_GT_5_SETS,EXERCISE_SUPPLIES_OVER_60_PERCENT_WEEKLY_STIMULUS)",
      "",
      "Slot allocation:",
      "- upper_a: explicit demand satisfied",
      "- upper_b: explicit demand not fully satisfied locally",
      "",
      "Architecture implication:",
      "Suspicious downstream repairs block promotion. Resolve ownership smells first, then promote only bounded slot-owned demand.",
    ]);
  });

  it("prints the Rear Delts collateral verdict when planningReality includes it", () => {
    const summary = buildPlanningRealitySummary({
      artifact: {
        mesocycleExplain: {
          preview: {
            projectionDiagnostics: {
              planningReality: {
                summary: {
                  planningShape: "mixed_upstream_plus_repair_shaped",
                  explicitWeeklyDemandMuscles: 0,
                  inferredDemandMuscles: 0,
                  slotsWithExplicitWeeklyDemand: 0,
                  slotsWithOnlyLocalOrInferredSemantics: 0,
                  materialRepairCount: 26,
                  majorRepairCount: 18,
                  highExerciseConcentrationCount: 0,
                  warningCodes: [],
                },
                weeklyMuscleDemand: [],
                repairMateriality: [],
                warnings: [],
                exerciseConcentration: [],
                slotDemandAllocation: [],
                allocationVsFinalDelta: [],
                repairMaterialityAfterShadowAllocation: [],
                shadowRepairSummary: {
                  materialRepairCount: 26,
                  majorRepairCount: 18,
                  likelyAvoidableMaterialRepairCount: 11,
                  remainingMaterialRepairCount: 15,
                  likelyAvoidableMajorRepairCount: 0,
                  remainingMajorRepairCount: 18,
                  likelyAvoidableByMuscle: {},
                  remainingByMuscle: {},
                },
                suspiciousRepairsNotEligibleForPromotion: [],
                promotionCandidates: [],
                rearDeltCollateralSummary: {
                  directRearDeltStimulusBefore: 0,
                  directRearDeltStimulusAfter: 2,
                  rearDeltPreselectionConsumed: true,
                  upperBackCollateralDelta: 2,
                  pullPatternConcentrationDelta: 1,
                  suspiciousRepairDelta: 1,
                  capTrimOrRemovalDelta: 0,
                  verdict: "worse_collateral",
                  reasons: [
                    "REAR_DELT_COLLATERAL_UPPER_BACK_INCREASE",
                    "REAR_DELT_PRESELECTION_CONSUMED_BUT_PROGRAM_WORSE",
                    "consumed_preselection_demand_alone_is_not_success",
                  ],
                },
              },
            },
          },
        },
      },
    });

    expect(summary).toEqual(
      expect.arrayContaining([
        "Rear Delts collateral guard:",
        "- verdict: worse_collateral",
        "- directRearDeltStimulus: 0 -> 2",
        "- rearDeltPreselectionConsumed: yes",
        "- upperBackCollateralDelta: 2",
        "- pullPatternConcentrationDelta: 1",
        "- suspiciousRepairDelta: 1",
        "- capTrimOrRemovalDelta: 0",
        "- reasons: consumed_preselection_demand_alone_is_not_success, REAR_DELT_COLLATERAL_UPPER_BACK_INCREASE, REAR_DELT_PRESELECTION_CONSUMED_BUT_PROGRAM_WORSE",
      ]),
    );
  });

  it("prints weak pre-selection consumption when consumed demand misses target", () => {
    const summary = buildPlanningRealitySummary({
      artifact: {
        mesocycleExplain: {
          preview: {
            projectionDiagnostics: {
              planningReality: {
                summary: {
                  planningShape: "mostly_repair_shaped",
                  explicitWeeklyDemandMuscles: 4,
                  inferredDemandMuscles: 3,
                  slotsWithExplicitWeeklyDemand: 2,
                  slotsWithOnlyLocalOrInferredSemantics: 1,
                  materialRepairCount: 22,
                  majorRepairCount: 14,
                  highExerciseConcentrationCount: 4,
                  warningCodes: [],
                },
                weakPreselectionConsumption: [
                  {
                    slotId: "upper_b",
                    muscle: "Triceps",
                    role: "support",
                    targetStatus: "soft",
                    selectedEffectiveSets: 0.9,
                    preferredEffectiveSets: 5,
                    minEffectiveSets: 5,
                    consumedBySelection: true,
                    targetMet: false,
                    reason: "consumed_but_target_not_met",
                  },
                ],
              },
            },
          },
        },
      },
    });

    expect(summary).toEqual(
      expect.arrayContaining([
        "Weak pre-selection consumption:",
        "- upper_b: Triceps selected 0.9 / target 5, targetMet=no",
      ]),
    );
  });

  it("prints clean preselection feasibility when planningReality includes it", () => {
    const summary = buildPlanningRealitySummary({
      artifact: {
        mesocycleExplain: {
          preview: {
            projectionDiagnostics: {
              planningReality: {
                summary: {
                  planningShape: "mostly_repair_shaped",
                  explicitWeeklyDemandMuscles: 4,
                  inferredDemandMuscles: 3,
                  slotsWithExplicitWeeklyDemand: 2,
                  slotsWithOnlyLocalOrInferredSemantics: 1,
                  materialRepairCount: 22,
                  majorRepairCount: 14,
                  highExerciseConcentrationCount: 4,
                  warningCodes: [],
                },
                preselectionFeasibility: [
                  {
                    slotId: "lower_b",
                    muscle: "Hamstrings",
                    role: "primary",
                    targetStatus: "hard",
                    demandType: "direct_required",
                    candidateStatus: "dirty_candidate",
                    targetEffectiveSets: 4,
                    currentInitialEffectiveSets: 0,
                    currentFinalEffectiveSets: 4,
                    shortfallBeforeRepair: 4,
                    preferredCleanPath: [
                      {
                        exerciseClass: "knee_flexion_curl",
                        available: false,
                        evidence: [],
                      },
                      {
                        exerciseClass: "hinge_compound",
                        available: false,
                        evidence: [],
                      },
                      {
                        exerciseClass: "existing_anchor_plus_curl",
                        available: false,
                        evidence: [],
                      },
                    ],
                    dirtyClosureSignals: [
                      {
                        signal: "back_extension_closure",
                        evidence: [
                          "lower_b:Back Extension (45 Degree):weekly_obligation_closure:added",
                        ],
                      },
                      {
                        signal: "glute_collateral",
                        evidence: ["collateralEstimate:Glutes:+2"],
                      },
                    ],
                    collateralEstimate: {
                      glutesDelta: 2,
                      lowerBackDelta: 2,
                    },
                    candidateInventory: [
                      {
                        exerciseId: "lying-leg-curl",
                        exerciseName: "Lying Leg Curl",
                        candidateClass: "knee_flexion_curl",
                        primaryMuscles: ["Hamstrings"],
                        secondaryMuscles: [],
                        movementPatterns: ["flexion"],
                        hamstringsStimulusPerSet: 1,
                        glutesStimulusPerSet: null,
                        lowerBackStimulusPerSet: null,
                        lowerSlotCompatible: true,
                        lowerBCompatible: true,
                        alreadySelectedInWeek: true,
                        alreadySelectedSlotIds: ["lower_a"],
                        selectedInLowerBInitial: false,
                        selectedInLowerBFinal: false,
                        availability: "available_but_already_used_elsewhere",
                        reasons: [
                          "classification_mismatch:movementPatterns_flexion_not_in_allowedPatterns_hinge+isolation_but_class_knee_flexion_curl_is_allowed",
                        ],
                      },
                      {
                        exerciseId: "nordic-hamstring-curl",
                        exerciseName: "Nordic Hamstring Curl",
                        candidateClass: "knee_flexion_curl",
                        primaryMuscles: ["Hamstrings"],
                        secondaryMuscles: ["Glutes"],
                        movementPatterns: ["flexion"],
                        hamstringsStimulusPerSet: 1,
                        glutesStimulusPerSet: 0.2,
                        lowerBackStimulusPerSet: null,
                        lowerSlotCompatible: true,
                        lowerBCompatible: true,
                        alreadySelectedInWeek: false,
                        alreadySelectedSlotIds: [],
                        selectedInLowerBInitial: false,
                        selectedInLowerBFinal: false,
                        availability: "clean_available",
                        reasons: [
                          "classification_mismatch:movementPatterns_flexion_not_in_allowedPatterns_hinge+isolation_but_class_knee_flexion_curl_is_allowed",
                        ],
                      },
                      {
                        exerciseId: "back-extension-45",
                        exerciseName: "Back Extension (45 Degree)",
                        candidateClass: "dirty_extension",
                        primaryMuscles: ["Glutes", "Hamstrings", "Lower Back"],
                        secondaryMuscles: [],
                        movementPatterns: ["extension"],
                        hamstringsStimulusPerSet: 0.5,
                        glutesStimulusPerSet: 0.7,
                        lowerBackStimulusPerSet: 0.9,
                        lowerSlotCompatible: true,
                        lowerBCompatible: false,
                        alreadySelectedInWeek: true,
                        alreadySelectedSlotIds: ["lower_b"],
                        selectedInLowerBInitial: false,
                        selectedInLowerBFinal: true,
                        availability: "dirty_not_clean_candidate",
                        reasons: [
                          "not_clean_closure:extension_collateral_sensitive",
                        ],
                      },
                    ],
                    recommendation: "do_not_promote_yet",
                    reasons: [
                      "candidate_scope:lower_b_Hamstrings",
                      "dirty_signal:back_extension_closure",
                    ],
                    readOnly: true,
                    affectsScoringOrGeneration: false,
                  },
                ],
              },
            },
          },
        },
      },
    });

    expect(summary).toEqual(
      expect.arrayContaining([
        "Clean Preselection Feasibility",
        "--------------------------------",
        "lower_b Hamstrings: do_not_promote_yet (dirty_candidate)",
        "Reason: back_extension_closure, glute_collateral.",
        "Preferred clean path: none proven.",
        "Collateral estimate: Glutes +2.0, Lower Back +2.0.",
        "Candidate inventory:",
        "- Lying Leg Curl: knee_flexion_curl, available_but_already_used_elsewhere, lower_b=yes, already selected in lower_a",
        "- Nordic Hamstring Curl: knee_flexion_curl, clean_available, lower_b=yes, not selected",
        "- Back Extension (45 Degree): dirty_extension, dirty_not_clean_candidate, lower_b=no, already selected in lower_b",
      ]),
    );
  });

  it("prints cleanup candidate feasibility with blocking math when planningReality includes it", () => {
    const summary = buildPlanningRealitySummary({
      artifact: {
        mesocycleExplain: {
          preview: {
            projectionDiagnostics: {
              planningReality: {
                summary: {
                  planningShape: "mostly_repair_shaped",
                  explicitWeeklyDemandMuscles: 4,
                  inferredDemandMuscles: 3,
                  slotsWithExplicitWeeklyDemand: 2,
                  slotsWithOnlyLocalOrInferredSemantics: 1,
                  materialRepairCount: 22,
                  majorRepairCount: 14,
                  highExerciseConcentrationCount: 4,
                  warningCodes: [],
                },
                cleanupCandidateFeasibility: [
                  {
                    candidate: "lower_b_calf_duplicate_cleanup",
                    slotId: "lower_b",
                    muscle: "Calves",
                    currentShape: [
                      {
                        exerciseName: "Seated Calf Raise",
                        setCount: 3,
                        effectiveSets: 3,
                        exerciseClass: "seated_calf_raise",
                      },
                      {
                        exerciseName: "Leg Press Calf Raise",
                        setCount: 3,
                        effectiveSets: 3,
                        exerciseClass: "calf_raise",
                      },
                    ],
                    proposedCleanerShape: [
                      {
                        exerciseName: "Seated Calf Raise",
                        proposedSetCount: 4,
                        projectedEffectiveSets: 4,
                        reason:
                          "needs_6_sets_to_preserve_Calves_floor_but_maxSetsPerExercise_is_4",
                      },
                    ],
                    target: {
                      minEffectiveSets: 8,
                      preferredEffectiveSets: 8,
                      targetStatus: "soft",
                    },
                    caps: {
                      maxSetsPerExercise: 4,
                      maxDirectExercises: 1,
                      maxTotalSlotSets: 24,
                    },
                    feasibility: "not_feasible_under_current_caps",
                    blockingReasons: [
                      "single_exercise_cannot_meet_floor",
                      "would_exceed_set_cap",
                      "would_reduce_below_support_floor",
                    ],
                    recommendation: "do_not_trial_behavior",
                    readOnly: true,
                    affectsScoringOrGeneration: false,
                  },
                ],
              },
            },
          },
        },
      },
    });

    expect(summary).toEqual(
      expect.arrayContaining([
        "Cleanup Candidate Feasibility",
        "-----------------------------",
        "lower_b Calves duplicate cleanup: not feasible",
        "Current: Seated Calf Raise 3 + Leg Press Calf Raise 3 = 6 lower_b Calves effective sets (6 raw sets).",
        "Target floor: 8 (soft).",
        "Caps: maxSetsPerExercise=4, maxDirectExercises=1, maxTotalSlotSets=24.",
        "Proposed cleaner shape: Seated Calf Raise 4 sets -> 4 effective.",
        "Blocking: single_exercise_cannot_meet_floor, would_exceed_set_cap, would_reduce_below_support_floor.",
        "Recommendation: do_not_trial_behavior.",
      ]),
    );
  });

  it("prints compact set distribution intent evidence when present", () => {
    const summary = buildPlanningRealitySummary({
      artifact: {
        mesocycleExplain: {
          preview: {
            projectionDiagnostics: {
              planningReality: {
                summary: {
                  planningShape: "mostly_repair_shaped",
                  explicitWeeklyDemandMuscles: 4,
                  inferredDemandMuscles: 3,
                  slotsWithExplicitWeeklyDemand: 2,
                  slotsWithOnlyLocalOrInferredSemantics: 1,
                  materialRepairCount: 22,
                  majorRepairCount: 14,
                  highExerciseConcentrationCount: 4,
                  warningCodes: [],
                },
                setDistributionIntents: [
                  {
                    version: 1,
                    slotId: "upper_b",
                    slotIndex: 2,
                    intent: "upper",
                    slotArchetype: "upper_vertical_balanced",
                    musclePolicies: [
                      {
                        muscle: "Chest",
                        role: "primary",
                        targetStatus: "hard",
                        demandType: "direct_required",
                        preferredEffectiveSets: 5,
                        minEffectiveSets: 5,
                        maxEffectiveSets: 16,
                        maxSingleExerciseShare: 0.5,
                        maxSinglePatternShare: 0.7,
                        maxSetsPerExercise: 5,
                        maxDirectExercises: 2,
                        maxDuplicateExerciseClasses: 1,
                        preferredDistribution: "two_exercise_split",
                        whenAtLimit: "prefer_alternative",
                      },
                      {
                        muscle: "Upper Back",
                        role: "collateral",
                        targetStatus: "diagnostic",
                        demandType: "diagnostic_only",
                        preferredEffectiveSets: null,
                        minEffectiveSets: null,
                        maxEffectiveSets: null,
                        maxSingleExerciseShare: null,
                        maxSinglePatternShare: null,
                        maxSetsPerExercise: null,
                        maxDirectExercises: null,
                        maxDuplicateExerciseClasses: null,
                        preferredDistribution: "diagnostic_only",
                        whenAtLimit: "leave_unresolved",
                      },
                    ],
                    slotBudget: {
                      preferredTotalSets: 18,
                      maxTotalSets: 25,
                      maxMainLifts: 2,
                      maxAccessories: 5,
                      maxDirectIsolationExercises: 2,
                    },
                    evidence: {
                      concentrationRows: [
                        "upper_b:Incline DB Bench:Chest:57.1%",
                      ],
                      capCleanupRows: ["upper_b:Cable Pullover:-2"],
                      repairRowsStillRepairOwned: [
                        "upper_b:Cable Pullover:Lats:diagnostic_or_cap_cleanup",
                      ],
                    },
                    readOnly: true,
                    affectsScoringOrGeneration: false,
                  },
                ],
                distributionGuardActions: [
                  {
                    slotId: "upper_b",
                    exerciseName: "Incline DB Bench",
                    muscle: "Chest",
                    attemptedAction: "set_bump",
                    decision: "left_unresolved",
                    reason: "single_exercise_share_limit",
                  },
                ],
              },
            },
          },
        },
      },
    });

    expect(summary).toEqual(
      expect.arrayContaining([
        "Set Distribution Intent",
        "-----------------------",
        "High concentration:",
        "- upper_b:Incline DB Bench:Chest:57.1%",
        "Cap cleanup:",
        "- upper_b:Cable Pullover:-2",
        "Distribution guard actions:",
        "- upper_b:Incline DB Bench:Chest:left_unresolved",
        "Likely next policy:",
        "- avoid set-bumping concentrated exercises",
        "- leave collateral or no-clean-path demand unresolved",
        "- prefer clean alternative before cap cleanup",
      ]),
    );
  });

  it("prints compact preselection distribution policy limitations when present", () => {
    const summary = buildPlanningRealitySummary({
      artifact: {
        mesocycleExplain: {
          preview: {
            projectionDiagnostics: {
              planningReality: {
                summary: {
                  planningShape: "mostly_repair_shaped",
                  explicitWeeklyDemandMuscles: 4,
                  inferredDemandMuscles: 3,
                  slotsWithExplicitWeeklyDemand: 2,
                  slotsWithOnlyLocalOrInferredSemantics: 1,
                  materialRepairCount: 20,
                  majorRepairCount: 10,
                  highExerciseConcentrationCount: 4,
                  warningCodes: [],
                },
                preselectionDistributionPolicyByWeek: {
                  mesocycleId: "meso-1",
                  source: "diagnostic_shadow_planner",
                  readOnly: true,
                  affectsScoringOrGeneration: false,
                  limitations: [
                    "weeks_2_to_4_unprojected",
                    "missing_weekly_demand_curve",
                    "missing_accumulation_progression_policy",
                    "deload_distribution_not_projected",
                  ],
                  limitationCatalog: {
                    L1: "week_1_evidence_only",
                    L2: "diagnostic_shadow_policy_not_behavior",
                  },
                  evidenceCatalog: {
                    E1: "upper_a:Chest:hard:direct_required",
                  },
                  affectsCatalog: {
                    A1: {
                      volumeProgression: true,
                      exerciseContinuity: true,
                      setDistribution: true,
                      fatigueManagement: false,
                      deloadPreservation: true,
                      runtimeAdaptation: false,
                    },
                  },
                  weeks: [
                    {
                      week: 1,
                      phase: "accumulation",
                      projectionStatus: "projected_from_current_week_evidence",
                      weekScope: "week_1_only",
                      slots: [
                        {
                          slotId: "upper_a",
                          slotArchetype: "upper_horizontal_balanced",
                          muscleDistributions: [],
                        },
                      ],
                      weekLevelWarnings: [],
                    },
                    {
                      week: 2,
                      phase: "accumulation",
                      projectionStatus:
                        "not_projected_missing_weekly_demand_curve",
                      weekScope: "accumulation_weeks",
                      slots: [],
                      weekLevelWarnings: ["weeks_2_to_4_unprojected"],
                    },
                    {
                      week: 3,
                      phase: "accumulation",
                      projectionStatus:
                        "not_projected_missing_accumulation_policy",
                      weekScope: "accumulation_weeks",
                      slots: [],
                      weekLevelWarnings: [
                        "missing_accumulation_progression_policy",
                      ],
                    },
                    {
                      week: 4,
                      phase: "accumulation",
                      projectionStatus:
                        "not_projected_missing_accumulation_policy",
                      weekScope: "accumulation_weeks",
                      slots: [],
                      weekLevelWarnings: ["missing_per_week_slot_distribution"],
                    },
                    {
                      week: 5,
                      phase: "deload",
                      projectionStatus: "not_projected_missing_deload_policy",
                      weekScope: "deload_week",
                      slots: [],
                      weekLevelWarnings: ["deload_distribution_not_projected"],
                    },
                  ],
                  candidateBehaviorSlices: [
                    {
                      candidate:
                        "chest_upper_slot_distinct_exercise_distribution",
                      weekScope: "accumulation_weeks",
                      expectedBenefit:
                        "Chest is the safest future behavior once week projection exists.",
                      risk: "Blocked from behavior now because no week-by-week projection exists.",
                      prereqs: ["week-by-week Chest demand"],
                      recommendation: "best_future_behavior",
                    },
                  ],
                  recommendedNextStep: "add_weekly_demand_curve_diagnostic",
                },
              },
            },
          },
        },
      },
    });

    expect(summary).toEqual(
      expect.arrayContaining([
        "Preselection Distribution Policy",
        "--------------------------------",
        "Week 1: projected from current evidence",
        "Weeks 2-4: not projected - missing weekly demand curve / accumulation policy",
        "Deload: not projected - missing deload preservation policy",
        "Best future behavior: Chest upper-slot distinct exercise distribution",
        "Blocked from behavior now: no week-by-week projection yet",
      ]),
    );
  });

  it("prints compact weekly demand curve risks when present", () => {
    const summary = buildPlanningRealitySummary({
      artifact: {
        mesocycleExplain: {
          preview: {
            projectionDiagnostics: {
              planningReality: {
                summary: {
                  planningShape: "mostly_repair_shaped",
                  explicitWeeklyDemandMuscles: 4,
                  inferredDemandMuscles: 3,
                  slotsWithExplicitWeeklyDemand: 2,
                  slotsWithOnlyLocalOrInferredSemantics: 1,
                  materialRepairCount: 20,
                  majorRepairCount: 10,
                  highExerciseConcentrationCount: 4,
                  warningCodes: [],
                },
                weeklyDemandCurve: {
                  mesocycleId: "meso-1",
                  source: "diagnostic_shadow_planner",
                  readOnly: true,
                  affectsScoringOrGeneration: false,
                  designBasis: {
                    durationWeeks: 5,
                    intensityBias: "HYPERTROPHY",
                    focus: "Strength-Hypertrophy",
                    volumeTarget: "MODERATE",
                    splitType: "UPPER_LOWER",
                    sessionsPerWeek: 4,
                  },
                  sourceCatalog: {},
                  limitationCatalog: {},
                  muscleCatalog: {},
                  weeks: [
                    {
                      week: 1,
                      phase: "entry",
                      projectionStatus: "partially_projected_from_week_1",
                      muscles: [],
                      weekLevelLimitations: [],
                    },
                    {
                      week: 2,
                      phase: "accumulation",
                      projectionStatus: "partially_projected_from_week_1",
                      muscles: [],
                      weekLevelLimitations: [
                        "missing_per_week_slot_distribution",
                      ],
                    },
                    {
                      week: 3,
                      phase: "accumulation",
                      projectionStatus: "partially_projected_from_week_1",
                      muscles: [],
                      weekLevelLimitations: ["missing_fatigue_carryover_model"],
                    },
                    {
                      week: 4,
                      phase: "peak",
                      projectionStatus: "partially_projected_from_week_1",
                      muscles: [],
                      weekLevelLimitations: [
                        "missing_cross_week_exercise_continuity_policy",
                      ],
                    },
                    {
                      week: 5,
                      phase: "deload",
                      projectionStatus: "not_projected_missing_policy",
                      muscles: [],
                      weekLevelLimitations: ["missing_deload_demand_curve"],
                    },
                  ],
                  crossWeekWarnings: [
                    {
                      code: "PRIMARY_UNDER_TARGET_ACROSS_ACCUMULATION",
                      muscle: "Chest",
                      evidence: ["week1_final=7:preferred=10"],
                      severity: "warning",
                    },
                    {
                      code: "MUSCLE_OVERDELIVERED_ACROSS_ACCUMULATION",
                      muscle: "Hamstrings",
                      evidence: ["week1_final=8:preferred=6"],
                      severity: "warning",
                    },
                    {
                      code: "SUPPORT_UNDER_TARGET_ACROSS_ACCUMULATION",
                      muscle: "Side Delts",
                      evidence: ["week1_final=1:preferred=2"],
                      severity: "warning",
                    },
                  ],
                  candidateBehaviorGate: {
                    status: "blocked_until_weekly_curve_is_visible",
                    likelyBestFutureBehavior:
                      "chest_upper_slot_distinct_exercise_distribution",
                    requiredQuestions: [
                      "would_this_improve_weeks_1_to_4_not_just_week_1",
                      "would_this_preserve_deload_quality",
                      "would_this_increase_fatigue_concentration",
                    ],
                    evidence: [
                      "behavior_must_remain_blocked_until_weekly_curve_answers_cross_week_questions",
                    ],
                  },
                },
              },
            },
          },
        },
      },
    });

    expect(summary).toEqual(
      expect.arrayContaining([
        "Weekly Demand Curve",
        "-------------------",
        "Week 1: projected from current evidence",
        "Weeks 2-4: limited / missing accumulation policy",
        "Week 5 deload: limited / missing deload demand projection",
        "Risks:",
        "- Chest below preferred target across accumulation",
        "- Hamstrings overdelivered if repeated",
        "- Side Delts below preferred support target",
        "Candidate gate: Chest upper-slot distinct exercise distribution blocked until weekly curve answers cross-week questions",
      ]),
    );
  });

  it("prints compact slot demand allocation by week limitations when present", () => {
    const summary = buildPlanningRealitySummary({
      artifact: {
        mesocycleExplain: {
          preview: {
            projectionDiagnostics: {
              planningReality: {
                summary: {
                  planningShape: "mostly_repair_shaped",
                  explicitWeeklyDemandMuscles: 4,
                  inferredDemandMuscles: 3,
                  slotsWithExplicitWeeklyDemand: 2,
                  slotsWithOnlyLocalOrInferredSemantics: 1,
                  materialRepairCount: 20,
                  majorRepairCount: 10,
                  highExerciseConcentrationCount: 4,
                  warningCodes: [],
                },
                slotDemandAllocationByWeek: {
                  mesocycleId: "meso-1",
                  source: "diagnostic_shadow_planner",
                  readOnly: true,
                  affectsScoringOrGeneration: false,
                  weeks: [
                    {
                      week: 1,
                      phase: "entry",
                      projectionStatus: "allocated_from_current_week_evidence",
                      slots: [
                        {
                          slotId: "upper_a",
                          slotIndex: 0,
                          slotArchetype: "upper_horizontal_balanced",
                          intent: "upper",
                          allocatedMuscles: [
                            {
                              muscle: "Chest",
                              role: "primary",
                              targetStatus: "hard",
                              minEffectiveSets: 5,
                              preferredEffectiveSets: 5,
                              maxEffectiveSets: 16,
                              weekScope: "week_1_only",
                              allocationConfidence: "high",
                              allocationReason: [],
                              limitations: ["week_1_under_preferred_target"],
                            },
                          ],
                          slotLevelWarnings: [],
                        },
                        {
                          slotId: "lower_b",
                          slotIndex: 3,
                          slotArchetype: "lower_hinge_dominant",
                          intent: "lower",
                          allocatedMuscles: [
                            {
                              muscle: "Hamstrings",
                              role: "primary",
                              targetStatus: "hard",
                              minEffectiveSets: 6,
                              preferredEffectiveSets: 6,
                              maxEffectiveSets: 14,
                              weekScope: "week_1_only",
                              allocationConfidence: "high",
                              allocationReason: [],
                              limitations: ["week_1_over_preferred_target"],
                            },
                          ],
                          slotLevelWarnings: [],
                        },
                        {
                          slotId: "upper_b",
                          slotIndex: 2,
                          slotArchetype: "upper_vertical_balanced",
                          intent: "upper",
                          allocatedMuscles: [
                            {
                              muscle: "Side Delts",
                              role: "support",
                              targetStatus: "soft",
                              minEffectiveSets: 2,
                              preferredEffectiveSets: 2,
                              maxEffectiveSets: 16,
                              weekScope: "week_1_only",
                              allocationConfidence: "medium",
                              allocationReason: [],
                              limitations: ["week_1_under_preferred_target"],
                            },
                          ],
                          slotLevelWarnings: [],
                        },
                      ],
                      weekLevelWarnings: [
                        "week_1_current_projection_evidence_only",
                      ],
                    },
                    {
                      week: 2,
                      phase: "accumulation",
                      projectionStatus:
                        "not_allocated_missing_weekly_projection",
                      slots: [],
                      weekLevelWarnings: ["missing_per_week_slot_composition"],
                    },
                    {
                      week: 3,
                      phase: "accumulation",
                      projectionStatus:
                        "not_allocated_missing_weekly_projection",
                      slots: [],
                      weekLevelWarnings: ["missing_fatigue_carryover_model"],
                    },
                    {
                      week: 4,
                      phase: "peak",
                      projectionStatus:
                        "not_allocated_missing_weekly_projection",
                      slots: [],
                      weekLevelWarnings: [
                        "missing_weekly_exercise_identity_policy",
                      ],
                    },
                    {
                      week: 5,
                      phase: "deload",
                      projectionStatus: "not_allocated_missing_deload_policy",
                      slots: [],
                      weekLevelWarnings: ["deload_slot_allocation_unprojected"],
                    },
                  ],
                  crossWeekAllocationWarnings: [],
                },
              },
            },
          },
        },
      },
    });

    expect(summary).toEqual(
      expect.arrayContaining([
        "Slot Demand Allocation By Week",
        "------------------------------",
        "Week 1: allocated from current evidence",
        "Weeks 2-4: not allocated - missing weekly projection",
        "Deload: not allocated - missing deload policy",
        "Key Week 1 ownership gaps:",
        "- Chest owned by upper_a but under-delivered",
        "- Hamstrings owned by lower_b but over-delivered",
        "- Side Delts support gap remains in upper_b",
      ]),
    );
  });

  it("prints compact accumulation week projection risks when present", () => {
    const summary = buildPlanningRealitySummary({
      artifact: {
        mesocycleExplain: {
          preview: {
            projectionDiagnostics: {
              planningReality: {
                summary: {
                  planningShape: "mostly_repair_shaped",
                  explicitWeeklyDemandMuscles: 4,
                  inferredDemandMuscles: 3,
                  slotsWithExplicitWeeklyDemand: 2,
                  slotsWithOnlyLocalOrInferredSemantics: 1,
                  materialRepairCount: 20,
                  majorRepairCount: 10,
                  highExerciseConcentrationCount: 4,
                  warningCodes: [],
                },
                accumulationWeekProjection: {
                  mesocycleId: "meso-1",
                  source: "diagnostic_shadow_planner",
                  readOnly: true,
                  affectsScoringOrGeneration: false,
                  projectionBasis: {
                    sourceWeek: 1,
                    method: "repeat_week_1_final_shape",
                    limitations: ["does_not_apply_true_progression_policy"],
                  },
                  weeks: [],
                  crossWeekWarnings: [
                    {
                      code: "CHEST_UNDER_TARGET_ACROSS_ACCUMULATION",
                      muscle: "Chest",
                      evidence: ["week1_final=7:preferred=10"],
                      severity: "warning",
                    },
                    {
                      code: "HAMSTRINGS_OVERDELIVERED_ACROSS_ACCUMULATION",
                      muscle: "Hamstrings",
                      evidence: ["week1_final=8:preferred=6"],
                      severity: "warning",
                    },
                    {
                      code: "SIDE_DELTS_UNDER_TARGET_ACROSS_ACCUMULATION",
                      muscle: "Side Delts",
                      evidence: ["week1_final=1:preferred=8"],
                      severity: "warning",
                    },
                    {
                      code: "DUPLICATE_MAIN_LIFT_REUSE_ACROSS_ACCUMULATION",
                      evidence: ["duplicate:Incline DB Bench"],
                      severity: "warning",
                    },
                    {
                      code: "COLLATERAL_FATIGUE_RISK_ACROSS_ACCUMULATION",
                      evidence: ["Front Delts"],
                      severity: "info",
                    },
                  ],
                  candidateBehaviorReadiness: [
                    {
                      candidate:
                        "chest_upper_slot_distinct_exercise_distribution",
                      readiness: "ready_for_bounded_trial",
                      reason: "Chest remains below its preferred target.",
                      requiredGuardrails: [],
                    },
                  ],
                },
              },
            },
          },
        },
      },
    });

    expect(summary).toEqual(
      expect.arrayContaining([
        "Accumulation Week Projection",
        "----------------------------",
        "Basis: repeat Week 1 final shape / limited",
        "Risks:",
        "- Chest below preferred target across accumulation",
        "- Hamstrings overdelivered across accumulation",
        "- Side Delts below preferred support target across accumulation",
        "- Duplicate main-lift reuse",
        "- Collateral fatigue risk",
        "Best bounded candidate: Chest upper-slot distinct exercise distribution",
      ]),
    );
  });

  it("prints exercise-class distribution intent when planningReality includes it", () => {
    const baseDemand = {
      role: "primary" as const,
      targetStatus: "hard" as const,
      demandType: "direct_required" as const,
      desiredEffectiveSets: 4,
      minEffectiveSets: 3,
      maxEffectiveSets: null,
      requiredExerciseClasses: [],
      forbiddenExerciseClasses: [],
      preferredMovementPatterns: [],
      forbiddenMovementPatterns: [],
      duplicatePolicy: "discourage_if_alternative_exists" as const,
      duplicateJustifications: [],
      unresolvedBehavior: "repair_safety_net" as const,
      collateralLimits: [],
      inventoryEvidence: [],
      repairEvidence: [],
      limitations: [],
    };
    const summary = buildPlanningRealitySummary({
      artifact: {
        mesocycleExplain: {
          preview: {
            projectionDiagnostics: {
              planningReality: {
                summary: {
                  planningShape: "mostly_repair_shaped",
                  explicitWeeklyDemandMuscles: 4,
                  inferredDemandMuscles: 3,
                  slotsWithExplicitWeeklyDemand: 2,
                  slotsWithOnlyLocalOrInferredSemantics: 1,
                  materialRepairCount: 20,
                  majorRepairCount: 10,
                  highExerciseConcentrationCount: 4,
                  warningCodes: [],
                },
                exerciseClassDistributionBySlot: [
                  {
                    version: 1,
                    source: "diagnostic_shadow_planner",
                    mesocycleId: "meso-1",
                    week: 1,
                    phase: "accumulation",
                    projectionStatus: "projected_from_current_evidence",
                    slotId: "upper_b",
                    slotIndex: 1,
                    slotArchetype: "upper_horizontal_balanced",
                    intent: "upper",
                    readOnly: true,
                    affectsScoringOrGeneration: false,
                    muscleDemands: [
                      {
                        ...baseDemand,
                        muscle: "Chest",
                        preferredExerciseClasses: ["press", "machine_press"],
                        requiredExerciseClasses: ["press"],
                        preferredSetSplit: "two_distinct_exercises",
                        duplicatePolicy: "block_if_clean_alternative_exists",
                        inventoryEvidence: ["duplicate:Incline DB Bench"],
                        limitations: [
                          "duplicate_exercise_class_reuse_requires_explicit_justification",
                        ],
                      },
                      {
                        ...baseDemand,
                        muscle: "Side Delts",
                        role: "support",
                        targetStatus: "soft",
                        demandType: "soft_direct_allowed",
                        preferredExerciseClasses: ["lateral_raise"],
                        preferredSetSplit: "overlap_first_then_isolation",
                        unresolvedBehavior: "leave_unresolved",
                        limitations: ["avoid_ohp_overconcentration"],
                      },
                    ],
                  },
                  {
                    version: 1,
                    source: "diagnostic_shadow_planner",
                    mesocycleId: "meso-1",
                    week: 1,
                    phase: "accumulation",
                    projectionStatus: "projected_from_current_evidence",
                    slotId: "lower_b",
                    slotIndex: 3,
                    slotArchetype: "lower_hinge_dominant",
                    intent: "lower",
                    readOnly: true,
                    affectsScoringOrGeneration: false,
                    muscleDemands: [
                      {
                        ...baseDemand,
                        muscle: "Hamstrings",
                        preferredExerciseClasses: [
                          "hinge_compound",
                          "knee_flexion_curl",
                        ],
                        requiredExerciseClasses: [
                          "hinge_compound",
                          "knee_flexion_curl",
                        ],
                        forbiddenExerciseClasses: ["back_extension"],
                        preferredMovementPatterns: ["hinge", "knee_flexion"],
                        forbiddenMovementPatterns: ["extension"],
                        preferredSetSplit: "anchor_plus_isolation",
                        duplicatePolicy: "block_if_clean_alternative_exists",
                        inventoryEvidence: ["duplicate:SLDL"],
                        limitations: [
                          "back_extension_is_not_clean_hamstrings_closure",
                        ],
                      },
                      {
                        ...baseDemand,
                        muscle: "Calves",
                        role: "support",
                        targetStatus: "soft",
                        demandType: "soft_direct_allowed",
                        preferredExerciseClasses: ["calf_raise"],
                        forbiddenExerciseClasses: [
                          "same_session_duplicate_calf_isolation",
                        ],
                        preferredSetSplit: "overlap_first_then_isolation",
                        unresolvedBehavior: "leave_unresolved",
                        limitations: [
                          "avoid_same_session_duplicate_calf_variants",
                        ],
                      },
                    ],
                  },
                ],
                exerciseClassUnresolvedCauses: [
                  {
                    slotId: "upper_b",
                    muscle: "Chest",
                    targetStatus: "hard",
                    demandType: "direct_required",
                    initialAlignment: "missing",
                    finalAlignment: "partial",
                    owningCause: "duplicate_continuity_conflict",
                    recommendedOwner: "duplicate_continuity_policy",
                    behaviorReadiness: "needs_duplicate_policy",
                    evidence: ["duplicate:Incline DB Bench"],
                    limitations: [
                      "diagnostic_read_only_no_generation_scoring_repair_seed_or_runtime_effect",
                    ],
                  },
                  {
                    slotId: "lower_b",
                    muscle: "Calves",
                    targetStatus: "soft",
                    demandType: "soft_direct_allowed",
                    initialAlignment: "satisfied",
                    finalAlignment: "satisfied",
                    owningCause: "duplicate_continuity_conflict",
                    recommendedOwner: "duplicate_continuity_policy",
                    behaviorReadiness: "needs_duplicate_policy",
                    evidence: [
                      "same_session_duplicate_class:Calves:calf_raise",
                    ],
                    limitations: [
                      "diagnostic_read_only_no_generation_scoring_repair_seed_or_runtime_effect",
                    ],
                  },
                ],
                duplicateContinuityJustification: {
                  version: 1,
                  source: "diagnostic_shadow_planner",
                  readOnly: true,
                  affectsScoringOrGeneration: false,
                  duplicates: [
                    {
                      exerciseId: "incline-db-bench",
                      exerciseName: "Incline DB Bench",
                      duplicatedInSlots: ["upper_a", "upper_b"],
                      roleBySlot: { upper_a: "main", upper_b: "main" },
                      setCountBySlot: { upper_a: 3, upper_b: 3 },
                      primaryMuscles: ["Chest"],
                      movementPatterns: ["horizontal_push"],
                      exerciseClass: "incline_press",
                      duplicateType: "same_exercise_cross_slot",
                      justification: "continuity_anchor",
                      compatibleAlternativeExists: true,
                      compatibleAlternatives: [
                        {
                          exerciseName: "Machine Chest Press",
                          exerciseClass: "machine_press",
                          primaryMuscles: ["Chest"],
                          reasonAvailableOrBlocked: [
                            "distinct_class_available",
                          ],
                        },
                      ],
                      policyRecommendation: "block_if_clean_alternative_exists",
                      risk: "high",
                      evidence: [
                        "Chest:duplicate_policy=block_if_clean_alternative_exists",
                      ],
                      limitations: [
                        "diagnostic_read_only_no_generation_scoring_repair_seed_or_runtime_effect",
                      ],
                    },
                    {
                      exerciseId: "lat-pulldown",
                      exerciseName: "Lat Pulldown",
                      duplicatedInSlots: ["upper_a", "upper_b"],
                      roleBySlot: {
                        upper_a: "accessory",
                        upper_b: "accessory",
                      },
                      setCountBySlot: { upper_a: 3, upper_b: 3 },
                      primaryMuscles: ["Lats"],
                      movementPatterns: ["vertical_pull"],
                      exerciseClass: "vertical_pull",
                      duplicateType: "same_exercise_cross_slot",
                      justification: "unjustified",
                      compatibleAlternativeExists: true,
                      compatibleAlternatives: [],
                      policyRecommendation: "discourage_duplicate",
                      risk: "moderate",
                      evidence: [
                        "Lats:duplicate_policy=block_if_clean_alternative_exists",
                      ],
                      limitations: [
                        "diagnostic_read_only_no_generation_scoring_repair_seed_or_runtime_effect",
                      ],
                    },
                    {
                      exerciseId: "sldl",
                      exerciseName: "SLDL",
                      duplicatedInSlots: ["lower_a", "lower_b"],
                      roleBySlot: { lower_a: "main", lower_b: "main" },
                      setCountBySlot: { lower_a: 3, lower_b: 3 },
                      primaryMuscles: ["Hamstrings"],
                      movementPatterns: ["hinge"],
                      exerciseClass: "stiff_leg_deadlift",
                      duplicateType: "same_exercise_cross_slot",
                      justification: "exact_demand_fit",
                      compatibleAlternativeExists: true,
                      compatibleAlternatives: [],
                      policyRecommendation: "requires_planner_decision",
                      risk: "moderate",
                      evidence: ["Hamstrings:final=9:preferred=6"],
                      limitations: [
                        "diagnostic_read_only_no_generation_scoring_repair_seed_or_runtime_effect",
                      ],
                    },
                    {
                      exerciseId: "standing-calf-raise+seated-calf-raise",
                      exerciseName: "Standing Calf Raise + Seated Calf Raise",
                      duplicatedInSlots: ["lower_b"],
                      roleBySlot: { lower_b: "accessory" },
                      setCountBySlot: { lower_b: 4 },
                      primaryMuscles: ["Calves"],
                      movementPatterns: ["isolation"],
                      exerciseClass: "calf_raise",
                      duplicateType: "same_session_variant",
                      justification: "unjustified",
                      compatibleAlternativeExists: false,
                      compatibleAlternatives: [],
                      policyRecommendation: "discourage_duplicate",
                      risk: "low",
                      evidence: ["duplicate_type:same_session_variant"],
                      limitations: [
                        "diagnostic_read_only_no_generation_scoring_repair_seed_or_runtime_effect",
                      ],
                    },
                  ],
                  summary: {
                    totalDuplicates: 4,
                    justifiedDuplicates: 2,
                    unjustifiedOrUnknown: 2,
                    cleanAlternativeAvailable: 3,
                    highRiskDuplicates: 1,
                  },
                },
                exerciseClassAlignment: {
                  version: 1,
                  source: "diagnostic_shadow_planner",
                  readOnly: true,
                  affectsScoringOrGeneration: false,
                  slots: [
                    {
                      slotId: "upper_b",
                      slotIndex: 1,
                      slotArchetype: "upper_horizontal_balanced",
                      slotWarnings: ["duplicate:Incline DB Bench"],
                      muscleAlignments: [
                        {
                          muscle: "Chest",
                          targetStatus: "hard",
                          demandType: "direct_required",
                          intendedClasses: ["press"],
                          forbiddenClasses: [],
                          initialSelectedClasses: [],
                          finalSelectedClasses: [
                            {
                              exerciseName: "Incline DB Bench",
                              exerciseClass: "incline_press",
                              setCount: 3,
                              effectiveSets: 3,
                              producedOrIncreasedByRepair: false,
                            },
                          ],
                          initialAlignment: "missing",
                          finalAlignment: "partial",
                          repairEffect: "improved_alignment",
                          evidence: [
                            "final:Incline DB Bench:incline_press:3 sets",
                          ],
                          limitations: [],
                        },
                      ],
                    },
                    {
                      slotId: "lower_b",
                      slotIndex: 3,
                      slotArchetype: "lower_hinge_dominant",
                      slotWarnings: [
                        "same_session_duplicate_class:Calves:calf_raise",
                      ],
                      muscleAlignments: [
                        {
                          muscle: "Hamstrings",
                          targetStatus: "hard",
                          demandType: "direct_required",
                          intendedClasses: [
                            "hinge_compound",
                            "knee_flexion_curl",
                          ],
                          forbiddenClasses: ["back_extension"],
                          initialSelectedClasses: [],
                          finalSelectedClasses: [],
                          initialAlignment: "partial",
                          finalAlignment: "satisfied",
                          repairEffect: "improved_alignment",
                          evidence: [],
                          limitations: [],
                        },
                        {
                          muscle: "Calves",
                          targetStatus: "soft",
                          demandType: "soft_direct_allowed",
                          intendedClasses: ["calf_raise"],
                          forbiddenClasses: [
                            "same_session_duplicate_calf_isolation",
                          ],
                          initialSelectedClasses: [],
                          finalSelectedClasses: [],
                          initialAlignment: "satisfied",
                          finalAlignment: "satisfied",
                          repairEffect: "unchanged",
                          evidence: [
                            "same_session_duplicate_class:Calves:calf_raise",
                          ],
                          limitations: [],
                        },
                      ],
                    },
                  ],
                  summary: {
                    initiallySatisfied: 1,
                    finallySatisfied: 2,
                    improvedByRepair: 2,
                    worsenedByRepair: 0,
                    identityChurnCount: 1,
                    unresolvedClassIntentCount: 1,
                  },
                },
              },
            },
          },
        },
      },
    });

    expect(summary).toEqual(
      expect.arrayContaining([
        "Exercise Class Distribution",
        "---------------------------",
        "- Chest: upper slots need distinct class intent; duplicate Incline requires justification",
        "- Hamstrings lower_b: hinge anchor + knee-flexion curl; Back Extension not clean closure",
        "- Side Delts: lateral raise / vertical press overlap, avoid OHP concentration",
        "- Calves: one isolation per lower slot; avoid same-session duplicate variants",
        "- Duplicates: Incline DB Bench, Lat Pulldown, SLDL, Back Squat require justification",
        "Exercise Class Alignment",
        "------------------------",
        "Initial satisfied: 1",
        "Final satisfied: 2",
        "Improved by repair: 2",
        "Identity churn: 1",
        "Unresolved class intents: 1",
        "- Chest: duplicate Incline / distinct class unresolved",
        "- lower_b Hamstrings: hinge + curl satisfied",
        "- Calves: duplicate isolation class warning",
        "Exercise Class Unresolved Causes",
        "--------------------------------",
        "selection blind spots: 0",
        "duplicate/continuity conflicts: 2",
        "support-floor late repairs: 0",
        "repair identity churn: 0",
        "diagnostic-only: 0",
        "- Chest: duplicate continuity conflict",
        "- lower_b Hamstrings: class satisfied; duplicate risk separate",
        "- Calves: duplicate isolation policy",
        "Duplicate / Continuity Justification",
        "------------------------------------",
        "Total duplicates: 4",
        "Unknown/unjustified: 2",
        "Clean alternatives visible: 3",
        "High risk: 1",
        "- Incline DB Bench: duplicate, Chest hard primary, clean alternative visible",
        "- Lat Pulldown: duplicate, Lats adequate, discourage",
        "- SLDL: duplicate, Hamstrings high, planner decision needed",
        "- Calves: same-session variant, discourage unless specialization",
      ]),
    );
  });

  it("returns null when mesocycle-explain does not include planningReality", () => {
    expect(
      buildPlanningRealitySummary({
        artifact: {
          mesocycleExplain: {
            preview: {
              projectionDiagnostics: {},
            },
          },
        },
      }),
    ).toBeNull();
  });
});

describe("buildPlannerOnlyDryRunSummary", () => {
  it("prints a compact planner-only dry-run comparison verdict", () => {
    const summary = buildPlannerOnlyDryRunSummary({
      artifact: {
        mesocycleExplain: {
          plannerOnlyDryRun: {
            enabled: true,
            compareRepaired: true,
            readOnly: true,
            affectsScoringOrGeneration: false,
            canReplaceRepairedProjection: false,
            summary: {
              status: "fail",
              acceptancePassed: 9,
              acceptanceFailed: 4,
              unresolvedDemandCount: 2,
              disabledRepairDependencyCount: 3,
            },
            slotComparisons: [
              {
                slotId: "upper_a",
                repairedExercises: ["Incline Dumbbell Press (5 sets)"],
                plannerOnlyExercises: ["Incline Dumbbell Press (6 sets)"],
                laneStatus: "failed",
                unresolvedDemand: [
                  "repair_would_be_needed_here:Chest:shortfall_4",
                ],
                duplicateViolations: [],
                setDistributionViolations: [
                  "Incline Dumbbell Press:set_count_gt_5:6",
                ],
              },
            ],
            weeklyMuscleComparison: [],
            acceptanceChecks: [
              {
                check: "materialRepairCount = 0 for basic shape",
                status: "fail",
                evidence: ["materialRepairCount:1"],
              },
            ],
            repairDependencies: [
              {
                path: "support-floor closure",
                wouldHaveActed: true,
                consequenceWithoutRepair:
                  "repair_would_be_needed_here:1_support_rows",
                plannerOwnerRequired: "Support demand planner",
              },
            ],
            calvesFourFourCandidate: {
              status: "blocked",
              readOnly: true,
              affectsScoringOrGeneration: false,
              lowerAProjectedCalfSets: 4,
              lowerBProjectedCalfSets: 4,
              weeklyProjectedCalfEffectiveSets: 8,
              currentLowerAShape: [
                {
                  exerciseName: "Standing Calf Raise",
                  sets: 2,
                  effectiveCalfSets: 2,
                },
              ],
              currentLowerBShape: [
                {
                  exerciseName: "Seated Calf Raise",
                  sets: 4,
                  effectiveCalfSets: 4,
                },
                {
                  exerciseName: "Leg Press Calf Raise",
                  sets: 4,
                  effectiveCalfSets: 4,
                },
              ],
              proposedLowerAShape: [
                {
                  exerciseClass: "calf_raise",
                  proposedSets: 4,
                  reason: "lower_a_four_set_direct_calf_allocation_candidate",
                },
              ],
              proposedLowerBShape: [
                {
                  exerciseClass: "calf_raise",
                  proposedSets: 4,
                  reason: "lower_b_single_calf_identity_four_set_candidate",
                },
              ],
              wouldRemoveLowerBSameSessionCalfDuplicate: true,
              wouldReduceSupportFloorClosureRows: true,
              wouldReduceSetBumps: false,
              wouldIncreaseCapTrimRows: false,
              wouldChangeMaterialRepairCount: "unknown",
              wouldChangeMajorRepairCount: "unknown",
              wouldChangeSuspiciousRepairCount: "unknown",
              preservesLowerBHingeCurlRoute: true,
              lowerASafety: {
                status: "pass",
                currentTotalSets: 2,
                projectedTotalSets: 4,
                slotSetCap: 25,
                wouldExceedSlotCap: false,
                wouldDisplaceHardPrimary: false,
                affectedExercises: ["Standing Calf Raise"],
                evidence: [
                  "lower_a_current_total_sets:2",
                  "lower_a_projected_total_sets:4",
                ],
              },
              materialityEstimate: {
                status: "partial",
                expectedMaterialRepairDelta: null,
                expectedMajorRepairDelta: null,
                expectedSuspiciousRepairDelta: null,
                wouldReduceSupportFloorClosureRows: true,
                wouldReduceSetBumps: false,
                wouldIncreaseCapTrimRows: false,
                removableRows: [
                  {
                    category: "support_floor_closure",
                    slotId: "lower_a",
                    muscle: "Calves",
                    exerciseName: "Standing Calf Raise",
                    reason: "support floor closure",
                  },
                  {
                    category: "duplicate_variant",
                    slotId: "lower_b",
                    muscle: "Calves",
                    exerciseName: "Leg Press Calf Raise + Seated Calf Raise",
                    reason:
                      "lower_b_single_calf_identity_four_set_candidate_removes_same_session_variant_duplicate",
                  },
                ],
                potentialNewRows: [],
                stillUnknown: [
                  "exact_repair_reclassification_requires_full_generation",
                ],
                evidence: [
                  "current_materialRepairCount:2",
                  "exact_repair_counter_delta_unknown_without_reprojection",
                ],
              },
              policyReadiness: {
                behaviorReadiness: "needs_more_projection",
                remainingBlockers: [
                  "materiality_delta_unknown",
                  "weeks_2_to_4_unprojected",
                ],
              },
              blockedReasons: [
                "materiality_delta_unknown",
                "weeks_2_to_4_unprojected",
              ],
              recommendation: "needs_more_projection",
            },
          },
        },
      },
    });

    expect(summary).toEqual([
      "Planner-Only Dry Run",
      "--------------------",
      "Planner-only dry run: fail",
      "Current repaired projection: pass",
      "Can replace repaired projection today: no",
      "Acceptance: passed=9 failed=4",
      "Unresolved demand count: 2",
      "Disabled repair dependency count: 3",
      "",
      "Failed acceptance checks:",
      "- materialRepairCount = 0 for basic shape: materialRepairCount:1",
      "",
      "Top unresolved demand:",
      "- upper_a: repair_would_be_needed_here:Chest:shortfall_4",
      "",
      "Repair dependencies still required:",
      "- support-floor closure: repair_would_be_needed_here:1_support_rows",
      "",
      "Calves 4+4 Candidate",
      "--------------------",
      "Status: blocked",
      "Lower A projected calf sets: 4",
      "Lower B projected calf sets: 4",
      "Weekly projected calf sets: 8",
      "Would remove lower_b duplicate: yes",
      "Lower A safety: pass",
      "Materiality estimate: partial",
      "Expected deltas: material unknown, major unknown, suspicious unknown",
      "Recommendation: needs_more_projection",
      "Remaining blockers: materiality_delta_unknown, weeks_2_to_4_unprojected",
    ]);
  });
});

describe("buildPlannerOnlyNoRepairSummary", () => {
  it("prints a compact planner-only no-repair verdict", () => {
    const plannerPolicy = buildV2PlannerMesocyclePolicy();
    const summary = buildPlannerOnlyNoRepairSummary({
      artifact: {
        mesocycleExplain: {
          plannerOnlyNoRepair: {
            enabled: true,
            readOnly: true,
            affectsScoringOrGeneration: false,
            canReplaceRepairedProjection: false,
            summary: {
              status: "fail",
              targetLanesSatisfied: 4,
              targetLanesMissing: 2,
              unresolvedDemandCount: 1,
              validationFailureCount: 1,
            },
            acceptanceClassification: {
              basicMesocycleShapeStatus: "fail",
              replacementReadinessStatus: "blocked",
              hardBlockers: [
                {
                  code: "primary_hard_target_below_minimum",
                  evidence: ["Chest:below_min_10"],
                },
              ],
              qualityWarnings: [
                {
                  code: "support_direct_isolation_concentrated_but_clean_and_near_or_at_target",
                  evidence: [
                    "upper_a:Cable Rear Delt Fly:Rear Delts:64.5%:support_direct_isolation_concentrated_but_clean_and_near_or_at_target",
                  ],
                },
              ],
              diagnosticOnly: [
                {
                  code: "secondary_or_implicit_collateral_not_acceptance_target",
                  evidence: [
                    "upper_b:Machine Shoulder Press:Front Delts:70%:secondary_or_implicit_collateral_not_acceptance_target",
                  ],
                },
              ],
              sessionShaping: [
                {
                  code: "planner_owned_set_allocation_changes",
                  evidence: ["upper_a:chest_secondary:Cable Crossover:2->3"],
                },
              ],
              migrationScoreboard: {
                materialRepairCount: 1,
                majorRepairCount: 0,
                suspiciousRepairs: 0,
                canReplaceRepairedProjection: false,
                reason: "hard_blockers:1",
              },
            },
            crossWeekProjectionGate: {
              readOnly: true,
              affectsScoringOrGeneration: false,
              week1Status: {
                status: "fail",
                basis: ["basicMesocycleShapeStatus:fail"],
              },
              accumulationWeeksStatus: {
                status: "projected_with_limitations",
                weeks: [
                  {
                    week: 2,
                    phase: "accumulation",
                    volumeMultiplier: 1,
                    rirTarget: "2-3",
                    projectionBasis: "planner_owned_read_only_projection",
                    limitations: [
                      "planner_owned_week_projection_exists_but_is_diagnostic_only",
                    ],
                    safeForBehaviorPromotion: false,
                  },
                  {
                    week: 3,
                    phase: "hard_accumulation",
                    volumeMultiplier: 1.075,
                    rirTarget: "1-2",
                    projectionBasis: "planner_owned_read_only_projection",
                    limitations: [
                      "planner_owned_week_projection_exists_but_is_diagnostic_only",
                    ],
                    safeForBehaviorPromotion: false,
                  },
                  {
                    week: 4,
                    phase: "peak_overreach_lite",
                    volumeMultiplier: 1.125,
                    rirTarget: "0-1",
                    projectionBasis: "planner_owned_read_only_projection",
                    limitations: [
                      "planner_owned_week_projection_exists_but_is_diagnostic_only",
                    ],
                    safeForBehaviorPromotion: false,
                  },
                ],
              },
              deloadStatus: {
                status: "diagnostic_projection_only",
                projectionBasis: "v2_deload_transform_read_only",
                preserveIdentities: true,
                targetVolumeReductionPercent: { min: 40, max: 60 },
                targetRir: "4-5",
                limitations: ["runtime_replay_consumption_path_missing"],
                safeForBehaviorPromotion: false,
              },
              replacementReadinessStatus: "not_ready",
              blockers: ["hard_blockers:1"],
              warnings: ["planner_owned_weeks_2_to_4_projection_is_read_only"],
              missingInputs: [],
              projectedWeekSummaries: [
                {
                  week: 1,
                  phase: "entry_calibration",
                  volumeMultiplier: 0.875,
                  totalPlannedSets: 4,
                  projectionBasis: "week_1_no_repair_shape",
                  limitations: ["week_1_no_repair_shape_only"],
                },
              ],
              deloadSummary: {
                targetVolumeReductionPercent: { min: 40, max: 60 },
                preserveExerciseIdentities: true,
                introducesNewMovements: false,
                projectionBasis: "v2_deload_transform_read_only",
                limitations: ["runtime_replay_consumption_path_missing"],
              },
              safeToPromoteBehavior: false,
            },
            v2MesocycleStrategyDiagnostic:
              plannerPolicy.mesocycleStrategyDiagnostic,
            strategyToDemandProjection:
              plannerPolicy.strategyToDemandProjection,
            v2MesocyclePlan: {
              version: 1,
              source: "v2_planner_no_repair_experimental",
              readOnly: true,
              affectsScoringOrGeneration: false,
              planStatus: "experimental",
              skeleton: {
                split: "upper_lower_4x",
                weeks: 5,
                slotSequence: ["upper_a", "lower_a", "upper_b", "lower_b"],
                slots: [
                  {
                    slotId: "upper_a",
                    intent: "horizontal push/pull + rear delt/triceps support",
                    targetSessionSets: { min: 15, max: 20 },
                    lanes: [
                      {
                        laneId: "chest_anchor",
                        required: true,
                        role: "anchor",
                        primaryMuscles: ["Chest"],
                        preferredExerciseClasses: ["horizontal_press"],
                        targetSets: { min: 3, preferred: 4, max: 4 },
                        currentWeek1Status: "missing",
                      },
                    ],
                  },
                ],
              },
              weeklyProgressionModel: {
                weeks: [
                  {
                    week: 1,
                    phase: "entry_calibration",
                    volumeMultiplier: 0.875,
                    rirTarget: "3-4",
                    progressionIntent: "establish_anchors",
                    limitations: ["week_1_uses_flagged_no_repair_evidence"],
                  },
                  {
                    week: 2,
                    phase: "accumulation",
                    volumeMultiplier: 1,
                    rirTarget: "2-3",
                    progressionIntent: "productive_volume",
                    limitations: [
                      "derived_from_stable_skeleton_not_independent_plan",
                    ],
                  },
                  {
                    week: 3,
                    phase: "hard_accumulation",
                    volumeMultiplier: 1.075,
                    rirTarget: "1-2",
                    progressionIntent: "push_stimulus",
                    limitations: [
                      "derived_from_stable_skeleton_not_independent_plan",
                    ],
                  },
                  {
                    week: 4,
                    phase: "peak_overreach_lite",
                    volumeMultiplier: 1.125,
                    rirTarget: "0-1 isolations; 1-2 compounds",
                    progressionIntent: "peak_effort",
                    limitations: [
                      "derived_from_stable_skeleton_not_independent_plan",
                    ],
                  },
                  {
                    week: 5,
                    phase: "deload",
                    volumeMultiplier: 0.5,
                    rirTarget: "4-5",
                    progressionIntent: "reduce_fatigue",
                    limitations: [
                      "deload_transform_defined_not_production_projected",
                    ],
                  },
                ],
              },
              deloadTransform: {
                preserveExerciseIdentities: true,
                targetVolumeReductionPercent: { min: 40, max: 60 },
                targetRir: "4-5",
                removeRedundantAccessories: true,
                introduceNewMovements: false,
                projectionStatus: "partially_modeled",
                limitations: ["not_used_by_runtime_replay"],
              },
              validationRules: [
                {
                  ruleId: "primary_muscles_above_minimum",
                  severity: "hard_blocker",
                  description:
                    "Primary hard-target muscles must meet Week 1 minimums.",
                  week1Status: "fail",
                  fullMesocycleStatus: "limited",
                },
              ],
              replacementReadiness: {
                canReplaceRepairedProjection: false,
                reason: ["hard_blockers:1"],
              },
            },
            v2TargetVsNoRepairDiff: {
              version: 1,
              source: "v2_planner_no_repair_experimental",
              readOnly: true,
              affectsScoringOrGeneration: false,
              summary: {
                targetLaneCount: 2,
                satisfiedLaneCount: 1,
                partialLaneCount: 0,
                missingLaneCount: 0,
                blockedLaneCount: 0,
                repairDependentLaneCount: 1,
                migrationCandidateCount: 1,
                suspiciousOrBlockedCount: 0,
              },
              slotDiffs: [],
              replacementReadinessImpact: {
                canReplaceRepairedProjection: false,
                blockers: ["hard_blockers:1"],
                nextBestMigrationSlice:
                  "chest_secondary:promote_to_planner_later",
              },
            },
            v2SetDistributionIntent: {
              version: 1,
              source: "v2_planner_policy",
              readOnly: true,
              affectsScoringOrGeneration: false,
              summary: {
                weekCount: 1,
                slotCount: 1,
                laneCount: 1,
                plannedTotalSetsByWeek: [
                  {
                    week: 1,
                    totalSets: 4,
                    volumeMultiplier: 1,
                    phase: "entry_calibration",
                  },
                ],
              },
              weeks: [
                {
                  week: 1,
                  phase: "entry_calibration",
                  volumeMultiplier: 1,
                  rirTarget: "3-4",
                  slots: [
                    {
                      slotId: "upper_a",
                      slotIntent:
                        "horizontal push/pull + rear delt/triceps support",
                      targetSessionSets: { min: 3, preferred: 4, max: 4 },
                      lanes: [
                        {
                          laneId: "chest_anchor",
                          role: "anchor",
                          classLaneKind: "owned_class_lane",
                          primaryMuscles: ["Chest"],
                          supportMuscles: [],
                          optionalMuscles: [],
                          managedCollateralMuscles: [],
                          preferredExerciseClasses: ["horizontal_press"],
                          requiredExerciseClasses: ["horizontal_press"],
                          allocatedTargetSetRange: {
                            min: 3,
                            preferred: 4,
                            max: 4,
                          },
                          ownershipKinds: ["primary_exposure"],
                          setBudget: {
                            min: 3,
                            preferred: 4,
                            max: 4,
                            basis: "class_ownership_allocation",
                          },
                          capPolicy: {
                            maxSetsPerExerciseWithoutJustification: 4,
                            maxDirectExercises: 2,
                            allowAboveFiveSetsOnlyWithJustification: true,
                          },
                          concentrationPolicy: {
                            warningShare: 0.5,
                            blockerShare: 0.6,
                            appliesTo: "primary_target",
                          },
                          evidenceBasis: ["v2_target_skeleton"],
                        },
                      ],
                    },
                  ],
                },
              ],
              guardrails: {
                doesNotUseRepairedProjectionAsTarget: true,
                doesNotUseAcceptedSeedAsTarget: true,
                doesNotAffectSelection: true,
                doesNotAffectRepair: true,
                doesNotAffectSeedSerialization: true,
                doesNotAffectRuntimeReplay: true,
              },
            },
            plannerOwnedAccumulationProjection:
              makePlannerOwnedAccumulationProjection(),
            v2SupportLaneProjectionDiagnostic:
              makeV2SupportLaneProjectionDiagnostic(),
            v2SelectionCapacityPlanDiagnostic:
              makeV2SelectionCapacityPlanDiagnostic(),
            v2DeloadProjectionDiagnostic: {
              version: 1,
              source: "v2_deload_projection_diagnostic",
              readOnly: true,
              affectsScoringOrGeneration: false,
              status: "projected_with_limitations",
              identityBasis: "week_1_selected_identities",
              projectionBasis: "v2_deload_transform_read_only",
              slots: [],
              summary: {
                identitiesPreservedCount: 1,
                movementsIntroducedCount: 0,
                totalWeek1Sets: 4,
                totalDeloadProjectedSets: 2,
                volumeReductionPercent: 50,
                blockedLaneCount: 0,
                warningCount: 0,
              },
              blockers: [],
              warnings: [],
              missingInputs: [],
              safeForBehaviorPromotion: false,
            },
            v2ExerciseSelectionPlanDiagnostic:
              makeV2ExerciseSelectionPlanDiagnostic(),
            v2LaneSelectionIntentAudit: buildV2LaneSelectionIntentAudit({
              exerciseSelectionPlan:
                buildV2PlannerMesocyclePolicy().exerciseSelectionPlan,
              targetSkeleton: buildV2PlannerMesocyclePolicy().targetSkeleton,
            }),
            lowAxialHipExtensionLimitation: {
              version: 1,
              source: "v2_planner_no_repair_diagnostic",
              readOnly: true,
              affectsScoringOrGeneration: false,
              slotId: "lower_b",
              status: "not_evaluated",
              limitationText:
                "Low-axial hip extension is glute-biased, has lower hamstring-per-set than true hinge compounds, and is not equivalent to hinge_compound; it is acceptable only when the Lower B knee_flexion_curl direct floor and weekly Hamstrings target are met and lower-back/axial fatigue management favors low-axial work.",
              acceptanceCriteria: {
                lowerBKneeFlexionCurlDirectFloor: {
                  status: "not_evaluated",
                  directSets: 0,
                  floor: null,
                },
                weeklyHamstringsTarget: {
                  status: "unknown",
                  projectedEffectiveSets: null,
                  targetMin: null,
                  targetPreferred: null,
                },
                axialFatigueManagement: {
                  status: "not_evaluated",
                  evidence: [],
                },
              },
              hamstringContribution: {
                lowerBEffectiveSets: 0,
                weeklyEffectiveSets: null,
                curlEffectiveSets: 0,
                hipExtensionEffectiveSets: 0,
                trueHingeEffectiveSets: 0,
                otherEffectiveSets: 0,
                curlShareOfLowerBPercent: null,
                hipExtensionShareOfLowerBPercent: null,
                trueHingeShareOfLowerBPercent: null,
                weeklyCurlEffectiveSets: 0,
                weeklyHipExtensionEffectiveSets: 0,
                weeklyTrueHingeEffectiveSets: 0,
                weeklyOtherEffectiveSets: 0,
                curlShareOfWeeklyPercent: null,
                hipExtensionShareOfWeeklyPercent: null,
                trueHingeShareOfWeeklyPercent: null,
              },
              trueHingeExposureCount: 0,
              lowAxialHipExtensionAnchorCount: 0,
              lowAxialExercises: [],
              expansionGuidance: [
                "weeks_3_to_4_guidance:prefer_curl_expansion_first_if_hamstrings_need_more",
                "weeks_3_to_4_guidance:consider_true_hinge_exposure_only_if_curl_capacity_monotony_or_hamstring_target_pressure_demands_it_and_fatigue_budget_allows",
                "weeks_3_to_4_guidance:do_not_add_glute_bridge_sets_for_hamstring_delivery_alone",
              ],
              evidence: ["fixture_not_lower_b"],
              limitations: [
                "diagnostic_only_not_selection_repair_seed_or_runtime_input",
              ],
              safeForBehaviorPromotion: false,
            },
            slotPlans: [
              {
                slotId: "upper_a",
                exercises: [
                  {
                    exerciseName: "Incline Dumbbell Press",
                    lane: "chest_anchor",
                    exerciseClass: "chest_press",
                    sets: 6,
                  },
                ],
                missingLanes: ["chest_secondary:missing"],
                unresolvedDemand: ["Chest:shortfall_4"],
                validationFailures: ["Incline Dumbbell Press:set_count_gt_5:6"],
              },
            ],
            weeklyMuscleTotals: [
              {
                muscle: "Chest",
                projectedEffectiveSets: 6,
                targetMin: 10,
                targetPreferred: 10,
                status: "below",
              },
            ],
            setAllocationChanges: [
              {
                slotId: "upper_a",
                lane: "chest_secondary",
                exerciseName: "Cable Crossover",
                setsBefore: 2,
                setsAfter: 3,
                effectiveStimulusDeltaByMuscle: { Chest: 1 },
              },
            ],
            weeklyMuscleTotalChanges: [
              {
                muscle: "Chest",
                beforeEffectiveSets: 5,
                afterEffectiveSets: 6,
                deltaEffectiveSets: 1,
                targetMin: 10,
                targetPreferred: 10,
                statusBefore: "below",
                statusAfter: "below",
              },
            ],
            acceptanceChecks: [
              {
                check: "primary muscles above minimum",
                status: "fail",
                evidence: ["Chest:below_min_10"],
              },
            ],
            acceptanceFailures: [
              {
                severity: "acceptance_blocker",
                slotId: "upper_a",
                exerciseName: "Incline Dumbbell Press",
                muscle: "Chest",
                percentageOfWeeklyStimulus: 70,
                weeklyEffectiveSets: 6,
                setCount: 6,
                producedOrIncreasedByRepair: false,
                reason:
                  "primary_hard_target_excessive_single_exercise_share_unjustified",
                evidence: ["priority:primary"],
              },
            ],
            qualityWarnings: [
              {
                severity: "quality_warning",
                slotId: "upper_a",
                exerciseName: "Cable Rear Delt Fly",
                muscle: "Rear Delts",
                percentageOfWeeklyStimulus: 64.5,
                weeklyEffectiveSets: 6.2,
                setCount: 4,
                producedOrIncreasedByRepair: false,
                reason:
                  "support_direct_isolation_concentrated_but_clean_and_near_or_at_target",
                evidence: ["priority:support"],
              },
            ],
            diagnosticRows: [
              {
                severity: "diagnostic_only",
                slotId: "upper_b",
                exerciseName: "Machine Shoulder Press",
                muscle: "Front Delts",
                percentageOfWeeklyStimulus: 70,
                weeklyEffectiveSets: 5,
                setCount: 4,
                producedOrIncreasedByRepair: false,
                reason:
                  "secondary_or_implicit_collateral_not_acceptance_target",
                evidence: ["priority:implicit"],
              },
            ],
            ignoredRows: [
              {
                severity: "ignored_for_acceptance",
                slotId: "upper_b",
                exerciseName: "Barbell Curl",
                muscle: "Forearms",
                percentageOfWeeklyStimulus: 100,
                weeklyEffectiveSets: 1,
                setCount: 3,
                producedOrIncreasedByRepair: false,
                reason: "compound_or_curl_collateral_denominator_artifact",
                evidence: ["priority:secondary"],
              },
            ],
            repairDependenciesDisabled: [
              "support-floor closure",
              "weekly obligation closure",
            ],
            comparisonToRepaired: {
              repairedPasses: true,
              noRepairPasses: false,
              mainGaps: ["upper_a:unresolved:Chest:shortfall_4"],
            },
          },
        },
      },
    });

    expect(summary).toEqual([
      "Planner-Only No-Repair Acceptance",
      "---------------------------------",
      "Basic shape: fail",
      "Replacement readiness: blocked",
      "Hard blockers: 1",
      "Hard blocker details: primary_hard_target_below_minimum: Chest:below_min_10",
      "Quality warnings: 1",
      "Quality warning details: support_direct_isolation_concentrated_but_clean_and_near_or_at_target: upper_a:Cable Rear Delt Fly:Rear Delts:64.5%:support_direct_isolation_concentrated_but_clean_and_near_or_at_target",
      "Diagnostic rows: 1",
      "Session-shaping rows: 1",
      "Migration scoreboard: not-ready",
      "V2 Mesocycle Strategy Diagnostic",
      "---------------------------------",
      "Status: available-with-limitations",
      "Phase: unknown (low confidence)",
      "Demand source: mixed -> mesocycle-strategy",
      "Missing profile inputs: 6",
      "Strategy input groups: present=none missing=userProfile,currentTrainingContext,historicalMesocycles,readinessAndRecoverySignals",
      "Strategy historical mesocycles: 0",
      "Strategy source planners: legacy_projection=0 v2=0 unknown=0",
      "Strategy evidence categories: none",
      "Block response signals: 0",
      "Strategy implications: protect=0 capLate=0 reduceFatigue=0 preserveProgression=0 deload=0 unknown=0",
      "Recurring under-hit examples: none",
      "Recurring over-concentration examples: none",
      "Exercise response signals: 0",
      "Exercise signals: progressed=0 stalled=0 regressed=0 skipped=0 swapped=0 pain=0 fatigue=0 low=0 unknown=0",
      "Response confidence: low=0 medium=0 high=0",
      "Evidence limitations: 1",
      "Continuity/variation evidence: not-available keep=0 rotate=0 avoid=0 low=0",
      "Materializer ranking evidence usable: no",
      "Volume/fatigue evidence: not-available protect=0 over=0 late=0 deload=0",
      "Demand-zone learning: not-available floor=0 productive=0 stretch=0 cap=0 next=collect-more-performed-evidence",
      "Demand-zone consumed by demand/materializer: no",
      "Strategy-to-demand diff: not-available rows=0 floor=0 productive=0 stretch=0 cap=0 readOnlyDiff=0 blocked=0 monitor=0 needsEvidence=0 next=collect-more-evidence",
      "Strategy-to-demand consumed by demand/materializer: no",
      "Strategy-to-demand projection: not-available rows=0 baseMatched=0 noMutation=0 measuredCurrent=0 behaviorUnknown=0 blocked=0 monitor=0 next=keep-diagnostic-only",
      "Strategy-to-demand current measurement: measured=0 pass=0 unknown=0 maxDelta=0 netNew=0 behaviorMeasured=no",
      "Strategy-to-demand bounded behavior trial: not-available candidates=0 ready=0 blocked=0 monitor=0 netNewFail=0 redistributionReady=0 redistributionMissing=0 downstreamUnknown=0 materializerUnknown=0 next=collect-more-evidence",
      "Strategy-to-demand downstream context: not-available candidates=0 weeklyReady=0 slotReady=0 setReady=0 netNewUnknown=0 materializerUnknown=0 ready=0 next=collect-more-evidence",
      "Strategy-to-demand measured redistribution: not-available candidates=0 measured=0 ready=0 blocked=0 pass=0 fail=0 unknown=0 netNew=0 materialRepairDelta=0 concentrationDelta=0 next=keep-diagnostic-only",
      "Strategy-to-demand measured blockers: not-available scope=not-projected independent=no floor=none donors=none required=none",
      "Strategy-to-demand alternate donors: not-available scope=not-projected current=none alternateEligible=0 excluded=none required=none next=keep-diagnostic-only",
      "Strategy-to-demand fallback capacity inspection: projected-with-limitations blockers=0 pressure=1 capAwareExpansion=0 optionalSuppressed=0 safeForPromotion=no",
      "Strategy-to-demand projection consumed by demand/materializer: no",
      "Strategy recommendation: not-available phase=unknown confidence=low hypotheses=0",
      "Recommendation hypotheses: none",
      "Recommendation priorities: P0=0 P1=0 P2=0",
      "Recommendation evidence examples: none",
      "Recommendation promotion blockers: none",
      "Recommendations consumed by demand/materializer: no",
      "Promotion readiness: not-ready hypotheses=0",
      "Promotion readiness counts: not_ready=0 needs_more_evidence=0 needs_owner=0 needs_non_regression_gates=0 ready_for_read_only_diff=0 ready_for_bounded_trial=0",
      "Promotion owner counts: MesocycleDemand=0 WeeklyDemandCurve=0 SlotDemandAllocation=0 ExerciseSelectionStrategy=0 MaterializerRanking=0 DeloadPlan=0 RuntimeUX=0 unknown=0",
      "Promotion next actions: collect=0 read_only_diff=0 audit_gate=0 bounded_trial=0 do_not_promote=0",
      "Promotion missing evidence: none",
      "Promotion global blockers: audit_comparison_path_required_before_behavior, bounded_trials_require_explicit_follow_up_slice, no_strategy_hypotheses_available, non_regression_gates_not_yet_satisfied, promotion_readiness_is_diagnostic_only, readiness_must_not_influence_generation_selection_repair_seed_runtime_or_receipts, +2 more",
      "Promotion readiness consumed by demand/materializer: no",
      "Promotion diff gate: not-available evaluated=0 next=do-not-promote",
      "Promotion diff hypotheses: none",
      "Promotion diff target-tier under-hit: none",
      "Promotion diff hard-week skipped-set signal: no examples=none",
      "Promotion diff interaction risk: not-evaluated none",
      "Promotion diff non-regression gates: reported=0/10 enforced=no",
      "Promotion projection diff: not-available mode=not-projected readiness=not-ready",
      "Promotion projection candidates: protected=0 donors=0",
      "Promotion donor surplus evidence: not-available candidates=0 measuredMargin=0 eligible=0 ineligible=0 unknownMargin=0 protectedOverlap=0 slotIncompatible=0",
      "Promotion projection pre-shadow filter: not-available eligibleDonors=0 excludedDonors=0 retainedProtected=0 excludedProtected=0",
      "Promotion projection gates: pass=0 fail=0 unknown=10",
      "Promotion projection conflict-aware: not-available conflicts=0 protected-donor=0 floor=0 slot-owner=0 session-size=0 net-new=0",
      "Promotion projection limitations: candidate_strategy_is_owner_agnostic, computed_gates_default_unknown_without_projected_delta_evidence, dirty_collateral_deltas_not_measured, lagging_muscle_protection_diff_not_available, late_block_volume_cap_diff_not_available, +7 more",
      "Promotion slot-owned demand adjustment: not-available feasibility=unknown protected=0 donors=0 eligibleDonors=0 blocking=3 unresolved=1 next=collect-more-evidence",
      "Promotion projection consumedByDemandOrMaterializer: false",
      "Promotion diff consumedByDemandOrMaterializer: false",
      "Performed history loaded: no",
      "Old prescribed plan shape excluded: yes",
      "North-star gaps: 6",
      "V2 Mesocycle Plan",
      "-----------------",
      "Status: experimental",
      "Skeleton: upper/lower 4x",
      "Week 1: fail",
      "Weeks 2-4: derived progression model, limited projection",
      "Deload: transform defined, not production-projected",
      "Replacement readiness: blocked",
      "V2 Target vs No-Repair Diff",
      "----------------------------",
      "Lane status: satisfied=1 partial=0 missing=0 blocked=0 repair-dependent=1",
      "Migration candidates: 1",
      "Suspicious or blocked: 0",
      "Next migration slice: chest_secondary:promote_to_planner_later",
    ]);
  });

  it("prints compact V2 base-plan compare diagnostics when present", () => {
    const summary = buildPlannerOnlyNoRepairSummary({
      artifact: {
        mesocycleExplain: {
          plannerOnlyNoRepair: {
            acceptanceClassification: {
              basicMesocycleShapeStatus: "pass_with_warnings",
              replacementReadinessStatus: "not_ready",
              hardBlockers: [],
              qualityWarnings: [],
              diagnosticOnly: [],
              sessionShaping: [],
              migrationScoreboard: {
                materialRepairCount: 0,
                majorRepairCount: 0,
                suspiciousRepairs: 0,
                canReplaceRepairedProjection: false,
                reason: "not_ready",
              },
            },
            v2MesocyclePlan: {
              planStatus: "experimental",
              deloadTransform: {
                projectionStatus: "partially_modeled",
              },
            },
            v2BasePlanCompare: makeV2BasePlanCompareFixture(),
            v2BasePlanShadowConsumptionTrial:
              makeV2BasePlanShadowConsumptionTrialFixture(),
          },
        },
      } as unknown as Parameters<
        typeof buildPlannerOnlyNoRepairSummary
      >[0]["artifact"],
    });

    expect(summary).toEqual(
      expect.arrayContaining([
        "V2 Base Plan Compare",
        "--------------------",
        "Status: available",
        "Compared plans: v2=yes noRepair=yes repaired=yes",
        "Set totals: v2=55 noRepair=25 repaired=55",
        "Repair dependencies: 9",
        "V2 compare classifications: improves=12 regresses=0 unclear=2",
        "Next safe action: add-shadow-consumption-trial",
        "Read-only/no generation impact: yes",
        "V2 Base Plan Shadow Consumption",
        "--------------------------------",
        "Status: available",
        "Compared plans: v2=yes shadow=yes noRepair=yes repaired=yes",
        "Set totals: shadow=55 v2=55 noRepair=25 repaired=55",
        "Repair dependency delta: -8 remaining=1 current=9",
        "Shadow classifications: improves=14 preserves=10 regresses=0 unclear=1 notComparable=0",
        "Identity differences categorized: 4",
        "Consumed by production: no",
        "Next safe action: inspect-shadow-consumption",
        "Read-only/no generation impact: yes",
        "V2 base-plan compare/shadow detail: v2-materialization shard when --v2-debug-artifact is enabled",
      ]),
    );
  });

  it("prints compact V2 plan-quality warning evidence with source attribution", () => {
    const summary = buildPlannerOnlyNoRepairSummary({
      artifact: {
        mesocycleExplain: {
          plannerOnlyNoRepair: {
            acceptanceClassification: {
              basicMesocycleShapeStatus: "pass_with_warnings",
              replacementReadinessStatus: "not_ready",
              hardBlockers: [],
              qualityWarnings: [],
              diagnosticOnly: [],
              sessionShaping: [],
              migrationScoreboard: {
                materialRepairCount: 0,
                majorRepairCount: 0,
                suspiciousRepairs: 0,
                canReplaceRepairedProjection: false,
                reason: "not_ready",
              },
            },
            v2MesocyclePlan: {
              planStatus: "full_mesocycle_limited",
              deloadTransform: {
                projectionStatus: "partially_modeled",
              },
            },
            v2PlanQualityBenchmark: makeV2PlanQualityBenchmarkFixture(),
          },
        },
      } as unknown as Parameters<
        typeof buildPlannerOnlyNoRepairSummary
      >[0]["artifact"],
    });

    expect(summary).toEqual(
      expect.arrayContaining([
        "V2 Plan Quality Benchmark",
        "-------------------------",
        "Status: warning deprecation=ready-for-review",
        "Gates: pass=6 warn=2 fail=0 missing=0 mustFixW1=0",
        "Gate detail: session_size:pass:pure_v2_base_plan; duplicate_concentration_risk:warning:pure_v2_base_plan",
        "Warning evidence: duplicate_concentration_risk@v2_base_plan_validation.duplicate_distinctness: exerciseIdentityClassification=v2_preserves, v2DuplicateExact:Standing Calf Raise, v2DuplicateExactExercises=1, watch:exact_duplicate_reuse_needs_variant_or_continuity_justification",
        "Next safe action: review-warning-gates-before-deprecation",
        "Guardrails: seedRuntimeChanged=no productionMaterializerChanged=no acceptanceThresholdChanged=no persistenceChanged=no",
      ]),
    );
  });

  it("prints legacy repair quarantine status when the repair scoreboard is present", () => {
    const summary = buildPlannerOnlyNoRepairSummary({
      artifact: {
        mesocycleExplain: {
          plannerOnlyNoRepair: {
            acceptanceClassification: {
              basicMesocycleShapeStatus: "pass_with_warnings",
              replacementReadinessStatus: "not_ready",
              hardBlockers: [],
              qualityWarnings: [],
              diagnosticOnly: [],
              sessionShaping: [],
              migrationScoreboard: {
                materialRepairCount: 19,
                majorRepairCount: 8,
                suspiciousRepairs: 6,
                canReplaceRepairedProjection: false,
                reason: "not_ready",
              },
            },
            v2MesocyclePlan: {
              planStatus: "experimental",
              deloadTransform: {
                projectionStatus: "partially_modelled",
              },
            },
            repairPromotionScoreboard: {
              version: 1,
              readOnly: true,
              affectsScoringOrGeneration: false,
              source: "repaired_planning_reality",
              rawRepairEvidence: {
                rawRowCount: 48,
                materialRepairCount: 19,
                majorRepairCount: 8,
                likelyAvoidableMaterialRepairCount: 9,
                remainingMaterialRepairCount: 10,
                suspiciousRepairCount: 6,
              },
              summary: {
                promotionCandidateCount: 0,
                doNotPromoteCount: 48,
                safetyNetCount: 12,
                collateralDiagnosticCount: 17,
                diagnosticOnlyCount: 19,
              },
              interpretation: {
                legacyRepairPressure: {
                  rawRowCount: 48,
                  materialRepairCount: 19,
                  majorRepairCount: 8,
                  likelyAvoidableMaterialRepairCount: 9,
                  remainingMaterialRepairCount: 10,
                  suspiciousRepairCount: 6,
                  note: "raw_legacy_repair_evidence_not_behavior_promotion_pressure",
                },
                currentV2PolicyGap: {
                  supportDirectFloorBlockerCount: 0,
                  setDistributionCapacityGapCount: 4,
                  setBudgetPolicyFailureCount: 2,
                  selectionFeasibilityCapacityPressureCount: 1,
                  staleWeek1ReadoutArtifactCount: 1,
                  capAwareExpansionLimitationCount: 1,
                  concentrationQualityGapCount: 7,
                  optionalDiagnosticLaneCount: 1,
                  selectionBlockerCount: 0,
                  classTaxonomyMismatchCount: 20,
                },
                safetyNonRegressionRows: {
                  count: 12,
                  includesSuspiciousRows: true,
                },
                staleRepairedProjectionArtifacts: {
                  count: 9,
                  reasonCounts: {
                    v2_already_solved_differently: 5,
                    collateral_support_accounting: 4,
                    legacy_repaired_artifact: 5,
                    support_floor_design_needed: 4,
                  },
                },
                quarantineGroups: {
                  upstreamOwnedCandidate: {
                    count: 0,
                    evidenceQuality: "owner_specific_behavior_candidate",
                    ownerCounts: {},
                    requiredProof: [
                      "positive_slot_owned_likely_avoidable_row_not_demoted_by_v2_context",
                    ],
                  },
                  safetyRepairOnly: {
                    count: 12,
                    evidenceQuality: "safety_or_legacy_only",
                    topReasons: {
                      cap_trim_removal_or_safety_guard: 12,
                    },
                    requiredProof: [
                      "prove_safety_guard_can_be_owned_upstream_without_regression",
                      "keep_repair_as_fallback_until_replaced",
                    ],
                  },
                  collateralAmbiguous: {
                    count: 17,
                    evidenceQuality: "collateral_or_ambiguous",
                    topReasons: {
                      collateral_or_non_owned_muscle: 10,
                      diagnostic_or_collateral_only: 7,
                    },
                    requiredProof: [
                      "prove_target_muscle_slot_ownership",
                      "separate_collateral_credit_from_direct_floor_satisfaction",
                    ],
                  },
                  staleArtifact: {
                    count: 9,
                    evidenceQuality: "stale_repaired_projection_artifact",
                    topReasons: {
                      v2_already_solved_differently: 5,
                      support_floor_design_needed: 4,
                    },
                    requiredProof: [
                      "compare_against_current_v2_no_repair_solution",
                      "do_not_copy_legacy_repaired_identity_or_set_bump",
                    ],
                  },
                  missingEvidenceOrUnmeasuredGate: {
                    count: 10,
                    evidenceQuality: "missing_or_unmeasured_gate",
                    topReasons: {
                      taxonomy_bridge_needed: 6,
                      set_distribution_design_needed: 4,
                    },
                    requiredProof: [
                      "owner_specific_projection_delta",
                      "materializer_non_regression",
                      "cross_week_and_deload_projection",
                    ],
                  },
                },
                missingProofBeforeBehaviorPromotion: [
                  {
                    gate: "owner_specific_behavior_candidate",
                    status: "missing",
                    ownerSeam: "repairPromotionScoreboard",
                    missingEvidence: [
                      "positive_slot_owned_likely_avoidable_row_not_demoted_by_v2_context",
                    ],
                    evidence: ["behaviorPromotionCandidateCount=0"],
                  },
                  {
                    gate: "current_v2_policy_gap",
                    status: "blocked",
                    ownerSeam:
                      "ExerciseClassDistributionBySlot,ExerciseSelectionPlan,SetDistributionIntent,SlotDemandAllocationByWeek,audit_readout_cleanup",
                    missingEvidence: [
                      "resolve_or_measure_current_v2_policy_gaps_before_behavior",
                    ],
                    evidence: [
                      "setDistributionCapacityGapCount=4",
                      "setBudgetPolicyFailureCount=2",
                    ],
                  },
                  {
                    gate: "measured_behavior_projection",
                    status: "missing",
                    ownerSeam: "read_only_projection_or_materializer_comparison",
                    missingEvidence: ["measured_projection_delta"],
                    evidence: [
                      "repair_scoreboard_is_repaired_projection_evidence_only",
                    ],
                  },
                  {
                    gate: "seed_runtime_non_consumption",
                    status: "required_before_promotion",
                    ownerSeam: "accepted_seed_runtime_replay",
                    missingEvidence: [
                      "focused_seed_runtime_guard_tests_for_any_future_behavior_promotion",
                    ],
                    evidence: [
                      "diagnostic_readout_does_not_change_slotPlanSeedJson_or_runtime_replay",
                    ],
                  },
                ],
                gapInventory: [
                  {
                    rank: 1,
                    gapId: "class_taxonomy_mismatch",
                    description:
                      "Exercise class/taxonomy mismatches block trusting selected identities as lane-fit proof.",
                    likelyOwnerSeam: "ExerciseClassDistributionBySlot",
                    evidenceQuality: "diagnostic_count",
                    trainingImportance: "high",
                    gapCount: 20,
                    currentEvidence: ["classTaxonomyMismatchCount=20"],
                    missingProof: [
                      "taxonomy_bridge_fixture",
                      "materializer_identity_non_regression",
                    ],
                    measurableNextStep:
                      "build_taxonomy_bridge_no_drift_probe",
                    status: "blocked_by_missing_evidence",
                  },
                ],
                taxonomyMismatchInventory: {
                  version: 1,
                  readOnly: true,
                  affectsScoringOrGeneration: false,
                  consumedByProduction: false,
                  source: "v2_exercise_selection_plan_diagnostic",
                  summary: {
                    mismatchRowCount: 20,
                    selectedIdentityAffectedCount: 12,
                    cleanAlternativeAvailableCount: 3,
                    ownerCounts: {
                      ExerciseClassDistributionBySlot: 14,
                      ExerciseSelectionPlan: 6,
                    },
                    selectedMismatchId: "week_1:upper_b:chest_second_exposure",
                  },
                  rows: [
                    {
                      rank: 1,
                      mismatchId: "week_1:upper_b:chest_second_exposure",
                      week: 1,
                      slotId: "upper_b",
                      laneId: "chest_second_exposure",
                      muscles: ["Chest"],
                      plannedClasses: ["distinct_chest_press_or_fly"],
                      selectedExerciseName: "Machine Chest Press",
                      selectedExerciseId: "exercise-chest-press",
                      selectedClass: "chest_press",
                      laneClassStatus: "mismatch",
                      likelyOwnerSeam: "ExerciseClassDistributionBySlot",
                      evidenceQuality: "selected_identity_lane_mismatch",
                      trainingImportance: "high",
                      affectsSelectedIdentities: true,
                      affectsSelectedIdentitySets: 2,
                      evidence: [
                        "slot=upper_b",
                        "lane=chest_second_exposure",
                      ],
                      missingProof: [
                        "taxonomy_bridge_no_drift_materializer_probe",
                        "seed_runtime_non_consumption_gate",
                      ],
                      nextMeasurement: "build_taxonomy_bridge_no_drift_probe",
                      classification: "true_v2_policy_class_taxonomy_gap",
                    },
                  ],
                },
                supportFloorGapInventory: {
                  version: 1,
                  readOnly: true,
                  affectsScoringOrGeneration: false,
                  consumedByProduction: false,
                  source: "v2_support_lane_projection_diagnostic",
                  summary: {
                    gapRowCount: 4,
                    setDistributionIntentOwnedCount: 1,
                    downstreamMaterializerOrCapacityCount: 0,
                    diagnosticOnlyOrStaleCount: 3,
                    ownerCounts: {
                      SetDistributionIntent: 1,
                      audit_readout_cleanup: 3,
                    },
                    selectedGapId:
                      "week_1:upper_b:side_delt_isolation:side_delts",
                  },
                  rows: [
                    {
                      rank: 1,
                      supportFloorGapId:
                        "week_1:upper_b:side_delt_isolation:side_delts",
                      week: 1,
                      slotId: "upper_b",
                      laneId: "side_delt_isolation",
                      muscle: "Side Delts",
                      directFloorExpected: 8,
                      directFloorDelivered: 6,
                      currentBudget: { min: 4, preferred: 4, max: 4 },
                      suspectedNeededBudget: {
                        min: 8,
                        preferred: 8,
                        max: 8,
                      },
                      likelyOwnerSeam: "SetDistributionIntent",
                      evidenceQuality: "direct_floor_below",
                      trainingImportance: "high",
                      evidence: [
                        "slot=upper_b",
                        "lane=side_delt_isolation",
                      ],
                      missingProof: [
                        "support_floor_materializer_projection_delta",
                      ],
                      nextMeasurement:
                        "measure_support_floor_materializer_projection",
                      classification: "true_support_direct_floor_gap",
                    },
                  ],
                },
                selectedGapProof: {
                  gapId: "class_taxonomy_mismatch",
                  selectedMismatchId: "week_1:upper_b:chest_second_exposure",
                  classification: "blocked_by_missing_evidence",
                  proofResult: "blocked_by_missing_evidence",
                  rightfulOwnerSeam: "ExerciseClassDistributionBySlot",
                  readOnly: true,
                  affectsScoringOrGeneration: false,
                  consumedByProduction: false,
                  safeForBehaviorPromotion: false,
                  measuredEvidence: ["classTaxonomyMismatchCount=20"],
                  missingGates: [
                    "taxonomy_bridge_fixture",
                    "materializer_identity_non_regression",
                  ],
                  nextSafeAction: "build_taxonomy_bridge_no_drift_probe",
                },
                legacyRepairQuarantine: {
                  readOnly: true,
                  affectsScoringOrGeneration: false,
                  repairedProjectionRole: "legacy_evidence_not_target_policy",
                  policyPromotionBasis:
                    "positive_slot_owned_likely_avoidable_rows_only",
                  rawLegacyEvidenceRowCount: 48,
                  behaviorPromotionCandidateCount: 0,
                  quarantinedRowCount: 48,
                  safetyNetCount: 12,
                  collateralDiagnosticCount: 17,
                  diagnosticOnlyCount: 19,
                  staleRepairedProjectionArtifactCount: 9,
                  suspiciousRepairCount: 6,
                },
              },
              promotionCandidates: [],
              doNotPromoteRows: [],
              safetyNetRows: [],
              collateralDiagnosticRows: [],
              diagnosticRows: [],
              rawSuspiciousRows: [],
            },
          },
        },
      } as unknown as Parameters<
        typeof buildPlannerOnlyNoRepairSummary
      >[0]["artifact"],
    });

    expect(summary).toEqual(
      expect.arrayContaining([
        "V2 Repair Promotion Scoreboard",
        "Raw repair evidence: material=19 major=8 likely-avoidable=9 remaining=10 suspicious=6",
        "Legacy repair quarantine: role=legacy_evidence_not_target_policy behaviorCandidates=0 quarantined=48 staleArtifacts=9",
        "Quarantine groups: upstreamOwned=0 safetyRepairOnly=12 collateralAmbiguous=17 staleArtifact=9 missingEvidenceOrGate=10",
        "Top quarantine reasons: safety=cap_trim_removal_or_safety_guard=12 collateral=collateral_or_non_owned_muscle=10 diagnostic_or_collateral_only=7 stale=v2_already_solved_differently=5 support_floor_design_needed=4 missing=taxonomy_bridge_needed=6 set_distribution_design_needed=4",
        "Missing proof before behavior: owner_specific_behavior_candidate:missing@repairPromotionScoreboard; current_v2_policy_gap:blocked@ExerciseClassDistributionBySlot,ExerciseSelectionPlan,SetDistributionIntent,SlotDemandAllocationByWeek,audit_readout_cleanup; measured_behavior_projection:missing@read_only_projection_or_materializer_comparison; seed_runtime_non_consumption:required_before_promotion@accepted_seed_runtime_replay",
        "Ranked gap inventory: #1 class_taxonomy_mismatch@ExerciseClassDistributionBySlot count=20 importance=high evidence=diagnostic_count status=blocked_by_missing_evidence next=build_taxonomy_bridge_no_drift_probe",
        "Taxonomy mismatch inventory: rows=20 selectedIdentityAffected=12 cleanAlternatives=3 selected=week_1:upper_b:chest_second_exposure owners=ExerciseClassDistributionBySlot=14 ExerciseSelectionPlan=6",
        "Support-floor gap inventory: rows=4 setDistributionOwned=1 downstreamOrCapacity=0 diagnosticOrStale=3 selected=week_1:upper_b:side_delt_isolation:side_delts owners=audit_readout_cleanup=3 SetDistributionIntent=1 selectedDetail=week_1:upper_b:side_delt_isolation:Side Delts floor=6/8 owner=SetDistributionIntent evidence=direct_floor_below class=true_support_direct_floor_gap",
        "Selected gap proof: class_taxonomy_mismatch:blocked_by_missing_evidence@ExerciseClassDistributionBySlot classification=blocked_by_missing_evidence selected=week_1:upper_b:chest_second_exposure consumedByProduction=no safeForBehavior=no missing=materializer_identity_non_regression, taxonomy_bridge_fixture next=build_taxonomy_bridge_no_drift_probe",
        "Promotion candidates: 0",
        "Safety/do-not-promote: 12",
        "Collateral/diagnostic: 36",
        "Candidate rows: none",
      ]),
    );
  });

  it("prints compact promotion diff gate details for ready read-only hypotheses", () => {
    const summary = buildPlannerOnlyNoRepairSummary({
      artifact: {
        mesocycleExplain: {
          plannerOnlyNoRepair: {
            acceptanceClassification: {
              basicMesocycleShapeStatus: "pass_with_warnings",
              replacementReadinessStatus: "not_ready",
              hardBlockers: [],
              qualityWarnings: [],
              diagnosticOnly: [],
              sessionShaping: [],
              migrationScoreboard: {
                materialRepairCount: 0,
                majorRepairCount: 0,
                suspiciousRepairs: 0,
                canReplaceRepairedProjection: false,
                reason: "not_ready",
              },
            },
            v2MesocycleStrategyDiagnostic:
              buildV2MesocycleStrategyDiagnostic({
                strategyInput: makePromotionDiffStrategyInput(),
              }),
            v2MesocyclePlan: {
              planStatus: "experimental",
              deloadTransform: {
                projectionStatus: "partially_modeled",
              },
            },
          },
        },
      } as unknown as Parameters<
        typeof buildPlannerOnlyNoRepairSummary
      >[0]["artifact"],
    });

    expect(summary).toEqual(
      expect.arrayContaining([
        "Promotion diff gate: available-with-limitations evaluated=2 next=run-read-only-shadow-trial",
        "Promotion diff hypotheses: cap_late_block_volume, protect_lagging_muscles_earlier",
        "Promotion diff target-tier under-hit: Side Delts",
        expect.stringContaining(
          "Promotion diff hard-week skipped-set signal: yes examples=",
        ),
        "Promotion diff interaction risk: available-with-limitations both_hypotheses_can_conflict_without_redistribution_policy, lagging_muscle_protection_may_require_more_allocated_work, late_block_volume_cap_may_require_less_total_expansion",
        "Promotion diff non-regression gates: reported=0/10 enforced=no",
        "Promotion projection diff: available-with-limitations mode=read-only-estimate readiness=ready-for-read-only-shadow-trial",
        "Promotion projection candidates: protected=2 donors=1",
        "Promotion donor surplus evidence: available-with-limitations candidates=1 measuredMargin=0 eligible=0 ineligible=1 unknownMargin=1 protectedOverlap=0 slotIncompatible=0",
        "Promotion projection pre-shadow filter: not-available eligibleDonors=0 excludedDonors=0 retainedProtected=0 excludedProtected=0",
        "Promotion projection gates: pass=0 fail=0 unknown=10",
        "Promotion projection conflict-aware: available-with-limitations conflicts=0 protected-donor=0 floor=0 slot-owner=0 session-size=0 net-new=0",
        "Promotion projection limitations: candidate_strategy_is_owner_agnostic, computed_gates_default_unknown_without_projected_delta_evidence, dirty_collateral_deltas_not_measured, no_shadow_projection_rerun_yet, old_prescribed_plan_shape_excluded_from_projection_target, +4 more",
        "Promotion slot-owned demand adjustment: blocked feasibility=blocked protected=2 donors=1 eligibleDonors=0 blocking=2 unresolved=1 next=collect-more-evidence",
        "Promotion projection consumedByDemandOrMaterializer: false",
        "Promotion diff consumedByDemandOrMaterializer: false",
      ]),
    );
  });
});

describe("buildCurrentWeekAuditOperatorSummary", () => {
  it("prints current-week guidance when the projected-week artifact carries the evaluation layer", () => {
    const summary = buildCurrentWeekAuditOperatorSummary({
      artifact: {
        projectedWeekVolume: {
          version: 1,
          currentWeek: {
            mesocycleId: "meso-1",
            week: 4,
            phase: "accumulation",
            blockType: "accumulation",
          },
          projectionNotes: [],
          completedVolumeByMuscle: {},
          projectedSessions: [],
          fullWeekByMuscle: [],
          currentWeekAudit: {
            belowMEV: ["Chest"],
            overMAV: ["Glutes"],
            underTargetClusters: [{ muscle: "Chest", deficit: 2 }],
            belowPreferred: [
              { muscle: "Rear Delts", deficit: 2, status: "below_preferred" },
            ],
            fatigueRisks: ["Glutes projects 2.0 sets over MAV"],
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
              slotId: "lower_b",
              issue: "projected duration 85 min exceeds ~80 min",
            },
          ],
        },
      },
    });

    expect(summary).toEqual([
      "[workout-audit:current-week] below_mev=Chest mev_closure_clusters=Chest (-2.0) below_preferred=Rear Delts:below_preferred (-2.0) over_mav=Glutes",
      "[workout-audit:current-week] fatigue_risks=Glutes projects 2.0 sets over MAV",
      "[workout-audit:current-week] intervention_hints=Chest:2 sets (below_mev: projected 2.0 sets below MEV; bounded floor closure only)",
      "[workout-audit:current-week] no_target_chasing=above_mev_below_target_rows_are_monitor_only",
      "[workout-audit:current-week] session_risks=lower_b: projected duration 85 min exceeds ~80 min",
    ]);
  });

  it("returns null for plain projected-week-volume artifacts", () => {
    const summary = buildCurrentWeekAuditOperatorSummary({
      artifact: {
        projectedWeekVolume: {
          version: 1,
          currentWeek: {
            mesocycleId: "meso-1",
            week: 3,
            phase: "accumulation",
            blockType: "accumulation",
          },
          projectionNotes: [],
          completedVolumeByMuscle: {},
          projectedSessions: [],
          fullWeekByMuscle: [],
        },
      },
    });

    expect(summary).toBeNull();
  });
});

describe("buildPreSessionReadinessSummary", () => {
  function buildWeek4UpperBPreSessionArtifact(overrides: {
    projectedSessions?: unknown[];
    fullWeekByMuscle?: unknown[];
    runtimeDoseAdjustmentDiagnostics?: unknown[];
    currentWeekAudit?: Record<string, unknown>;
    sessionRisks?: unknown[];
  } = {}) {
    const projectedSessions = overrides.projectedSessions ?? [
      {
        slotId: "upper_b",
        intent: "upper",
        isNext: true,
        exerciseCount: 6,
        totalSets: 18,
        exercises: [
          {
            exerciseId: "machine-shoulder-press",
            name: "Machine Shoulder Press",
            setCount: 2,
            role: "primary",
            effectiveStimulusByMuscle: { "Side Delts": 2, Triceps: 1.6 },
          },
          {
            exerciseId: "lat-pulldown",
            name: "Lat Pulldown",
            setCount: 3,
            role: "primary",
            effectiveStimulusByMuscle: { Lats: 3, "Upper Back": 1.5, Biceps: 1 },
          },
          {
            exerciseId: "cable-fly",
            name: "Cable Fly",
            setCount: 3,
            role: "accessory",
            effectiveStimulusByMuscle: { Chest: 1.8 },
          },
          {
            exerciseId: "seated-cable-row",
            name: "Seated Cable Row",
            setCount: 3,
            role: "primary",
            effectiveStimulusByMuscle: { "Upper Back": 3, Lats: 1.5, Biceps: 1 },
          },
          {
            exerciseId: "machine-lateral-raise",
            name: "Machine Lateral Raise",
            setCount: 4,
            role: "accessory",
            effectiveStimulusByMuscle: { "Side Delts": 4 },
          },
          {
            exerciseId: "barbell-curl",
            name: "Barbell Curl",
            setCount: 3,
            role: "accessory",
            effectiveStimulusByMuscle: { Biceps: 3 },
          },
        ],
        projectedContributionByMuscle: {
          Chest: 3,
          Triceps: 1.6,
          Biceps: 5,
          "Side Delts": 6,
          Lats: 4.5,
          "Upper Back": 4.5,
          "Rear Delts": 1,
        },
      },
    ];
    const fullWeekByMuscle = overrides.fullWeekByMuscle ?? [
      buildFullWeekRow("Chest", 7, 12, 10, 16, "A_PRIMARY"),
      buildFullWeekRow("Triceps", 5.6, 8, 6, 12, "B_SUPPORT"),
      buildFullWeekRow("Biceps", 8, 10, 6, 14, "B_SUPPORT"),
      buildFullWeekRow("Side Delts", 6, 12, 6, 16, "B_SUPPORT"),
      buildFullWeekRow("Rear Delts", 6, 8, 4, 12, "B_SUPPORT"),
      buildFullWeekRow("Lats", 12, 14, 8, 16, "A_PRIMARY"),
      buildFullWeekRow("Upper Back", 9, 10, 6, 14, "A_PRIMARY"),
    ];
    const runtimeDoseAdjustmentDiagnostics =
      overrides.runtimeDoseAdjustmentDiagnostics ?? [
        buildDoseDiagnostic("Chest", 7, 12, 10, 16, "add_set", "Cable Fly"),
        buildDoseDiagnostic(
          "Triceps",
          5.6,
          8,
          6,
          12,
          "add_set",
          "Machine Shoulder Press"
        ),
        buildDoseDiagnostic("Biceps", 8, 10, 6, 14, "hold_seed", undefined),
        buildDoseDiagnostic("Side Delts", 6, 12, 6, 16, "hold_seed", undefined),
        buildDoseDiagnostic("Rear Delts", 6, 8, 4, 12, "hold_seed", undefined),
        buildDoseDiagnostic("Lats", 12, 14, 8, 16, "hold_seed", undefined),
        buildDoseDiagnostic("Upper Back", 9, 10, 6, 14, "hold_seed", undefined),
      ];

    return {
      identity: {
        userId: "user-1",
        ownerEmail: "aaron8819@gmail.com",
      },
      request: {
        mode: "pre-session-readiness",
        ownerEmail: "aaron8819@gmail.com",
        mesocycleId: "ceb2cff3-9d4d-4b3e-b309-c63ab28e62d4",
      },
      nextSession: {
        intent: "upper",
        slotId: "upper_b",
        slotSequenceIndex: 2,
        slotSequenceLength: 4,
        slotSource: "mesocycle_slot_sequence",
        existingWorkoutId: null,
        isExisting: false,
        source: "rotation",
        weekInMeso: 4,
        sessionInWeek: 3,
        derivationTrace: [],
        selectedIncompleteStatus: null,
      },
      generationPath: {
        requestedMode: "pre-session-readiness",
        executionMode: "standard_generation",
        generator: "generateSessionFromIntent",
        reason: "standard_future_week_or_preview",
      },
      generationProvenance: {
        receiptProvenance: {
          mesocycleId: "ceb2cff3-9d4d-4b3e-b309-c63ab28e62d4",
          compositionSource: "persisted_slot_plan_seed",
        },
        auditOnly: {
          generationPath: null,
        },
        seed: {
          provenanceConsistency: {
            version: 1,
            readOnly: true,
            affectsScoringOrGeneration: false,
            consumedByProduction: false,
            status: "valid",
            seed: {
              available: true,
              source: "handoff_slot_plan_projection",
              executableShape: "set_aware",
            },
            warnings: [],
          },
        },
      },
      sessionSnapshot: {
        version: 1,
        generated: {
          selectionMode: "INTENT",
          sessionIntent: "upper",
          semantics: {
            kind: "advancing",
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
            trace: { advancesSplitInput: true },
          },
          exerciseCount: 6,
          hardSetCount: 18,
          exercises: [
            buildGeneratedExercise("machine-shoulder-press", "Machine Shoulder Press", 0, "main", 2),
            buildGeneratedExercise("lat-pulldown", "Lat Pulldown", 1, "main", 3),
            buildGeneratedExercise("cable-fly", "Cable Fly", 2, "accessory", 3),
            buildGeneratedExercise("seated-cable-row", "Seated Cable Row", 3, "main", 3),
            buildGeneratedExercise("machine-lateral-raise", "Machine Lateral Raise", 4, "accessory", 4),
            buildGeneratedExercise("barbell-curl", "Barbell Curl", 5, "accessory", 3),
          ],
          traces: {
            progression: {},
          },
        },
      },
      projectedWeekVolume: {
        version: 1,
        currentWeek: {
          mesocycleId: "ceb2cff3-9d4d-4b3e-b309-c63ab28e62d4",
          week: 4,
          phase: "accumulation",
          blockType: "accumulation",
        },
        projectionNotes: [],
        completedVolumeByMuscle: {},
        projectedSessions,
        fullWeekByMuscle,
        currentWeekAudit: {
          belowMEV: ["Chest", "Triceps"],
          overMAV: [],
          underTargetClusters: [{ muscle: "Chest", deficit: 2 }],
          belowPreferred: [],
          fatigueRisks: [],
          ...(overrides.currentWeekAudit ?? {}),
        },
        sessionRisks: overrides.sessionRisks ?? [],
        runtimeDoseAdjustmentDiagnostics,
      },
      weeklyRetro: {
        week: 3,
        volumeTargeting: {
          overMav: [],
          overTargetOnly: [],
        },
        planAdherence: {
          plannedWorkCompletedSets: 46,
          plannedWorkTotalSets: 48,
          plannedWorkMissedSets: 2,
          explainedAdditions: {
            totalSets: 0,
          },
          engineConfidenceImpact: "none",
        },
      },
      preSessionReadiness: {
        readOnly: true,
        affectsScoringOrGeneration: false,
        consumedByProduction: false,
        wouldWriteTransaction: false,
        activeMesocycle: {
          mesocycleId: "ceb2cff3-9d4d-4b3e-b309-c63ab28e62d4",
          state: "ACTIVE_ACCUMULATION",
          completedAccumulationSessions: 14,
          deloadSessionsCompleted: 0,
          deloadSessionsExpected: 4,
          deloadSessionPosition: null as { current: number; total: number } | null,
          currentWeek: 4,
          currentSession: 3,
          requestedMesocycleId: "ceb2cff3-9d4d-4b3e-b309-c63ab28e62d4",
          mesocycleIdMatchesRequest: true,
        },
      },
      warningSummary: {
        blockingErrors: [],
        semanticWarnings: [],
        backgroundWarnings: [],
        counts: {
          blockingErrors: 0,
          semanticWarnings: 0,
          backgroundWarnings: 0,
        },
      },
    };
  }

  function buildGeneratedExercise(
    exerciseId: string,
    exerciseName: string,
    orderIndex: number,
    section: "main" | "accessory",
    prescribedSetCount: number
  ) {
    return {
      exerciseId,
      exerciseName,
      orderIndex,
      section,
      isMainLift: section === "main",
      prescribedSetCount,
      prescribedSets: [
        {
          setIndex: 1,
          targetLoad: 10,
          targetRepRange: { min: 8, max: 12 },
          targetRpe: 8,
        },
      ],
    };
  }

  function buildFullWeekRow(
    muscle: string,
    projectedFullWeekEffectiveSets: number,
    weeklyTarget: number,
    mev: number,
    mav: number,
    targetTier: string
  ) {
    return {
      muscle,
      targetKind: "hard",
      displayGroup: targetTier === "A_PRIMARY" ? "primary" : "support",
      targetTier,
      warningSeverity: targetTier === "A_PRIMARY" ? "hard" : "soft",
      dashboardGroup:
        targetTier === "A_PRIMARY" ? "primary_driver" : "support_driver",
      completedEffectiveSets: 0,
      projectedNextSessionEffectiveSets: projectedFullWeekEffectiveSets,
      projectedRemainingWeekEffectiveSets: 0,
      projectedFullWeekEffectiveSets,
      weeklyTarget,
      mev,
      mav,
      mrv: mav + 6,
      deltaToTarget: Number((projectedFullWeekEffectiveSets - weeklyTarget).toFixed(1)),
      deltaToMev: Number((projectedFullWeekEffectiveSets - mev).toFixed(1)),
      deltaToMav: Number((projectedFullWeekEffectiveSets - mav).toFixed(1)),
    };
  }

  function buildDoseDiagnostic(
    muscle: string,
    effectiveSets: number,
    weeklyTarget: number,
    mev: number,
    mav: number,
    kind: "hold_seed" | "add_set" | "optional_add_set",
    exerciseName: string | undefined
  ) {
    return {
      muscle,
      plannedRemainingVolume: {
        effectiveSets,
        bySlot:
          exerciseName != null
            ? [{ slotId: "upper_b", exerciseName, effectiveSets }]
            : [],
      },
      performedWeekToDateVolume: {
        effectiveSets: 0,
        source: "weekly_volume_read_model",
      },
      projectedEndOfWeekVolume: {
        effectiveSets,
        weeklyTarget,
        mev,
        mav,
      },
      targetStatus:
        effectiveSets > mav
          ? "over_mav"
          : effectiveSets >= mav - 2
            ? "near_mav"
            : effectiveSets < mev
              ? "below_mev"
              : effectiveSets < weeklyTarget
                ? weeklyTarget >= mav - 2
                  ? "stretch_miss"
                  : "below_preferred"
                : "productive_zone",
      fatigueDensityConcern: {
        level: "none",
        drivers: [],
      },
      recoveryReadinessCaveat: {
        status: "none",
      },
      recommendedAction: {
        kind,
        ...(exerciseName ? { slotId: "upper_b", exerciseName } : {}),
        setDelta: kind === "hold_seed" ? 0 : 1,
      },
      reasonCode:
        kind === "hold_seed"
          ? effectiveSets < weeklyTarget && effectiveSets >= mev
            ? "below_preferred_monitor"
            : "seed_truth_preserved"
          : Math.abs(effectiveSets - mev) <= 1.25
            ? "close_low_volume_opportunity"
            : "mev_floor_deficit",
      guidance:
        effectiveSets < mev
          ? "below MEV floor; bounded low-fatigue closure if readiness and time allow"
          : effectiveSets < weeklyTarget
            ? "productive floor achieved; below preferred target; monitor, no default add-on"
            : "productive zone achieved; hold seed",
      confidence: 0.8,
      readOnly: true,
      affectsAcceptedSeed: false,
    };
  }

  function attachReadinessContract<T extends ReturnType<typeof buildWeek4UpperBPreSessionArtifact>>(
    artifact: T
  ): T & { preSessionReadiness: PreSessionReadinessAuditPayload } {
    const preSessionReadiness =
      artifact.preSessionReadiness as PreSessionReadinessAuditPayload;
    preSessionReadiness.contract = buildPreSessionReadinessContract({
      userId: artifact.identity.userId,
      ownerEmail: artifact.identity.ownerEmail,
      evidence: toPreSessionReadinessEvidence(preSessionReadiness),
      nextSession: artifact.nextSession as never,
      sessionSnapshot: artifact.sessionSnapshot as never,
      generationPath: artifact.generationPath as never,
      seedConsistency:
        artifact.generationProvenance.seed.provenanceConsistency as never,
      projectedWeek: toPreSessionReadinessProjectedWeekEvidence(
        artifact.projectedWeekVolume as never
      ),
      weeklyRetro: toPreSessionReadinessWeeklyRetroEvidence(
        artifact.weeklyRetro as never
      ),
    });
    return {
      ...artifact,
      preSessionReadiness,
    };
  }

  it("prints generated preview, dose guidance, add-ons, and safe-to-train status", () => {
    const summary = buildPreSessionReadinessSummary({
      operatorDebug: false,
      artifact: {
        identity: {
          userId: "user-1",
          ownerEmail: "owner@test.local",
        },
        request: {
          mode: "pre-session-readiness",
          ownerEmail: "owner@test.local",
          mesocycleId: "meso-1",
        },
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
        generationPath: {
          requestedMode: "pre-session-readiness",
          executionMode: "standard_generation",
          generator: "generateSessionFromIntent",
          reason: "standard_future_week_or_preview",
        },
        generationProvenance: {
          receiptProvenance: {
            mesocycleId: "meso-1",
            compositionSource: "persisted_slot_plan_seed",
          },
          auditOnly: {
            generationPath: null,
          },
          seed: {
            provenanceConsistency: {
              version: 1,
              readOnly: true,
              affectsScoringOrGeneration: false,
              consumedByProduction: false,
              status: "valid",
              seed: {
                available: true,
                source: "handoff_slot_plan_projection",
                executableShape: "set_aware",
              },
              warnings: [],
            },
          },
        },
        sessionSnapshot: {
          version: 1,
          generated: {
            selectionMode: "INTENT",
            sessionIntent: "upper",
            semantics: {
              kind: "advancing",
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
              trace: { advancesSplitInput: true },
            },
            exerciseCount: 2,
            hardSetCount: 7,
            exercises: [
              {
                exerciseId: "incline",
                exerciseName: "Incline Machine Press",
                orderIndex: 0,
                section: "main",
                isMainLift: true,
                prescribedSetCount: 4,
                prescribedSets: [
                  {
                    setIndex: 1,
                    targetLoad: 132.5,
                    targetRepRange: { min: 8, max: 10 },
                    targetRpe: 8,
                  },
                ],
              },
              {
                exerciseId: "rear-delt",
                exerciseName: "Cable Rear Delt Fly",
                orderIndex: 1,
                section: "accessory",
                isMainLift: false,
                prescribedSetCount: 3,
                prescribedSets: [
                  {
                    setIndex: 1,
                    targetLoad: 10,
                    targetRepRange: { min: 12, max: 15 },
                    targetRpe: 8,
                  },
                ],
              },
            ],
            traces: {
              progression: {
                incline: {
                  version: 1,
                  decisionSource: "double_progression",
                  repRange: { min: 8, max: 10 },
                  equipment: "other",
                  anchor: {
                    source: "working_set",
                    workingSetApplied: true,
                    anchorLoad: 130,
                    signalSetCount: 4,
                    effectiveSetCount: 4,
                    trimmedSetCount: 0,
                    highVarianceDetected: false,
                    minSignalLoad: 130,
                    maxSignalLoad: 130,
                    medianSignalLoad: 130,
                  },
                  confidence: {
                    priorSessionCount: 3,
                    sampleScale: 1,
                    historyScale: 1,
                    combinedScale: 0.8,
                    reasons: ["recent_history"],
                  },
                  metrics: {
                    medianReps: 9,
                    modalRpe: 8,
                    nextLoad: 132.5,
                    loadDelta: 2.5,
                  },
                  outcome: {
                    path: "path_1",
                    action: "increase",
                    reasonCodes: ["clean_progression"],
                  },
                  decisionLog: [],
                },
              },
            },
          },
        },
        projectedWeekVolume: {
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
              exerciseCount: 2,
              totalSets: 7,
              projectedContributionByMuscle: {
                Chest: 4,
                "Rear Delts": 3,
              },
            },
          ],
          fullWeekByMuscle: [],
          currentWeekAudit: {
            belowMEV: [],
            overMAV: [],
            underTargetClusters: [],
            belowPreferred: [
              { muscle: "Rear Delts", deficit: 1, status: "below_preferred" },
            ],
            fatigueRisks: [],
          },
          runtimeDoseAdjustmentDiagnostics: [
            {
              muscle: "Rear Delts",
              plannedRemainingVolume: {
                effectiveSets: 3,
                bySlot: [
                  {
                    slotId: "upper_a",
                    exerciseName: "Cable Rear Delt Fly",
                    effectiveSets: 3,
                  },
                ],
              },
              performedWeekToDateVolume: {
                effectiveSets: 4,
                source: "weekly_volume_read_model",
              },
              projectedEndOfWeekVolume: {
                effectiveSets: 7,
                weeklyTarget: 8,
                mev: 4,
                mav: 12,
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
        },
        weeklyRetro: {
          week: 3,
          volumeTargeting: {
            overMav: [],
            overTargetOnly: ["Triceps"],
          },
          planAdherence: {
            plannedWorkCompletedSets: 46,
            plannedWorkTotalSets: 48,
            plannedWorkMissedSets: 2,
            explainedAdditions: {
              totalSets: 3,
            },
            engineConfidenceImpact: "low",
          },
        },
        preSessionReadiness: {
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
        },
        warningSummary: {
          blockingErrors: [],
          semanticWarnings: [],
          backgroundWarnings: [],
          counts: {
            blockingErrors: 0,
            semanticWarnings: 0,
            backgroundWarnings: 0,
          },
        },
      } as never,
    });

    expect(summary).toEqual(
      expect.arrayContaining([
        "Pre-Session Readiness",
        "Deload sessions completed: n/a",
        "Deload session position: n/a",
        "Seed order/set counts respected: yes, generated preview is from persisted seed replay",
        "Generated Preview",
        "Order | Exercise | Sets | Load | Rep target/range | RPE",
        "1 | Incline Machine Press | 4 | 132.5 | 8-10 | 8",
        "2 | Cable Rear Delt Fly | 3 | 10 | 12-15 | 8",
        "Current-Week Dose Guidance",
        "Rear Delts | 7 vs MEV 4 / target 8 / MAV 12 | below_preferred | monitor, no default add-on | 0.8",
        "Session-Local Add-On Recommendation",
        "Use Dose Closure Guidance for MEV-floor top-ups; session-local only.",
        "- none",
        "Safe to train: yes",
      ]),
    );
  });

  it("prints deload session progress directly for pre-session readiness", () => {
    const artifact = buildWeek4UpperBPreSessionArtifact();
    artifact.nextSession = {
      ...artifact.nextSession,
      intent: "lower",
      slotId: "lower_a",
      slotSequenceIndex: 1,
      weekInMeso: 5,
      sessionInWeek: 2,
    };
    artifact.generationPath = {
      requestedMode: "pre-session-readiness",
      executionMode: "active_deload_reroute",
      generator: "generateDeloadSessionFromIntent",
      reason: "active_mesocycle_state_active_deload",
    };
    artifact.generationProvenance.receiptProvenance.compositionSource =
      "deload_seed_replay";
    artifact.projectedWeekVolume.currentWeek = {
      mesocycleId: "ceb2cff3-9d4d-4b3e-b309-c63ab28e62d4",
      week: 5,
      phase: "deload",
      blockType: "deload",
    };
    artifact.preSessionReadiness.activeMesocycle = {
      ...artifact.preSessionReadiness.activeMesocycle,
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
    };

    const summary = buildPreSessionReadinessSummary({
      operatorDebug: true,
      artifact: artifact as never,
    });

    expect(summary).toEqual(
      expect.arrayContaining([
        expect.stringContaining("state=ACTIVE_DELOAD"),
        expect.stringContaining("current_week=5 current_session=2"),
        "Deload sessions completed: 1",
        "Deload session position: 2 of 4",
        expect.stringContaining("path=active_deload_reroute"),
        expect.stringContaining("composition_source=deload_seed_replay"),
        "Exercise identity/order source: accepted seed replay for deload",
        "Set-count policy: deload-adjusted; accumulation seed set counts intentionally reduced",
        "Current-Week Dose Guidance (Deload Context)",
        "Deload is intentionally reduced volume; do not chase MEV/target deficits.",
        "Chest | 7 vs MEV 10 / target 12 / MAV 16 | deload_non_actionable:below_mev | deload context: non-actionable; do not top up | 0.8",
        "Dose Closure Guidance (Deload Context)",
        "- none - deload volume deficits are expected/non-actionable.",
        "- all hypertrophy add-set / MEV closure top-ups during ACTIVE_DELOAD.",
        "Session-Local Coaching Readout",
        "- none - deload context suppresses hypertrophy top-ups",
        "Safe optional add-ons:",
        "- all hypertrophy add-ons / MEV closure top-ups during ACTIVE_DELOAD",
        "Run deload seed as prescribed.",
        "- hypertrophy add-ons / MEV closure top-ups during ACTIVE_DELOAD",
        "Safe to train: yes",
      ])
    );
    const joined = summary?.join("\n") ?? "";
    expect(joined).not.toContain("Use Dose Closure Guidance for MEV-floor top-ups");
    expect(joined).not.toContain("Recommended: +");
    expect(joined).not.toContain("- Add +");
    expect(joined).not.toContain("consider +1");
    expect(joined).not.toContain("Seed order/set counts respected: unknown");
    expect(joined).not.toContain("accumulation seed set counts preserved");
  });

  it("treats a matching planned next workout as ready instead of an incomplete blocker", () => {
    const artifact = buildWeek4UpperBPreSessionArtifact();
    artifact.nextSession = {
      ...artifact.nextSession,
      source: "existing_incomplete",
      existingWorkoutId: "planned-next",
      isExisting: true,
      selectedIncompleteStatus: "planned",
      selectedIncompleteReadiness: {
        classification: "matching_next_planned_workout",
        safeToTrain: true,
        action: "start_logging",
        reason:
          "Planned workout matches the next expected seeded slot, exercise order, and set counts; start or resume logging it.",
      },
    } as never;

    const summary = buildPreSessionReadinessSummary({
      operatorDebug: true,
      artifact: artifact as never,
    });
    const joined = summary?.join("\n") ?? "";

    expect(summary).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "incomplete_workout_blocker=none incomplete_workout_readiness=matching_next_planned_workout (start_logging)"
        ),
        "Existing workout action: Planned workout matches the next expected seeded slot, exercise order, and set counts; start or resume logging it.",
        "Safe to train: yes",
      ])
    );
    expect(joined).not.toContain("incomplete workout blocker: planned-next");
  });

  it("keeps a stale planned workout as an unsafe incomplete blocker", () => {
    const artifact = buildWeek4UpperBPreSessionArtifact();
    artifact.nextSession = {
      ...artifact.nextSession,
      source: "existing_incomplete",
      existingWorkoutId: "stale-plan",
      isExisting: true,
      selectedIncompleteStatus: "planned",
      selectedIncompleteReadiness: {
        classification: "stale_or_mismatched_incomplete_workout",
        safeToTrain: false,
        action: "block_or_cleanup",
        reason:
          "Incomplete planned workout does not match the next expected seeded slot, seed exercise plan, mesocycle, or clean planned state.",
      },
    } as never;

    const summary = buildPreSessionReadinessSummary({
      operatorDebug: true,
      artifact: artifact as never,
    });

    expect(summary).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "incomplete_workout_blocker=stale-plan (planned) incomplete_workout_readiness=stale_or_mismatched_incomplete_workout (block_or_cleanup)"
        ),
        "Existing workout action: Incomplete planned workout does not match the next expected seeded slot, seed exercise plan, mesocycle, or clean planned state.",
        "Safe to train: no",
        "Reason: incomplete workout blocker: stale-plan (planned)",
      ])
    );
  });

  it("treats an in-progress workout as resumable instead of an incomplete blocker", () => {
    const artifact = buildWeek4UpperBPreSessionArtifact();
    artifact.nextSession = {
      ...artifact.nextSession,
      source: "existing_incomplete",
      existingWorkoutId: "in-progress-next",
      isExisting: true,
      selectedIncompleteStatus: "in_progress",
      selectedIncompleteReadiness: {
        classification: "in_progress_workout",
        safeToTrain: true,
        action: "resume_logging",
        reason: "Existing workout is already started; resume it instead of generating another workout.",
      },
    } as never;

    const summary = buildPreSessionReadinessSummary({
      operatorDebug: true,
      artifact: artifact as never,
    });
    const joined = summary?.join("\n") ?? "";

    expect(summary).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "incomplete_workout_blocker=none incomplete_workout_readiness=in_progress_workout (resume_logging)"
        ),
        "Existing workout action: Existing workout is already started; resume it instead of generating another workout.",
        "Safe to train: yes",
      ])
    );
    expect(joined).not.toContain("incomplete workout blocker: in-progress-next");
  });

  it("labels ACTIVE_DELOAD status lines as deload diagnostics with accumulation reference week", () => {
    const line = buildWorkoutAuditModeLine({
      mode: "pre-session-readiness",
      plannerDiagnosticsMode: "standard",
      summary: "week=4 projected_sessions=1",
      preSessionReadiness: {
        activeMesocycle: {
          mesocycleId: "meso-1",
          state: "ACTIVE_DELOAD",
          completedAccumulationSessions: 16,
          deloadSessionsCompleted: 2,
          deloadSessionsExpected: 4,
          deloadSessionPosition: { current: 3, total: 4 },
          currentWeek: 5,
          currentSession: 3,
        },
      },
      projectedWeekVolume: {
        currentWeek: {
          mesocycleId: "meso-1",
          week: 5,
          phase: "deload",
          blockType: "deload",
        },
      },
      weeklyRetro: { week: 4 },
    });

    expect(line).toBe(
      "[workout-audit] mode=pre-session-readiness diagnostics=deload planner_diagnostics=standard deload_week=5 accumulation_reference_week=4 projected_sessions=1"
    );
    expect(line).not.toContain("diagnostics=standard week=4");
    expect(line).not.toContain(" week=4 ");
  });

  it("preserves accumulation status-line diagnostics labels", () => {
    const line = buildWorkoutAuditModeLine({
      mode: "pre-session-readiness",
      plannerDiagnosticsMode: "debug",
      summary: "week=4 projected_sessions=1",
      preSessionReadiness: {
        activeMesocycle: {
          mesocycleId: "meso-1",
          state: "ACTIVE_ACCUMULATION",
          completedAccumulationSessions: 14,
          deloadSessionsCompleted: 0,
          deloadSessionsExpected: 4,
          deloadSessionPosition: null,
          currentWeek: 4,
          currentSession: 3,
        },
      },
      projectedWeekVolume: {
        currentWeek: {
          mesocycleId: "meso-1",
          week: 4,
          phase: "accumulation",
          blockType: "accumulation",
        },
      },
    });

    expect(line).toBe(
      "[workout-audit] mode=pre-session-readiness diagnostics=debug week=4 projected_sessions=1"
    );
  });

  it("prints closeout-required blocker for pre-session readiness", () => {
    const blockerMessage =
      "Week 4 closeout is pending. Resolve or dismiss the optional gap-fill before generating the Week 5 deload. Standard accumulation generation is blocked to prevent an unintended extra accumulation session.";
    const summary = buildPreSessionReadinessSummary({
      artifact: {
        identity: {
          userId: "user-1",
          ownerEmail: "owner@test.local",
        },
        request: {
          mode: "pre-session-readiness",
          ownerEmail: "owner@test.local",
          mesocycleId: "meso-1",
        },
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
            message: blockerMessage,
            mesocycleId: "meso-1",
            weekCloseId: "wc-4",
            targetWeek: 4,
          },
        },
        generation: { error: blockerMessage },
        generationPath: {
          requestedMode: "pre-session-readiness",
          executionMode: "blocked_closeout_required",
          generator: "none",
          reason: "final_accumulation_week_close_pending",
        },
        generationProvenance: {
          receiptProvenance: {
            mesocycleId: null,
            compositionSource: null,
          },
          auditOnly: {
            generationPath: null,
          },
        },
        projectedWeekVolume: {
          currentWeek: {
            mesocycleId: "meso-1",
            week: 4,
            phase: "accumulation",
            blockType: "accumulation",
          },
          projectionNotes: [blockerMessage],
          completedVolumeByMuscle: {},
          projectedSessions: [],
          fullWeekByMuscle: [],
          runtimeDoseAdjustmentDiagnostics: [],
        },
        warningSummary: {
          blockingErrors: [blockerMessage],
          semanticWarnings: [],
          backgroundWarnings: [],
          counts: {
            blockingErrors: 1,
            semanticWarnings: 0,
            backgroundWarnings: 0,
          },
        },
        preSessionReadiness: {
          readOnly: true,
          affectsScoringOrGeneration: false,
          consumedByProduction: false,
          wouldWriteTransaction: false,
          activeMesocycle: {
            mesocycleId: "meso-1",
            state: "ACTIVE_ACCUMULATION",
            completedAccumulationSessions: 16,
            deloadSessionsCompleted: 0,
            deloadSessionsExpected: 4,
            deloadSessionPosition: null,
            currentWeek: 4,
            currentSession: 4,
            requestedMesocycleId: "meso-1",
            mesocycleIdMatchesRequest: true,
          },
        },
      } as never,
      operatorDebug: true,
    });

    expect(summary).toEqual(
      expect.arrayContaining([
        `Lifecycle blocker: ${blockerMessage}`,
        "Generated Preview",
        `generation_error | ${blockerMessage}`,
        "Safe to train: no",
        expect.stringContaining(blockerMessage),
      ])
    );
  });

  it("prints final-opportunity MEV closure, marginal top-up, suppressions, and guardrails", () => {
    const artifact = buildWeek4UpperBPreSessionArtifact();
    const volumeRowsBefore = JSON.parse(
      JSON.stringify(artifact.projectedWeekVolume.fullWeekByMuscle)
    );
    const summary = buildPreSessionReadinessSummary({
      operatorDebug: false,
      artifact: artifact as never,
    });

    expect(summary).toEqual(
      expect.arrayContaining([
        "Dose Closure Guidance",
        "Priority:",
        "- Chest: projected 7 / MEV 10; gap 3 weighted sets. Candidate: Cable Fly or Pec Deck. Estimated contribution: ~0.6 weighted Chest sets per raw Cable Fly set. Recommended: +5 raw low-fatigue isolation sets if readiness/time allow. Expected outcome: likely closes MEV floor. A +1-2 raw add-on is expected to reduce the deficit, not fully close MEV. Guardrail: do not chase full target or add pressing.",
        "Optional:",
        "- Triceps: projected 5.6 / MEV 6; gap 0.4 weighted sets. Optional +1 Pushdown if readiness/time/elbows are good. Expected outcome: close or reduce tiny MEV gap; low-fatigue isolation only.",
        "Suppress:",
        "- Biceps: projected above MEV after seed; no extra curls.",
        "- Side Delts: at MEV after seed; no extra lateral raises.",
        "- Lats: projected above MEV after seed; no extra pulldowns.",
        "- Upper Back: projected above MEV after seed; no extra rows.",
        "Guardrails:",
        "- session-local only; no seed/runtime/save/progression mutation",
        "- do not add extra pressing",
        "- do not add extra rows/pulldowns",
        "- do not chase full target deficit",
        "- avoid exceeding MAV/MRV; accept the miss if closure requires excessive raw volume",
        "Use Dose Closure Guidance for MEV-floor top-ups; session-local only.",
        "- Add +5 raw sets of Cable Fly or Pec Deck if readiness/time allow.",
        "- Add +1 Pushdown if readiness/time/elbows are good.",
        "Safe to train: yes",
      ])
    );
    expect(summary).not.toContain("- chest/triceps top-up");
    expect(summary).not.toContain("- Add +1 Barbell Curl if readiness/time allow.");
    expect(summary).not.toContain("- Add +1 Machine Lateral Raise if readiness/time allow.");
    expect(artifact.projectedWeekVolume.fullWeekByMuscle).toEqual(volumeRowsBefore);
  });

  it("surfaces a Chest exact-floor Cable Crossover buffer as session-local optional isolation", () => {
    const artifact = buildWeek4UpperBPreSessionArtifact({
      projectedSessions: [
        {
          slotId: "upper_b",
          intent: "upper",
          isNext: true,
          exerciseCount: 2,
          totalSets: 7,
          exercises: [
            {
              exerciseId: "machine-chest-press",
              name: "Machine Chest Press",
              setCount: 4,
              role: "primary",
              effectiveStimulusByMuscle: { Chest: 4, Triceps: 2 },
            },
            {
              exerciseId: "cable-crossover",
              name: "Cable Crossover",
              setCount: 3,
              role: "accessory",
              effectiveStimulusByMuscle: { Chest: 3 },
            },
          ],
          projectedContributionByMuscle: { Chest: 3, Triceps: 2 },
        },
      ],
      fullWeekByMuscle: [
        buildFullWeekRow("Chest", 10, 12, 10, 16, "A_PRIMARY"),
        buildFullWeekRow("Triceps", 8, 8, 6, 12, "B_SUPPORT"),
      ],
      runtimeDoseAdjustmentDiagnostics: [
        buildDoseDiagnostic("Chest", 10, 12, 10, 16, "hold_seed", undefined),
        buildDoseDiagnostic("Triceps", 8, 8, 6, 12, "hold_seed", undefined),
      ],
    });

    const summary = buildPreSessionReadinessSummary({
      operatorDebug: false,
      artifact: artifact as never,
    });
    const joined = summary?.join("\n") ?? "";

    expect(summary).toEqual(
      expect.arrayContaining([
        "Session-Local Coaching Readout",
        "Floor-buffer opportunities:",
        "- Chest: projected 10 / MEV 10; floor margin 0 weighted sets. Optional +1 Cable Crossover or Pec Deck if readiness/time allow as a session-local buffer only. Expected outcome: add a thin MEV cushion without changing the accepted seed; low-fatigue isolation only.",
        "Safe optional add-ons:",
        "- Optional session-local +1 Cable Crossover or Pec Deck if readiness/time allow for floor buffer only.",
        "Suppress / avoid:",
        "- extra pressing",
      ])
    );
    expect(joined).not.toContain("Optional +1 Machine Chest Press");
    expect(joined).not.toContain("- Add +1 Machine Chest Press");
  });

  it("does not treat Iso-Lateral pulldown text as side-delt isolation", () => {
    const artifact = attachReadinessContract(
      buildWeek4UpperBPreSessionArtifact({
        projectedSessions: [
          {
            slotId: "upper_b",
            intent: "upper",
            isNext: true,
            exerciseCount: 2,
            totalSets: 7,
            exercises: [
              {
                exerciseId: "lat-pulldown",
                name: "Iso-Lateral Front Lat Pulldown",
                setCount: 3,
                role: "primary",
                effectiveStimulusByMuscle: { Lats: 3 },
              },
              {
                exerciseId: "cable-lateral-raise",
                name: "Cable Lateral Raise",
                setCount: 4,
                role: "accessory",
                effectiveStimulusByMuscle: { "Side Delts": 4 },
              },
            ],
            projectedContributionByMuscle: { Lats: 3, "Side Delts": 4 },
          },
        ],
        fullWeekByMuscle: [
          buildFullWeekRow("Side Delts", 6, 8, 6, 16, "B_SUPPORT"),
          buildFullWeekRow("Lats", 12, 12, 8, 16, "A_PRIMARY"),
        ],
        runtimeDoseAdjustmentDiagnostics: [
          buildDoseDiagnostic("Side Delts", 6, 8, 6, 16, "hold_seed", undefined),
          buildDoseDiagnostic("Lats", 12, 12, 8, 16, "hold_seed", undefined),
        ],
      })
    );

    const summary = buildPreSessionReadinessSummary({
      operatorDebug: false,
      artifact: artifact as never,
    });
    const joined = summary?.join("\n") ?? "";

    expect(joined).toContain("Optional +1 Cable Lateral Raise");
    expect(joined).not.toContain("Optional +1 Iso-Lateral Front Lat Pulldown");
  });

  it("reports a fatigue watch for a squat plus hinge week before optional add-ons", () => {
    const artifact = buildWeek4UpperBPreSessionArtifact({
      projectedSessions: [
        {
          slotId: "lower_b",
          intent: "lower",
          isNext: true,
          exerciseCount: 4,
          totalSets: 14,
          movementPatternCounts: { squat: 1, hinge: 1, lunge: 1 },
          exercises: [
            {
              exerciseId: "back-squat",
              name: "Back Squat",
              setCount: 4,
              role: "primary",
              effectiveStimulusByMuscle: { Quads: 4, Glutes: 2 },
            },
            {
              exerciseId: "romanian-deadlift",
              name: "Romanian Deadlift",
              setCount: 4,
              role: "primary",
              effectiveStimulusByMuscle: { Hamstrings: 4, Glutes: 3, "Lower Back": 2 },
            },
            {
              exerciseId: "walking-lunge",
              name: "Walking Lunge",
              setCount: 3,
              role: "accessory",
              effectiveStimulusByMuscle: { Quads: 2, Glutes: 2 },
            },
          ],
          projectedContributionByMuscle: {
            Quads: 6,
            Hamstrings: 4,
            Glutes: 7,
            "Lower Back": 2,
          },
        },
      ],
      fullWeekByMuscle: [
        buildFullWeekRow("Quads", 10, 10, 8, 16, "A_PRIMARY"),
        buildFullWeekRow("Hamstrings", 8, 8, 6, 14, "A_PRIMARY"),
        buildFullWeekRow("Glutes", 15, 12, 6, 14, "B_SUPPORT"),
      ],
      runtimeDoseAdjustmentDiagnostics: [
        {
          ...buildDoseDiagnostic("Glutes", 15, 12, 6, 14, "hold_seed", undefined),
          targetStatus: "over_mav",
          fatigueDensityConcern: {
            level: "meaningful",
            drivers: [
              {
                slotId: "lower_b",
                exerciseName: "Romanian Deadlift",
                pattern: "hinge",
              },
              {
                slotId: "lower_b",
                exerciseName: "Back Squat",
                pattern: "squat",
              },
            ],
          },
          reasonCode: "posterior_fatigue_meaningful",
          guidance: "over MAV; caution and suppress add-ons",
        },
      ],
      currentWeekAudit: {
        fatigueRisks: [
          "lower_b: high systemic fatigue pattern: squat/hinge/lunge stacking with glutes/lower back stimulus",
        ],
      },
      sessionRisks: [
        {
          slotId: "lower_b",
          issue:
            "high systemic fatigue pattern: squat/hinge/lunge stacking with glutes/lower back stimulus",
        },
      ],
    });
    artifact.nextSession.intent = "lower";
    artifact.nextSession.slotId = "lower_b";

    const summary = buildPreSessionReadinessSummary({
      operatorDebug: false,
      artifact: artifact as never,
    });

    expect(summary).toEqual(
      expect.arrayContaining([
        "Fatigue cautions:",
        "- lower_b: high systemic fatigue pattern: squat/hinge/lunge stacking with glutes/lower back stimulus",
        "- Glutes: meaningful fatigue watch via Romanian Deadlift, Back Squat",
        "Safe optional add-ons:",
        "- none",
      ])
    );
  });

  it("does not mutate seed provenance, generated preview, or runtime dose evidence while formatting coaching", () => {
    const artifact = buildWeek4UpperBPreSessionArtifact({
      fullWeekByMuscle: [
        buildFullWeekRow("Chest", 10, 12, 10, 16, "A_PRIMARY"),
      ],
      runtimeDoseAdjustmentDiagnostics: [
        buildDoseDiagnostic("Chest", 10, 12, 10, 16, "hold_seed", undefined),
      ],
    });
    const before = JSON.parse(
      JSON.stringify({
        generationProvenance: artifact.generationProvenance,
        generated: artifact.sessionSnapshot.generated,
        projectedWeekVolume: artifact.projectedWeekVolume,
        preSessionReadiness: artifact.preSessionReadiness,
      })
    );

    const summary = buildPreSessionReadinessSummary({
      operatorDebug: false,
      artifact: artifact as never,
    });

    expect({
      generationProvenance: artifact.generationProvenance,
      generated: artifact.sessionSnapshot.generated,
      projectedWeekVolume: artifact.projectedWeekVolume,
      preSessionReadiness: artifact.preSessionReadiness,
    }).toEqual(before);
    expect(summary).toEqual(
      expect.arrayContaining([
        "Boundary: recommendations only; no workout/session/log/seed/progression mutation.",
      ])
    );
  });

  it("reflects Lower B calf MEV floor closure in session-local add-ons without upper-body or hinge work", () => {
    const artifact = buildWeek4UpperBPreSessionArtifact({
      projectedSessions: [
        {
          slotId: "lower_b",
          intent: "lower",
          isNext: true,
          exerciseCount: 4,
          totalSets: 12,
          exercises: [
            {
              exerciseId: "stiff-legged-deadlift",
              name: "Stiff-Legged Deadlift",
              setCount: 3,
              role: "primary",
              effectiveStimulusByMuscle: { Hamstrings: 3, Glutes: 1.5, "Lower Back": 1 },
            },
            {
              exerciseId: "leg-curl",
              name: "Lying Leg Curl",
              setCount: 3,
              role: "accessory",
              effectiveStimulusByMuscle: { Hamstrings: 3 },
            },
            {
              exerciseId: "seated-calf-raise",
              name: "Seated Calf Raise",
              setCount: 4,
              role: "accessory",
              effectiveStimulusByMuscle: { Calves: 4 },
            },
          ],
          projectedContributionByMuscle: {
            Hamstrings: 6,
            Glutes: 1.5,
            "Lower Back": 1,
            Calves: 4,
          },
        },
      ],
      fullWeekByMuscle: [
        buildFullWeekRow("Chest", 7, 12, 10, 16, "A_PRIMARY"),
        buildFullWeekRow("Hamstrings", 8, 8, 6, 14, "A_PRIMARY"),
        buildFullWeekRow("Calves", 7, 10, 8, 14, "B_SUPPORT"),
      ],
      runtimeDoseAdjustmentDiagnostics: [
        buildDoseDiagnostic("Chest", 7, 12, 10, 16, "add_set", "Cable Fly"),
        buildDoseDiagnostic(
          "Calves",
          7,
          10,
          8,
          14,
          "optional_add_set",
          "Seated Calf Raise"
        ),
        buildDoseDiagnostic("Hamstrings", 8, 8, 6, 14, "hold_seed", undefined),
      ],
    });
    artifact.nextSession.intent = "lower";
    artifact.nextSession.slotId = "lower_b";
    artifact.nextSession.sessionInWeek = 4;
    artifact.sessionSnapshot.generated.sessionIntent = "lower";
    artifact.sessionSnapshot.generated.exercises = [
      buildGeneratedExercise("stiff-legged-deadlift", "Stiff-Legged Deadlift", 0, "main", 3),
      buildGeneratedExercise("leg-curl", "Lying Leg Curl", 1, "accessory", 3),
      buildGeneratedExercise("seated-calf-raise", "Seated Calf Raise", 2, "accessory", 4),
    ];

    const summary = buildPreSessionReadinessSummary({
      operatorDebug: false,
      artifact: artifact as never,
    });

    expect(summary).toEqual(
      expect.arrayContaining([
        "- Calves: projected 7 / MEV 8; gap 1 weighted sets. Optional +1 Seated Calf Raise or equivalent Standing Calf Raise if calves/Achilles/feet feel good. Expected outcome: close or reduce tiny MEV gap; low-fatigue isolation only.",
        "- Add +1 Seated Calf Raise or equivalent Standing Calf Raise if calves/Achilles/feet feel good.",
        "- upper-body work",
        "- extra hinge",
      ])
    );
    expect(summary).not.toContain("- Chest: projected 7 / MEV 10; gap 3 weighted sets. Candidate: Cable Fly or Pec Deck.");
    expect(summary).not.toContain("- Add +5 raw sets of Cable Fly or Pec Deck if readiness/time allow.");
  });

  it("prints raw sets needed equal to weighted gap when candidate contribution is one-to-one", () => {
    const summary = buildPreSessionReadinessSummary({
      operatorDebug: false,
      artifact: buildWeek4UpperBPreSessionArtifact({
        projectedSessions: [
          {
            slotId: "upper_b",
            intent: "upper",
            isNext: true,
            exerciseCount: 1,
            totalSets: 3,
            exercises: [
              {
                exerciseId: "cable-fly",
                name: "Cable Fly",
                setCount: 3,
                role: "accessory",
                effectiveStimulusByMuscle: { Chest: 3 },
              },
            ],
            projectedContributionByMuscle: { Chest: 3 },
          },
        ],
        fullWeekByMuscle: [buildFullWeekRow("Chest", 7, 12, 10, 16, "A_PRIMARY")],
        runtimeDoseAdjustmentDiagnostics: [
          buildDoseDiagnostic("Chest", 7, 12, 10, 16, "add_set", "Cable Fly"),
        ],
      }) as never,
    });

    expect(summary).toEqual(
      expect.arrayContaining([
        "- Chest: projected 7 / MEV 10; gap 3 weighted sets. Candidate: Cable Fly or Pec Deck. Estimated contribution: ~1 weighted Chest sets per raw Cable Fly set. Recommended: +3 raw low-fatigue isolation sets if readiness/time allow. Expected outcome: likely closes MEV floor. A +1-2 raw add-on is expected to reduce the deficit, not fully close MEV. Guardrail: do not chase full target or add pressing.",
      ])
    );
  });

  it("accepts the miss when weighted closure would exceed the bounded raw-set cap", () => {
    const summary = buildPreSessionReadinessSummary({
      operatorDebug: false,
      artifact: buildWeek4UpperBPreSessionArtifact({
        projectedSessions: [
          {
            slotId: "upper_b",
            intent: "upper",
            isNext: true,
            exerciseCount: 1,
            totalSets: 2,
            exercises: [
              {
                exerciseId: "cable-fly",
                name: "Cable Fly",
                setCount: 2,
                role: "accessory",
                effectiveStimulusByMuscle: { Chest: 0.8 },
              },
            ],
            projectedContributionByMuscle: { Chest: 0.8 },
          },
        ],
        fullWeekByMuscle: [buildFullWeekRow("Chest", 7, 12, 10, 16, "A_PRIMARY")],
        runtimeDoseAdjustmentDiagnostics: [
          buildDoseDiagnostic("Chest", 7, 12, 10, 16, "add_set", "Cable Fly"),
        ],
      }) as never,
    });

    expect(summary).toEqual(
      expect.arrayContaining([
        "- Chest: projected 7 / MEV 10; gap 3 weighted sets. Candidate: Cable Fly or Pec Deck. Estimated contribution: ~0.4 weighted Chest sets per raw Cable Fly set. Closing would require about 8 raw sets, above the bounded top-up cap. Recommended: +2-5 raw low-fatigue isolation sets only if readiness/time allow. Expected outcome: reduce deficit but may still miss MEV; accept the miss rather than chase volume today. Guardrail: do not chase full target or add pressing.",
      ])
    );
  });

  it("uses conservative close-vs-reduce wording when candidate contribution is unavailable", () => {
    const summary = buildPreSessionReadinessSummary({
      operatorDebug: false,
      artifact: buildWeek4UpperBPreSessionArtifact({
        projectedSessions: [
          {
            slotId: "upper_b",
            intent: "upper",
            isNext: true,
            exerciseCount: 1,
            totalSets: 3,
            exercises: [
              {
                exerciseId: "cable-fly",
                name: "Cable Fly",
                setCount: 3,
                role: "accessory",
              },
            ],
            projectedContributionByMuscle: { Chest: 3 },
          },
        ],
        fullWeekByMuscle: [buildFullWeekRow("Chest", 7, 12, 10, 16, "A_PRIMARY")],
        runtimeDoseAdjustmentDiagnostics: [
          buildDoseDiagnostic("Chest", 7, 12, 10, 16, "add_set", "Cable Fly"),
        ],
      }) as never,
    });

    expect(summary).toEqual(
      expect.arrayContaining([
        "- Chest: projected 7 / MEV 10; gap 3 weighted sets. Candidate: Cable Fly or Pec Deck. Estimated contribution unavailable; raw set recommendation may reduce but not guarantee MEV closure. Recommended: +1-2 raw low-fatigue Chest isolation sets if readiness/time allow. Expected outcome: reduce deficit but may still miss MEV. Guardrail: accept the miss if full closure would require too much volume today; do not chase full target or add pressing.",
      ])
    );
  });

  it("defers a below-MEV top-up when another practical upper opportunity remains", () => {
    const summary = buildPreSessionReadinessSummary({
      operatorDebug: false,
      artifact: buildWeek4UpperBPreSessionArtifact({
        projectedSessions: [
          {
            slotId: "upper_a",
            intent: "upper",
            isNext: true,
            exerciseCount: 1,
            totalSets: 3,
            exercises: [
              {
                exerciseId: "cable-fly",
                name: "Cable Fly",
                setCount: 3,
                role: "accessory",
                effectiveStimulusByMuscle: { Chest: 3 },
              },
            ],
            projectedContributionByMuscle: { Chest: 3 },
          },
          {
            slotId: "upper_b",
            intent: "upper",
            isNext: false,
            exerciseCount: 1,
            totalSets: 3,
            exercises: [
              {
                exerciseId: "pec-deck",
                name: "Pec Deck",
                setCount: 3,
                role: "accessory",
                effectiveStimulusByMuscle: { Chest: 3 },
              },
            ],
            projectedContributionByMuscle: { Chest: 3 },
          },
        ],
        fullWeekByMuscle: [buildFullWeekRow("Chest", 7, 12, 10, 16, "A_PRIMARY")],
        runtimeDoseAdjustmentDiagnostics: [
          buildDoseDiagnostic("Chest", 7, 12, 10, 16, "add_set", "Cable Fly"),
        ],
      }) as never,
    });

    expect(summary).toEqual(
      expect.arrayContaining([
        "Priority:",
        "- none",
        "Monitor / defer:",
        "- Chest: projected 7 / MEV 10. Below MEV, but another practical upper opportunity remains; monitor after the seed.",
        "Optional add-ons:",
        "- none",
      ])
    );
  });

  it("uses the typed contract to make no-add-ons explicit when projected week needs no further action", () => {
    const artifact = attachReadinessContract(
      buildWeek4UpperBPreSessionArtifact({
        fullWeekByMuscle: [
          buildFullWeekRow("Chest", 12, 12, 10, 16, "A_PRIMARY"),
          buildFullWeekRow("Triceps", 8, 8, 6, 12, "B_SUPPORT"),
        ],
        runtimeDoseAdjustmentDiagnostics: [
          buildDoseDiagnostic("Chest", 12, 12, 10, 16, "hold_seed", undefined),
          buildDoseDiagnostic("Triceps", 8, 8, 6, 12, "hold_seed", undefined),
        ],
        currentWeekAudit: {
          belowMEV: [],
          overMAV: [],
          underTargetClusters: [],
          belowPreferred: [],
          fatigueRisks: [],
        },
      })
    );

    const summary = buildPreSessionReadinessSummary({
      operatorDebug: false,
      artifact: artifact as never,
    });

    expect(artifact.preSessionReadiness.contract?.projectedWeekStatus.status).toBe(
      "no_further_action"
    );
    expect(summary).toEqual(
      expect.arrayContaining([
        "Projected week status is no_further_action; no optional add-ons are recommended.",
        "- none - Projected week status is no_further_action; no optional add-ons are recommended.",
        "Safe to train: yes",
      ])
    );
  });

  it("suppresses a mismatched optional add-on candidate and emits a consistency warning", () => {
    const artifact = attachReadinessContract(
      buildWeek4UpperBPreSessionArtifact({
        projectedSessions: [
          {
            slotId: "upper_b",
            intent: "upper",
            isNext: true,
            exerciseCount: 1,
            totalSets: 3,
            exercises: [
              {
                exerciseId: "barbell-curl",
                name: "Barbell Curl",
                setCount: 3,
                role: "accessory",
                effectiveStimulusByMuscle: { Biceps: 3 },
              },
            ],
            projectedContributionByMuscle: { Biceps: 3 },
          },
        ],
        fullWeekByMuscle: [buildFullWeekRow("Chest", 7, 12, 10, 16, "A_PRIMARY")],
        runtimeDoseAdjustmentDiagnostics: [
          buildDoseDiagnostic("Chest", 7, 12, 10, 16, "add_set", "Barbell Curl"),
        ],
      })
    );

    const summary = buildPreSessionReadinessSummary({
      operatorDebug: false,
      artifact: artifact as never,
    });
    const joined = summary?.join("\n") ?? "";

    expect(summary).toEqual(
      expect.arrayContaining([
        "- Chest: add-on candidate Barbell Curl does not match the flagged muscle need; hold seed.",
        "- none - No safe session-local optional add-ons from current contract evidence.",
        "warning: optional_add_on_matches_flagged_muscle - One or more optional add-on candidates did not match the flagged muscle need and were suppressed. Evidence: Chest:Barbell Curl",
      ])
    );
    expect(joined).not.toContain("- Add +1 Barbell Curl");
    expect(joined).not.toContain("Use Dose Closure Guidance for MEV-floor top-ups");
  });

  it("suppresses an optional add-on targeting a suppressed muscle", () => {
    const artifact = buildWeek4UpperBPreSessionArtifact({
      projectedSessions: [
        {
          slotId: "upper_b",
          intent: "upper",
          isNext: true,
          exerciseCount: 1,
          totalSets: 3,
          exercises: [
            {
              exerciseId: "cable-crossover",
              name: "Cable Crossover",
              setCount: 3,
              role: "accessory",
              effectiveStimulusByMuscle: { Chest: 3 },
            },
          ],
          projectedContributionByMuscle: { Chest: 3 },
        },
      ],
      fullWeekByMuscle: [buildFullWeekRow("Chest", 10, 12, 10, 16, "A_PRIMARY")],
      runtimeDoseAdjustmentDiagnostics: [
        {
          ...buildDoseDiagnostic("Chest", 10, 12, 10, 16, "hold_seed", undefined),
          targetStatus: "over_mav",
          reasonCode: "over_mav_caution",
          guidance: "over MAV; caution and suppress add-ons",
        },
      ],
    });
    const contracted = attachReadinessContract(artifact);

    const summary = buildPreSessionReadinessSummary({
      operatorDebug: false,
      artifact: contracted as never,
    });
    const joined = summary?.join("\n") ?? "";

    expect(summary).toEqual(
      expect.arrayContaining([
        "- Chest: optional floor-buffer add-on suppressed because this muscle is in suppress/avoid guidance.",
        "- none - No safe session-local optional add-ons from current contract evidence.",
        "warning: optional_add_on_not_suppressed_muscle - One or more optional add-ons targeted a suppressed muscle and were suppressed. Evidence: Chest",
      ])
    );
    expect(joined).not.toContain("Optional session-local +1 Cable Crossover");
  });

  it("does not emit normal start coaching when the contract startability is blocked", () => {
    const artifact = buildWeek4UpperBPreSessionArtifact();
    artifact.nextSession = {
      ...artifact.nextSession,
      source: "existing_incomplete",
      existingWorkoutId: "stale-plan",
      isExisting: true,
      selectedIncompleteStatus: "planned",
      selectedIncompleteReadiness: {
        classification: "stale_or_mismatched_incomplete_workout",
        safeToTrain: false,
        action: "block_or_cleanup",
        reason:
          "Incomplete planned workout does not match the next expected seeded slot, seed exercise plan, mesocycle, or clean planned state.",
      },
    } as never;
    const contracted = attachReadinessContract(artifact);

    const summary = buildPreSessionReadinessSummary({
      operatorDebug: false,
      artifact: contracted as never,
    });
    const joined = summary?.join("\n") ?? "";

    expect(summary).toEqual(
      expect.arrayContaining([
        "Resolve blocker before starting; do not start this as a normal session.",
        "Resolve blocker before starting.",
        "Safe to train: no",
      ])
    );
    expect(joined).not.toContain("Run seed as prescribed.");
    expect(joined).not.toContain("Default: run seed as prescribed.");
  });

  it("prints CLI add-on output from contract fields", () => {
    const artifact = attachReadinessContract(buildWeek4UpperBPreSessionArtifact());
    artifact.preSessionReadiness.contract?.sessionLocalCoaching.safeOptionalAddOns.splice(
      0,
      artifact.preSessionReadiness.contract.sessionLocalCoaching.safeOptionalAddOns.length,
      "- contract-only add-on row"
    );

    const summary = buildPreSessionReadinessSummary({
      operatorDebug: false,
      artifact: artifact as never,
    });

    expect(summary).toEqual(expect.arrayContaining(["- contract-only add-on row"]));
  });

  it("keeps the structured contract audit-only with no DB, seed, or runtime mutation flags", () => {
    const artifact = attachReadinessContract(buildWeek4UpperBPreSessionArtifact());
    const contract = artifact.preSessionReadiness.contract;

    expect(contract?.boundaries).toMatchObject({
      readOnly: true,
      affectsScoringOrGeneration: false,
      consumedByProduction: false,
      wouldWriteTransaction: false,
      dbMutation: false,
      workoutLogSessionCreated: false,
      seedRuntimeChanged: false,
      plannerMaterializerChanged: false,
    });
    expect(
      contract?.consistencyChecks.find(
        (check) => check.id === "seed_runtime_proof_read_only"
      )
    ).toMatchObject({ status: "pass" });
  });
});

describe("buildFutureWeekOperatorDebugSummary", () => {
  function buildFutureWeekExercise(
    exerciseId: string,
    exerciseName: string,
    orderIndex: number,
    prescribedSetCount: number,
    targetLoad: number,
    targetReps: number,
    targetRpe: number
  ) {
    return {
      exerciseId,
      exerciseName,
      orderIndex,
      section: orderIndex < 2 ? "main" : "accessory",
      isMainLift: orderIndex < 2,
      prescribedSetCount,
      prescribedSets: [
        {
          setIndex: 1,
          targetLoad,
          targetReps,
          targetRpe,
        },
      ],
    };
  }

  function buildFutureWeekArtifact(overrides: Record<string, unknown> = {}) {
    return {
      mode: "future-week",
      requestedMode: "future-week",
      nextSession: {
        intent: "upper",
        slotId: "upper_a",
        slotSequenceIndex: 0,
        slotSequenceLength: 4,
        slotSource: "mesocycle_slot_sequence",
        existingWorkoutId: null,
        isExisting: false,
        source: "rotation",
        weekInMeso: 5,
        sessionInWeek: 1,
        derivationTrace: [],
        selectedIncompleteStatus: null,
      },
      generationPath: {
        requestedMode: "future-week",
        executionMode: "active_deload_reroute",
        generator: "generateDeloadSessionFromIntent",
        reason: "active_mesocycle_state_active_deload",
      },
      generationProvenance: {
        receiptProvenance: {
          mesocycleId: "meso-1",
          compositionSource: "deload_seed_replay",
        },
        auditOnly: {
          generationPath: null,
        },
      },
      sessionSnapshot: {
        version: 1,
        generated: {
          selectionMode: "INTENT",
          sessionIntent: "upper",
          semantics: {
            kind: "advancing",
            isDeload: true,
            isStrictGapFill: false,
            isStrictSupplemental: false,
            advancesLifecycle: true,
            consumesWeeklyScheduleIntent: true,
            countsTowardCompliance: true,
            countsTowardRecentStimulus: true,
            countsTowardWeeklyVolume: true,
            countsTowardProgressionHistory: false,
            countsTowardPerformanceHistory: false,
            updatesProgressionAnchor: false,
            eligibleForUniqueIntentSubtraction: true,
            reasons: [],
            trace: { advancesSplitInput: true },
          },
          exerciseCount: 4,
          hardSetCount: 8,
          cycleContext: {
            weekInMeso: 5,
            weekInBlock: 1,
            phase: "deload",
            blockType: "deload",
            isDeload: true,
            source: "computed",
          },
          exercises: [
            buildFutureWeekExercise(
              "incline-machine-press",
              "Incline Machine Press",
              0,
              2,
              112.5,
              6,
              4.5
            ),
            buildFutureWeekExercise(
              "close-grip-row",
              "Close-Grip Seated Cable Row",
              1,
              2,
              42.5,
              6,
              4.5
            ),
            buildFutureWeekExercise(
              "machine-lateral-raise",
              "Machine Lateral Raise",
              2,
              2,
              37.5,
              12,
              4.5
            ),
            buildFutureWeekExercise(
              "cable-triceps-pushdown",
              "Cable Triceps Pushdown",
              3,
              2,
              35,
              15,
              4.5
            ),
          ],
          traces: {
            progression: {},
            deload: {
              version: 1,
              sessionIntent: "upper",
              targetRpe: 4.5,
              setFactor: 0.5,
              minSets: 1,
              exerciseCount: 4,
              exercises: [],
            },
          },
        },
      },
      warningSummary: {
        blockingErrors: [],
        semanticWarnings: [],
        backgroundWarnings: [],
        counts: {
          blockingErrors: 0,
          semanticWarnings: 0,
          backgroundWarnings: 0,
        },
      },
      ...overrides,
    };
  }

  it("prints deload generation path and generated preview for future-week operator debug", () => {
    const summary = buildFutureWeekOperatorDebugSummary({
      operatorDebug: true,
      artifact: buildFutureWeekArtifact() as never,
    });

    expect(summary).toEqual(
      expect.arrayContaining([
        "Generation Summary",
        "State | Week | Session | Slot | Path | Generator | Composition Source | Safe To Train",
        "ACTIVE_DELOAD | 5 | 1 | upper_a | active_deload_reroute | generateDeloadSessionFromIntent | deload_seed_replay | yes",
        "Blocker: none",
        "Generated Preview",
        "Order | Exercise | Sets | Load | Rep target/range | RPE | Note",
        "1 | Incline Machine Press | 2 | 112.5 | 6 | 4.5 | deload",
        "4 | Cable Triceps Pushdown | 2 | 35 | 15 | 4.5 | deload",
      ])
    );
  });

  it("keeps future-week generation details out of normal non-operator output", () => {
    expect(
      buildFutureWeekOperatorDebugSummary({
        operatorDebug: false,
        artifact: buildFutureWeekArtifact() as never,
      })
    ).toBeNull();
  });

  it("prints closeout blocker instead of a misleading generated preview", () => {
    const blockerMessage =
      "Week 4 closeout is pending. Resolve or dismiss the optional gap-fill before generating the Week 5 deload.";
    const summary = buildFutureWeekOperatorDebugSummary({
      operatorDebug: true,
      artifact: buildFutureWeekArtifact({
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
            message: blockerMessage,
            mesocycleId: "meso-1",
            weekCloseId: "week-close-4",
            targetWeek: 4,
          },
        },
        generation: { error: blockerMessage },
        sessionSnapshot: undefined,
        generationPath: {
          requestedMode: "future-week",
          executionMode: "blocked_closeout_required",
          generator: "none",
          reason: "final_accumulation_week_close_pending",
        },
        generationProvenance: {
          receiptProvenance: {
            mesocycleId: null,
            compositionSource: null,
          },
          auditOnly: {
            generationPath: null,
          },
        },
        warningSummary: {
          blockingErrors: [blockerMessage],
          semanticWarnings: [],
          backgroundWarnings: [],
          counts: {
            blockingErrors: 1,
            semanticWarnings: 0,
            backgroundWarnings: 0,
          },
        },
      }) as never,
    });

    expect(summary).toEqual(
      expect.arrayContaining([
        "ACTIVE_ACCUMULATION | unknown | unknown | unknown | blocked_closeout_required | none | unknown | no",
        `Blocker: ${blockerMessage}`,
        "Generated Preview: unavailable (blocked_closeout_required)",
      ])
    );
    expect(summary).not.toContain("Order | Exercise | Sets | Load | Rep target/range | RPE | Note");
  });

  it("labels standard accumulation future-week generation without changing the preview rows", () => {
    const summary = buildFutureWeekOperatorDebugSummary({
      operatorDebug: true,
      artifact: buildFutureWeekArtifact({
        generationPath: {
          requestedMode: "future-week",
          executionMode: "standard_generation",
          generator: "generateSessionFromIntent",
          reason: "standard_future_week_or_preview",
        },
        generationProvenance: {
          receiptProvenance: {
            mesocycleId: "meso-1",
            compositionSource: "persisted_slot_plan_seed",
          },
          auditOnly: {
            generationPath: null,
          },
        },
        sessionSnapshot: {
          version: 1,
          generated: {
            ...buildFutureWeekArtifact().sessionSnapshot.generated,
            semantics: {
              ...buildFutureWeekArtifact().sessionSnapshot.generated.semantics,
              isDeload: false,
              countsTowardProgressionHistory: true,
              countsTowardPerformanceHistory: true,
              updatesProgressionAnchor: true,
            },
          },
        },
      }) as never,
    });

    expect(summary).toEqual(
      expect.arrayContaining([
        "ACTIVE_ACCUMULATION | 5 | 1 | upper_a | standard_generation | generateSessionFromIntent | persisted_slot_plan_seed | yes",
        "1 | Incline Machine Press | 2 | 112.5 | 6 | 4.5 | standard",
      ])
    );
  });
});

describe("buildWeeklyRetroOperatorSummary", () => {
  it("prints weekly set totals and muscle volume outcome for operator-debug weekly-retro", () => {
    const volumeRows = [
      {
        muscle: "Chest",
        actualEffectiveSets: 9,
        weeklyTarget: 16,
        mev: 10,
        mav: 16,
        deltaToTarget: -7,
        deltaToMev: -1,
        deltaToMav: -7,
        status: "below_mev",
        topContributors: [],
      },
      {
        muscle: "Triceps",
        actualEffectiveSets: 7.6,
        weeklyTarget: 12,
        mev: 6,
        mav: 12,
        deltaToTarget: -4.4,
        deltaToMev: 1.6,
        deltaToMav: -4.4,
        status: "under_target_only",
        topContributors: [],
      },
      {
        muscle: "Lats",
        actualEffectiveSets: 17,
        weeklyTarget: 14,
        mev: 8,
        mav: 16,
        deltaToTarget: 3,
        deltaToMev: 9,
        deltaToMav: 1,
        status: "over_mav",
        topContributors: [],
      },
    ];
    const beforeRows = JSON.parse(JSON.stringify(volumeRows));
    const summary = buildWeeklyRetroOperatorSummary({
      operatorDebug: true,
      artifact: {
        weeklyRetro: {
          loadCalibration: {
            status: "aligned",
            comparableSessionCount: 4,
            driftSessionCount: 0,
            prescriptionChangeCount: 0,
            selectionDriftCount: 0,
            legacyLimitedSessionCount: 0,
            highlightedSessions: [],
          },
          volumeTargeting: {
            muscles: volumeRows,
          },
          planAdherence: {
            plannedWorkCompletedPercent: 100,
            plannedWorkMissedSets: 0,
            plannedWorkTotalSets: 58,
            plannedWorkCompletedSets: 58,
            explainedAdditions: {
              totalSets: 17,
              byIntent: {
                final_weekly_opportunity_mev_closure: 17,
              },
            },
            substitutions: 0,
            painFatigueDeviations: 0,
            unclassifiedDrift: 0,
            engineConfidenceImpact: "none",
            interpretations: [],
          },
          interventions: [],
          recommendedPriorities: [],
          exerciseLoadCalibrationRows: [
            {
              week: 4,
              workoutId: "upper-a",
              slotId: "upper_a",
              sessionLabel: "upper_a",
              exerciseId: "planned-upper",
              exerciseName: "Planned Upper",
              plannedSetCount: 40,
              savedSetCount: 40,
              performedSetCount: 40,
              skippedSetCount: 0,
              addedSetCount: 0,
              performedLoadSummary: {},
              classification: "clean",
              reasonCodes: [],
              notes: [],
            },
            {
              week: 4,
              workoutId: "lower-a",
              slotId: "lower_a",
              sessionLabel: "lower_a",
              exerciseId: "planned-lower",
              exerciseName: "Planned Lower",
              plannedSetCount: 18,
              savedSetCount: 11,
              performedSetCount: 11,
              skippedSetCount: 0,
              addedSetCount: 0,
              performedLoadSummary: {},
              classification: "clean",
              reasonCodes: [],
              notes: [],
            },
            {
              week: 4,
              workoutId: "upper-b",
              slotId: "upper_b",
              sessionLabel: "upper_b",
              exerciseId: "added-work",
              exerciseName: "Added Work",
              plannedSetCount: 0,
              savedSetCount: 17,
              performedSetCount: 17,
              skippedSetCount: 0,
              addedSetCount: 17,
              performedLoadSummary: {},
              classification: "runtime_added",
              reasonCodes: ["exercise_not_in_generated_snapshot"],
              notes: [],
            },
          ],
        } as never,
      },
    });

    expect(summary).toEqual(
      expect.arrayContaining([
        "Weekly Set Summary",
        "Planned | Saved | Performed | Skipped | Added | Planned Completed",
        "58 | 68 | 68 | 0 | 17 | 58/58",
        "Weekly Muscle Volume",
        "Muscle | Sets | MEV | Target | MAV | Status | Notes",
        "Chest | 9 | 10 | 16 | 16 | below_mev | floor gap 1",
        "Triceps | 7.6 | 6 | 12 | 12 | below_preferred | floor reached; below preferred",
        "Lats | 17 | 8 | 14 | 16 | over_cap | over MAV",
      ])
    );
    expect(volumeRows).toEqual(beforeRows);
  });

  it("prints a compact weekly-retro verdict from the composed artifact payload", () => {
    const summary = buildWeeklyRetroOperatorSummary({
      artifact: {
        weeklyRetro: {
          version: 1,
          week: 3,
          mesocycleId: "meso-1",
          executiveSummary: {
            status: "attention_required",
            generatedLayerCoverage: "partial",
            sessionCount: 3,
            advancingSessionCount: 3,
            progressionEligibleCount: 2,
            progressionExcludedCount: 1,
            driftSessionCount: 1,
            belowMevCount: 1,
            underTargetCount: 2,
            overMavCount: 0,
            slotIdentityIssueCount: 1,
            highlights: [],
          },
          loadCalibration: {
            status: "attention_required",
            comparableSessionCount: 2,
            driftSessionCount: 1,
            prescriptionChangeCount: 1,
            selectionDriftCount: 1,
            legacyLimitedSessionCount: 1,
            highlightedSessions: [],
          },
          sessionExecution: {
            summary: {
              sessionCount: 3,
              advancingCount: 3,
              gapFillCount: 0,
              supplementalCount: 0,
              deloadCount: 0,
              progressionEligibleCount: 2,
              progressionExcludedCount: 1,
              weekCloseRelevantCount: 0,
              persistedSnapshotCount: 2,
              reconstructedSnapshotCount: 1,
              mutationDriftCount: 1,
              statusCounts: { COMPLETED: 3 },
              intentCounts: { PUSH: 1, PULL: 1 },
            },
            sessions: [],
          },
          slotBalance: {
            status: "attention_required",
            advancingSessionCount: 3,
            identifiedSlotCount: 2,
            missingSlotIdentityCount: 1,
            duplicateSlotCount: 0,
            intentMismatchCount: 0,
            missingSlotIdentityWorkoutIds: ["workout-2"],
            duplicateSlots: [],
            intentMismatches: [],
          },
          volumeTargeting: {
            status: "attention_required",
            belowMev: ["Chest"],
            underTargetOnly: ["Calves"],
            overMav: [],
            overTargetOnly: [],
            muscles: [
              {
                muscle: "Chest",
                actualEffectiveSets: 6,
                weeklyTarget: 10,
                mev: 8,
                mav: 16,
                deltaToTarget: -4,
                deltaToMev: -2,
                deltaToMav: -10,
                status: "below_mev",
                topContributors: [],
              },
              {
                muscle: "Calves",
                actualEffectiveSets: 8,
                weeklyTarget: 9,
                mev: 8,
                mav: 14,
                deltaToTarget: -1,
                deltaToMev: 0,
                deltaToMav: -6,
                status: "under_target_only",
                topContributors: [],
              },
            ],
          },
          planAdherence: {
            plannedWorkCompletedPercent: 92,
            plannedWorkMissedSets: 4,
            plannedWorkTotalSets: 50,
            plannedWorkCompletedSets: 46,
            explainedAdditions: {
              totalSets: 6,
              byIntent: {
                target_gap_closure: 4,
                opportunistic_extra: 2,
              },
            },
            substitutions: 1,
            painFatigueDeviations: 0,
            unclassifiedDrift: 0,
            engineConfidenceImpact: "low",
            interpretations: [],
          },
          interventions: [
            {
              priority: "high",
              kind: "slot_identity",
              summary: "Repair missing slot receipts.",
              evidence: [],
            },
            {
              priority: "medium",
              kind: "volume_deficit",
              summary: "Inspect deficit muscles.",
              evidence: [],
            },
          ],
          rootCauses: [],
          recommendedPriorities: ["Repair missing slot receipts."],
        },
      },
    });

    expect(summary).toEqual([
      "[workout-audit:retro] load_calibration=attention_required comparable_sessions=2 drift_sessions=1 legacy_limited=1",
      "[workout-audit:retro] plan_adherence planned_completed=92% (46/50 sets) missed=4 explained_additions=+6.0 substitutions=1 unclassified=0 engine_confidence=low",
      "[workout-audit:retro] explained_additions_by_intent=opportunistic_extra:+2.0, target_gap_closure:+4.0",
      "[workout-audit:retro] volume below_mev=Chest (-2.0) below_preferred=Calves (-1.0) near_cap=none over_cap=none",
      "[workout-audit:retro] interventions=slot_identity, volume_deficit",
      "[workout-audit:retro] recommendation=Repair missing slot receipts.",
    ]);
  });

  it("prints projection delivery drift when weekly-retro includes the audit-only comparison", () => {
    const summary = buildWeeklyRetroOperatorSummary({
      artifact: {
        weeklyRetro: {
          version: 1,
          week: 3,
          mesocycleId: "meso-1",
          executiveSummary: {
            status: "attention_required",
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
          sessionExecution: {
            summary: {
              sessionCount: 3,
              advancingCount: 3,
              gapFillCount: 0,
              supplementalCount: 0,
              deloadCount: 0,
              progressionEligibleCount: 3,
              progressionExcludedCount: 0,
              weekCloseRelevantCount: 0,
              persistedSnapshotCount: 3,
              reconstructedSnapshotCount: 0,
              mutationDriftCount: 0,
              statusCounts: { COMPLETED: 3 },
              intentCounts: { PUSH: 1, PULL: 1, LEGS: 1 },
            },
            sessions: [],
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
          projectionDeliveryDrift: {
            status: "comparable",
            baseline: {
              generatedAt: "2026-04-01T12:00:00.000Z",
              projectedSessionCount: 2,
            },
            summary: {
              direction: "underdelivery",
              materialUnderdeliveryCount: 2,
              materialOverdeliveryCount: 0,
              netEffectiveSetDelta: -5.5,
            },
            muscles: [],
            limitations: [],
          },
          interventions: [],
          rootCauses: [],
          recommendedPriorities: [],
        },
      },
    });

    expect(summary?.at(-1)).toBe(
      "[workout-audit:retro] projection_delivery_drift=comparable direction=underdelivery under=2 over=0 net=-5.5",
    );
  });

  it("prints an operator-debug exercise reconciliation table from weekly-retro rows", () => {
    const summary = buildWeeklyRetroOperatorSummary({
      operatorDebug: true,
      artifact: {
        weeklyRetro: {
          loadCalibration: {
            status: "aligned",
            comparableSessionCount: 1,
            driftSessionCount: 0,
            prescriptionChangeCount: 0,
            selectionDriftCount: 0,
            legacyLimitedSessionCount: 0,
            highlightedSessions: [],
          },
          volumeTargeting: {
            muscles: [],
          },
          planAdherence: {
            plannedWorkCompletedPercent: 100,
            plannedWorkMissedSets: 0,
            plannedWorkTotalSets: 14,
            plannedWorkCompletedSets: 14,
            explainedAdditions: {
              totalSets: 5,
              byIntent: {
                target_gap_closure: 1,
              },
            },
            substitutions: 1,
            painFatigueDeviations: 0,
            unclassifiedDrift: 0,
            engineConfidenceImpact: "none",
            interpretations: [
              {
                opKind: "add_set",
                intent: "target_gap_closure",
                confidence: "high",
                source: "persisted_op",
                setDelta: 1,
                exerciseId: "leg-extension",
                muscles: ["Quads"],
                evidence: ["Quads: inferred_before=7 target=8 mev=6"],
              },
              {
                opKind: "replace_exercise",
                intent: "substitution",
                confidence: "high",
                source: "persisted_op",
                setDelta: 0,
                exerciseId: "standing-calf",
                muscles: ["Calves"],
                evidence: ["from:Seated Calf Raise", "to:Standing Calf Raise"],
              },
            ],
          },
          interventions: [],
          recommendedPriorities: [],
          exerciseLoadCalibrationRows: [
            {
              week: 4,
              workoutId: "workout-lower-a",
              slotId: "lower_a",
              sessionLabel: "lower_a",
              exerciseId: "belt-squat",
              exerciseName: "Belt Squat",
              plannedSetCount: 4,
              savedSetCount: 4,
              performedSetCount: 4,
              skippedSetCount: 0,
              addedSetCount: 0,
              targetLoad: 80,
              performedLoadSummary: {
                medianLoad: 95,
              },
              classification: "target_too_low",
              reasonCodes: ["performed_load_materially_above_target"],
              notes: ["load_delta_pct:18.8"],
            },
            {
              week: 4,
              workoutId: "workout-lower-a",
              slotId: "lower_a",
              sessionLabel: "lower_a",
              exerciseId: "leg-extension",
              exerciseName: "Leg Extension",
              plannedSetCount: 2,
              savedSetCount: 3,
              performedSetCount: 3,
              skippedSetCount: 0,
              addedSetCount: 1,
              performedLoadSummary: {},
              classification: "clean",
              reasonCodes: ["performed_load_within_target_band"],
              notes: ["added_sets:1"],
            },
            {
              week: 4,
              workoutId: "workout-lower-a",
              slotId: "lower_a",
              sessionLabel: "lower_a",
              exerciseId: "seated-calf",
              exerciseName: "Seated Calf Raise",
              plannedSetCount: 4,
              savedSetCount: 0,
              performedSetCount: 0,
              skippedSetCount: 0,
              addedSetCount: 0,
              performedLoadSummary: {},
              classification: "skipped_or_low_coverage",
              reasonCodes: ["planned_exercise_low_performed_coverage"],
              notes: ["coverage:0%"],
            },
            {
              week: 4,
              workoutId: "workout-lower-a",
              slotId: "lower_a",
              sessionLabel: "lower_a",
              exerciseId: "standing-calf",
              exerciseName: "Standing Calf Raise",
              plannedSetCount: 0,
              savedSetCount: 4,
              performedSetCount: 4,
              skippedSetCount: 0,
              addedSetCount: 4,
              performedLoadSummary: {},
              classification: "runtime_added",
              reasonCodes: ["exercise_not_in_generated_snapshot"],
              notes: ["saved_sets:4", "performed_sets:4"],
            },
            {
              week: 4,
              workoutId: "workout-lower-a",
              slotId: "lower_a",
              sessionLabel: "lower_a",
              exerciseId: "duplicate-calf",
              exerciseName: "Duplicate Calf Raise",
              plannedSetCount: 2,
              savedSetCount: 2,
              performedSetCount: 2,
              skippedSetCount: 0,
              addedSetCount: 0,
              performedLoadSummary: {},
              classification: "clean",
              reasonCodes: ["same_exercise_duplicate_logging"],
              notes: [],
            },
          ],
          postSessionReview: {
            readOnly: true,
            seedRuntimeChanged: false,
            plannerMaterializerChanged: false,
            completedWorkoutIds: ["workout-lower-a"],
            futurePlannedIncompleteWorkouts: [],
            calibrationRows: [
              {
                week: 4,
                workoutId: "workout-lower-a",
                slotId: "lower_a",
                sessionLabel: "lower_a",
                exerciseId: "back-squat",
                exerciseName: "Barbell Back Squat",
                role: "main_lift",
                target: {
                  load: 72.5,
                  repRange: { min: 8, max: 8 },
                  rpe: 6.5,
                },
                performed: {
                  load: 95,
                  reps: 8,
                  rpe: 7,
                },
                loadDeltaPct: 31,
                rpeDelta: 0.5,
                classification: "stale_main_anchor",
                reasonCodes: ["main_lift_performed_load_above_target"],
                nextExposureNote:
                  "Re-anchor next exposure from performed median 95 x 8 @7; target was stale for a main lift.",
              },
              {
                week: 4,
                workoutId: "workout-lower-a",
                slotId: "lower_a",
                sessionLabel: "lower_a",
                exerciseId: "leg-extension",
                exerciseName: "Leg Extension",
                role: "accessory",
                target: {
                  load: 85,
                  repRange: { min: 10, max: 10 },
                  rpe: 6.5,
                },
                performed: {
                  load: 70,
                  reps: 10,
                  rpe: 7,
                },
                loadDeltaPct: -17.6,
                rpeDelta: 0.5,
                classification: "accessory_equipment_scaling",
                reasonCodes: ["accessory_load_scale_materially_different"],
                nextExposureNote:
                  "Treat as accessory equipment scaling and calibrate next exposure from performed median 70 x 10 @7.",
              },
            ],
          },
        } as never,
      },
    });

    expect(summary).toEqual(
      expect.arrayContaining([
        "Exercise Reconciliation",
        "Exercise | Slot | Planned | Saved | Performed | Skipped | Added | Classification | Notes",
        "Belt Squat | lower_a | 4 | 4 | 4 | 0 | 0 | target_too_low | median 95 vs target 80",
        "Leg Extension | lower_a | 2 | 3 | 3 | 0 | 1 | clean | +1 runtime-added set; target-gap work",
        "Seated Calf Raise | lower_a | 4 | 0 | 0 | 0 | 0 | skipped_or_low_coverage | substitute / replacement-like pattern",
        "Standing Calf Raise | lower_a | 0 | 4 | 4 | 0 | 4 | runtime_added | substitute / replacement-like pattern; added exercise, session-local performed reality",
        "Duplicate Calf Raise | lower_a | 2 | 2 | 2 | 0 | 0 | clean | same-exercise duplicate logging",
        "Post-Session Calibration Deltas",
        "Exercise | Role | Target load/reps/RPE | Performed load/reps/RPE | Load delta % | RPE delta | Classification | Next exposure note",
        "Barbell Back Squat | main_lift | 72.5 x 8 @6.5 | 95 x 8 @7 | 31 | 0.5 | stale_main_anchor | Re-anchor next exposure from performed median 95 x 8 @7; target was stale for a main lift.",
        "Leg Extension | accessory | 85 x 10 @6.5 | 70 x 10 @7 | -17.6 | 0.5 | accessory_equipment_scaling | Treat as accessory equipment scaling and calibrate next exposure from performed median 70 x 10 @7.",
      ]),
    );
  });

  it("separates completed-session reconciliation from future planned workouts in operator-debug weekly-retro", () => {
    const summary = buildWeeklyRetroOperatorSummary({
      operatorDebug: true,
      artifact: {
        weeklyRetro: {
          loadCalibration: {
            status: "aligned",
            comparableSessionCount: 1,
            driftSessionCount: 0,
            prescriptionChangeCount: 0,
            selectionDriftCount: 0,
            legacyLimitedSessionCount: 0,
            highlightedSessions: [],
          },
          sessionExecution: {
            summary: {
              sessionCount: 2,
              advancingCount: 2,
              gapFillCount: 0,
              supplementalCount: 0,
              deloadCount: 0,
              progressionEligibleCount: 1,
              progressionExcludedCount: 1,
              weekCloseRelevantCount: 0,
              persistedSnapshotCount: 2,
              reconstructedSnapshotCount: 0,
              mutationDriftCount: 0,
              statusCounts: { COMPLETED: 1, PLANNED: 1 },
              intentCounts: { UPPER: 1, LOWER: 1 },
            },
            sessions: [
              {
                workoutId: "upper-1",
                scheduledDate: "2026-05-25T10:00:00.000Z",
                status: "COMPLETED",
                sessionIntent: "UPPER",
                snapshotSource: "persisted",
                semanticKind: "advancing",
                consumesWeeklyScheduleIntent: true,
                isCloseout: false,
                isDeload: false,
                reviewBucket: "completed_session",
                compositionSource: "persisted_slot_plan_seed",
                slot: {
                  slotId: "upper_a",
                  intent: "upper",
                  sequenceIndex: 0,
                  source: "mesocycle_slot_sequence",
                },
                mesocycleSnapshot: {
                  mesocycleId: "meso-1",
                  week: 1,
                  session: 1,
                  phase: "accumulation",
                },
                canonicalSemantics: {
                  sourceLayer: "saved",
                  phase: "accumulation",
                  isDeload: false,
                  countsTowardProgressionHistory: true,
                  countsTowardPerformanceHistory: true,
                  updatesProgressionAnchor: true,
                },
                progressionEvidence: {
                  countsTowardProgressionHistory: true,
                  countsTowardPerformanceHistory: true,
                  updatesProgressionAnchor: true,
                  reasonCodes: [],
                },
                reconciliation: {
                  version: 1,
                  comparisonState: "comparable",
                  hasDrift: false,
                  changedFields: [],
                  addedExerciseIds: [],
                  removedExerciseIds: [],
                  exercisesWithSetCountChanges: [],
                  exercisesWithPrescriptionChanges: [],
                },
              },
            ],
          },
          volumeTargeting: {
            muscles: [],
          },
          planAdherence: {
            plannedWorkCompletedPercent: 100,
            plannedWorkMissedSets: 0,
            plannedWorkTotalSets: 3,
            plannedWorkCompletedSets: 3,
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
          postSessionReview: {
            readOnly: true,
            seedRuntimeChanged: false,
            plannerMaterializerChanged: false,
            completedWorkoutIds: ["upper-1"],
            futurePlannedIncompleteWorkouts: [
              {
                workoutId: "lower-1",
                scheduledDate: "2026-05-27T10:00:00.000Z",
                status: "PLANNED",
                sessionIntent: "LOWER",
                slotId: "lower_a",
                mesocycleWeek: 1,
                mesoSession: 2,
                compositionSource: "persisted_slot_plan_seed",
              },
            ],
          },
          interventions: [],
          recommendedPriorities: [],
          exerciseLoadCalibrationRows: [
            {
              week: 1,
              workoutId: "upper-1",
              sessionStatus: "COMPLETED",
              slotId: "upper_a",
              sessionLabel: "upper_a",
              mesocycleWeek: 1,
              mesoSession: 1,
              compositionSource: "persisted_slot_plan_seed",
              reviewBucket: "completed_session",
              exerciseId: "upper-row",
              exerciseName: "Upper Row",
              plannedSetCount: 3,
              savedSetCount: 3,
              performedSetCount: 3,
              skippedSetCount: 0,
              addedSetCount: 0,
              performedLoadSummary: {},
              classification: "clean",
              reasonCodes: [],
              notes: [],
            },
            {
              week: 1,
              workoutId: "lower-1",
              sessionStatus: "PLANNED",
              slotId: "lower_a",
              sessionLabel: "lower_a",
              mesocycleWeek: 1,
              mesoSession: 2,
              compositionSource: "persisted_slot_plan_seed",
              reviewBucket: "future_planned_incomplete",
              exerciseId: "leg-press",
              exerciseName: "Leg Press",
              plannedSetCount: 4,
              savedSetCount: 4,
              performedSetCount: 0,
              skippedSetCount: 0,
              addedSetCount: 0,
              performedLoadSummary: {},
              classification: "skipped_or_low_coverage",
              reasonCodes: ["planned_exercise_low_performed_coverage"],
              notes: ["coverage:0%"],
            },
          ],
        } as never,
      },
    });

    expect(summary).toEqual(
      expect.arrayContaining([
        "Completed Session Reconciliation",
        "upper-1 | 1 | 1 | upper_a | COMPLETED | persisted_slot_plan_seed | unchanged | 3 | 3 | 0 | 0 | 0",
        "Future Planned / Incomplete Workouts",
        "lower-1 | 1 | 2 | lower_a | PLANNED | persisted_slot_plan_seed | scheduled next; not missed work in post-session context",
        "3 | 3 | 3 | 0 | 0 | 3/3",
        "Upper Row | upper_a | 3 | 3 | 3 | 0 | 0 | clean | none",
      ])
    );
    expect(summary).not.toContain(
      "Leg Press | lower_a | 4 | 4 | 0 | 0 | 0 | skipped_or_low_coverage | planned low performed coverage"
    );
  });

  it("prints replacement_like notes without implying seed mutation", () => {
    const summary = buildWeeklyRetroOperatorSummary({
      operatorDebug: true,
      artifact: {
        weeklyRetro: {
          loadCalibration: {
            status: "aligned",
            comparableSessionCount: 1,
            driftSessionCount: 0,
            prescriptionChangeCount: 0,
            selectionDriftCount: 0,
            legacyLimitedSessionCount: 0,
            highlightedSessions: [],
          },
          volumeTargeting: {
            muscles: [],
          },
          planAdherence: {
            plannedWorkCompletedPercent: 100,
            plannedWorkMissedSets: 0,
            plannedWorkTotalSets: 3,
            plannedWorkCompletedSets: 3,
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
          recommendedPriorities: [],
          exerciseLoadCalibrationRows: [
            {
              week: 1,
              workoutId: "upper-1",
              slotId: "upper_a",
              sessionLabel: "upper_a",
              reviewBucket: "completed_session",
              exerciseId: "close-grip-lat-pulldown",
              exerciseName: "Close-Grip Lat Pulldown",
              plannedSetCount: 3,
              savedSetCount: 3,
              performedSetCount: 0,
              skippedSetCount: 3,
              addedSetCount: 0,
              performedLoadSummary: {},
              classification: "replacement_like",
              reasonCodes: ["replacement_like_vertical_pull"],
              notes: ["replacement_like:Iso-Lateral Front Lat Pulldown", "seed_mutation:no"],
              replacementLike: {
                pairedExerciseId: "iso-front-lat-pulldown",
                pairedExerciseName: "Iso-Lateral Front Lat Pulldown",
                movementPattern: "vertical_pull",
                confidence: "likely",
                basis: ["movement_pattern:vertical_pull", "target:lat"],
                seedMutation: false,
              },
            },
          ],
        } as never,
      },
    });

    expect(summary).toContain(
      "Close-Grip Lat Pulldown | upper_a | 3 | 3 | 0 | 3 | 0 | replacement_like | replacement_like vertical_pull with Iso-Lateral Front Lat Pulldown; seed mutation no; 3 skipped planned sets"
    );
  });

  it("keeps the exercise reconciliation table out of normal weekly-retro output", () => {
    const summary = buildWeeklyRetroOperatorSummary({
      artifact: {
        weeklyRetro: {
          loadCalibration: {
            status: "aligned",
            comparableSessionCount: 1,
            driftSessionCount: 0,
            prescriptionChangeCount: 0,
            selectionDriftCount: 0,
            legacyLimitedSessionCount: 0,
            highlightedSessions: [],
          },
          volumeTargeting: {
            muscles: [],
          },
          planAdherence: {
            plannedWorkCompletedPercent: 100,
            plannedWorkMissedSets: 0,
            plannedWorkTotalSets: 4,
            plannedWorkCompletedSets: 4,
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
          recommendedPriorities: [],
          exerciseLoadCalibrationRows: [
            {
              week: 4,
              workoutId: "workout-lower-a",
              slotId: "lower_a",
              sessionLabel: "lower_a",
              exerciseId: "belt-squat",
              exerciseName: "Belt Squat",
              plannedSetCount: 4,
              savedSetCount: 4,
              performedSetCount: 4,
              skippedSetCount: 0,
              addedSetCount: 0,
              performedLoadSummary: {},
              classification: "clean",
              reasonCodes: [],
              notes: [],
            },
          ],
        } as never,
      },
    });

    expect(summary).not.toContain("Exercise Reconciliation");
    expect(summary).not.toContain("Weekly Set Summary");
    expect(summary).not.toContain("Weekly Muscle Volume");
    expect(summary?.some((line) => line.includes("Planned | Saved"))).toBe(false);
  });

  it("prints explicit no-action markers when the weekly-retro payload is quiet", () => {
    const summary = buildWeeklyRetroOperatorSummary({
      artifact: {
        weeklyRetro: {
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
          sessionExecution: {
            summary: {
              sessionCount: 3,
              advancingCount: 3,
              gapFillCount: 0,
              supplementalCount: 0,
              deloadCount: 0,
              progressionEligibleCount: 3,
              progressionExcludedCount: 0,
              weekCloseRelevantCount: 0,
              persistedSnapshotCount: 3,
              reconstructedSnapshotCount: 0,
              mutationDriftCount: 0,
              statusCounts: { COMPLETED: 3 },
              intentCounts: { PUSH: 1, PULL: 1, LEGS: 1 },
            },
            sessions: [],
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
        },
      },
    });

    expect(summary).toEqual([
      "[workout-audit:retro] load_calibration=aligned comparable_sessions=3 drift_sessions=0 legacy_limited=0",
      "[workout-audit:retro] plan_adherence planned_completed=100% (45/45 sets) missed=0 explained_additions=0.0 substitutions=0 unclassified=0 engine_confidence=none",
      "[workout-audit:retro] explained_additions_by_intent=none",
      "[workout-audit:retro] volume below_mev=none below_preferred=none near_cap=none over_cap=none",
      "[workout-audit:retro] interventions=none",
      "[workout-audit:retro] recommendation=no_further_action",
    ]);
  });
});

describe("buildV2AcceptedSeedPrepareCompareSummary", () => {
  it("prints compact boundary, availability, and provenance facts", () => {
    const summary = buildV2AcceptedSeedPrepareCompareSummary({
      artifact: {
        v2AcceptedSeedPrepareCompare: {
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
          availability: {
            legacyPreparationAvailable: true,
            v2PreparationPreviewAvailable: true,
            v2BlockedFailClosed: false,
          },
          seedShapeComparison: {
            classification: "unclear",
            slotIdsInOrder: {
              legacy: ["upper_a", "lower_a"],
              v2: ["upper_a", "lower_a"],
            },
            totalSetCount: {
              legacy: 14,
              v2: 42,
            },
            executableFieldShape: {
              classification: "v2_preserves",
            },
          },
          identityCoverageComparison: {
            identitySummary: {
              sameExercise: 2,
              v2Added: 3,
              v2Removed: 1,
              cleanAlternative: 1,
              classEquivalentDifference: 1,
              unclear: 0,
              notComparable: 0,
            },
          },
          provenance: {
            baseValidationStatus: "pass",
            materializerStatus: "materialized",
            seedShapeCompatibility: {
              compatible: true,
            },
            promotionReadinessStatus: "blocked",
            productionGates: {
              missing: ["acceptancePathDesigned", "receiptContractDesigned"],
            },
          },
        } as never,
      },
      outputPath: "C:\\artifacts\\v2-seed.json",
      sizeBytes: 4096,
    });

    expect(summary).toEqual([
      "[workout-audit:v2-seed-compare] handoff_candidate=yes mesocycle=meso-1 status=available",
      "[workout-audit:v2-seed-compare] boundary read_only=yes no_write=yes consumed_by_production=no serializer=buildMesocycleSlotPlanSeed",
      "[workout-audit:v2-seed-compare] availability legacy=yes v2_preview=yes production_write_eligible=no fail_closed=no",
      "[workout-audit:v2-seed-compare] v2_path legacy_projection_called=no repair_called=no transaction=no_write",
      "[workout-audit:v2-seed-compare] seed_shape classification=unclear slots=upper_a>lower_a -> upper_a>lower_a total_sets=14->42 executable_shape=v2_preserves",
      "[workout-audit:v2-seed-compare] identity same=2 added=3 removed=1 clean_alt=1 class_equiv=1 unclear=0 not_comparable=0",
      "[workout-audit:v2-seed-compare] gates base=pass materializer=materialized seed_shape=yes promotion=blocked production_gates_missing=acceptancePathDesigned,receiptContractDesigned",
      "[workout-audit:v2-seed-compare] artifact=C:\\artifacts\\v2-seed.json size_bytes=4096",
    ]);
  });
});

describe("buildNextMesocycleHandoffDryRunSummary", () => {
  it("prints writes=no, readiness, seed shape, gate readiness, and runtime replay limitation", () => {
    const summary = buildNextMesocycleHandoffDryRunSummary({
      artifact: {
        nextMesocycleHandoffDryRun: {
          version: 1,
          source: "next_mesocycle_handoff_dry_run_audit",
          readOnly: true,
          affectsScoringOrGeneration: false,
          consumedByProduction: false,
          wouldWriteTransaction: false,
          summary: {
            writes: "no",
            sourceMesocycleId: "source-1",
            sourceState: "AWAITING_HANDOFF",
            candidateAvailable: true,
            handoffReady: true,
            blockingReason: null,
            preparationPath: "prepareMesocycleHandoffAcceptance",
            transactionStatus: "not_started",
          },
          wouldPrepareWriteSummary: {
            successorSource: "prepared_handoff_projection",
            slotSequence: "upper_a > upper_b",
            seedShape: "version=1 slots=2 exercises=2",
            slotPlanSeedSource: "handoff_slot_plan_projection",
            legacyProjectionUse: "candidate_truth_when_no_v2_draft",
            trainingBlocksCount: 2,
            carriedRolesCount: 1,
            constraintsAction: "would_upsert_constraints",
            sourceCompletionAction: "would_mark_source_completed",
            transactionBoundary: "dry-run stops before transaction",
            noDbWritesOccur: true,
          },
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
            status: "available",
            rows: [
              {
                slotId: "upper_a",
                laneOrRole: "CORE_COMPOUND",
                exerciseId: "bench",
                exerciseName: "Bench Press",
                setCount: 3,
                source: "prepared_slotPlanSeedJson",
              },
            ],
          },
          seedShapeSummary: {
            slotPlanSeedJson: "would_be_built",
            truthBasis: "prepared_acceptance_seed",
            wouldBeBuilt: true,
            minimalExecutableRowsOnly: true,
            executableFields: ["exerciseId", "role", "setCount"],
            serializerPath: "buildMesocycleSlotPlanSeed",
            slotCount: 2,
            exerciseCount: 2,
            seedSource: "handoff_slot_plan_projection",
            parserCompatible: true,
          },
          weeklyVolumeFloorCapSummary: {
            status: "not_available",
            basis: "prepared seed has no volume rows",
            rows: [],
          },
          acceptanceGatePayloadSummary: {
            checks: [
              {
                check: "candidate identity gate",
                enoughData: true,
                basis: "candidate seed contains exercise identity rows",
              },
              {
                check: "volume floors/caps",
                enoughData: false,
                basis: "not exposed by the pre-transaction prepared seed",
              },
            ],
          },
          weekOneRuntimeReplayPreview: {
            status: "seed_order_preview_only",
            runtimeReplayInstantiated: false,
            rows: [
              {
                slotId: "upper_a",
                exerciseName: "Bench Press",
                role: "CORE_COMPOUND",
                setCount: 3,
              },
            ],
            limitation: "successor not persisted",
          },
          modeComparison: [
            {
              mode: "mesocycle-explain",
              distinction: "diagnostic preview only",
            },
          ],
          safety: {
            writes: "no",
            dbMutated: false,
            mesocycleCreated: false,
            workoutLogSessionCreated: false,
            seedRuntimeBehaviorChanged: false,
            plannerMaterializerBehaviorChanged: false,
            transactionExecuted: false,
          },
        },
      },
    });

    expect(summary).toContain("Handoff Dry Run Summary");
    expect(summary).toContain("writes=no");
    expect(summary).toContain("source_state=AWAITING_HANDOFF");
    expect(summary).toContain("candidate_available=yes");
    expect(summary).toContain("handoff_ready=yes");
    expect(summary).toContain("No DB writes occur.");
    expect(summary).toContain("persisted_draft_source=none");
    expect(summary).toContain("persisted_draft_rows=0");
    expect(summary).toContain(
      "prepared_projection_source=handoff_slot_plan_projection",
    );
    expect(summary).toContain(
      "legacy_projection_use=candidate_truth_when_no_v2_draft",
    );
    expect(summary).toContain("truth_basis=prepared_acceptance_seed");
    expect(summary).toContain(
      "minimal_executable_rows_only=yes fields=exerciseId,role,setCount",
    );
    expect(summary).toContain(
      "candidate identity gate | yes | candidate seed contains exercise identity rows",
    );
    expect(summary).toContain(
      "volume floors/caps | no | not exposed by the pre-transaction prepared seed",
    );
    expect(summary).toContain(
      "status=seed_order_preview_only runtime_replay_instantiated=no",
    );
  });
});

describe("buildNextMesocycleAcceptanceGateSummary", () => {
  it("prints candidate identity, gate table, muscle rows, risks, and preview caveat", () => {
    const summary = buildNextMesocycleAcceptanceGateSummary({
      artifact: {
        nextMesocycleAcceptanceGate: {
          version: 1,
          source: "next_mesocycle_acceptance_gate_audit",
          readOnly: true,
          affectsScoringOrGeneration: false,
          consumedByProduction: false,
          wouldWriteTransaction: false,
          gateResult: "not_runnable",
          candidateFound: false,
          why: [
            "source state not AWAITING_HANDOFF (ACTIVE_DELOAD)",
            "no persisted handoff candidate",
          ],
          recommendation: "rerun after handoff exists",
          decisionSummary: {
            trainability: "fail",
            plannerMaterializerQuality: "pass",
            repairBurden: "low",
            repairBurdenEvidence:
              "planning_shape=mostly_upstream_planned materialRepairCount=unknown majorRepairCount=unknown source=planning_reality_summary classification=legacy_diagnostic_context",
            repairBurdenSource: "planning_reality_summary",
            repairBurdenClassification: "legacy_diagnostic_context",
            shadowConsumptionClassification: "not_available",
            shadowConsumptionNextSafeAction: "not_available",
            shadowConsumptionEvidence:
              "no v2 base-plan shadow consumption trial reported",
            materializerGuardrailClassification: "no_material_guardrail_issue",
            materializerGuardrailNextSafeAction: "no_action",
            materializerGuardrailEvidence:
              "classification=no_material_guardrail_issue selectionBlindSpots=0 inventoryClassificationGaps=0 duplicateContinuityConflicts=0 slotCapacityIssues=0 selectionBlockers=unknown selectionClassMismatches=unknown duplicateJustifications=unknown capacityBlockers=unknown capacityPressure=unknown capAwareExpansionNeeded=unknown optionalSuppressed=unknown diagnosticsGuarded=true",
          },
          candidateIdentity: {
            ownerEmail: "owner@test.local",
            sourceMesocycleId: "meso-source",
            sourceState: "ACTIVE_DELOAD",
            candidateKind: "diagnostic_preview_only",
            candidateDraftAvailable: false,
            persistedHandoffCandidateFound: false,
            writeNeededToInspect: false,
          },
          gates: [
            {
              gate: "Candidate identity",
              status: "fail",
              severity: "blocker",
              evidence: "candidate_found=no kind=diagnostic_preview_only",
              notes: "diagnostic previews are evidence only and cannot be accepted",
              ownerSeam: "candidate identity",
              smallestSafeFix:
                "wait for or create the real persisted handoff candidate through the explicit handoff flow; do not accept a diagnostic preview",
              mustFixBeforeWeek1: true,
            },
          ],
          weeklyMuscleTable: [
            {
              muscle: "Chest",
              projectedSets: 12,
              mev: 10,
              productiveTarget: 14,
              mav: 16,
              status: "above_mev_below_target_not_failure",
              severity: "info",
              notes: "above MEV but below target is not a failure",
            },
          ],
          priorBlockRecurringRisks: [
            {
              risk: "Chest MEV fragility",
              status: "pass",
              severity: "pass",
              evidence: "projected=12 mev=10",
              notes: "watch recurring chest floor misses before acceptance",
            },
          ],
          completedBlockEvidence: [
            {
              risk: "Chest MEV fragility",
              evidence: "W3 required top-up; W4 finished 9/10 MEV",
              hypothesis:
                "Chest may need planned floor margin instead of relying on late-block or session-local top-ups",
              acceptanceImplication:
                "candidate evidence pending; apply when a persisted handoff candidate exists",
              requiredFix:
                "none unless the persisted candidate repeats below-MEV or razor-thin floor exposure",
              severity: "info",
              ownerSeam: "volume floors",
              smallestSafeFix:
                "monitor in the gate/pre-session readout; do not implement planner behavior from prior evidence alone",
              mustFixBeforeWeek1: false,
            },
          ],
          watchItems: [],
          findings: [
            {
              finding: "Candidate identity",
              severity: "blocker",
              ownerSeam: "candidate identity",
              smallestSafeFix:
                "wait for or create the real persisted handoff candidate through the explicit handoff flow; do not accept a diagnostic preview",
              mustFixBeforeWeek1: true,
              evidence: "candidate_found=no kind=diagnostic_preview_only",
            },
          ],
          doNotFixNotes: [
            {
              item: "below target but above MEV",
              reason:
                "productive target misses are informational unless another floor/cap/trainability failure is present",
            },
          ],
          diagnosticPreview: {
            available: true,
            label: "diagnostic_preview_not_candidate",
            canBeAccepted: false,
            planningShape: "mostly_upstream_planned",
            notes: ["mesocycle-explain preview is diagnostic evidence only"],
          },
          blockers: ["no persisted handoff candidate"],
          supportingEvidence: {
            mesocycleExplainPreviewAvailable: true,
          },
        },
      },
    });

    expect(summary).toEqual(
      expect.arrayContaining([
        "candidate found: no",
        "final decision: not_runnable",
        "Decision Summary",
        "Trainability | Planner/materializer quality | Repair burden | Repair source | Repair classification | Materializer guardrail | Materializer next action | Shadow consumption | Shadow next action | Repair evidence | Materializer evidence | Shadow evidence",
        "fail | pass | low | planning_reality_summary | legacy_diagnostic_context | no_material_guardrail_issue | no_action | not_available | not_available | planning_shape=mostly_upstream_planned materialRepairCount=unknown majorRepairCount=unknown source=planning_reality_summary classification=legacy_diagnostic_context | classification=no_material_guardrail_issue selectionBlindSpots=0 inventoryClassificationGaps=0 duplicateContinuityConflicts=0 slotCapacityIssues=0 selectionBlockers=unknown selectionClassMismatches=unknown duplicateJustifications=unknown capacityBlockers=unknown capacityPressure=unknown capAwareExpansionNeeded=unknown optionalSuppressed=unknown diagnosticsGuarded=true | no v2 base-plan shadow consumption trial reported",
        "Candidate Identity",
        "Gate | Status | Severity | Evidence | Owner seam | Smallest safe fix | Must fix before Week 1 | Notes",
        "Candidate identity | fail | blocker | candidate_found=no kind=diagnostic_preview_only | candidate identity | wait for or create the real persisted handoff candidate through the explicit handoff flow; do not accept a diagnostic preview | yes | diagnostic previews are evidence only and cannot be accepted",
        "Muscle | Projected sets | MEV | Productive/Target | MAV | Status | Severity | Notes",
        "Chest | 12 | 10 | 14 | 16 | above_mev_below_target_not_failure | info | above MEV but below target is not a failure",
        "Prior-Block Recurring Risks",
        "Completed Block Evidence",
        "Risk | Severity | Evidence | Hypothesis | Acceptance implication | Required fix | Owner seam | Smallest safe fix | Must fix before Week 1",
        "Chest MEV fragility | info | W3 required top-up; W4 finished 9/10 MEV | Chest may need planned floor margin instead of relying on late-block or session-local top-ups | candidate evidence pending; apply when a persisted handoff candidate exists | none unless the persisted candidate repeats below-MEV or razor-thin floor exposure | volume floors | monitor in the gate/pre-session readout; do not implement planner behavior from prior evidence alone | no",
        "Watch Items",
        "none | none | none",
        "Findings / Remediation",
        "Candidate identity | blocker | candidate identity | wait for or create the real persisted handoff candidate through the explicit handoff flow; do not accept a diagnostic preview | yes | candidate_found=no kind=diagnostic_preview_only",
        "Do Not Fix From This Gate Alone",
        "below target but above MEV | productive target misses are informational unless another floor/cap/trainability failure is present",
        "available=yes label=diagnostic_preview_not_candidate can_be_accepted=no planning_shape=mostly_upstream_planned",
      ]),
    );
  });
});

describe("buildNextMesocyclePostAcceptVerificationSummary", () => {
  it("prints persisted successor replay checks and read-only safety", () => {
    const summary = buildNextMesocyclePostAcceptVerificationSummary({
      artifact: {
        nextMesocyclePostAcceptVerification: {
          version: 1,
          source: "next_mesocycle_post_accept_verification_audit",
          readOnly: true,
          affectsScoringOrGeneration: false,
          consumedByProduction: false,
          wouldWriteTransaction: false,
          verificationResult: "safe_to_train",
          recommendation: "persisted successor is safe to train from for Week 1",
          sourceMesocycle: {
            id: "source-1",
            state: "COMPLETED",
            isActive: false,
            macroCycleId: "macro-1",
            mesoNumber: 1,
          },
          successorMesocycle: {
            id: "successor-1",
            requestedId: "successor-1",
            state: "ACTIVE_ACCUMULATION",
            isActive: true,
            macroCycleId: "macro-1",
            mesoNumber: 2,
            activeMesocycleId: "successor-1",
          },
          acceptedSeedIdentity: {
            preAcceptPersistedDraftSeedHash: null,
            successorSlotPlanSeedHash: "successor-seed-hash",
            hashesMatch: false,
            source: {
              preAccept: null,
              successor: "handoff_slot_plan_projection",
              matches: false,
            },
            anchorRows: {
              preAccept: [],
              successor: [
                {
                  slotId: "upper_a",
                  exerciseId: "bench",
                  exerciseName: "Bench Press",
                  setCount: 4,
                },
              ],
              matches: false,
            },
            rowCount: {
              preAccept: 0,
              successor: 1,
              matches: false,
            },
            slotOrder: {
              preAccept: [],
              successor: ["upper_a"],
              matches: false,
            },
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
            mesocycleId: "successor-1",
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
          checks: [
            {
              check: "Week 1 future-week replays persisted seed",
              status: "pass",
              evidence: "compositionSource=persisted_slot_plan_seed",
              ownerSeam: "template-session seeded runtime replay",
              mustFixBeforeWeek1: true,
            },
          ],
          safety: {
            writes: "no",
            dbMutated: false,
            mesocycleCreated: false,
            workoutLogSessionCreated: false,
            seedRuntimeBehaviorChanged: false,
            plannerMaterializerBehaviorChanged: false,
            transactionExecuted: false,
          },
        },
      },
    });

    expect(summary).toEqual(
      expect.arrayContaining([
        "Post-Accept Successor Verification",
        "verification_result=safe_to_train",
        "seed=available minimal_executable_rows_only=yes slots=1 exercises=1",
        "future_week=available composition_source=persisted_slot_plan_seed path=standard_generation order_matches_seed=yes generated_exercises=1",
        "prescription_confidence=available rows=1 low=0 caution=0 classifications=exact_history:1",
        "projected_week=available mesocycle=successor-1 sessions=1 seed_backed=yes",
        "failed_checks=0 must_fix_before_week_1=0 watch_items=0",
        "Week 1 future-week replays persisted seed | pass | yes | template-session seeded runtime replay | compositionSource=persisted_slot_plan_seed",
        "Prescription Confidence Source Map",
        "Bench Press | exact_history | high | history | none | future-week prescription readout | loadSource=history confidence=high caution=none",
        "safety writes=no db_mutated=no mesocycle_created=no workout_session_created=no seed_runtime_changed=no transaction=no",
      ]),
    );
  });
});

describe("buildActiveMesocycleSlotReseedSummary", () => {
  it("prints a compact reseed verdict with push deltas and guard flags", () => {
    const summary = buildActiveMesocycleSlotReseedSummary({
      artifact: {
        activeMesocycleSlotReseed: {
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
          slotDiffs: [
            {
              slotId: "upper_a",
              intent: "upper",
              sequenceIndex: 0,
              persistedSeedExercises: [],
              candidateSeedExercises: [],
              exerciseDiff: {
                added: [
                  {
                    exerciseId: "fly",
                    exerciseName: "Cable Fly",
                    role: "ACCESSORY",
                  },
                ],
                removed: [
                  {
                    exerciseId: "curl",
                    exerciseName: "Cable Curl",
                    role: "ACCESSORY",
                  },
                ],
                retained: [],
              },
              persistedSession: {
                exerciseCount: 5,
                totalSets: 15,
                estimatedMinutes: 45,
                exercises: [],
                muscleContributionByMuscle: { Chest: 2 },
                characterization: {
                  slotArchetype: "upper_horizontal_balanced",
                  continuityScope: "slot",
                  requiredMovementPatterns: [
                    "vertical_pull",
                    "horizontal_pull",
                  ],
                  preferredAccessoryPrimaryMuscles: ["Chest", "Triceps"],
                  protectedCoverageMuscles: ["Chest", "Triceps"],
                  preservesSlotIdentity: true,
                  hasCompoundRow: true,
                  hasCompoundVerticalPull: true,
                },
              },
              candidateSession: {
                exerciseCount: 5,
                totalSets: 16,
                estimatedMinutes: 47,
                exercises: [],
                muscleContributionByMuscle: { Chest: 3.5 },
                characterization: {
                  slotArchetype: "upper_horizontal_balanced",
                  continuityScope: "slot",
                  requiredMovementPatterns: [
                    "vertical_pull",
                    "horizontal_pull",
                  ],
                  preferredAccessoryPrimaryMuscles: ["Chest", "Triceps"],
                  protectedCoverageMuscles: ["Chest", "Triceps"],
                  preservesSlotIdentity: true,
                  hasCompoundRow: true,
                  hasCompoundVerticalPull: true,
                },
              },
              setDiffByExercise: [],
              muscleContributionDiff: [],
              estimatedMinutesDiff: {
                before: 45,
                after: 47,
                delta: 2,
              },
              flags: {
                improvesChestSupport: true,
                improvesTricepsSupport: true,
                preservesRowAndVerticalPullWhereAppropriate: true,
                avoidsNewObviousOvershoot: true,
              },
              warnings: [],
            },
          ],
          aggregateMuscleDiff: [
            { muscle: "Chest", before: 3, after: 5, delta: 2 },
            { muscle: "Triceps", before: 2, after: 3.5, delta: 1.5 },
            { muscle: "Side Delts", before: 1, after: 2, delta: 1 },
          ],
          flags: {
            improvesChestSupport: true,
            improvesTricepsSupport: true,
            improvesSideDeltSupport: true,
            improvesRearDeltSupport: false,
            improvesTierBSupport: true,
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
        },
      },
      outputPath: "C:\\artifacts\\reseed.json",
    });

    expect(summary).toEqual([
      "[workout-audit:reseed] mesocycle=meso-1 week=3 verdict=safe_to_apply_bounded_reseed",
      "[workout-audit:reseed] slots=upper_a, upper_b changed_slots=upper_a",
      "[workout-audit:reseed] push_delta=Chest:+2.0, Triceps:+1.5, Side Delts:+1.0",
      "[workout-audit:reseed] guards=slot_identity:yes row_vertical_pull:yes overshoot_clear:yes",
      "[workout-audit:reseed] artifact=C:\\artifacts\\reseed.json",
    ]);
  });
});

describe("buildActiveMesocycleSlotReseedApplySummary", () => {
  it("prints a compact bounded-apply outcome for the reseed operator flow", () => {
    const summary = buildActiveMesocycleSlotReseedApplySummary({
      result: {
        mesocycleId: "meso-1",
        targetSlotIds: ["upper_a", "upper_b"],
        changedSlotIds: ["upper_a"],
        applied: true,
      },
    });

    expect(summary).toEqual([
      "[workout-audit:reseed:apply] mesocycle=meso-1 applied=yes changed_slots=upper_a",
      "[workout-audit:reseed:apply] targeted_slots=upper_a, upper_b",
    ]);
  });

  it("returns null when no apply result is available", () => {
    expect(
      buildActiveMesocycleSlotReseedApplySummary({ result: null }),
    ).toBeNull();
  });
});
