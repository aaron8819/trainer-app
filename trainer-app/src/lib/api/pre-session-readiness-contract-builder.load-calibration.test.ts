import { describe, expect, it } from "vitest";
import { buildPreSessionReadinessContract } from "./pre-session-readiness-contract-builder";
import type { PrescriptionConfidenceReadout } from "./template-session/types";

function buildContract(readouts: PrescriptionConfidenceReadout[]) {
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
        exercises: readouts.map((readout, orderIndex) => ({
          exerciseId: readout.exerciseId,
          exerciseName: readout.exerciseName,
          orderIndex,
          prescribedSetCount: 1,
          prescribedSets: [],
        })),
        traces: { progression: {} },
      },
    } as never,
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
});
