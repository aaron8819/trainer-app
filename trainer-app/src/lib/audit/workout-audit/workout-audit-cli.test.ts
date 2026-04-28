import { describe, expect, it } from "vitest";
import {
  buildActiveMesocycleSlotReseedApplySummary,
  buildActiveMesocycleSlotReseedSummary,
  buildCurrentWeekAuditOperatorSummary,
  buildPlanningRealitySummary,
  buildPlanningRealitySizeBudgetSummary,
  buildPlannerOnlyDryRunSummary,
  buildPlannerOnlyNoRepairSummary,
  buildProjectedWeekDebugSummary,
  buildProjectedWeekOperatorSummary,
  buildV2DebugArtifactSummary,
  buildWeeklyRetroOperatorSummary,
  computePlanningRealitySizeBudget,
  normalizeAuditIntentArg,
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
          ? "peak_overreach_lite" as const
          : week === 3
            ? "hard_accumulation" as const
            : "accumulation" as const,
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

describe("normalizeAuditIntentArg", () => {
  it("normalizes uppercase explicit intents into canonical lower-case session intents", () => {
    expect(normalizeAuditIntentArg("UPPER")).toBe("upper");
    expect(normalizeAuditIntentArg("PULL")).toBe("pull");
  });

  it("fails fast with a clear error for invalid explicit intents", () => {
    expect(() => normalizeAuditIntentArg("TORSO")).toThrow(
      'Invalid --intent value "TORSO". Expected one of: push, pull, legs, upper, lower, full_body, body_part.'
    );
  });
});

describe("buildV2DebugArtifactSummary", () => {
  it("prints the sidecar path, size, and hash for CLI readout", () => {
    expect(
      buildV2DebugArtifactSummary({
        filePath: "C:\\repo\\trainer-app\\artifacts\\audits\\parent-v2-no-repair-debug.json",
        sizeBytes: 1234,
        sha256: "a".repeat(64),
      })
    ).toEqual([
      "[workout-audit:v2-debug] artifact=C:\\repo\\trainer-app\\artifacts\\audits\\parent-v2-no-repair-debug.json",
      `[workout-audit:v2-debug] size_bytes=1234 sha256=${"a".repeat(64)}`,
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
      "[workout-audit:week] recommendation=no_further_action reasons=none"
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
      })
    ).toBeNull();

    expect(
      buildPlanningRealitySizeBudgetSummary({
        artifact,
        sizeBytes: 30,
        thresholdBytes: 100,
        operatorDebug: true,
      })
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
                      gateMetricsRequired: ["materialRepairCount_non_increasing"],
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
                    reason: "shadow allocation marks this muscle as weekly_demand_owned_elsewhere",
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
      ])
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
      ])
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
                        reasons: ["not_clean_closure:extension_collateral_sensitive"],
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
      ])
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
      ])
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
      ])
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
                      weekLevelWarnings: [
                        "missing_per_week_slot_distribution",
                      ],
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
                      risk:
                        "Blocked from behavior now because no week-by-week projection exists.",
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
      ])
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
                      weekLevelLimitations: [
                        "missing_fatigue_carryover_model",
                      ],
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
                      weekLevelLimitations: [
                        "missing_deload_demand_curve",
                      ],
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
        "- Chest under target across accumulation",
        "- Hamstrings overdelivered if repeated",
        "- Side Delts under target",
        "Candidate gate: Chest upper-slot distinct exercise distribution blocked until weekly curve answers cross-week questions",
      ])
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
                      projectionStatus:
                        "allocated_from_current_week_evidence",
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
                      weekLevelWarnings: [
                        "missing_per_week_slot_composition",
                      ],
                    },
                    {
                      week: 3,
                      phase: "accumulation",
                      projectionStatus:
                        "not_allocated_missing_weekly_projection",
                      slots: [],
                      weekLevelWarnings: [
                        "missing_fatigue_carryover_model",
                      ],
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
                      projectionStatus:
                        "not_allocated_missing_deload_policy",
                      slots: [],
                      weekLevelWarnings: [
                        "deload_slot_allocation_unprojected",
                      ],
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
      ])
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
                    limitations: [
                      "does_not_apply_true_progression_policy",
                    ],
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
                      reason: "Chest remains under target.",
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
        "- Chest under target across accumulation",
        "- Hamstrings overdelivered across accumulation",
        "- Side Delts under target across accumulation",
        "- Duplicate main-lift reuse",
        "- Collateral fatigue risk",
        "Best bounded candidate: Chest upper-slot distinct exercise distribution",
      ])
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
                          reasonAvailableOrBlocked: ["distinct_class_available"],
                        },
                      ],
                      policyRecommendation: "block_if_clean_alternative_exists",
                      risk: "high",
                      evidence: ["Chest:duplicate_policy=block_if_clean_alternative_exists"],
                      limitations: [
                        "diagnostic_read_only_no_generation_scoring_repair_seed_or_runtime_effect",
                      ],
                    },
                    {
                      exerciseId: "lat-pulldown",
                      exerciseName: "Lat Pulldown",
                      duplicatedInSlots: ["upper_a", "upper_b"],
                      roleBySlot: { upper_a: "accessory", upper_b: "accessory" },
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
                      evidence: ["Lats:duplicate_policy=block_if_clean_alternative_exists"],
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
                          evidence: ["final:Incline DB Bench:incline_press:3 sets"],
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
                          forbiddenClasses: ["same_session_duplicate_calf_isolation"],
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
      ])
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
      })
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
                unresolvedDemand: ["repair_would_be_needed_here:Chest:shortfall_4"],
                duplicateViolations: [],
                setDistributionViolations: ["Incline Dumbbell Press:set_count_gt_5:6"],
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
                    reason: "lower_b_single_calf_identity_four_set_candidate_removes_same_session_variant_duplicate",
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
                  evidence: [
                    "upper_a:chest_secondary:Cable Crossover:2->3",
                  ],
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
                    limitations: ["planner_owned_week_projection_exists_but_is_diagnostic_only"],
                    safeForBehaviorPromotion: false,
                  },
                  {
                    week: 3,
                    phase: "hard_accumulation",
                    volumeMultiplier: 1.075,
                    rirTarget: "1-2",
                    projectionBasis: "planner_owned_read_only_projection",
                    limitations: ["planner_owned_week_projection_exists_but_is_diagnostic_only"],
                    safeForBehaviorPromotion: false,
                  },
                  {
                    week: 4,
                    phase: "peak_overreach_lite",
                    volumeMultiplier: 1.125,
                    rirTarget: "0-1",
                    projectionBasis: "planner_owned_read_only_projection",
                    limitations: ["planner_owned_week_projection_exists_but_is_diagnostic_only"],
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
                    limitations: ["deload_transform_defined_not_production_projected"],
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
                  description: "Primary hard-target muscles must meet Week 1 minimums.",
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
                nextBestMigrationSlice: "chest_secondary:promote_to_planner_later",
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
                      slotIntent: "horizontal push/pull + rear delt/triceps support",
                      targetSessionSets: { min: 3, preferred: 4, max: 4 },
                      lanes: [
                        {
                          laneId: "chest_anchor",
                          role: "anchor",
                          primaryMuscles: ["Chest"],
                          preferredExerciseClasses: ["horizontal_press"],
                          setBudget: {
                            min: 3,
                            preferred: 4,
                            max: 4,
                            basis: "target_lane",
                          },
                          capPolicy: {
                            maxSetsPerExerciseWithoutJustification: 5,
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
                doesNotAffectRuntimeReplay: true,
              },
            },
            plannerOwnedAccumulationProjection:
              makePlannerOwnedAccumulationProjection(),
            v2ExerciseSelectionPlanDiagnostic:
              makeV2ExerciseSelectionPlanDiagnostic(),
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
                validationFailures: [
                  "Incline Dumbbell Press:set_count_gt_5:6",
                ],
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
                reason: "primary_hard_target_excessive_single_exercise_share_unjustified",
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
                reason: "support_direct_isolation_concentrated_but_clean_and_near_or_at_target",
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
                reason: "secondary_or_implicit_collateral_not_acceptance_target",
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
            underTargetClusters: [{ muscle: "Chest", deficit: 6 }],
            fatigueRisks: ["Glutes projects 2.0 sets over MAV"],
          },
          interventionHints: [
            {
              muscle: "Chest",
              suggestedSets: 2,
              reason: "Projected 2.0 sets below MEV",
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
      "[workout-audit:current-week] below_mev=Chest under_target_clusters=Chest (-6.0) over_mav=Glutes",
      "[workout-audit:current-week] fatigue_risks=Glutes projects 2.0 sets over MAV",
      "[workout-audit:current-week] intervention_hints=Chest:2 sets (Projected 2.0 sets below MEV)",
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

describe("buildWeeklyRetroOperatorSummary", () => {
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
      "[workout-audit:retro] under_target=Chest (-4.0), Calves (-1.0)",
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
      "[workout-audit:retro] projection_delivery_drift=comparable direction=underdelivery under=2 over=0 net=-5.5"
    );
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
      "[workout-audit:retro] under_target=none",
      "[workout-audit:retro] interventions=none",
      "[workout-audit:retro] recommendation=no_further_action",
    ]);
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
                added: [{ exerciseId: "fly", exerciseName: "Cable Fly", role: "ACCESSORY" }],
                removed: [{ exerciseId: "curl", exerciseName: "Cable Curl", role: "ACCESSORY" }],
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
                  requiredMovementPatterns: ["vertical_pull", "horizontal_pull"],
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
                  requiredMovementPatterns: ["vertical_pull", "horizontal_pull"],
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
    expect(buildActiveMesocycleSlotReseedApplySummary({ result: null })).toBeNull();
  });
});
