import { describe, expect, it } from "vitest";
import { finalizeDeloadSessionResult } from "./finalize-session";
import { buildPrescriptionConfidenceReadouts } from "@/lib/api/prescription-confidence-readout";
import {
  EXACT_HISTORY_TRANSLATED_CONTEXT_REASON_CODE,
  RUNTIME_ADDED_SAME_EXERCISE_CALIBRATION_REASON_CODE,
  type ApplyLoadsAudit,
} from "@/lib/engine/apply-loads";
import type { WorkoutPlan } from "@/lib/engine/types";
import type { ProgressionDecisionTrace } from "@/lib/evidence/session-audit-types";

function workoutWithOneExercise(input: {
  exerciseId: string;
  exerciseName: string;
  targetLoad?: number;
  targetReps: number;
  targetRpe: number;
  equipment?: WorkoutPlan["mainLifts"][number]["exercise"]["equipment"];
}): WorkoutPlan {
  return {
    id: "workout-readout",
    scheduledDate: "2026-03-08T00:00:00.000Z",
    warmup: [],
    mainLifts: [
      {
        id: `${input.exerciseId}-entry`,
        exercise: {
          id: input.exerciseId,
          name: input.exerciseName,
          movementPatterns: ["hinge"],
          splitTags: ["legs"],
          jointStress: "medium",
          isMainLiftEligible: true,
          isCompound: true,
          fatigueCost: 3,
          equipment: input.equipment ?? ["barbell"],
          primaryMuscles: ["Hamstrings"],
          secondaryMuscles: ["Glutes"],
        },
        orderIndex: 0,
        isMainLift: true,
        role: "main",
        sets: [
          {
            setIndex: 1,
            targetLoad: input.targetLoad,
            targetReps: input.targetReps,
            targetRpe: input.targetRpe,
            role: "main",
          },
        ],
      },
    ],
    accessories: [],
    estimatedMinutes: 30,
  };
}

function progressionTrace(input: {
  anchorLoad: number;
  medianReps: number;
  modalRpe: number;
  nextLoad: number;
  combinedScale?: number;
  reasonCodes?: string[];
  confidenceReasons?: string[];
}): ProgressionDecisionTrace {
  return {
    version: 1,
    decisionSource: "double_progression",
    repRange: { min: 8, max: 12 },
    equipment: "barbell",
    anchor: {
      source: "conservative_modal",
      workingSetApplied: false,
      anchorLoad: input.anchorLoad,
      signalSetCount: 1,
      effectiveSetCount: 1,
      trimmedSetCount: 0,
      highVarianceDetected: false,
      minSignalLoad: input.anchorLoad,
      maxSignalLoad: input.anchorLoad,
      medianSignalLoad: input.anchorLoad,
    },
    confidence: {
      priorSessionCount: 1,
      sampleScale: 1,
      historyScale: input.combinedScale ?? 1,
      combinedScale: input.combinedScale ?? 1,
      reasons: input.confidenceReasons ?? [],
    },
    metrics: {
      medianReps: input.medianReps,
      modalRpe: input.modalRpe,
      nextLoad: input.nextLoad,
      loadDelta: input.nextLoad - input.anchorLoad,
    },
    outcome: {
      path: "fallback_hold",
      action: "hold",
      reasonCodes: input.reasonCodes ?? ["held_for_test_fixture"],
    },
    decisionLog: [],
  };
}

function loadAuditFor(input: {
  exerciseId: string;
  source: ApplyLoadsAudit["resolvedLoads"][string]["source"];
  targetLoad: number;
  trace?: ProgressionDecisionTrace;
  selectedAnchorEvidence?: ApplyLoadsAudit["selectedAnchorEvidence"];
}): Pick<
  ApplyLoadsAudit,
  "progressionTraces" | "resolvedLoads" | "selectedAnchorEvidence"
> {
  return {
    progressionTraces: input.trace ? { [input.exerciseId]: input.trace } : {},
    resolvedLoads: {
      [input.exerciseId]: {
        source: input.source,
        canonicalSourceLoad: input.targetLoad,
        resolvedTopSetLoad: input.targetLoad,
        resolvedSetLoads: [input.targetLoad],
      },
    },
    ...(input.selectedAnchorEvidence
      ? { selectedAnchorEvidence: input.selectedAnchorEvidence }
      : {}),
  };
}

describe("buildPrescriptionConfidenceReadouts", () => {
  it("flags the SLDL target-effort/load mismatch as caution-level low confidence", () => {
    const readouts = buildPrescriptionConfidenceReadouts({
      workout: workoutWithOneExercise({
        exerciseId: "sldl",
        exerciseName: "Stiff-Legged Deadlift",
        targetLoad: 135,
        targetReps: 10,
        targetRpe: 6.5,
      }),
      loadAudit: loadAuditFor({
        exerciseId: "sldl",
        source: "history",
        targetLoad: 135,
        trace: progressionTrace({
          anchorLoad: 135,
          medianReps: 6,
          modalRpe: 8.5,
          nextLoad: 135,
        }),
      }),
    });

    expect(readouts[0]).toMatchObject({
      exerciseId: "sldl",
      exerciseName: "Stiff-Legged Deadlift",
      targetLoad: 135,
      targetReps: 10,
      targetRpe: 6.5,
      targetRir: 3.5,
      loadSource: "history",
      confidence: "low",
      cautionLevel: "caution",
      suggestedAdjustmentRange: {
        minLoad: 125,
        maxLoad: 135,
        unit: "lb",
        basis: "target_effort_load_mismatch",
      },
    });
    expect(readouts[0]?.cautionReason).toContain("target_effort_load_mismatch");
  });

  it("flags exact-history anchors translated from high-effort lower-rep context", () => {
    const readouts = buildPrescriptionConfidenceReadouts({
      workout: workoutWithOneExercise({
        exerciseId: "close-grip-cable-row",
        exerciseName: "Close-Grip Seated Cable Row",
        targetLoad: 47.5,
        targetReps: 10,
        targetRpe: 6.5,
        equipment: ["cable"],
      }),
      loadAudit: loadAuditFor({
        exerciseId: "close-grip-cable-row",
        source: "history",
        targetLoad: 47.5,
        trace: progressionTrace({
          anchorLoad: 57.5,
          medianReps: 6,
          modalRpe: 8.5,
          nextLoad: 47.5,
          reasonCodes: [EXACT_HISTORY_TRANSLATED_CONTEXT_REASON_CODE],
          confidenceReasons: [
            "Exact same-exercise history was translated down because the prior anchor was lower-rep and higher-effort than this target.",
          ],
        }),
      }),
    });

    expect(readouts[0]).toMatchObject({
      exerciseId: "close-grip-cable-row",
      loadSource: "history",
      confidence: "low",
      cautionLevel: "caution",
      suggestedAdjustmentRange: {
        minLoad: 45,
        maxLoad: 47.5,
        unit: "lb",
        basis: EXACT_HISTORY_TRANSLATED_CONTEXT_REASON_CODE,
      },
    });
    expect(readouts[0]?.cautionReason).toContain(
      EXACT_HISTORY_TRANSLATED_CONTEXT_REASON_CODE
    );
    expect(readouts[0]?.cautionReason).toContain("translated down");
  });

  it("keeps a history-backed target clean when recent evidence supports it", () => {
    const readouts = buildPrescriptionConfidenceReadouts({
      workout: workoutWithOneExercise({
        exerciseId: "sldl",
        exerciseName: "Stiff-Legged Deadlift",
        targetLoad: 135,
        targetReps: 8,
        targetRpe: 8,
      }),
      loadAudit: loadAuditFor({
        exerciseId: "sldl",
        source: "history",
        targetLoad: 135,
        trace: progressionTrace({
          anchorLoad: 135,
          medianReps: 8,
          modalRpe: 8,
          nextLoad: 135,
        }),
      }),
    });

    expect(readouts[0]).toMatchObject({
      loadSource: "history",
      confidence: "high",
      cautionLevel: "none",
      cautionReason: null,
      suggestedAdjustmentRange: null,
    });
  });

  it("marks estimate/cold-start loads low confidence without target-effort mismatch", () => {
    const readouts = buildPrescriptionConfidenceReadouts({
      workout: workoutWithOneExercise({
        exerciseId: "cable-curl",
        exerciseName: "Cable Curl",
        targetLoad: 40,
        targetReps: 12,
        targetRpe: 8,
        equipment: ["cable"],
      }),
      loadAudit: loadAuditFor({
        exerciseId: "cable-curl",
        source: "estimate",
        targetLoad: 40,
      }),
    });

    expect(readouts[0]).toMatchObject({
      loadSource: "estimate",
      confidence: "low",
      cautionLevel: "notice",
      cautionReason: "estimate_load_no_exact_history",
    });
    expect(readouts[0]?.cautionReason).not.toContain("target_effort_load_mismatch");
  });

  it("surfaces runtime-added same-exercise calibration as lower-trust provenance", () => {
    const readouts = buildPrescriptionConfidenceReadouts({
      workout: workoutWithOneExercise({
        exerciseId: "cable-lateral-raise",
        exerciseName: "Cable Lateral Raise",
        targetLoad: 10,
        targetReps: 12,
        targetRpe: 8,
        equipment: ["cable"],
      }),
      loadAudit: loadAuditFor({
        exerciseId: "cable-lateral-raise",
        source: RUNTIME_ADDED_SAME_EXERCISE_CALIBRATION_REASON_CODE,
        targetLoad: 10,
      }),
    });

    expect(readouts[0]).toMatchObject({
      loadSource: RUNTIME_ADDED_SAME_EXERCISE_CALIBRATION_REASON_CODE,
      confidence: "medium",
      cautionLevel: "notice",
      cautionReason: RUNTIME_ADDED_SAME_EXERCISE_CALIBRATION_REASON_CODE,
      suggestedAdjustmentRange: {
        minLoad: 7.5,
        maxLoad: 10,
        unit: "lb",
        basis: RUNTIME_ADDED_SAME_EXERCISE_CALIBRATION_REASON_CODE,
      },
    });
  });

  it("adds selected-anchor evidence only for targeted backfilled prescription anchors", () => {
    const readouts = buildPrescriptionConfidenceReadouts({
      workout: workoutWithOneExercise({
        exerciseId: "close-grip-lat-pulldown",
        exerciseName: "Close-Grip Lat Pulldown",
        targetLoad: 80,
        targetReps: 10,
        targetRpe: 8,
        equipment: ["cable"],
      }),
      loadAudit: loadAuditFor({
        exerciseId: "close-grip-lat-pulldown",
        source: "history",
        targetLoad: 80,
        selectedAnchorEvidence: {
          "close-grip-lat-pulldown": {
            selectedExerciseId: "close-grip-lat-pulldown",
            normalHistoryHadUsableExactEvidence: false,
            targetedAnchorBackfilled: true,
            backfillReason: "exact_anchor_outside_general_window",
            skippedOrUnperformedRowsIgnored: 1,
            anchorSourceSummary: {
              source: "targeted_selected_exercise_history",
              sessionCount: 1,
              setCount: 1,
              latestDate: "2026-03-01T00:00:00.000Z",
            },
          },
        },
      }),
    });

    expect(readouts[0]).toMatchObject({
      exerciseId: "close-grip-lat-pulldown",
      exerciseName: "Close-Grip Lat Pulldown",
      loadSource: "history",
      selectedAnchorEvidence: {
        selectedExerciseId: "close-grip-lat-pulldown",
        selectedExerciseName: "Close-Grip Lat Pulldown",
        normalHistoryHadUsableExactEvidence: false,
        targetedAnchorBackfilled: true,
        backfillReason: "exact_anchor_outside_general_window",
        skippedOrUnperformedRowsIgnored: 1,
        anchorSourceSummary: {
          source: "targeted_selected_exercise_history",
          sessionCount: 1,
          setCount: 1,
          latestDate: "2026-03-01T00:00:00.000Z",
        },
      },
    });
  });
});

describe("finalizeDeloadSessionResult", () => {
  it("stamps deload traces with final resolved loads from the canonical load engine", () => {
    const result = finalizeDeloadSessionResult({
      mapped: {
        mappedGoals: { primary: "hypertrophy" },
        mappedProfile: { trainingAge: "intermediate", weightKg: 90 },
        exerciseLibrary: [
          {
            id: "row",
            name: "Chest Supported Row",
            movementPatterns: ["horizontal_pull"],
            splitTags: ["pull"],
            jointStress: "medium",
            isMainLiftEligible: true,
            isCompound: true,
            fatigueCost: 3,
            equipment: ["machine"],
            primaryMuscles: ["Upper Back"],
            secondaryMuscles: ["Biceps"],
          },
        ],
        history: [
          {
            date: "2026-03-01T00:00:00.000Z",
            status: "COMPLETED",
            selectionMode: "INTENT",
            sessionIntent: "pull",
            mesocycleSnapshot: {
              week: 4,
              phase: "ACCUMULATION",
            },
            exercises: [
              {
                exerciseId: "row",
                sets: [
                  { setIndex: 1, reps: 10, load: 100, rpe: 7 },
                  { setIndex: 2, reps: 10, load: 100, rpe: 7.5 },
                ],
              },
            ],
          },
        ],
        weekInBlock: 5,
        mesocycleLength: 5,
        lifecycleWeek: 5,
        lifecycleRirTarget: { min: 5, max: 6 },
        lifecycleVolumeTargets: { "Upper Back": 8 },
        sorenessSuppressedMuscles: [],
        activeMesocycle: {
          accumulationSessionsCompleted: 12,
        },
        effectivePeriodization: {
          isDeload: true,
          backOffMultiplier: 0.8,
        },
        mappedConstraints: {},
        mappedCheckIn: {},
        mappedPreferences: {},
        rawExercises: [],
        rawWorkouts: [],
        adaptiveDeload: false,
        deloadDecision: {
          mode: "scheduled",
          reason: ["Scheduled deload"],
          reductionPercent: 50,
          appliedTo: "both",
        },
        blockContext: null,
        rotationContext: {},
        cycleContext: {
          weekInMeso: 5,
          weekInBlock: 5,
          phase: "deload",
          blockType: "deload",
          isDeload: true,
          source: "computed",
        },
        mesocycleRoleMapByIntent: {
          pull: new Map(),
        },
      } as never,
      workout: {
        id: "workout-deload",
        scheduledDate: "2026-03-08T00:00:00.000Z",
        warmup: [],
        mainLifts: [
          {
            id: "row-entry",
            exercise: {
              id: "row",
              name: "Chest Supported Row",
              movementPatterns: ["horizontal_pull"],
              splitTags: ["pull"],
              jointStress: "medium",
              equipment: ["machine"],
            },
            orderIndex: 0,
            isMainLift: true,
            role: "main",
            sets: [
              { setIndex: 1, targetReps: 10, targetRpe: 4.5, role: "main" },
              { setIndex: 2, targetReps: 10, targetRpe: 4.5, role: "main" },
            ],
          },
        ],
        accessories: [],
        estimatedMinutes: 30,
      },
      selection: {
        selectedExerciseIds: ["row"],
        mainLiftIds: ["row"],
        accessoryIds: [],
        perExerciseSetTargets: { row: 2 },
        rationale: {},
        volumePlanByMuscle: {},
      },
      selectionMode: "INTENT",
      sessionIntent: "pull",
      note: "Scheduled deload week.",
      deloadTrace: {
        version: 1,
        sessionIntent: "pull",
        targetRpe: 4.5,
        setFactor: 0.5,
        minSets: 1,
        exerciseCount: 1,
        exercises: [
          {
            exerciseId: "row",
            exerciseName: "Chest Supported Row",
            isMainLift: true,
            baselineSetCount: 4,
            baselineRepAnchor: 10,
            deloadSetCount: 2,
            anchoredLoad: null,
            anchoredLoadSource: "latest_accumulation",
            peakAccumulationLoadCount: 0,
            latestAccumulationLoadCount: 2,
          },
        ],
      },
    });

    expect("error" in result).toBe(false);
    if ("error" in result) return;

    const resolvedTopSetLoad = result.workout.mainLifts[0]?.sets[0]?.targetLoad;
    expect(resolvedTopSetLoad).toBeTypeOf("number");
    expect(result.audit?.deloadTrace?.exercises[0]).toMatchObject({
      anchoredLoadSource: "latest_accumulation",
      canonicalSourceLoadSource: "history",
      resolvedLoadSource: "history",
      resolvedTopSetLoad,
      resolvedSetLoads: [resolvedTopSetLoad, resolvedTopSetLoad],
    });
    expect(result.audit?.deloadTrace?.exercises[0]?.canonicalSourceLoad).toBeGreaterThan(
      resolvedTopSetLoad ?? 0
    );
    expect(result.audit?.deloadTrace?.exercises[0]?.anchoredLoad).toBe(
      result.audit?.deloadTrace?.exercises[0]?.canonicalSourceLoad
    );
    expect(result.prescriptionReadouts?.[0]).toMatchObject({
      exerciseId: "row",
      exerciseName: "Chest Supported Row",
      loadSource: "history",
    });
  });
});
