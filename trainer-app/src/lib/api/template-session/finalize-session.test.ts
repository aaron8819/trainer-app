import { describe, expect, it } from "vitest";
import { finalizeDeloadSessionResult } from "./finalize-session";
import { buildPrescriptionReadouts } from "@/lib/api/prescription-readout";
import {
  EXACT_HISTORY_TRANSLATED_CONTEXT_REASON_CODE,
  RUNTIME_ADDED_SAME_EXERCISE_CALIBRATION_REASON_CODE,
  type ApplyLoadsAudit,
} from "@/lib/engine/apply-loads";
import type { WorkoutPlan } from "@/lib/engine/types";
import type { ProgressionDecisionTrace } from "@/lib/evidence/session-audit-types";
import type {
  NumericPrescription,
  PrescriptionReasonCode,
} from "@/lib/engine/load-prescription";

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
  historyEvidence?: ApplyLoadsAudit["resolvedLoads"][string]["historyEvidence"];
}): ApplyLoadsAudit {
  const placementId = `${input.exerciseId}-entry`;
  const source = canonicalPrescriptionSource(input.source);
  const confidence = canonicalPrescriptionConfidence(source);
  return {
    progressionTraces: input.trace ? { [placementId]: input.trace } : {},
    prescriptions: {
      [placementId]: {
        version: 1,
        kind: "numeric",
        canonicalExerciseId: input.exerciseId,
        measurement: null,
        value: input.targetLoad,
        source,
        confidence,
        reasonCodes: [canonicalPrescriptionReason(source)],
        evidence: [],
      },
    },
    resolvedLoads: {
      [placementId]: {
        placementId,
        canonicalExerciseId: input.exerciseId,
        source: input.source,
        canonicalSourceLoad: input.targetLoad,
        resolvedTopSetLoad: input.targetLoad,
        resolvedSetLoads: [input.targetLoad],
        ...(input.historyEvidence ? { historyEvidence: input.historyEvidence } : {}),
      },
    },
    ...(input.selectedAnchorEvidence
      ? { selectedAnchorEvidence: input.selectedAnchorEvidence }
      : {}),
  };
}

function canonicalPrescriptionSource(
  source: ApplyLoadsAudit["resolvedLoads"][string]["source"],
): NumericPrescription["source"] {
  switch (source) {
    case "history":
      return "exact_history";
    case "legacy_measurement_history":
      return "legacy_barbell_history";
    case "runtime_added_same_exercise_calibration_anchor":
      return "runtime_added_same_exercise";
    case "existing_target_load":
      return "existing_target";
    case "baseline":
      return "baseline";
    case "estimate":
      return "estimate";
    case "none":
      return "estimate";
  }
}

function canonicalPrescriptionConfidence(
  source: NumericPrescription["source"],
): NumericPrescription["confidence"] {
  if (source === "existing_target" || source === "exact_history") return "high";
  if (source === "legacy_barbell_history" || source === "runtime_added_same_exercise") {
    return "reduced";
  }
  return "low";
}

function canonicalPrescriptionReason(
  source: NumericPrescription["source"],
): PrescriptionReasonCode {
  switch (source) {
    case "exact_history":
    case "deload_history":
      return "same_exercise_same_measurement";
    case "legacy_barbell_history":
      return "legacy_barbell_bridge";
    case "runtime_added_same_exercise":
      return "runtime_added_evidence";
    case "existing_target":
      return "existing_target_preserved";
    case "baseline":
    case "estimate":
      return "no_comparable_history";
  }
}

function buildReadoutsFromAudit(input: {
  workout: WorkoutPlan;
  loadAudit: ApplyLoadsAudit;
}) {
  return buildPrescriptionReadouts({
    workout: input.workout,
    prescriptionResultsByPlacement: input.loadAudit.prescriptions,
    resolvedLoadsByPlacement: input.loadAudit.resolvedLoads,
  });
}

describe("buildPrescriptionReadouts", () => {
  it("carries exact and reduced-confidence legacy calibration evidence", () => {
    const exact = buildReadoutsFromAudit({
      workout: workoutWithOneExercise({
        exerciseId: "bench",
        exerciseName: "Bench Press",
        targetLoad: 140,
        targetReps: 5,
        targetRpe: 6.5,
      }),
      loadAudit: loadAuditFor({
        exerciseId: "bench",
        source: "history",
        targetLoad: 140,
        historyEvidence: {
          source: "exact_compatible_history",
          confidence: "high",
          date: "2026-08-03T00:00:00.000Z",
          load: 135,
          reps: 8,
          rpe: 8,
        },
      }),
    });
    const legacy = buildReadoutsFromAudit({
      workout: workoutWithOneExercise({
        exerciseId: "bench",
        exerciseName: "Bench Press",
        targetLoad: 140,
        targetReps: 5,
        targetRpe: 6.5,
      }),
      loadAudit: loadAuditFor({
        exerciseId: "bench",
        source: "legacy_measurement_history",
        targetLoad: 140,
        trace: progressionTrace({
          anchorLoad: 135,
          medianReps: 8,
          modalRpe: 8,
          nextLoad: 140,
          combinedScale: 1,
        }),
        historyEvidence: {
          source: "legacy_measurement_bridge",
          confidence: "reduced",
          date: "2026-08-03T00:00:00.000Z",
          load: 135,
          reps: 8,
          rpe: 8,
        },
      }),
    });

    expect(exact[0]).toMatchObject({
      loadSource: "exact_history",
      historyEvidence: { source: "exact_compatible_history", confidence: "high" },
    });
    expect(legacy[0]).toMatchObject({
      loadSource: "legacy_barbell_history",
      confidence: "medium",
      cautionLevel: "notice",
      cautionReason: "reduced_prescription_confidence",
      historyEvidence: { source: "legacy_measurement_bridge", confidence: "reduced" },
    });
  });

  it("does not let trace-only mismatch heuristics override canonical confidence", () => {
    const readouts = buildReadoutsFromAudit({
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
      loadSource: "exact_history",
      confidence: "high",
      cautionLevel: "none",
      cautionReason: null,
    });
    expect(readouts[0]).not.toHaveProperty("suggestedAdjustmentRange");
  });

  it("does not promote trace-only translation reasons into readout policy", () => {
    const readouts = buildReadoutsFromAudit({
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
      loadSource: "exact_history",
      confidence: "high",
      cautionLevel: "none",
      cautionReason: null,
    });
    expect(readouts[0]).not.toHaveProperty("suggestedAdjustmentRange");
  });

  it("keeps a history-backed target clean when recent evidence supports it", () => {
    const readouts = buildReadoutsFromAudit({
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
      loadSource: "exact_history",
      confidence: "high",
      cautionLevel: "none",
      cautionReason: null,
    });
  });

  it("marks estimate/cold-start loads low confidence without target-effort mismatch", () => {
    const readouts = buildReadoutsFromAudit({
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
      cautionLevel: "caution",
      cautionReason: "low_prescription_confidence",
    });
    expect(readouts[0]?.cautionReason).not.toContain("target_effort_load_mismatch");
  });

  it("surfaces runtime-added same-exercise calibration as lower-trust provenance", () => {
    const readouts = buildReadoutsFromAudit({
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
      loadSource: "runtime_added_same_exercise",
      confidence: "medium",
      cautionLevel: "notice",
      cautionReason: "reduced_prescription_confidence",
    });
    expect(readouts[0]).not.toHaveProperty("suggestedAdjustmentRange");
  });

  it("does not expose exercise-keyed selected-anchor evidence on occurrence readouts", () => {
    const readouts = buildReadoutsFromAudit({
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
      loadSource: "exact_history",
    });
    expect(readouts[0]).not.toHaveProperty("selectedAnchorEvidence");
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
          id: "legacy-meso",
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
      compositionSource: "deload_seed_replay",
      sessionSlot: {
        slotId: "pull_a",
        intent: "pull",
        sequenceIndex: 1,
        sequenceLength: 4,
        source: "mesocycle_slot_sequence",
      },
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
      loadSource: "deload_history",
    });
    expect(result.selection.sessionDecisionReceipt).toMatchObject({
      sessionProvenance: {
        mesocycleId: "legacy-meso",
        compositionSource: "deload_seed_replay",
      },
      sessionSlot: {
        slotId: "pull_a",
        intent: "pull",
        sequenceIndex: 1,
        sequenceLength: 4,
        source: "mesocycle_slot_sequence",
      },
    });
  });
});
