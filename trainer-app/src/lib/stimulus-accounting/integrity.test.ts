import { describe, expect, it } from "vitest";
import {
  buildExerciseStimulusSnapshot,
  toExerciseStimulusAccountingEvidence,
} from "./snapshot";
import { auditStimulusAccountingIntegrity } from "./integrity";

const exercise = {
  id: "bench",
  name: "Bench Press",
  primaryMuscles: ["Chest"],
  secondaryMuscles: ["Triceps"],
};

describe("auditStimulusAccountingIntegrity", () => {
  it("separates verified, derived, corrupt, missing-exact, and evidence mismatch", () => {
    const exact = buildExerciseStimulusSnapshot(exercise, "exact");
    const corrupt = { ...exact, policyHash: "0".repeat(64) };
    const mismatch = { ...toExerciseStimulusAccountingEvidence(exact), snapshotHash: "f".repeat(64) };
    const summary = auditStimulusAccountingIntegrity([
      { workoutId: "w1", workoutExerciseId: "we1", exerciseId: "bench", persistedSnapshot: exact, exercise, expectedEvidence: toExerciseStimulusAccountingEvidence(exact) },
      { workoutId: "w2", workoutExerciseId: "we2", exerciseId: "bench", persistedSnapshot: null, exercise },
      { workoutId: "w3", workoutExerciseId: "we3", exerciseId: "bench", persistedSnapshot: corrupt, exercise },
      { workoutId: "w4", workoutExerciseId: "we4", exerciseId: "bench", persistedSnapshot: null, exercise, expectedEvidence: toExerciseStimulusAccountingEvidence(exact) },
      { workoutId: "w5", workoutExerciseId: "we5", exerciseId: "bench", persistedSnapshot: exact, exercise, expectedEvidence: mismatch },
    ]);

    expect(summary).toMatchObject({
      exactVerifiedCount: 1,
      legacyDerivedCount: 1,
      invalidSnapshotCount: 1,
      missingExactSnapshotCount: 1,
      evidenceMismatchCount: 1,
    });
    expect(summary.rowsRequiringAttention.map((row) => row.status)).toEqual([
      "invalid_snapshot",
      "missing_exact_snapshot",
      "evidence_mismatch",
    ]);
  });
});
