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
    )?.classification).toBe("runtime_added");
    expect(contract.boundaries.workoutChanged).toBe(false);
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

  it("classifies target-too-high, target-too-low, and insufficient calibration evidence", () => {
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
            exerciseId: "too-low",
            exerciseName: "Too Low Row",
            sets: [
              performedSet("set-3", { targetLoad: 100, actualLoad: 130, actualReps: 10 }),
              performedSet("set-4", { targetLoad: 100, actualLoad: 130, actualReps: 10 }),
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
      "too-high": "target_too_high",
      "too-low": "target_too_low",
      insufficient: "insufficient_evidence",
    });
    expect(contract.prescriptionCalibration.summary).toMatchObject({
      targetTooHighCount: 1,
      targetTooLowCount: 1,
      insufficientEvidenceCount: 1,
    });
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
    expect(combined).not.toContain("workout-audit-cli");
    expect(combined).not.toContain("weekly-retro");
    expect(combined).not.toContain("serializer");
    expect(combined).not.toContain("artifacts/audits");
    expect(combined).not.toContain("@/lib/db/prisma");
    expect(combined).not.toContain("prisma.");
    expect(combined).not.toContain("writeFile");

    const schema = readFileSync("prisma/schema.prisma", "utf8");
    expect(schema).not.toContain("PostSessionReviewSnapshot");
  });
});
