import { describe, expect, it } from "vitest";
import {
  buildCurrentWeekAuditOperatorSummary,
  buildNextMesocycleAcceptanceGateSummary,
  buildPlanningRealitySummary,
  buildPreSessionReadinessSummary,
  buildWeeklyRetroOperatorSummary,
} from "../../../../scripts/workout-audit";

describe("planning diagnostic readout target semantics", () => {
  it("formats current-week below-MEV and above-MEV target misses as separate readout buckets", () => {
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
            underTargetClusters: [{ muscle: "Chest", deficit: 2.5 }],
            belowPreferred: [
              { muscle: "Side Delts", deficit: 1.5, status: "stretch_miss" },
            ],
            fatigueRisks: ["Glutes projects 1.0 sets over MAV"],
          },
          interventionHints: [
            {
              muscle: "Chest",
              suggestedSets: 3,
              reason: "below_mev: projected 2.5 sets below MEV; bounded floor closure only",
            },
          ],
          sessionRisks: [],
        },
      },
    });

    expect(summary).toEqual([
      "[workout-audit:current-week] below_mev=Chest mev_closure_clusters=Chest (-2.5) below_preferred=Side Delts:stretch_miss (-1.5) over_mav=Glutes",
      "[workout-audit:current-week] fatigue_risks=Glutes projects 1.0 sets over MAV",
      "[workout-audit:current-week] intervention_hints=Chest:3 sets (below_mev: projected 2.5 sets below MEV; bounded floor closure only)",
      "[workout-audit:current-week] no_target_chasing=above_mev_below_target_rows_are_monitor_only",
      "[workout-audit:current-week] session_risks=none",
    ]);
  });

  it("formats pre-session dose rows with monitor wording for target misses and cap wording for MAV rows", () => {
    const summary = buildPreSessionReadinessSummary({
      operatorDebug: true,
      artifact: {
        identity: {
          userId: "user-1",
          ownerEmail: "owner@test.local",
        },
        request: {
          mode: "pre-session-readiness",
          ownerEmail: "owner@test.local",
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
              exerciseCount: 0,
              totalSets: 0,
              projectedContributionByMuscle: {},
            },
          ],
          fullWeekByMuscle: [],
          runtimeDoseAdjustmentDiagnostics: [
            {
              muscle: "Biceps",
              plannedRemainingVolume: { effectiveSets: 0, bySlot: [] },
              performedWeekToDateVolume: {
                effectiveSets: 10,
                source: "weekly_volume_read_model",
              },
              projectedEndOfWeekVolume: {
                effectiveSets: 10,
                weeklyTarget: 12,
                mev: 6,
                mav: 12,
              },
              targetStatus: "stretch_miss",
              fatigueDensityConcern: { level: "none", drivers: [] },
              recoveryReadinessCaveat: { status: "none" },
              recommendedAction: { kind: "hold_seed", setDelta: 0 },
              reasonCode: "below_preferred_monitor",
              guidance:
                "productive floor achieved; below preferred target; monitor, no default add-on",
              confidence: 0.8,
              readOnly: true,
              affectsAcceptedSeed: false,
            },
            {
              muscle: "Glutes",
              plannedRemainingVolume: { effectiveSets: 0, bySlot: [] },
              performedWeekToDateVolume: {
                effectiveSets: 15,
                source: "weekly_volume_read_model",
              },
              projectedEndOfWeekVolume: {
                effectiveSets: 15,
                weeklyTarget: 12,
                mev: 8,
                mav: 16,
              },
              targetStatus: "near_mav",
              fatigueDensityConcern: { level: "meaningful", drivers: ["near_mav"] },
              recoveryReadinessCaveat: { status: "none" },
              recommendedAction: { kind: "hold_seed", setDelta: 0 },
              reasonCode: "near_mav_cap",
              guidance: "near MAV cap; suppress add-ons",
              confidence: 0.8,
              readOnly: true,
              affectsAcceptedSeed: false,
            },
            {
              muscle: "Lats",
              plannedRemainingVolume: { effectiveSets: 0, bySlot: [] },
              performedWeekToDateVolume: {
                effectiveSets: 17,
                source: "weekly_volume_read_model",
              },
              projectedEndOfWeekVolume: {
                effectiveSets: 17,
                weeklyTarget: 12,
                mev: 8,
                mav: 16,
              },
              targetStatus: "over_mav",
              fatigueDensityConcern: { level: "high", drivers: ["over_mav"] },
              recoveryReadinessCaveat: { status: "none" },
              recommendedAction: { kind: "hold_seed", setDelta: 0 },
              reasonCode: "over_mav_caution",
              guidance: "over MAV; suppress add-ons",
              confidence: 0.8,
              readOnly: true,
              affectsAcceptedSeed: false,
            },
            {
              muscle: "Side Delts",
              plannedRemainingVolume: { effectiveSets: 0, bySlot: [] },
              performedWeekToDateVolume: {
                effectiveSets: 8,
                source: "weekly_volume_read_model",
              },
              projectedEndOfWeekVolume: {
                effectiveSets: 8,
                weeklyTarget: 10,
                mev: 6,
                mav: 14,
              },
              targetStatus: "below_preferred",
              fatigueDensityConcern: { level: "none", drivers: [] },
              recoveryReadinessCaveat: { status: "none" },
              recommendedAction: { kind: "hold_seed", setDelta: 0 },
              reasonCode: "below_preferred_monitor",
              guidance:
                "productive floor achieved; below preferred target; monitor, no default add-on",
              confidence: 0.8,
              readOnly: true,
              affectsAcceptedSeed: false,
            },
          ],
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
        "Biceps | 10 vs MEV 6 / target 12 / MAV 12 | stretch_miss | monitor, no default add-on | 0.8",
        "Glutes | 15 vs MEV 8 / target 12 / MAV 16 | near_mav | hold seed; near MAV cap | 0.8",
        "Lats | 17 vs MEV 8 / target 12 / MAV 16 | over_mav | hold seed; over MAV caution | 0.8",
        "Side Delts | 8 vs MEV 6 / target 10 / MAV 14 | below_preferred | monitor, no default add-on | 0.8",
      ]),
    );
    const targetMissLines = summary?.filter(
      (line) => line.includes("below_preferred") || line.includes("stretch_miss"),
    ) ?? [];
    expect(targetMissLines.join("\n")).not.toMatch(/failure|blocker/i);
  });

  it("formats weekly-retro volume rows with floor, preferred, and cap labels", () => {
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
            muscles: [
              {
                muscle: "Chest",
                actualEffectiveSets: 9,
                weeklyTarget: 14,
                mev: 10,
                mav: 16,
                deltaToTarget: -5,
                deltaToMev: -1,
                deltaToMav: -7,
                status: "below_mev",
                topContributors: [],
              },
              {
                muscle: "Side Delts",
                actualEffectiveSets: 8,
                weeklyTarget: 10,
                mev: 6,
                mav: 14,
                deltaToTarget: -2,
                deltaToMev: 2,
                deltaToMav: -6,
                status: "under_target_only",
                topContributors: [],
              },
              {
                muscle: "Glutes",
                actualEffectiveSets: 14.5,
                weeklyTarget: 12,
                mev: 8,
                mav: 16,
                deltaToTarget: 2.5,
                deltaToMev: 6.5,
                deltaToMav: -1.5,
                status: "over_target_only",
                topContributors: [],
              },
              {
                muscle: "Lats",
                actualEffectiveSets: 17,
                weeklyTarget: 12,
                mev: 8,
                mav: 16,
                deltaToTarget: 5,
                deltaToMev: 9,
                deltaToMav: 1,
                status: "over_mav",
                topContributors: [],
              },
            ],
          },
          planAdherence: {
            plannedWorkCompletedPercent: 100,
            plannedWorkMissedSets: 0,
            plannedWorkTotalSets: 40,
            plannedWorkCompletedSets: 40,
            explainedAdditions: { totalSets: 0, byIntent: {} },
            substitutions: 0,
            painFatigueDeviations: 0,
            unclassifiedDrift: 0,
            engineConfidenceImpact: "none",
            interpretations: [],
          },
          interventions: [],
          recommendedPriorities: [],
          exerciseLoadCalibrationRows: [],
        } as never,
      },
    });

    expect(summary).toEqual(
      expect.arrayContaining([
        "[workout-audit:retro] volume below_mev=Chest (-1.0) below_preferred=Side Delts (-2.0) near_cap=Glutes (-1.5) over_cap=Lats (+1.0)",
        "Chest | 9 | 10 | 14 | 16 | below_mev | floor gap 1",
        "Side Delts | 8 | 6 | 10 | 14 | below_preferred | floor reached; below preferred",
        "Glutes | 14.5 | 8 | 12 | 16 | near_cap | near MAV cap",
        "Lats | 17 | 8 | 12 | 16 | over_cap | over MAV",
      ]),
    );
  });

  it("keeps planningReality target-semantics risk wording narrow and readout-only", () => {
    const summary = buildPlanningRealitySummary({
      artifact: {
        mesocycleExplain: {
          preview: {
            projectionDiagnostics: {
              planningReality: {
                summary: {
                  planningShape: "mostly_repair_shaped",
                  materialRepairCount: 3,
                  majorRepairCount: 1,
                  warningCodes: [],
                },
                shadowRepairSummary: {
                  materialRepairCount: 3,
                  majorRepairCount: 1,
                  likelyAvoidableMaterialRepairCount: 1,
                  remainingMaterialRepairCount: 2,
                  likelyAvoidableMajorRepairCount: 0,
                  remainingMajorRepairCount: 1,
                  likelyAvoidableByMuscle: { Chest: 1 },
                  remainingByMuscle: { "Side Delts": 1 },
                },
                weeklyDemandCurve: {
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
                      weekLevelLimitations: [],
                    },
                    {
                      week: 5,
                      phase: "deload",
                      projectionStatus: "not_projected_missing_policy",
                      muscles: [],
                      weekLevelLimitations: [],
                    },
                  ],
                  crossWeekWarnings: [
                    {
                      code: "PRIMARY_UNDER_TARGET_ACROSS_ACCUMULATION",
                      muscle: "Chest",
                      evidence: ["week1_final=8:preferred=10"],
                      severity: "warning",
                    },
                    {
                      code: "SUPPORT_UNDER_TARGET_ACROSS_ACCUMULATION",
                      muscle: "Side Delts",
                      evidence: ["week1_final=7:preferred=9"],
                      severity: "warning",
                    },
                  ],
                },
              },
            },
          },
        },
      } as never,
    });

    expect(summary).toEqual(
      expect.arrayContaining([
        "Weekly Demand Curve",
        "- Chest below preferred target across accumulation",
        "- Side Delts below preferred support target",
      ]),
    );
  });

  it("keeps acceptance-gate readout statuses and repair-burden wording stable", () => {
    const summary = buildNextMesocycleAcceptanceGateSummary({
      artifact: {
        nextMesocycleAcceptanceGate: {
          version: 1,
          source: "next_mesocycle_acceptance_gate_audit",
          readOnly: true,
          affectsScoringOrGeneration: false,
          consumedByProduction: false,
          wouldWriteTransaction: false,
          gateResult: "accepted_with_watch_items",
          candidateFound: true,
          why: [],
          recommendation: "accept with watch items",
          decisionSummary: {
            trainability: "warning",
            plannerMaterializerQuality: "warning",
            repairBurden: "high",
            repairBurdenEvidence:
              "planning_shape=mostly_repair_shaped materialRepairCount=3 majorRepairCount=1",
          },
          candidateIdentity: {
            ownerEmail: "owner@test.local",
            sourceMesocycleId: "meso-source",
            sourceState: "AWAITING_HANDOFF",
            candidateKind: "draft",
            candidateMesocycleId: "meso-candidate",
            candidateDraftAvailable: true,
            persistedHandoffCandidateFound: true,
            writeNeededToInspect: false,
          },
          gates: [],
          weeklyMuscleTable: [
            {
              muscle: "Chest",
              projectedSets: 9,
              mev: 10,
              productiveTarget: 14,
              mav: 16,
              status: "below_mev_fail",
              severity: "high_risk",
              notes: "below MEV blocks acceptance",
            },
            {
              muscle: "Side Delts",
              projectedSets: 8,
              mev: 6,
              productiveTarget: 10,
              mav: 14,
              status: "above_mev_below_target_not_failure",
              severity: "info",
              notes: "above MEV but below target is not a failure",
            },
            {
              muscle: "Glutes",
              projectedSets: 15,
              mev: 8,
              productiveTarget: 15.5,
              mav: 16,
              status: "target_near_mav_stretch_cap",
              severity: "info",
              notes: "target near MAV is a stretch/cap, not a quota",
            },
            {
              muscle: "Lats",
              projectedSets: 17,
              mev: 8,
              productiveTarget: 12,
              mav: 16,
              status: "over_mav_fail_or_warning",
              severity: "high_risk",
              notes: "over MAV requires failure/warning review",
            },
          ],
          priorBlockRecurringRisks: [],
          completedBlockEvidence: [],
          watchItems: [],
          findings: [],
          doNotFixNotes: [],
          diagnosticPreview: {
            available: true,
            label: "diagnostic_preview_not_candidate",
            canBeAccepted: false,
            planningShape: "mostly_repair_shaped",
            notes: [],
          },
          blockers: [],
          supportingEvidence: {
            mesocycleExplainPreviewAvailable: true,
          },
        },
      },
    });

    expect(summary).toEqual(
      expect.arrayContaining([
        "Trainability | Planner/materializer quality | Repair burden | Repair evidence",
        "warning | warning | high | planning_shape=mostly_repair_shaped materialRepairCount=3 majorRepairCount=1",
        "Chest | 9 | 10 | 14 | 16 | below_mev_fail | high_risk | below MEV blocks acceptance",
        "Side Delts | 8 | 6 | 10 | 14 | above_mev_below_target_not_failure | info | above MEV but below target is not a failure",
        "Glutes | 15 | 8 | 15.5 | 16 | target_near_mav_stretch_cap | info | target near MAV is a stretch/cap, not a quota",
        "Lats | 17 | 8 | 12 | 16 | over_mav_fail_or_warning | high_risk | over MAV requires failure/warning review",
      ]),
    );
    const sideDeltRow = summary?.find((line) => line.startsWith("Side Delts |")) ?? "";
    expect(sideDeltRow).not.toMatch(/blocker/i);
  });
});
