import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildPostSessionReviewContract } from "./post-session-review-contract-builder";
import {
  isPostSessionReviewContract,
  type PostSessionReviewContract,
} from "./post-session-review-contract";
import type {
  PostSessionReviewContractBuildInput,
  PostSessionReviewExerciseEvidence,
} from "./post-session-review-evidence";

function performedSet(
  id: string,
  input: Partial<PostSessionReviewExerciseEvidence["sets"][number]> = {}
): PostSessionReviewExerciseEvidence["sets"][number] {
  return {
    workoutSetId: id,
    setIndex: Number(id.replace(/\D/g, "")) || 1,
    targetReps: 10,
    targetRepMin: 8,
    targetRepMax: 12,
    targetRpe: 8,
    targetLoad: 100,
    wasLogged: true,
    wasSkipped: false,
    actualReps: 10,
    actualLoad: 100,
    actualRpe: 8,
    ...input,
  };
}

function exercise(
  input: Partial<PostSessionReviewExerciseEvidence>
): PostSessionReviewExerciseEvidence {
  return {
    workoutExerciseId: input.workoutExerciseId ?? input.exerciseId ?? "we-1",
    exerciseId: input.exerciseId ?? "ex-1",
    exerciseName: input.exerciseName ?? "Bench Press",
    section: "MAIN",
    isMainLift: true,
    sets: input.sets ?? [
      performedSet("set-1"),
      performedSet("set-2"),
      performedSet("set-3"),
    ],
    ...input,
  };
}

function buildInput(
  overrides: Partial<PostSessionReviewContractBuildInput> = {}
): PostSessionReviewContractBuildInput {
  return {
    workoutIdentity: {
      userId: "user-1",
      workoutId: "workout-1",
      status: "COMPLETED",
      revision: 2,
      scheduledDate: "2026-06-01T12:00:00.000Z",
      selectionMode: "INTENT",
      sessionIntent: "PUSH",
      advancesSplit: true,
      mesocycleId: "meso-1",
      mesocycleWeekSnapshot: 4,
      mesoSessionSnapshot: 2,
      mesocyclePhaseSnapshot: "ACCUMULATION",
      slotId: "upper_a",
    },
    sourceTruth: {
      setLogsAvailable: true,
      workoutStructureAvailable: true,
      sessionDecisionReceiptAvailable: true,
      workoutStructureStateAvailable: true,
      runtimeEditReconciliationAvailable: false,
    },
    sessionSemantics: {
      kind: "advancing",
      isDeload: false,
      countsTowardWeeklyVolume: true,
      countsTowardProgressionHistory: true,
      countsTowardPerformanceHistory: true,
      updatesProgressionAnchor: true,
    },
    exercises: [exercise({})],
    ...overrides,
  };
}

describe("post-session review contract", () => {
  it("builds and validates a completed workout contract", () => {
    const contract = buildPostSessionReviewContract(buildInput());

    expect(isPostSessionReviewContract(contract, { userId: "user-1" })).toBe(true);
    expect(contract.contractVersion).toBe(1);
    expect(contract.executionSummary).toMatchObject({
      plannedSetCount: 3,
      completedSetCount: 3,
      skippedSetCount: 0,
      extraSetCount: 0,
    });
    expect(contract.performedReality).toMatchObject({
      source: "set_log_vs_workout_set_targets",
      readOnly: true,
      affectsProgressionPolicy: false,
      affectsPrescriptionPolicy: false,
      seedRuntimeChanged: false,
      rows: [
        expect.objectContaining({
          exerciseName: "Bench Press",
          label: "performed_as_planned",
          completionStatus: "complete",
          plannedSetCount: 3,
          performedSetCount: 3,
          evidenceOnly: true,
          affectsProgressionPolicy: false,
          affectsPrescriptionPolicy: false,
          seedRuntimeChanged: false,
        }),
      ],
      trendGroups: [],
    });
    expect(contract.sourceTruth.receipt).toEqual({
      source: "selectionMetadata.sessionDecisionReceipt",
      available: true,
      mutated: false,
    });
  });

  it("represents partial and skipped work as evidence", () => {
    const contract = buildPostSessionReviewContract(
      buildInput({
        workoutIdentity: {
          ...buildInput().workoutIdentity,
          status: "PARTIAL",
        },
        exercises: [
          exercise({
            sets: [
              performedSet("set-1"),
              performedSet("set-2", { wasSkipped: true, actualLoad: null, actualReps: null }),
              performedSet("set-3", { wasLogged: false, actualLoad: null, actualReps: null }),
            ],
          }),
        ],
      })
    );

    expect(contract.executionSummary).toMatchObject({
      plannedSetCount: 3,
      completedSetCount: 1,
      skippedSetCount: 1,
      missingLogSetCount: 1,
      partialExerciseCount: 1,
    });
    expect(contract.exerciseReconciliation.rows[0]).toMatchObject({
      status: "partial",
      skippedSetCount: 1,
      evidenceOnly: true,
    });
    expect(contract.performedReality.rows[0]).toMatchObject({
      label: "under_performed",
      completionStatus: "partial",
      plannedSetCount: 3,
      performedSetCount: 1,
      skippedSetCount: 1,
      missingLogSetCount: 1,
      headline: "Bench Press came in under the plan",
      affectsProgressionPolicy: false,
      affectsPrescriptionPolicy: false,
      seedRuntimeChanged: false,
    });
    expect(isPostSessionReviewContract(contract)).toBe(true);
  });

  it("represents runtime-added exercise work as evidence without policy mutation", () => {
    const contract = buildPostSessionReviewContract(
      buildInput({
        sourceTruth: {
          ...buildInput().sourceTruth,
          runtimeEditReconciliationAvailable: true,
        },
        exercises: [
          exercise({ exerciseId: "planned", workoutExerciseId: "we-planned" }),
          exercise({
            exerciseId: "bonus-curl",
            workoutExerciseId: "we-added",
            exerciseName: "Bonus Cable Curl",
            isRuntimeAdded: true,
            isMainLift: false,
            section: "ACCESSORY",
            sets: [performedSet("set-10"), performedSet("set-11")],
          }),
        ],
      })
    );

    const added = contract.exerciseReconciliation.rows.find(
      (row) => row.exerciseId === "bonus-curl"
    );
    expect(added).toMatchObject({
      status: "runtime_added",
      runtimeAdded: true,
      addedSetCount: 2,
      policyMutation: false,
      seedMutation: false,
    });
    expect(contract.prescriptionCalibration.rows.find(
      (row) => row.exerciseId === "bonus-curl"
    )).toMatchObject({
      classification: "runtime_added",
      plannedSetCount: 0,
      performedSetCount: 2,
      targetLoad: 100,
      targetRepRange: { min: 8, max: 12 },
      targetRpe: 8,
      medianPerformedLoad: 100,
      medianReps: 10,
      medianActualRpe: 8,
      performedRealityCoherence: "session_local",
      affectsPrescriptionPolicy: false,
    });
    expect(contract.performedReality.rows.find(
      (row) => row.exerciseId === "bonus-curl"
    )).toMatchObject({
      workoutExerciseId: "we-added",
      label: "performed_as_planned",
      completionStatus: "session_local",
      plannedSetCount: 0,
      performedSetCount: 2,
      target: {
        reps: { min: 8, max: 12 },
        load: 100,
        rpe: 8,
      },
      actual: {
        medianReps: 10,
        medianLoad: 100,
        medianRpe: 8,
      },
      detail:
        "2 session-local sets performed; target 8-12 reps, load 100, RPE 8; actual median 10 reps, load 100, RPE 8.",
      evidenceOnly: true,
      affectsProgressionPolicy: false,
      affectsPrescriptionPolicy: false,
      seedRuntimeChanged: false,
    });
    expect(contract.boundaries.workoutChanged).toBe(false);
  });

  it("keeps runtime-added exercises with no logs as missing actuals", () => {
    const contract = buildPostSessionReviewContract(
      buildInput({
        sourceTruth: {
          ...buildInput().sourceTruth,
          runtimeEditReconciliationAvailable: true,
        },
        exercises: [
          exercise({
            exerciseId: "bonus-curl",
            workoutExerciseId: "we-added-empty",
            exerciseName: "Bonus Cable Curl",
            isRuntimeAdded: true,
            isMainLift: false,
            section: "ACCESSORY",
            sets: [
              performedSet("set-10", {
                wasLogged: false,
                actualReps: null,
                actualLoad: null,
                actualRpe: null,
              }),
              performedSet("set-11", {
                wasLogged: false,
                actualReps: null,
                actualLoad: null,
                actualRpe: null,
              }),
            ],
          }),
        ],
      })
    );

    expect(contract.prescriptionCalibration.rows[0]).toMatchObject({
      classification: "runtime_added",
      plannedSetCount: 0,
      performedSetCount: 0,
      medianPerformedLoad: null,
      medianReps: null,
      medianActualRpe: null,
      performedRealityCoherence: "session_local",
    });
    expect(contract.performedReality.rows[0]).toMatchObject({
      workoutExerciseId: "we-added-empty",
      label: "missing_actuals",
      completionStatus: "session_local",
      plannedSetCount: 0,
      performedSetCount: 0,
      actual: {
        medianReps: null,
        medianLoad: null,
        medianRpe: null,
      },
      detail:
        "No session-local set actuals were captured; target 8-12 reps, load 100, RPE 8; actual median reps not captured, load not captured, RPE not captured.",
      evidenceOnly: true,
      affectsProgressionPolicy: false,
      affectsPrescriptionPolicy: false,
      seedRuntimeChanged: false,
    });
    expect(isPostSessionReviewContract(contract)).toBe(true);
  });

  it("represents replacement-like swaps as evidence, not policy mutation", () => {
    const contract = buildPostSessionReviewContract(
      buildInput({
        sourceTruth: {
          ...buildInput().sourceTruth,
          runtimeEditReconciliationAvailable: true,
        },
        exercises: [
          exercise({
            workoutExerciseId: "we-replaced",
            exerciseId: "machine-row",
            exerciseName: "Machine Row",
            replacement: {
              source: "runtime_edit_reconciliation",
              fromExerciseId: "barbell-row",
              fromExerciseName: "Barbell Row",
              toExerciseId: "machine-row",
              toExerciseName: "Machine Row",
              reason: "equipment_availability_equivalent_pull_swap",
              setCount: 3,
              evidence: ["replace_exercise persisted op"],
              seedMutation: false,
              policyMutation: false,
            },
          }),
        ],
      })
    );

    expect(contract.exerciseReconciliation.rows[0]).toMatchObject({
      status: "replacement_like",
      replacement: expect.objectContaining({
        source: "runtime_edit_reconciliation",
        seedMutation: false,
        policyMutation: false,
      }),
      seedMutation: false,
      policyMutation: false,
    });
    expect(contract.prescriptionCalibration.rows[0]).toMatchObject({
      classification: "replacement_like",
      affectsPrescriptionPolicy: false,
    });
  });

  it("uses outcome evidence instead of load deviation alone for calibration", () => {
    const contract = buildPostSessionReviewContract(
      buildInput({
        exercises: [
          exercise({
            exerciseId: "too-high",
            exerciseName: "Too High Press",
            sets: [
              performedSet("set-1", { targetLoad: 100, actualLoad: 70, actualReps: 10 }),
              performedSet("set-2", { targetLoad: 100, actualLoad: 70, actualReps: 10 }),
            ],
          }),
          exercise({
            exerciseId: "effort-high",
            exerciseName: "High Effort Press",
            sets: [
              performedSet("set-6", {
                targetLoad: 100,
                actualLoad: 100,
                actualReps: 10,
                targetRpe: 8,
                actualRpe: 9.5,
              }),
              performedSet("set-7", {
                targetLoad: 100,
                actualLoad: 100,
                actualReps: 10,
                targetRpe: 8,
                actualRpe: 9.5,
              }),
            ],
          }),
          exercise({
            exerciseId: "too-low",
            exerciseName: "Too Low Row",
            sets: [
              performedSet("set-3", {
                targetLoad: 100,
                actualLoad: 130,
                actualReps: 14,
                targetRpe: 8,
                actualRpe: 6.5,
              }),
              performedSet("set-4", {
                targetLoad: 100,
                actualLoad: 130,
                actualReps: 14,
                targetRpe: 8,
                actualRpe: 6.5,
              }),
            ],
          }),
          exercise({
            exerciseId: "insufficient",
            exerciseName: "No Target Curl",
            sets: [
              performedSet("set-5", {
                targetLoad: null,
                actualLoad: 30,
                actualReps: 12,
              }),
            ],
          }),
        ],
      })
    );

    expect(
      Object.fromEntries(
        contract.prescriptionCalibration.rows.map((row) => [
          row.exerciseId,
          row.classification,
        ])
      )
    ).toEqual({
      "too-high": "successful_autoregulation",
      "effort-high": "target_too_high",
      "too-low": "target_too_low",
      insufficient: "insufficient_evidence",
    });
    expect(contract.prescriptionCalibration.summary).toMatchObject({
      targetTooHighCount: 1,
      targetTooLowCount: 1,
      insufficientEvidenceCount: 1,
      coherentCount: 1,
      loadTooHeavyCount: 1,
      loadTooLightCount: 1,
      mixedSignalCount: 0,
      lowCoverageCount: 0,
      sessionLocalCount: 0,
    });
    expect(contract.learningSignals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "calibration_signal",
          severity: "watch",
          summary:
            "Prescription calibration evidence: 1 coherent, 1 looked too heavy, 1 looked too light, 1 incomplete.",
        }),
      ])
    );
    expect(
      contract.prescriptionCalibration.rows.find(
        (row) => row.exerciseId === "effort-high"
      )
    ).toMatchObject({
      targetRpe: 8,
      medianActualRpe: 9.5,
      rpeDelta: 1.5,
      repRangeResult: "in_range",
      effortResult: "above_target",
      performedRealityCoherence: "load_too_heavy",
      affectsPrescriptionPolicy: false,
    });
    expect(
      contract.prescriptionCalibration.rows.find((row) => row.exerciseId === "too-low")
    ).toMatchObject({
      targetRepRange: { min: 8, max: 12 },
      medianReps: 14,
      medianActualRpe: 6.5,
      repRangeResult: "above_target",
      effortResult: "below_target",
      performedRealityCoherence: "load_too_light",
    });
    expect(
      Object.fromEntries(
        contract.performedReality.rows.map((row) => [row.exerciseId, row.label])
      )
    ).toEqual({
      "too-high": "performed_as_planned",
      "effort-high": "under_performed",
      "too-low": "over_performed",
      insufficient: "missing_actuals",
    });
    expect(contract.performedReality.rows.find((row) => row.exerciseId === "too-low"))
      .toMatchObject({
        headline: "Too Low Row exceeded the plan",
        detail:
          "2 of 2 prescribed sets performed; target 8-12 reps, load 100, RPE 8; actual median 14 reps, load 130, RPE 6.5.",
        evidenceOnly: true,
        affectsProgressionPolicy: false,
        affectsPrescriptionPolicy: false,
        seedRuntimeChanged: false,
      });
  });

  it("does not let next-exposure copy override successful autoregulation evidence", () => {
    const contract = buildPostSessionReviewContract(
      buildInput({
        exercises: [
          exercise({
            exerciseId: "leg-extension",
            exerciseName: "Leg Extension",
            sets: [
              performedSet("set-1", {
                targetLoad: 70,
                targetRepMin: 10,
                targetRepMax: 15,
                targetRpe: 8.5,
                actualLoad: 55,
                actualReps: 12,
                actualRpe: 8,
              }),
              performedSet("set-2", {
                targetLoad: 70,
                targetRepMin: 10,
                targetRepMax: 15,
                targetRpe: 8.5,
                actualLoad: 70,
                actualReps: 12,
                actualRpe: 8.5,
              }),
            ],
          }),
        ],
        nextExposureDecisions: [
          {
            exerciseId: "leg-extension",
            exerciseName: "Leg Extension",
            decision: {
              action: "target_too_high",
              summary: "Next exposure: review the starting point before increasing.",
              reason: "Written target missed, but reps and effort were otherwise clean.",
              anchorLoad: 55,
              repRange: { min: 10, max: 15 },
              modalRpe: 8.5,
              medianReps: 12,
              decisionLog: ["Review-quality guard: downward recalibrated hold."],
            },
          },
        ],
      })
    );

    expect(contract.prescriptionCalibration.rows[0]).toMatchObject({
      exerciseId: "leg-extension",
      classification: "successful_autoregulation",
      reasonCodes: [
        "performed_load_adjusted",
        "prescribed_reps_achieved",
        "actual_rpe_at_or_below_target",
      ],
      loadDeltaPct: -10.7,
      performedRealityCoherence: "coherent",
      affectsPrescriptionPolicy: false,
    });
    expect(contract.performedReality.rows[0]).toMatchObject({
      exerciseId: "leg-extension",
      label: "performed_as_planned",
      evidenceOnly: true,
      affectsProgressionPolicy: false,
      affectsPrescriptionPolicy: false,
    });
    expect(contract.prescriptionCalibration.summary).toMatchObject({
      targetTooHighCount: 0,
      loadTooHeavyCount: 0,
      coherentCount: 1,
    });
  });

  it("shows warmup/ramp context while calibrating only from work sets", () => {
    const contract = buildPostSessionReviewContract(
      buildInput({
        exercises: [
          exercise({
            exerciseId: "leg-extension",
            exerciseName: "Leg Extension",
            isMainLift: false,
            section: "ACCESSORY",
            sets: [
              performedSet("set-1", {
                setIntent: "WARMUP",
                targetLoad: 70,
                targetRepMin: 10,
                targetRepMax: 15,
                targetRpe: 8.5,
                actualLoad: 55,
                actualReps: 12,
                actualRpe: 8,
              }),
              performedSet("set-2", {
                targetLoad: 70,
                targetRepMin: 10,
                targetRepMax: 15,
                targetRpe: 8.5,
                actualLoad: 70,
                actualReps: 12,
                actualRpe: 8.5,
              }),
              performedSet("set-3", {
                targetLoad: 75,
                targetRepMin: 10,
                targetRepMax: 15,
                targetRpe: 8.5,
                actualLoad: 75,
                actualReps: 12,
                actualRpe: 8.5,
              }),
            ],
          }),
        ],
      })
    );

    expect(contract.executionSummary).toMatchObject({
      completedSetCount: 3,
    });
    expect(contract.prescriptionCalibration.rows[0]).toMatchObject({
      exerciseId: "leg-extension",
      classification: "clean",
      plannedSetCount: 2,
      performedSetCount: 2,
      targetLoad: 72.5,
      medianPerformedLoad: 72.5,
      medianReps: 12,
      medianActualRpe: 8.5,
      affectsPrescriptionPolicy: false,
    });
    expect(contract.performedReality.rows[0]).toMatchObject({
      exerciseId: "leg-extension",
      plannedSetCount: 3,
      performedSetCount: 3,
      actual: {
        medianLoad: 72.5,
        medianReps: 12,
        medianRpe: 8.5,
      },
      evidenceOnly: true,
    });
    expect(contract.prescriptionCalibration.summary).toMatchObject({
      coherentCount: 1,
      targetTooHighCount: 0,
      loadTooHeavyCount: 0,
    });
  });

  it("classifies a clean upward load adjustment as successful autoregulation", () => {
    const contract = buildPostSessionReviewContract(
      buildInput({
        exercises: [
          exercise({
            exerciseId: "cable-crossover",
            exerciseName: "Cable Crossover",
            sets: [
              performedSet("set-1", {
                targetLoad: 15,
                actualLoad: 16.5,
                actualReps: 10,
                targetRpe: 8,
                actualRpe: 8,
              }),
              performedSet("set-2", {
                targetLoad: 15,
                actualLoad: 16.5,
                actualReps: 10,
                targetRpe: 8,
                actualRpe: 8,
              }),
            ],
          }),
        ],
        nextExposureDecisions: [
          {
            exerciseId: "cable-crossover",
            exerciseName: "Cable Crossover",
            decision: {
              action: "hold_at_recalibrated_anchor",
              summary: "Next exposure: hold the recalibrated starting point.",
              reason: "Performed anchor was above the written target.",
              anchorLoad: 16.5,
              repRange: { min: 8, max: 12 },
              modalRpe: 8,
              medianReps: 10,
              decisionLog: ["Review-quality guard: upward recalibrated hold."],
            },
          },
        ],
      })
    );

    expect(contract.prescriptionCalibration.rows[0]).toMatchObject({
      exerciseId: "cable-crossover",
      classification: "successful_autoregulation",
      reasonCodes: [
        "performed_load_adjusted",
        "prescribed_reps_achieved",
        "actual_rpe_at_or_below_target",
      ],
      loadDeltaPct: 10,
      performedRealityCoherence: "coherent",
      affectsPrescriptionPolicy: false,
    });
    expect(contract.prescriptionCalibration.summary).toMatchObject({
      targetTooHighCount: 0,
      targetTooLowCount: 0,
      mixedSignalCount: 0,
      coherentCount: 1,
    });
  });

  it("summarizes exact-exercise recent calibration exposure without policy impact", () => {
    const contract = buildPostSessionReviewContract(
      buildInput({
        recentExerciseExposures: [
          {
            ...exercise({
              workoutExerciseId: "prior-heavy",
              exerciseId: "ex-1",
              exerciseName: "Bench Press",
              sets: [
                performedSet("prior-heavy-set-1", {
                  targetLoad: 100,
                  actualLoad: 100,
                  actualReps: 10,
                  targetRpe: 8,
                  actualRpe: 9.5,
                }),
                performedSet("prior-heavy-set-2", {
                  targetLoad: 100,
                  actualLoad: 100,
                  actualReps: 10,
                  targetRpe: 8,
                  actualRpe: 9.5,
                }),
              ],
            }),
            workoutId: "prior-heavy-workout",
            performedAt: "2026-05-25T13:00:00.000Z",
          },
          {
            ...exercise({
              workoutExerciseId: "prior-clean",
              exerciseId: "ex-1",
              exerciseName: "Bench Press",
            }),
            workoutId: "prior-clean-workout",
            performedAt: "2026-05-20T13:00:00.000Z",
          },
        ],
      })
    );

    expect(contract.prescriptionCalibration.recentExposureSummary).toEqual({
      source: "exact_exercise_prior_performed_workouts",
      readOnly: true,
      affectsPrescriptionPolicy: false,
      affectsProgressionPolicy: false,
      rows: [
        {
          exerciseId: "ex-1",
          exerciseName: "Bench Press",
          priorExposureCount: 2,
          lookbackWorkoutLimit: 3,
          latestPerformedAt: "2026-05-25T13:00:00.000Z",
          coherentCount: 1,
          loadTooHeavyCount: 1,
          loadTooLightCount: 0,
          mixedSignalCount: 0,
          lowCoverageCount: 0,
          insufficientEvidenceCount: 0,
          sessionLocalCount: 0,
          evidenceOnly: true,
          affectsPrescriptionPolicy: false,
          affectsProgressionPolicy: false,
        },
      ],
    });
    expect(isPostSessionReviewContract(contract)).toBe(true);
  });

  it("groups recent performed-reality trends without policy, seed, planner, or receipt impact", () => {
    const contract = buildPostSessionReviewContract(
      buildInput({
        exercises: [
          exercise({ exerciseId: "stable", exerciseName: "Stable Press" }),
          exercise({
            exerciseId: "under",
            exerciseName: "Hard Press",
            sets: [
              performedSet("under-set-1", { actualRpe: 9.5 }),
              performedSet("under-set-2", { actualRpe: 9.5 }),
            ],
          }),
          exercise({
            exerciseId: "over",
            exerciseName: "Light Row",
            sets: [
              performedSet("over-set-1", {
                actualLoad: 130,
                actualReps: 14,
                actualRpe: 6.5,
              }),
              performedSet("over-set-2", {
                actualLoad: 130,
                actualReps: 14,
                actualRpe: 6.5,
              }),
            ],
          }),
          exercise({
            exerciseId: "missing",
            exerciseName: "Unlogged Raise",
            sets: [
              performedSet("missing-set-1", {
                wasLogged: false,
                actualLoad: null,
                actualReps: null,
                actualRpe: null,
              }),
            ],
          }),
        ],
        recentExerciseExposures: [
          {
            ...exercise({ exerciseId: "stable", exerciseName: "Stable Press" }),
            workoutId: "prior-stable",
            performedAt: "2026-05-25T13:00:00.000Z",
          },
          {
            ...exercise({
              exerciseId: "under",
              exerciseName: "Hard Press",
              sets: [
                performedSet("prior-under-set-1", { actualRpe: 9.5 }),
                performedSet("prior-under-set-2", { actualRpe: 9.5 }),
              ],
            }),
            workoutId: "prior-under",
            performedAt: "2026-05-24T13:00:00.000Z",
          },
          {
            ...exercise({
              exerciseId: "over",
              exerciseName: "Light Row",
              sets: [
                performedSet("prior-over-set-1", {
                  actualLoad: 130,
                  actualReps: 14,
                  actualRpe: 6.5,
                }),
                performedSet("prior-over-set-2", {
                  actualLoad: 130,
                  actualReps: 14,
                  actualRpe: 6.5,
                }),
              ],
            }),
            workoutId: "prior-over",
            performedAt: "2026-05-23T13:00:00.000Z",
          },
          {
            ...exercise({
              exerciseId: "missing",
              exerciseName: "Unlogged Raise",
              sets: [
                performedSet("prior-missing-set-1", {
                  wasLogged: false,
                  actualLoad: null,
                  actualReps: null,
                  actualRpe: null,
                }),
              ],
            }),
            workoutId: "prior-missing",
            performedAt: "2026-05-22T13:00:00.000Z",
          },
        ],
      })
    );

    expect(contract.performedReality.trendGroups.map((group) => group.kind)).toEqual([
      "repeated_underperformance",
      "repeated_overperformance",
      "missing_actuals_pattern",
      "stable_as_planned",
    ]);
    expect(contract.performedReality.trendGroups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "repeated_underperformance",
          priorExposureCount: 1,
          currentRows: [
            expect.objectContaining({
              workoutExerciseId: "under",
              exerciseId: "under",
              sourceOrder: 1,
              currentLabel: "under_performed",
              recentLabels: ["under_performed"],
            }),
          ],
          evidenceOnly: true,
          affectsProgressionPolicy: false,
          affectsPrescriptionPolicy: false,
          seedRuntimeChanged: false,
          plannerMaterializerChanged: false,
          receiptMutated: false,
        }),
        expect.objectContaining({
          kind: "repeated_overperformance",
          currentRows: [
            expect.objectContaining({
              currentLabel: "over_performed",
              recentLabels: ["over_performed"],
            }),
          ],
        }),
        expect.objectContaining({
          kind: "missing_actuals_pattern",
          currentRows: [
            expect.objectContaining({
              currentLabel: "missing_actuals",
              recentLabels: ["missing_actuals"],
            }),
          ],
        }),
        expect.objectContaining({
          kind: "stable_as_planned",
          currentRows: [
            expect.objectContaining({
              currentLabel: "performed_as_planned",
              recentLabels: ["performed_as_planned"],
            }),
          ],
        }),
      ])
    );
    expect(contract.boundaries).toMatchObject({
      seedRuntimeChanged: false,
      plannerMaterializerChanged: false,
      receiptMutated: false,
    });
    expect(isPostSessionReviewContract(contract)).toBe(true);
  });

  it("preserves duplicate current workout-row identity in trend groups", () => {
    const contract = buildPostSessionReviewContract(
      buildInput({
        exercises: [
          exercise({
            workoutExerciseId: "we-bench-a",
            exerciseId: "bench",
            exerciseName: "Bench Press",
            sets: [
              performedSet("bench-a-set-1", { actualRpe: 9.5 }),
              performedSet("bench-a-set-2", { actualRpe: 9.5 }),
            ],
          }),
          exercise({
            workoutExerciseId: "we-bench-b",
            exerciseId: "bench",
            exerciseName: "Bench Press",
            sets: [
              performedSet("bench-b-set-1", {
                actualLoad: 130,
                actualReps: 14,
                actualRpe: 6.5,
              }),
              performedSet("bench-b-set-2", {
                actualLoad: 130,
                actualReps: 14,
                actualRpe: 6.5,
              }),
            ],
          }),
        ],
        recentExerciseExposures: [
          {
            ...exercise({
              workoutExerciseId: "prior-bench-under",
              exerciseId: "bench",
              exerciseName: "Bench Press",
              sets: [
                performedSet("prior-bench-under-set-1", { actualRpe: 9.5 }),
                performedSet("prior-bench-under-set-2", { actualRpe: 9.5 }),
              ],
            }),
            workoutId: "prior-bench-under-workout",
            performedAt: "2026-05-25T13:00:00.000Z",
          },
          {
            ...exercise({
              workoutExerciseId: "prior-bench-over",
              exerciseId: "bench",
              exerciseName: "Bench Press",
              sets: [
                performedSet("prior-bench-over-set-1", {
                  actualLoad: 130,
                  actualReps: 14,
                  actualRpe: 6.5,
                }),
                performedSet("prior-bench-over-set-2", {
                  actualLoad: 130,
                  actualReps: 14,
                  actualRpe: 6.5,
                }),
              ],
            }),
            workoutId: "prior-bench-over-workout",
            performedAt: "2026-05-20T13:00:00.000Z",
          },
        ],
      })
    );

    const underGroup = contract.performedReality.trendGroups.find(
      (group) => group.kind === "repeated_underperformance"
    );
    const overGroup = contract.performedReality.trendGroups.find(
      (group) => group.kind === "repeated_overperformance"
    );

    expect(underGroup?.currentRows).toEqual([
      expect.objectContaining({
        workoutExerciseId: "we-bench-a",
        sourceOrder: 0,
        currentLabel: "under_performed",
      }),
    ]);
    expect(underGroup?.priorExposureCount).toBe(1);
    expect(overGroup?.currentRows).toEqual([
      expect.objectContaining({
        workoutExerciseId: "we-bench-b",
        sourceOrder: 1,
        currentLabel: "over_performed",
      }),
    ]);
    expect(overGroup?.priorExposureCount).toBe(1);
  });

  it("preserves duplicate current workout rows in performed reality", () => {
    const contract = buildPostSessionReviewContract(
      buildInput({
        exercises: [
          exercise({
            workoutExerciseId: "we-cable-curl-planned",
            exerciseId: "cable-curl",
            exerciseName: "Cable Curl",
            sets: [performedSet("planned-curl-set-1")],
          }),
          exercise({
            workoutExerciseId: "we-cable-curl-added",
            exerciseId: "cable-curl",
            exerciseName: "Cable Curl",
            isRuntimeAdded: true,
            section: "ACCESSORY",
            isMainLift: false,
            sets: [
              performedSet("added-curl-set-1", {
                actualLoad: 35,
                actualReps: 12,
                actualRpe: 8.5,
              }),
            ],
          }),
        ],
      })
    );

    expect(contract.performedReality.rows).toEqual([
      expect.objectContaining({
        workoutExerciseId: "we-cable-curl-planned",
        exerciseId: "cable-curl",
        completionStatus: "complete",
        plannedSetCount: 1,
        performedSetCount: 1,
      }),
      expect.objectContaining({
        workoutExerciseId: "we-cable-curl-added",
        exerciseId: "cable-curl",
        completionStatus: "session_local",
        plannedSetCount: 0,
        performedSetCount: 1,
        actual: {
          medianReps: 12,
          medianLoad: 35,
          medianRpe: 8.5,
        },
      }),
    ]);
  });

  it("includes next-exposure rows when explainability evidence exists", () => {
    const contract = buildPostSessionReviewContract(
      buildInput({
        nextExposureDecisions: [
          {
            exerciseId: "ex-1",
            exerciseName: "Bench Press",
            decision: {
              action: "hold",
              summary: "Next exposure: hold load.",
              reason: "Median reps stayed in range.",
              anchorLoad: 100,
              repRange: { min: 8, max: 12 },
              modalRpe: 8,
              medianReps: 10,
              decisionLog: ["read-only explainability row"],
            },
          },
        ],
      })
    );

    expect(contract.nextExposure.available).toBe(true);
    expect(contract.nextExposure.rows).toEqual([
      expect.objectContaining({
        exerciseId: "ex-1",
        action: "hold",
        evidenceOnly: true,
        affectsProgressionPolicy: false,
      }),
    ]);
  });

  it("keeps boundaries read-only and rejects invalid mutating contracts", () => {
    const contract = buildPostSessionReviewContract(buildInput());
    expect(contract.boundaries).toMatchObject({
      readOnly: true,
      affectsScoringOrGeneration: false,
      dbMutation: false,
      workoutChanged: false,
      seedRuntimeChanged: false,
      plannerMaterializerChanged: false,
    });

    const invalid: PostSessionReviewContract = {
      ...contract,
      boundaries: {
        ...contract.boundaries,
        dbMutation: true as never,
      },
    };

    expect(isPostSessionReviewContract(invalid)).toBe(false);
  });

  it("rejects missing identity or source truth", () => {
    const contract = buildPostSessionReviewContract(buildInput());

    expect(
      isPostSessionReviewContract({
        ...contract,
        workoutIdentity: undefined,
      })
    ).toBe(false);
    expect(
      isPostSessionReviewContract({
        ...contract,
        sourceTruth: undefined,
      })
    ).toBe(false);
  });

  it("keeps the builder free of CLI, audit formatter, Prisma, and persistence paths", () => {
    const builderSource = readFileSync(
      "src/lib/api/post-session-review-contract-builder.ts",
      "utf8"
    );
    const contractSource = readFileSync(
      "src/lib/api/post-session-review-contract.ts",
      "utf8"
    );
    const evidenceSource = readFileSync(
      "src/lib/api/post-session-review-evidence.ts",
      "utf8"
    );
    const combined = `${builderSource}\n${contractSource}\n${evidenceSource}`;

    expect(combined).not.toContain("@/lib/audit/workout-audit");
    expect(combined).not.toContain("@/lib/engine/apply-loads");
    expect(combined).not.toContain("@/lib/engine/progression");
    expect(combined).not.toContain("@/lib/progression");
    expect(combined).not.toContain("computeDoubleProgressionDecision");
    expect(combined).not.toContain("slotPlanSeedJson");
    expect(combined).not.toContain("workout-audit-cli");
    expect(combined).not.toContain("weekly-retro");
    expect(combined).not.toContain("serializer");
    expect(combined).not.toContain("artifacts/audits");
    expect(combined).not.toContain("@/lib/db/prisma");
    expect(combined).not.toContain("prisma.");
    expect(combined).not.toContain("writeFile");

    const schema = readFileSync("prisma/schema.prisma", "utf8");
    expect(schema).toContain("model PostSessionReviewSnapshot");
  });
});
