import { describe, expect, it } from "vitest";
import type { WorkoutExplanation } from "@/lib/engine/explainability";
import { buildPostWorkoutInsightsModel } from "./post-workout-insights";

function makeExplanation(): WorkoutExplanation {
  return {
    confidence: {
      level: "high",
      summary: "ok",
      missingSignals: [],
    },
    sessionContext: {
      blockPhase: {
        blockType: "accumulation",
        weekInBlock: 4,
        totalWeeksInBlock: 4,
        primaryGoal: "build",
      },
      volumeStatus: {
        muscleStatuses: new Map(),
        overallSummary: "ok",
      },
      readinessStatus: {
        overall: "moderate",
        signalAge: 0,
        availability: "recent",
        label: "Recent readiness",
        perMuscleFatigue: new Map(),
        sorenessSuppressedMuscles: [],
        adaptations: [],
      },
      progressionContext: {
        weekInMesocycle: 4,
        volumeProgression: "building",
        intensityProgression: "ramping",
        nextMilestone: "deload next",
      },
      cycleSource: "computed",
      narrative: "narrative",
    },
    coachMessages: [],
    exerciseRationales: new Map(),
    prescriptionRationales: new Map(),
    progressionReceipts: new Map([
      [
        "lat-pull",
        {
          lastPerformed: {
            reps: 12,
            load: 35,
            rpe: 8,
            performedAt: "2026-02-18T00:00:00.000Z",
          },
          todayPrescription: {
            reps: 10,
            load: 40,
            rpe: 8,
          },
          delta: {
            load: 5,
            loadPercent: 14.2857,
            reps: -2,
            rpe: 0,
          },
          trigger: "double_progression",
          decisionLog: [],
        },
      ],
    ]),
    nextExposureDecisions: new Map([
      [
        "lat-pull",
        {
          action: "hold",
          summary: "Next exposure: hold load.",
          reason: "Median reps stayed at 8 in the 8-12 band, so keep building reps before adding load.",
          anchorLoad: 40,
          repRange: { min: 8, max: 12 },
          modalRpe: 8,
          medianReps: 8,
        },
      ],
    ]),
    filteredExercises: [],
    volumeCompliance: [
      {
        muscle: "Lats",
        performedEffectiveVolumeBeforeSession: 6,
        plannedEffectiveVolumeThisSession: 4,
        projectedEffectiveVolume: 10,
        weeklyTarget: 10,
        mev: 8,
        mav: 16,
        status: "ON_TARGET",
      },
    ],
  };
}

describe("buildPostWorkoutInsightsModel", () => {
  it("keeps the session outcome and next-time guidance aligned for hold cases", () => {
    const model = buildPostWorkoutInsightsModel({
      explanation: makeExplanation(),
      exercises: [
        {
          exerciseId: "lat-pull",
          exerciseName: "Lat Pulldown",
          isMainLift: true,
        },
      ],
    });

    expect(model.headline).toBe(
      "Key lifts point to a hold next time while reps keep building."
    );
    expect(model.summary).toContain("next exposure points to a hold");
    expect(model.overview.find((item) => item.label === "Next time")?.value).toContain(
      "Hold load on Lat Pulldown"
    );
    expect(model.overview.find((item) => item.label === "Next time")?.emphasized).toBe(true);
    expect(model.overview.some((item) => item.label === "Program impact")).toBe(false);
    expect(model.keyLifts[0]?.badge).toBe("Hold next time");
    expect(model.keyLifts[0]?.nextTime).toContain("Next exposure: hold load.");
    expect(model.keyLifts[0]?.todayContext).toContain("Today's written target moved from 35 lbs to 40 lbs");
    expect(model.programSignals[0]).toMatchObject({
      label: "Lats",
      tone: "positive",
    });
  });

  it("uses the dashboard weekly-status ladder for projected program impact copy", () => {
    const explanation = makeExplanation();
    explanation.volumeCompliance = [
      {
        muscle: "Front Delts",
        performedEffectiveVolumeBeforeSession: 0,
        plannedEffectiveVolumeThisSession: 9.6,
        projectedEffectiveVolume: 9.6,
        weeklyTarget: 7,
        mev: 2,
        mav: 7,
        status: "OVER_MAV",
      },
      {
        muscle: "Triceps",
        performedEffectiveVolumeBeforeSession: 0,
        plannedEffectiveVolumeThisSession: 12.5,
        projectedEffectiveVolume: 12.5,
        weeklyTarget: 12,
        mev: 6,
        mav: 12,
        status: "OVER_MAV",
      },
    ];

    const model = buildPostWorkoutInsightsModel({
      explanation,
      exercises: [],
    });

    expect(model.programSignals).toEqual([
      {
        label: "Front Delts",
        value: "Front Delts is on target for the week after this session.",
        tone: "positive",
      },
      {
        label: "Triceps",
        value: "Triceps is on target for the week after this session.",
        tone: "positive",
      },
    ]);
  });

  it("uses deload-first framing instead of progression-first messaging for deload sessions", () => {
    const explanation = makeExplanation();
    explanation.sessionContext.blockPhase.blockType = "deload";
    explanation.progressionReceipts = new Map([
      [
        "lat-pull",
        {
          lastPerformed: {
            reps: 12,
            load: 35,
            rpe: 8,
            performedAt: "2026-02-18T00:00:00.000Z",
          },
          todayPrescription: {
            reps: 10,
            load: 30,
            rpe: 5,
          },
          delta: {
            load: -5,
            loadPercent: -14.2857,
            reps: -2,
            rpe: -3,
          },
          trigger: "deload",
          decisionLog: [],
        },
      ],
    ]);

    const model = buildPostWorkoutInsightsModel({
      explanation,
      exercises: [
        {
          exerciseId: "lat-pull",
          exerciseName: "Lat Pulldown",
          isMainLift: true,
        },
      ],
    });

    expect(model.headline).toBe("Deload logged. The win was crisp work with low fatigue.");
    expect(model.summary).toContain("intentionally lighter");
    expect(model.overview).toEqual([
      expect.objectContaining({
        label: "Deload focus",
        value: expect.stringContaining("low fatigue"),
      }),
      expect.objectContaining({
        label: "What comes next",
        value: expect.stringContaining("re-anchors from your accumulation work"),
        emphasized: true,
      }),
    ]);
    expect(model.keyLifts[0]).toMatchObject({
      badge: "Deload",
      action: "deload",
    });
    expect(model.keyLifts[0]?.todayContext).toContain("intentionally lighter");
    expect(model.keyLifts[0]?.nextTime).toContain("not a normal progression call");
    expect(model.summary).not.toContain("next exposure points to");
  });
});
