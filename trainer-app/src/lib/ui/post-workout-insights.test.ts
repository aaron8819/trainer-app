import { describe, expect, it } from "vitest";
import type { WorkoutExplanation } from "@/lib/engine/explainability";
import { buildPostWorkoutInsightsModel } from "./post-workout-insights";
import { formatRepPrescription } from "./rep-target-display";

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
          reason: "Median reps stayed at 8 in the 8–12 range, so keep building reps before adding load.",
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
  it("formats main-lift rep ranges with the range primary and aim secondary", () => {
    expect(
      formatRepPrescription(
        {
          targetReps: 9,
          targetRepRange: { min: 6, max: 10 },
        },
        { showAim: true }
      )
    ).toEqual({
      primary: "6–10 reps",
      secondary: "aim 9",
    });

    expect(
      formatRepPrescription({
        targetReps: 10,
        targetRepRange: { min: 10, max: 15 },
      })
    ).toEqual({
      primary: "10–15 reps",
      secondary: null,
    });
  });

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

  it("ranks final-opportunity MEV closures above neutral readiness and in-range notes", () => {
    const explanation = makeExplanation();
    explanation.sessionContext.readinessStatus.adaptations = [
      "Readiness normal; no adjustment needed.",
    ];
    explanation.volumeCompliance = [
      {
        muscle: "Calves",
        performedEffectiveVolumeBeforeSession: 7,
        plannedEffectiveVolumeThisSession: 1,
        projectedEffectiveVolume: 8,
        weeklyTarget: 12,
        mev: 8,
        mav: 16,
        status: "APPROACHING_TARGET",
      },
      {
        muscle: "Chest",
        performedEffectiveVolumeBeforeSession: 8,
        plannedEffectiveVolumeThisSession: 2,
        projectedEffectiveVolume: 10,
        weeklyTarget: 14,
        mev: 10,
        mav: 20,
        status: "APPROACHING_TARGET",
      },
      {
        muscle: "Triceps",
        performedEffectiveVolumeBeforeSession: 5.6,
        plannedEffectiveVolumeThisSession: 2,
        projectedEffectiveVolume: 7.6,
        weeklyTarget: 10,
        mev: 6,
        mav: 16,
        status: "APPROACHING_TARGET",
      },
      {
        muscle: "Adductors",
        performedEffectiveVolumeBeforeSession: 8,
        plannedEffectiveVolumeThisSession: 1,
        projectedEffectiveVolume: 9,
        weeklyTarget: 12,
        mev: 6,
        mav: 18,
        status: "APPROACHING_TARGET",
      },
    ];

    const model = buildPostWorkoutInsightsModel({
      explanation,
      exercises: [],
    });

    expect(model.programSignals).toHaveLength(3);
    expect(model.programSignals[0]).toMatchObject({
      label: "Chest",
      tone: "positive",
      value: expect.stringContaining("below MEV before this session"),
    });
    expect(model.programSignals[1]).toMatchObject({
      label: "Triceps",
      tone: "positive",
      value: expect.stringContaining("below MEV before this session"),
    });
    expect(model.programSignals.map((signal) => signal.label)).not.toContain("Readiness");
  });

  it("keeps below-MEV-after-session and readiness warnings ahead of MEV closures", () => {
    const explanation = makeExplanation();
    explanation.sessionContext.readinessStatus.adaptations = [
      "Readiness adaptation: keep the next block conservative.",
    ];
    explanation.volumeCompliance = [
      {
        muscle: "Lats",
        performedEffectiveVolumeBeforeSession: 4,
        plannedEffectiveVolumeThisSession: 1,
        projectedEffectiveVolume: 5,
        weeklyTarget: 12,
        mev: 8,
        mav: 18,
        status: "UNDER_MEV",
      },
      {
        muscle: "Chest",
        performedEffectiveVolumeBeforeSession: 8,
        plannedEffectiveVolumeThisSession: 2,
        projectedEffectiveVolume: 10,
        weeklyTarget: 14,
        mev: 10,
        mav: 20,
        status: "APPROACHING_TARGET",
      },
    ];

    const model = buildPostWorkoutInsightsModel({
      explanation,
      exercises: [],
    });

    expect(model.programSignals.map((signal) => signal.label)).toEqual([
      "Readiness",
      "Lats",
      "Chest",
    ]);
    expect(model.programSignals[1]?.value).toContain("still below MEV");
    expect(model.programSignals[2]?.value).toContain("below MEV before this session");
  });

  it("does not frame target-quality downgrades as plain increases", () => {
    const explanation = makeExplanation();
    explanation.nextExposureDecisions = new Map([
      [
        "lat-pull",
        {
          action: "target_too_high",
          summary: "Next exposure: target likely too high.",
          reason:
            "Hold around 115 lbs next time and rebuild from today's performed anchor, not the old written target 140 lbs. Treat 140 lbs as too high for next exposure rather than a normal clean hold.",
          anchorLoad: 115,
          repRange: { min: 6, max: 10 },
          modalRpe: 7.5,
          medianReps: 9,
        },
      ],
    ]);

    const model = buildPostWorkoutInsightsModel({
      explanation,
      exercises: [
        {
          exerciseId: "lat-pull",
          exerciseName: "Stiff-Legged Deadlift",
          isMainLift: true,
        },
      ],
    });

    expect(model.headline).toBe("Key lifts need target review before increasing next time.");
    expect(model.summary).toContain("Review or recalibrate Stiff-Legged Deadlift");
    expect(model.overview.find((item) => item.label === "Next time")?.value).toContain(
      "Review or recalibrate Stiff-Legged Deadlift"
    );
    expect(model.overview.find((item) => item.label === "Next time")?.tone).toBe("caution");
    expect(model.keyLifts[0]?.badge).toBe("Target too high");
    expect(model.keyLifts[0]?.nextTime).toContain("Next exposure: target likely too high.");
    expect(model.keyLifts[0]?.nextTime).toContain("Hold around 115 lbs next time");
    expect(model.keyLifts[0]?.nextTime).toContain(
      "Treat 140 lbs as too high for next exposure"
    );
    expect(model.headline).not.toContain("point to an increase");
  });

  it("ranks severe target-too-high recalibration ahead of accessory upward recalibrations", () => {
    const explanation = makeExplanation();
    explanation.nextExposureDecisions = new Map([
      [
        "shoulder-press",
        {
          action: "recalibrated_increase",
          summary: "Next exposure: recalibrated increase.",
          reason: "Increase from the performed anchor.",
          anchorLoad: 85,
          repRange: { min: 8, max: 12 },
          modalRpe: 7.5,
          medianReps: 10,
        },
      ],
      [
        "lateral-raise",
        {
          action: "recalibrated_increase",
          summary: "Next exposure: recalibrated increase.",
          reason: "Increase from the performed anchor.",
          anchorLoad: 25,
          repRange: { min: 10, max: 15 },
          modalRpe: 7.5,
          medianReps: 12,
        },
      ],
      [
        "barbell-curl",
        {
          action: "recalibrated_increase",
          summary: "Next exposure: recalibrated increase.",
          reason: "Increase from the performed anchor.",
          anchorLoad: 60,
          repRange: { min: 8, max: 12 },
          modalRpe: 8,
          medianReps: 10,
        },
      ],
      [
        "cable-fly",
        {
          action: "target_too_high",
          summary: "Next exposure: target likely too high.",
          reason:
            "Next target should hold and rebuild from today's 17.5 lbs performed anchor, not the old written target 55 lbs. Treat the written target as too high rather than a normal clean hold.",
          anchorLoad: 17.5,
          repRange: { min: 10, max: 15 },
          modalRpe: 7.5,
          medianReps: 12,
        },
      ],
    ]);

    const model = buildPostWorkoutInsightsModel({
      explanation,
      exercises: [
        { exerciseId: "shoulder-press", exerciseName: "Machine Shoulder Press", isMainLift: false },
        { exerciseId: "lateral-raise", exerciseName: "Machine Lateral Raise", isMainLift: false },
        { exerciseId: "barbell-curl", exerciseName: "Barbell Curl", isMainLift: false },
        { exerciseId: "cable-fly", exerciseName: "Cable Fly", isMainLift: false },
      ],
    });

    expect(model.keyLifts[0]).toMatchObject({
      exerciseName: "Cable Fly",
      badge: "Target too high",
      tone: "caution",
    });
    expect(model.keyLifts.map((lift) => lift.exerciseName)).toEqual([
      "Cable Fly",
      "Machine Shoulder Press",
      "Machine Lateral Raise",
    ]);
    expect(model.headline).toBe("Key lifts need target review before increasing next time.");
  });

  it("frames upward recalibration without missed-target language", () => {
    const explanation = makeExplanation();
    explanation.nextExposureDecisions = new Map([
      [
        "lat-pull",
        {
          action: "recalibrated_increase",
          summary: "Next exposure: recalibrated increase.",
          reason:
            "This is an upward target recalibration from today's 110 lbs performed anchor. The written target 55 lbs was too low.",
          anchorLoad: 110,
          repRange: { min: 8, max: 12 },
          modalRpe: 7.5,
          medianReps: 10,
        },
      ],
    ]);

    const model = buildPostWorkoutInsightsModel({
      explanation,
      exercises: [
        {
          exerciseId: "lat-pull",
          exerciseName: "Incline Machine Press",
          isMainLift: true,
        },
      ],
    });

    expect(model.headline).toBe("Key lifts point to recalibrated increases from performed anchors.");
    expect(model.summary).toContain("written target needs calibration");
    expect(model.overview.find((item) => item.label === "Next time")?.value).toContain(
      "Use a recalibrated increase on Incline Machine Press"
    );
    expect(model.keyLifts[0]?.badge).toBe("Recalibrated increase");
    expect(model.keyLifts[0]?.nextTime).toContain("Next exposure: recalibrated increase.");
    expect(JSON.stringify(model)).not.toMatch(/missed/i);
    expect(model.headline).not.toContain("clean increase");
  });

  it("surfaces notable accessory recalibration even when a main lift exists", () => {
    const explanation = makeExplanation();
    explanation.nextExposureDecisions = new Map([
      [
        "main",
        {
          action: "hold",
          summary: "Next exposure: hold load.",
          reason: "Median reps stayed in range, so keep building reps before adding load.",
          anchorLoad: 225,
          repRange: { min: 6, max: 10 },
          modalRpe: 8,
          medianReps: 8,
        },
      ],
      [
        "leg-extension",
        {
          action: "hold_at_recalibrated_anchor",
          summary: "Next exposure: hold at recalibrated anchor.",
          reason:
            "Next target should hold at today's 85 lbs performed anchor, not the old written target 70 lbs. The written target or estimate was too low and was recalibrated upward.",
          anchorLoad: 85,
          repRange: { min: 10, max: 15 },
          modalRpe: 7.5,
          medianReps: 12,
        },
      ],
    ]);

    const model = buildPostWorkoutInsightsModel({
      explanation,
      exercises: [
        {
          exerciseId: "main",
          exerciseName: "Back Squat",
          isMainLift: true,
        },
        {
          exerciseId: "leg-extension",
          exerciseName: "Leg Extension",
          isMainLift: false,
        },
      ],
    });

    expect(model.keyLifts.map((lift) => lift.exerciseName)).toContain("Leg Extension");
    expect(model.keyLifts[0]).toMatchObject({
      exerciseName: "Leg Extension",
      badge: "Recalibrated hold",
      nextTime: expect.stringContaining("hold at recalibrated anchor"),
    });
    expect(model.headline).toBe("Key lifts should hold at recalibrated performed anchors.");
    expect(model.overview.find((item) => item.label === "Next time")?.value).toContain(
      "Hold the recalibrated anchor on Leg Extension"
    );
  });

  it("keeps runtime-added exercises out of key-lift takeaways by default", () => {
    const explanation = makeExplanation();
    explanation.nextExposureDecisions = new Map([
      [
        "planned",
        {
          action: "hold",
          summary: "Next exposure: hold load.",
          reason: "Median reps stayed in range, so keep building reps before adding load.",
          anchorLoad: 40,
          repRange: { min: 8, max: 12 },
          modalRpe: 8,
          medianReps: 8,
        },
      ],
      [
        "bonus",
        {
          action: "target_too_high",
          summary: "Next exposure: target likely too high.",
          reason: "Runtime-added work should stay out of key-lift takeaways.",
          anchorLoad: 20,
          repRange: { min: 10, max: 15 },
          modalRpe: 7,
          medianReps: 12,
        },
      ],
    ]);

    const model = buildPostWorkoutInsightsModel({
      explanation,
      exercises: [
        { exerciseId: "planned", exerciseName: "Lat Pulldown", isMainLift: true },
        {
          exerciseId: "bonus",
          exerciseName: "Bonus Cable Curl",
          isMainLift: false,
          isRuntimeAdded: true,
        },
      ],
    });

    expect(model.keyLifts.map((lift) => lift.exerciseName)).toEqual(["Lat Pulldown"]);
    expect(JSON.stringify(model.keyLifts)).not.toContain("Bonus Cable Curl");
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
        value: expect.stringContaining("re-anchors from accumulation work"),
        emphasized: true,
      }),
    ]);
    expect(model.keyLifts[0]).toMatchObject({
      badge: "Deload",
      action: "deload",
    });
    expect(model.keyLifts[0]?.todayContext).toContain("intentionally lighter");
    expect(model.keyLifts[0]?.nextTime).toContain("does not count toward progression history");
    expect(model.summary).not.toContain("next exposure points to");
  });
});
