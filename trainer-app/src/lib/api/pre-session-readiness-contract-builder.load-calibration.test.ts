import { describe, expect, it, vi } from "vitest";
import { buildLogWorkoutExecutionGuidanceByExercise } from "./log-workout-execution-guidance";
import { buildPreSessionReadinessContract } from "./pre-session-readiness-contract-builder";
import { getCalibrationWatchRows } from "./pre-session-readiness-contract-consumers";
import { buildPreSessionReadinessGymCardDto } from "./pre-session-readiness-gym-card";
import type { PrescriptionConfidenceReadout } from "./template-session/types";

vi.mock("./home-pre-session-readiness", () => ({
  loadCurrentHomePreSessionReadinessContractCandidate: vi.fn(),
  resolveHomePreSessionReadinessContract: vi.fn(),
}));

function buildContract(
  readouts: PrescriptionConfidenceReadout[],
  generatedSnapshot?: {
    exercises: Array<{ placementId?: string; exerciseId: string; exerciseName: string }>;
    traces: { progression: Record<string, unknown> };
    placementCorrelations?: unknown;
    persistedExercises?: Array<{ id: string; exerciseId: string }>;
  },
) {
  return buildPreSessionReadinessContract({
    userId: "user-1",
    evidence: {
      readOnly: true,
      affectsScoringOrGeneration: false,
      consumedByProduction: false,
      wouldWriteTransaction: false,
      activeMesocycle: {
        mesocycleId: "meso-1",
        state: "ACTIVE_ACCUMULATION",
        completedAccumulationSessions: 1,
        deloadSessionsCompleted: 0,
        deloadSessionsExpected: 4,
        deloadSessionPosition: null,
        currentWeek: 1,
        currentSession: 2,
      },
    },
    generation: {
      selection: {},
      prescriptionReadouts: readouts,
    } as never,
    sessionSnapshot: {
      version: 1,
      generated: {
        exercises: (generatedSnapshot?.exercises ?? readouts).map((exercise, orderIndex) => ({
          ...(exercise.placementId ? { placementId: exercise.placementId } : {}),
          exerciseId: exercise.exerciseId,
          exerciseName: exercise.exerciseName,
          orderIndex,
          prescribedSetCount: 1,
          prescribedSets: [],
        })),
        traces: generatedSnapshot?.traces ?? { progression: {} },
      },
      ...(generatedSnapshot?.persistedExercises
        ? {
            saved: {
              ...(generatedSnapshot.placementCorrelations === undefined
                ? {}
                : { placementCorrelations: generatedSnapshot.placementCorrelations }),
            },
          }
        : {}),
    } as never,
    persistedExercises: generatedSnapshot?.persistedExercises,
    projectedWeek: {
      version: 1,
      currentWeek: {
        mesocycleId: "meso-1",
        week: 1,
        phase: "accumulation",
        blockType: "accumulation",
      },
      projectionNotes: [],
      completedVolumeByMuscle: {},
      projectedSessions: [],
      fullWeekByMuscle: [],
      runtimeDoseAdjustmentDiagnostics: [],
    } as never,
  });
}

function readout(
  input: Partial<PrescriptionConfidenceReadout> &
    Pick<PrescriptionConfidenceReadout, "exerciseId" | "exerciseName" | "loadSource">,
): PrescriptionConfidenceReadout {
  return {
    placementId: input.exerciseId,
    targetLoad: 140,
    targetReps: 5,
    repRange: { min: 5, max: 8 },
    targetRpe: 6.5,
    targetRir: 3.5,
    confidence: "medium",
    cautionLevel: "none",
    cautionReason: null,
    suggestedAdjustmentRange: null,
    ...input,
  };
}

describe("V4 load-calibration presentation", () => {
  const legacyTrace = {
    confidence: { combinedScale: 0.5, reasons: ["low signal"] },
    outcome: { action: "hold" },
  };

  it("keeps duplicate canonical exercises correlated to their placement readouts", () => {
    const contract = buildContract([
      readout({
        placementId: "bench-placement-a",
        exerciseId: "bench",
        exerciseName: "Bench Press",
        loadSource: "existing_target_load",
        targetLoad: 105,
      }),
      readout({
        placementId: "bench-placement-b",
        exerciseId: "bench",
        exerciseName: "Bench Press",
        loadSource: "existing_target_load",
        targetLoad: 95,
      }),
    ]);

    expect(contract.calibrationWatches.prescriptionConfidence).toMatchObject([
      { placementId: "bench-placement-a", targetLoad: 105 },
      { placementId: "bench-placement-b", targetLoad: 95 },
    ]);
  });

  it("uses legacy canonical trace fallback only for a unique occurrence", () => {
    const contract = buildContract([], {
      exercises: [{ exerciseId: "bench", exerciseName: "Bench Press" }],
      traces: { progression: { bench: legacyTrace } },
    });

    expect(contract.calibrationWatches.prescriptionConfidence).toEqual([
      expect.objectContaining({
        exerciseLabel: "Bench Press",
        reasonCode: "estimate_or_low_signal",
        confidence: 0.5,
      }),
    ]);
  });

  it("fails closed instead of sharing a legacy canonical trace across duplicates", () => {
    const contract = buildContract([], {
      exercises: [
        { exerciseId: "bench", exerciseName: "Bench Press A" },
        { exerciseId: "bench", exerciseName: "Bench Press B" },
      ],
      traces: { progression: { bench: legacyTrace } },
    });

    expect(contract.calibrationWatches.prescriptionConfidence).toEqual([
      expect.objectContaining({ exerciseLabel: "Bench Press A", reasonCode: "progression_trace_unavailable" }),
      expect.objectContaining({ exerciseLabel: "Bench Press B", reasonCode: "progression_trace_unavailable" }),
    ]);
    expect(contract.calibrationWatches.prescriptionConfidence).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ confidence: 0.5 })]),
    );
  });

  it("correlates current and mixed readiness traces only by exact placement", () => {
    const contract = buildContract([], {
      exercises: [
        { placementId: "bench-a", exerciseId: "bench", exerciseName: "Bench Press A" },
        { exerciseId: "bench", exerciseName: "Bench Press Legacy" },
        { placementId: "curl-a", exerciseId: "curl", exerciseName: "Curl" },
      ],
      traces: {
        progression: {
          "bench-a": legacyTrace,
          bench: { ...legacyTrace, confidence: { combinedScale: 0.25, reasons: ["low signal"] } },
          "curl-a": { ...legacyTrace, confidence: { combinedScale: 0.6, reasons: ["low signal"] } },
        },
      },
    });

    expect(contract.calibrationWatches.prescriptionConfidence).toEqual([
      expect.objectContaining({ placementId: "bench-a", confidence: 0.5 }),
      expect.objectContaining({ exerciseLabel: "Bench Press Legacy", reasonCode: "progression_trace_unavailable" }),
      expect.objectContaining({ placementId: "curl-a", confidence: 0.6 }),
    ]);
  });

  it("projects saved placement correlations into downstream preview and guidance identity", () => {
    const contract = buildContract(
      [
        readout({
          placementId: "generated-a",
          exerciseId: "bench",
          exerciseName: "Bench Press",
          loadSource: "history",
        }),
        readout({
          placementId: "generated-b",
          exerciseId: "bench",
          exerciseName: "Bench Press",
          loadSource: "history",
        }),
      ],
      {
        exercises: [
          { placementId: "generated-a", exerciseId: "bench", exerciseName: "Bench Press" },
          { placementId: "generated-b", exerciseId: "bench", exerciseName: "Bench Press" },
        ],
        traces: { progression: {} },
        placementCorrelations: [
          { generatedPlacementId: "generated-a", persistedWorkoutExerciseId: "row-a" },
          { generatedPlacementId: "generated-b", persistedWorkoutExerciseId: "row-b" },
        ],
        persistedExercises: [
          { id: "row-a", exerciseId: "bench" },
          { id: "row-b", exerciseId: "bench" },
        ],
      },
    );

    expect(contract.workoutPreview?.exercises.map((exercise) => exercise.placementId)).toEqual([
      "row-a",
      "row-b",
    ]);
    expect(contract.workoutPreview?.exercises.map((exercise) => exercise.placementCorrelationSource)).toEqual([
      "explicit",
      "explicit",
    ]);
    expect(contract.placementCorrelation).toMatchObject({
      state: "resolved",
      explicitPairCount: 2,
      legacyUniquePairCount: 0,
      provenPairCount: 2,
    });
    expect(
      getCalibrationWatchRows(contract).map((row) => row.placementId),
    ).toEqual(["row-a", "row-b"]);
    expect(
      buildLogWorkoutExecutionGuidanceByExercise(
        buildPreSessionReadinessGymCardDto(contract),
      ).byPlacementId,
    ).toEqual({
      "row-a": [expect.objectContaining({ title: "Prescription guidance" })],
      "row-b": [expect.objectContaining({ title: "Prescription guidance" })],
    });
  });

  it("omits placement-specific readiness and log guidance for a many-to-one saved map", () => {
    const contract = buildContract(
      [
        readout({
          placementId: "generated-a",
          exerciseId: "bench",
          exerciseName: "Bench Press",
          loadSource: "history",
          targetLoad: 105,
        }),
        readout({
          placementId: "generated-b",
          exerciseId: "bench",
          exerciseName: "Bench Press",
          loadSource: "history",
          targetLoad: 95,
        }),
      ],
      {
        exercises: [
          { placementId: "generated-a", exerciseId: "bench", exerciseName: "Bench Press" },
          { placementId: "generated-b", exerciseId: "bench", exerciseName: "Bench Press" },
        ],
        traces: { progression: {} },
        placementCorrelations: [
          { generatedPlacementId: "generated-a", persistedWorkoutExerciseId: "row-a" },
          { generatedPlacementId: "generated-b", persistedWorkoutExerciseId: "row-a" },
        ],
        persistedExercises: [
          { id: "row-a", exerciseId: "bench" },
          { id: "row-b", exerciseId: "bench" },
        ],
      },
    );

    expect(contract.workoutPreview?.exercises).toEqual([]);
    expect(getCalibrationWatchRows(contract)).toEqual([]);
    expect(contract.placementCorrelation).toMatchObject({
      state: "invalid_explicit_correlation",
      provenPairCount: 0,
      unresolvedGeneratedCount: 2,
    });
    const guidance = buildLogWorkoutExecutionGuidanceByExercise(
      buildPreSessionReadinessGymCardDto(contract),
    );
    expect(guidance.byPlacementId).toEqual({});
  });

  it("does not translate an occurrence whose explicit persisted target is missing", () => {
    const contract = buildContract(
      [
        readout({ placementId: "generated-a", exerciseId: "bench", exerciseName: "Bench A", loadSource: "history" }),
        readout({ placementId: "generated-b", exerciseId: "row", exerciseName: "Row B", loadSource: "history" }),
      ],
      {
        exercises: [
          { placementId: "generated-a", exerciseId: "bench", exerciseName: "Bench A" },
          { placementId: "generated-b", exerciseId: "row", exerciseName: "Row B" },
        ],
        traces: { progression: {} },
        placementCorrelations: [
          { generatedPlacementId: "generated-a", persistedWorkoutExerciseId: "NOPE" },
          { generatedPlacementId: "generated-b", persistedWorkoutExerciseId: "row-b" },
        ],
        persistedExercises: [
          { id: "row-a", exerciseId: "bench" },
          { id: "row-b", exerciseId: "row" },
        ],
      },
    );

    expect(contract.workoutPreview?.exercises.map((exercise) => exercise.placementId)).toEqual([
      "row-b",
    ]);
    expect(getCalibrationWatchRows(contract).map((row) => row.placementId)).toEqual([
      "row-b",
    ]);
    expect(contract.placementCorrelation).toMatchObject({
      state: "invalid_explicit_correlation",
      explicitPairCount: 1,
      unresolvedGeneratedCount: 1,
    });
    expect(
      buildLogWorkoutExecutionGuidanceByExercise(
        buildPreSessionReadinessGymCardDto(contract),
      ).byPlacementId,
    ).toEqual({
      "row-b": [expect.objectContaining({ title: "Prescription guidance" })],
    });
  });

  it("does not recover distinct-canonical many-to-one guidance by exercise identity", () => {
    const contract = buildContract(
      [
        readout({ placementId: "generated-a", exerciseId: "bench", exerciseName: "Bench", loadSource: "history" }),
        readout({ placementId: "generated-b", exerciseId: "row", exerciseName: "Row", loadSource: "history" }),
      ],
      {
        exercises: [
          { placementId: "generated-a", exerciseId: "bench", exerciseName: "Bench" },
          { placementId: "generated-b", exerciseId: "row", exerciseName: "Row" },
        ],
        traces: { progression: {} },
        placementCorrelations: [
          { generatedPlacementId: "generated-a", persistedWorkoutExerciseId: "row-a" },
          { generatedPlacementId: "generated-b", persistedWorkoutExerciseId: "row-a" },
        ],
        persistedExercises: [
          { id: "row-a", exerciseId: "bench" },
          { id: "row-b", exerciseId: "row" },
        ],
      },
    );

    expect(contract.placementCorrelation?.state).toBe("invalid_explicit_correlation");
    expect(contract.workoutPreview?.exercises).toEqual([]);
    expect(getCalibrationWatchRows(contract)).toEqual([]);
    expect(buildLogWorkoutExecutionGuidanceByExercise(buildPreSessionReadinessGymCardDto(contract))).toEqual({
      byPlacementId: {},
    });
  });

  it("emits no placement guidance when generated occurrence IDs are duplicated", () => {
    const contract = buildContract(
      [readout({ placementId: "generated-a", exerciseId: "bench", exerciseName: "Bench", loadSource: "history" })],
      {
        exercises: [
          { placementId: "generated-a", exerciseId: "bench", exerciseName: "Bench 1" },
          { placementId: "generated-a", exerciseId: "bench", exerciseName: "Bench 2" },
        ],
        traces: { progression: {} },
        placementCorrelations: [
          { generatedPlacementId: "generated-a", persistedWorkoutExerciseId: "row-a" },
        ],
        persistedExercises: [
          { id: "row-a", exerciseId: "bench" },
          { id: "row-b", exerciseId: "bench" },
        ],
      },
    );

    expect(contract.placementCorrelation).toMatchObject({
      state: "invalid_occurrence_cardinality",
      provenPairCount: 0,
      issueCodes: ["duplicate_generated_occurrence_id"],
    });
    expect(contract.workoutPreview?.exercises).toEqual([]);
    expect(getCalibrationWatchRows(contract)).toEqual([]);
  });

  it("retains only resolver-proven unique legacy placement guidance", () => {
    const unique = buildContract(
      [readout({ placementId: "generated-a", exerciseId: "bench", exerciseName: "Bench", loadSource: "history" })],
      {
        exercises: [{ placementId: "generated-a", exerciseId: "bench", exerciseName: "Bench" }],
        traces: { progression: {} },
        persistedExercises: [{ id: "row-a", exerciseId: "bench" }],
      },
    );
    expect(unique.placementCorrelation).toMatchObject({
      state: "resolved",
      legacyUniquePairCount: 1,
    });
    expect(unique.workoutPreview?.exercises).toEqual([
      expect.objectContaining({
        placementId: "row-a",
        placementCorrelationSource: "legacy_unique",
      }),
    ]);
    expect(getCalibrationWatchRows(unique)).toEqual([
      expect.objectContaining({ placementId: "row-a" }),
    ]);
    expect(
      buildLogWorkoutExecutionGuidanceByExercise(
        buildPreSessionReadinessGymCardDto(unique),
      ).byPlacementId,
    ).toEqual({
      "row-a": [expect.objectContaining({ title: "Prescription guidance" })],
    });

    const ambiguous = buildContract(
      [
        readout({ placementId: "generated-a", exerciseId: "bench", exerciseName: "Bench A", loadSource: "history" }),
        readout({ placementId: "generated-b", exerciseId: "bench", exerciseName: "Bench B", loadSource: "history" }),
      ],
      {
        exercises: [
          { placementId: "generated-a", exerciseId: "bench", exerciseName: "Bench A" },
          { placementId: "generated-b", exerciseId: "bench", exerciseName: "Bench B" },
        ],
        traces: { progression: {} },
        persistedExercises: [
          { id: "row-a", exerciseId: "bench" },
          { id: "row-b", exerciseId: "bench" },
        ],
      },
    );
    expect(ambiguous.placementCorrelation?.state).toBe("ambiguous_legacy_correlation");
    expect(ambiguous.workoutPreview?.exercises).toEqual([]);
    expect(getCalibrationWatchRows(ambiguous)).toEqual([]);
  });

  it("explains exact, legacy-bridged, and uncalibrated starting loads", () => {
    const contract = buildContract([
      readout({
        exerciseId: "exact-bench",
        exerciseName: "Bench Press",
        loadSource: "history",
        historyEvidence: {
          source: "exact_compatible_history",
          confidence: "high",
          date: "2026-08-03T21:09:57.853Z",
          load: 135,
          reps: 8,
          rpe: 8,
        },
      }),
      readout({
        exerciseId: "legacy-bench",
        exerciseName: "Barbell Bench Press",
        loadSource: "legacy_measurement_history",
        historyEvidence: {
          source: "legacy_measurement_bridge",
          confidence: "reduced",
          date: "2026-08-03T21:09:57.853Z",
          load: 135,
          reps: 8,
          rpe: 8,
        },
      }),
      readout({
        exerciseId: "uncalibrated-bench",
        exerciseName: "Incline Bench Press",
        loadSource: "none",
        targetLoad: null,
        confidence: "low",
      }),
    ]);

    expect(contract.sessionLocalCoaching.prescriptionConfidenceWatches).toEqual([
      "Suggested load: 140 lb. Based on 135 × 8 @ RPE 8 on Aug 3.",
      "Suggested load: 140 lb. Based on prior Barbell Bench Press history from Aug 3.",
      "No calibrated load yet. Enter a starting load for this exercise.",
    ]);
    expect(contract.calibrationWatches.prescriptionConfidence).toEqual([
      expect.objectContaining({
        exerciseLabel: "Bench Press",
        loadSource: "history",
        historyEvidence: expect.objectContaining({ confidence: "high" }),
      }),
      expect.objectContaining({
        exerciseLabel: "Barbell Bench Press",
        loadSource: "legacy_measurement_history",
        severity: "warning",
        historyEvidence: expect.objectContaining({ confidence: "reduced" }),
      }),
      expect.objectContaining({
        exerciseLabel: "Incline Bench Press",
        loadSource: "none",
        targetLoad: null,
        severity: "warning",
      }),
    ]);
  });

  it("preserves all three calibration explanations through production guidance", () => {
    const contract = buildContract([
      readout({
        exerciseId: "exact-bench",
        exerciseName: "Bench Press",
        loadSource: "history",
        historyEvidence: {
          source: "exact_compatible_history",
          confidence: "high",
          date: "2026-08-03T21:09:57.853Z",
          load: 135,
          reps: 8,
          rpe: 8,
        },
      }),
      readout({
        exerciseId: "legacy-bench",
        exerciseName: "Barbell Bench Press",
        loadSource: "legacy_measurement_history",
        historyEvidence: {
          source: "legacy_measurement_bridge",
          confidence: "reduced",
          date: "2026-08-03T21:09:57.853Z",
          load: 135,
          reps: 8,
          rpe: 8,
        },
      }),
      readout({
        exerciseId: "uncalibrated-bench",
        exerciseName: "Incline Bench Press",
        loadSource: "none",
        targetLoad: null,
        confidence: "low",
      }),
    ]);

    expect(getCalibrationWatchRows(contract).map((row) => row.message)).toEqual([
      "Suggested load: 140 lb. Based on 135 × 8 @ RPE 8 on Aug 3.",
      "Suggested load: 140 lb. Based on prior Barbell Bench Press history from Aug 3.",
      "No calibrated load yet. Enter a starting load for this exercise.",
    ]);

    const card = buildPreSessionReadinessGymCardDto(contract);
    const guidance = buildLogWorkoutExecutionGuidanceByExercise(card);

    expect(card.calibrationNotes.map((note) => note.message)).toEqual([
      "Suggested load: 140 lb. Based on 135 × 8 @ RPE 8 on Aug 3.",
      "Suggested load: 140 lb. Based on prior Barbell Bench Press history from Aug 3.",
      "No calibrated load yet. Enter a starting load for this exercise.",
    ]);
    expect(guidance.byPlacementId).toEqual({
      "exact-bench": [
        expect.objectContaining({
          message:
            "Suggested load: 140 lb. Based on 135 × 8 @ RPE 8 on Aug 3.",
          sourceLabel: "History",
        }),
      ],
      "legacy-bench": [
        expect.objectContaining({
          message:
            "Suggested load: 140 lb. Based on prior Barbell Bench Press history from Aug 3.",
          sourceLabel: "Prior history",
        }),
      ],
      "uncalibrated-bench": [
        expect.objectContaining({
          message:
            "No calibrated load yet. Enter a starting load for this exercise.",
        }),
      ],
    });
    expect(
      guidance.byPlacementId["uncalibrated-bench"]?.[0]?.message
    ).not.toMatch(/start at|use the target/i);
  });
});
