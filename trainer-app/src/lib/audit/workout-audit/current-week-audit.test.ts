import { describe, expect, it } from "vitest";
import { buildCurrentWeekAuditEvaluation } from "./current-week-audit";
import type { ProjectedWeekVolumeAuditPayload } from "./types";

function buildPayload(
  overrides: Partial<ProjectedWeekVolumeAuditPayload> = {}
): ProjectedWeekVolumeAuditPayload {
  return {
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
    ...overrides,
  };
}

describe("buildCurrentWeekAuditEvaluation", () => {
  it("keeps quiet weeks empty", () => {
    const evaluation = buildCurrentWeekAuditEvaluation(
      buildPayload({
        fullWeekByMuscle: [
          {
            muscle: "Chest",
            completedEffectiveSets: 0,
            projectedNextSessionEffectiveSets: 4,
            projectedRemainingWeekEffectiveSets: 6,
            projectedFullWeekEffectiveSets: 10,
            weeklyTarget: 10,
            mev: 6,
            mav: 16,
            deltaToTarget: 0,
            deltaToMev: 4,
            deltaToMav: -6,
          },
        ],
      })
    );

    expect(evaluation).toEqual({
      currentWeekAudit: {
        belowMEV: [],
        overMAV: [],
        underTargetClusters: [],
        fatigueRisks: [],
      },
      interventionHints: [],
      sessionRisks: [],
    });
  });

  it("flags meaningful projection deficits and caps intervention hints", () => {
    const evaluation = buildCurrentWeekAuditEvaluation(
      buildPayload({
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
          {
            muscle: "Calves",
            completedEffectiveSets: 0,
            projectedNextSessionEffectiveSets: 2,
            projectedRemainingWeekEffectiveSets: 5,
            projectedFullWeekEffectiveSets: 7,
            weeklyTarget: 9,
            mev: 6,
            mav: 12,
            deltaToTarget: -2,
            deltaToMev: 1,
            deltaToMav: -5,
          },
          {
            muscle: "Biceps",
            completedEffectiveSets: 0,
            projectedNextSessionEffectiveSets: 2,
            projectedRemainingWeekEffectiveSets: 2,
            projectedFullWeekEffectiveSets: 4,
            weeklyTarget: 10,
            mev: 6,
            mav: 7,
            deltaToTarget: -6,
            deltaToMev: -2,
            deltaToMav: -3,
          },
        ],
      })
    );

    expect(evaluation.currentWeekAudit.belowMEV).toEqual(["Biceps", "Chest"]);
    expect(evaluation.currentWeekAudit.underTargetClusters).toEqual([
      { muscle: "Biceps", deficit: 6 },
      { muscle: "Chest", deficit: 6 },
    ]);
    expect(evaluation.interventionHints).toEqual([
      {
        muscle: "Biceps",
        suggestedSets: 2,
        reason: "Projected 2.0 sets below MEV",
      },
      {
        muscle: "Chest",
        suggestedSets: 2,
        reason: "Projected 2.0 sets below MEV",
      },
    ]);
  });

  it("flags over-MAV fatigue risks and session-shape warnings without proposing near-MAV additions", () => {
    const evaluation = buildCurrentWeekAuditEvaluation(
      buildPayload({
        projectedSessions: [
          {
            slotId: "lower_b",
            intent: "lower",
            isNext: true,
            exerciseCount: 6,
            totalSets: 22,
            estimatedMinutes: 85,
            movementPatternCounts: {
              squat: 2,
              hinge: 1,
              lunge: 1,
            },
            projectedContributionByMuscle: {
              Glutes: 5,
              "Lower Back": 2,
            },
          },
          {
            slotId: "upper_b",
            intent: "upper",
            isNext: false,
            exerciseCount: 6,
            totalSets: 20,
            estimatedMinutes: 65,
            movementPatternCounts: {
              horizontal_pull: 3,
              vertical_pull: 1,
              horizontal_push: 1,
            },
            projectedContributionByMuscle: {
              Lats: 4,
              "Upper Back": 4,
            },
          },
        ],
        fullWeekByMuscle: [
          {
            muscle: "Glutes",
            completedEffectiveSets: 0,
            projectedNextSessionEffectiveSets: 18,
            projectedRemainingWeekEffectiveSets: 0,
            projectedFullWeekEffectiveSets: 18,
            weeklyTarget: 12,
            mev: 8,
            mav: 16,
            deltaToTarget: 6,
            deltaToMev: 10,
            deltaToMav: 2,
          },
          {
            muscle: "Rear Delts",
            completedEffectiveSets: 0,
            projectedNextSessionEffectiveSets: 0,
            projectedRemainingWeekEffectiveSets: 10,
            projectedFullWeekEffectiveSets: 10,
            weeklyTarget: 13,
            mev: 4,
            mav: 12,
            deltaToTarget: -3,
            deltaToMev: 6,
            deltaToMav: -2,
          },
        ],
      })
    );

    expect(evaluation.currentWeekAudit.overMAV).toEqual(["Glutes"]);
    expect(evaluation.currentWeekAudit.fatigueRisks).toEqual([
      "Glutes projects 2.0 sets over MAV",
      "lower_b: high systemic fatigue pattern: squat/hinge/lunge stacking with glutes/lower back stimulus",
    ]);
    expect(evaluation.interventionHints).toEqual([]);
    expect(evaluation.sessionRisks).toEqual([
      {
        slotId: "lower_b",
        issue: "projected duration 85 min exceeds ~80 min",
      },
      {
        slotId: "lower_b",
        issue:
          "high systemic fatigue pattern: squat/hinge/lunge stacking with glutes/lower back stimulus",
      },
      {
        slotId: "upper_b",
        issue: "redundant pattern stacking: horizontal pull appears 3 times",
      },
      {
        slotId: "upper_b",
        issue: "excessive pull vs push imbalance: pull-pattern exercises 4 vs push 1",
      },
    ]);
  });
});
