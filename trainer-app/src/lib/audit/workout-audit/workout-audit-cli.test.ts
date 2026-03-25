import { describe, expect, it } from "vitest";
import {
  buildProjectedWeekDebugSummary,
  buildProjectedWeekOperatorSummary,
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
