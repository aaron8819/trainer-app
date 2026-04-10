import { describe, expect, it } from "vitest";
import {
  buildActiveMesocycleSlotReseedApplySummary,
  buildActiveMesocycleSlotReseedSummary,
  buildCurrentWeekAuditOperatorSummary,
  buildProjectedWeekDebugSummary,
  buildProjectedWeekOperatorSummary,
  buildWeeklyRetroOperatorSummary,
  normalizeAuditIntentArg,
} from "../../../../scripts/workout-audit";

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
      "[workout-audit:retro] under_target=Chest (-4.0), Calves (-1.0)",
      "[workout-audit:retro] interventions=slot_identity, volume_deficit",
      "[workout-audit:retro] recommendation=Repair missing slot receipts.",
    ]);
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
          interventions: [],
          rootCauses: [],
          recommendedPriorities: [],
        },
      },
    });

    expect(summary).toEqual([
      "[workout-audit:retro] load_calibration=aligned comparable_sessions=3 drift_sessions=0 legacy_limited=0",
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
