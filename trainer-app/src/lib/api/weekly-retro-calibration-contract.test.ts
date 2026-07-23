import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildPostSessionReviewContract } from "./post-session-review-contract-builder";
import {
  buildWeeklyRetroCalibrationContract,
  isWeeklyRetroCalibrationContract,
} from "./weekly-retro-calibration-contract";
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
    exerciseId: input.exerciseId ?? "bench",
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

function reviewInput(
  workoutId: string,
  exercises: PostSessionReviewExerciseEvidence[]
): PostSessionReviewContractBuildInput {
  return {
    workoutIdentity: {
      userId: "user-1",
      workoutId,
      status: "COMPLETED",
      revision: 2,
      scheduledDate: `2026-06-0${workoutId.replace(/\D/g, "") || "1"}T12:00:00.000Z`,
      selectionMode: "INTENT",
      sessionIntent: "UPPER",
      advancesSplit: true,
      mesocycleId: "meso-1",
      mesocycleWeekSnapshot: 2,
      mesoSessionSnapshot: 1,
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
    exercises,
  };
}

function review(
  workoutId: string,
  exercises: PostSessionReviewExerciseEvidence[]
) {
  return buildPostSessionReviewContract(reviewInput(workoutId, exercises));
}

function buildWeekly(
  reviews = [review("workout-1", [exercise({})])]
) {
  return buildWeeklyRetroCalibrationContract({
    userId: "user-1",
    mesocycleId: "meso-1",
    week: 2,
    reviews,
  });
}

describe("weekly retro calibration contract", () => {
  it("summarizes repeated under-plan performed-reality evidence", () => {
    const contract = buildWeekly([
      review("workout-1", [
        exercise({
          workoutExerciseId: "we-hard-press-1",
          exerciseId: "hard-press",
          exerciseName: "Hard Press",
          sets: [
            performedSet("under-1", { actualRpe: 9.5 }),
            performedSet("under-2", { actualRpe: 9.5 }),
          ],
        }),
      ]),
      review("workout-2", [
        exercise({
          workoutExerciseId: "we-hard-press-2",
          exerciseId: "hard-press",
          exerciseName: "Hard Press",
          sets: [
            performedSet("under-3", { actualRpe: 9.5 }),
            performedSet("under-4", { actualRpe: 9.5 }),
          ],
        }),
      ]),
    ]);

    expect(contract.summary).toMatchObject({
      kind: "repeated_under_plan",
      headline: "Repeated likely over-prescription",
      displaySafe: true,
    });
    expect(contract.patterns).toEqual([
      expect.objectContaining({
        kind: "repeated_under_plan",
        rowCount: 2,
        exerciseCount: 1,
        evidenceOnly: true,
        affectsProgressionPolicy: false,
        affectsPrescriptionPolicy: false,
        seedRuntimeChanged: false,
        plannerMaterializerChanged: false,
        receiptMutated: false,
        acceptanceChanged: false,
      }),
    ]);
    expect(isWeeklyRetroCalibrationContract(contract, { userId: "user-1" })).toBe(true);
  });

  it("summarizes repeated over-plan performed-reality evidence", () => {
    const contract = buildWeekly([
      review("workout-1", [
        exercise({
          workoutExerciseId: "we-row-1",
          exerciseId: "row",
          exerciseName: "Cable Row",
          sets: [
            performedSet("over-1", {
              actualLoad: 130,
              actualReps: 14,
              actualRpe: 6.5,
            }),
          ],
        }),
      ]),
      review("workout-2", [
        exercise({
          workoutExerciseId: "we-row-2",
          exerciseId: "row",
          exerciseName: "Cable Row",
          sets: [
            performedSet("over-2", {
              actualLoad: 130,
              actualReps: 14,
              actualRpe: 6.5,
            }),
          ],
        }),
      ]),
    ]);

    expect(contract.summary.kind).toBe("repeated_over_plan");
    expect(contract.patterns).toEqual([
      expect.objectContaining({
        kind: "repeated_over_plan",
        rowCount: 2,
      }),
    ]);
  });

  it("summarizes stable as-planned execution", () => {
    const contract = buildWeekly([
      review("workout-1", [exercise({ workoutExerciseId: "we-bench" })]),
      review("workout-2", [
        exercise({
          workoutExerciseId: "we-row",
          exerciseId: "row",
          exerciseName: "Cable Row",
        }),
      ]),
    ]);

    expect(contract.summary).toMatchObject({
      kind: "stable_as_planned",
      headline: "Repeated successful execution",
    });
    expect(contract.patterns).toEqual([
      expect.objectContaining({
        kind: "stable_as_planned",
        rowCount: 2,
        exerciseCount: 2,
      }),
    ]);
  });

  it("summarizes missing-actuals data-quality patterns", () => {
    const contract = buildWeekly([
      review("workout-1", [
        exercise({
          workoutExerciseId: "we-raise",
          exerciseId: "lateral-raise",
          exerciseName: "Lateral Raise",
          sets: [
            performedSet("missing-1", {
              wasLogged: false,
              actualLoad: null,
              actualReps: null,
              actualRpe: null,
            }),
          ],
        }),
      ]),
    ]);

    expect(contract.summary).toMatchObject({
      kind: "missing_actuals",
      headline: "Missing actuals limit calibration",
    });
    expect(contract.patterns).toEqual([
      expect.objectContaining({
        kind: "missing_actuals_pattern",
        rowCount: 1,
      }),
    ]);
  });

  it("summarizes mixed weekly evidence without choosing a policy action", () => {
    const contract = buildWeekly([
      review("workout-1", [
        exercise({
          workoutExerciseId: "we-under",
          exerciseId: "press",
          exerciseName: "Press",
          sets: [performedSet("under-1", { actualRpe: 9.5 })],
        }),
        exercise({
          workoutExerciseId: "we-over",
          exerciseId: "row",
          exerciseName: "Row",
          sets: [
            performedSet("over-1", {
              actualLoad: 130,
              actualReps: 14,
              actualRpe: 6.5,
            }),
          ],
        }),
      ]),
    ]);

    expect(contract.summary).toMatchObject({
      kind: "mixed",
      headline: "Unresolved execution variability",
      displaySafe: true,
    });
    expect(contract.summary.detail).toContain("Review evidence only");
    expect(contract.nonConsumption).toMatchObject({
      progressionPolicy: false,
      prescriptionPolicy: false,
      seedRuntimeReplay: false,
      receipts: false,
      plannerMaterializer: false,
      acceptance: false,
      auditArtifacts: false,
      dbWrites: false,
    });
  });

  it("returns a no-history contract when no performed-reality rows are available", () => {
    const contract = buildWeeklyRetroCalibrationContract({
      userId: "user-1",
      mesocycleId: "meso-1",
      week: 2,
      reviews: [],
    });

    expect(contract.summary).toEqual({
      kind: "no_history",
      headline: "No weekly retro calibration evidence yet",
      detail: "No performed-reality rows were available for this weekly review.",
      bullets: ["No seed or plan changes made"],
      displaySafe: true,
    });
    expect(contract.sourceEvidence).toMatchObject({
      reviewCount: 0,
      rowCount: 0,
      rows: [],
      readOnly: true,
    });
    expect(contract.patterns).toEqual([]);
  });

  it("preserves duplicate current workout-row identity instead of collapsing by exerciseId", () => {
    const contract = buildWeekly([
      review("workout-1", [
        exercise({
          workoutExerciseId: "we-bench-a",
          exerciseId: "bench",
          exerciseName: "Bench Press",
          sets: [performedSet("bench-a-set", { actualRpe: 9.5 })],
        }),
        exercise({
          workoutExerciseId: "we-bench-b",
          exerciseId: "bench",
          exerciseName: "Bench Press",
          sets: [
            performedSet("bench-b-set", {
              actualLoad: 130,
              actualReps: 14,
              actualRpe: 6.5,
            }),
          ],
        }),
      ]),
    ]);

    expect(contract.sourceEvidence.rows.map((row) => row.workoutExerciseId)).toEqual([
      "we-bench-a",
      "we-bench-b",
    ]);
    expect(contract.sourceEvidence.rows.map((row) => row.sourceOrder)).toEqual([0, 1]);
    expect(contract.sourceEvidence.rows).toEqual([
      expect.objectContaining({
        workoutId: "workout-1",
        workoutExerciseId: "we-bench-a",
        exerciseId: "bench",
        label: "under_performed",
      }),
      expect.objectContaining({
        workoutId: "workout-1",
        workoutExerciseId: "we-bench-b",
        exerciseId: "bench",
        label: "over_performed",
      }),
    ]);
  });

  it("keeps the contract out of progression, prescription, seed/runtime, receipts, planner, acceptance, DB, and audit artifacts", () => {
    const source = readFileSync(
      "src/lib/api/weekly-retro-calibration-contract.ts",
      "utf8"
    );
    const schema = readFileSync("prisma/schema.prisma", "utf8");

    expect(source).toContain("./post-session-review-contract");
    expect(source).not.toContain("@/lib/audit");
    expect(source).not.toContain("workout-audit");
    expect(source).not.toContain("scripts/workout-audit");
    expect(source).not.toContain("artifacts/audits");
    expect(source).not.toContain("@/lib/db/prisma");
    expect(source).not.toContain("prisma.");
    expect(source).not.toContain("@/lib/engine/apply-loads");
    expect(source).not.toContain("@/lib/engine/planning");
    expect(source).not.toContain("@/lib/engine/progression");
    expect(source).not.toContain("@/lib/progression");
    expect(source).not.toContain("computeDoubleProgressionDecision");
    expect(source).not.toContain("generateWorkoutExplanation");
    expect(source).not.toContain("slotPlanSeedJson");
    expect(source).not.toContain("sessionDecisionReceipt");
    expect(source).not.toContain("accept-next-cycle");
    expect(source).not.toContain("acceptance-gate");
    expect(source).not.toContain("create(");
    expect(source).not.toContain("update(");
    expect(source).not.toContain("upsert(");
    expect(source).not.toContain("delete(");
    expect(schema).not.toContain("WeeklyRetroCalibration");
  });
});
