import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildPostSessionReviewContract } from "./post-session-review-contract-builder";
import type {
  PostSessionReviewContractBuildInput,
  PostSessionReviewExerciseEvidence,
} from "./post-session-review-evidence";

const mocks = vi.hoisted(() => ({
  loadHistoricalPostSessionReview: vi.fn(),
  produceCurrentPostSessionReviewInterpretation: vi.fn(),
}));

vi.mock("./post-session-review-producer", () => ({
  produceCurrentPostSessionReviewInterpretation: (...args: unknown[]) =>
    mocks.produceCurrentPostSessionReviewInterpretation(...args),
}));

vi.mock("./post-session-review-snapshot", () => ({
  loadHistoricalPostSessionReview: (...args: unknown[]) =>
    mocks.loadHistoricalPostSessionReview(...args),
  legacyDerivedSnapshotMetadata: (contract: { contractVersion: number }) => ({
    snapshotId: null,
    provenance: "legacy_derived",
    contractVersion: contract.contractVersion,
    computationPolicyVersion: 1,
    payloadHash: null,
    evidenceFingerprint: null,
    finalizedAt: null,
    exactHistoricalInterpretation: false,
  }),
}));

import { loadCompletedWorkoutReviewReadModel } from "./completed-workout-review";

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
      sessionIntent: "UPPER",
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

function readyResult(overrides: Partial<PostSessionReviewContractBuildInput> = {}) {
  return {
    status: "ready" as const,
    contract: buildPostSessionReviewContract(buildInput(overrides)),
  };
}

describe("loadCompletedWorkoutReviewReadModel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadHistoricalPostSessionReview.mockResolvedValue({
      status: "legacy_missing",
    });
  });

  it("exposes a PostSessionReviewDisplayDto for a completed user-owned workout", async () => {
    mocks.produceCurrentPostSessionReviewInterpretation.mockResolvedValue(readyResult());

    const model = await loadCompletedWorkoutReviewReadModel("user-1", "workout-1");

    expect(mocks.produceCurrentPostSessionReviewInterpretation).toHaveBeenCalledWith(
      "user-1",
      "workout-1"
    );
    expect(model.postSessionReview).toMatchObject({
      status: "reviewed",
      headline: "Post-session review ready",
      completion: {
        plannedSetCount: 3,
        completedSetCount: 3,
        completionPct: 100,
      },
      source: {
        workoutId: "workout-1",
        userId: "user-1",
        ownerSeam: "api/post-session-review-display",
        readOnly: true,
        evidenceOnly: true,
      },
    });
  });

  it("returns the persisted exact historical review without current-policy recomputation", async () => {
    const persisted = readyResult().contract;
    mocks.loadHistoricalPostSessionReview.mockResolvedValue({
      status: "ready",
      contract: persisted,
      metadata: {
        snapshotId: "snapshot-1",
        provenance: "exact",
        contractVersion: 1,
        computationPolicyVersion: 1,
        payloadHash: "payload-hash",
        evidenceFingerprint: "evidence-hash",
        finalizedAt: "2026-07-14T12:00:00.000Z",
        exactHistoricalInterpretation: true,
      },
    });

    const model = await loadCompletedWorkoutReviewReadModel("user-1", "workout-1");

    expect(model.postSessionReview?.status).toBe("reviewed");
    expect(model.reviewEvidence).toMatchObject({
      provenance: "exact",
      snapshotId: "snapshot-1",
    });
    expect(mocks.produceCurrentPostSessionReviewInterpretation).not.toHaveBeenCalled();
  });

  it("surfaces persisted integrity failure without fabricating a current review", async () => {
    mocks.loadHistoricalPostSessionReview.mockResolvedValue({
      status: "integrity_error",
      reason: "payload_hash_mismatch",
      message: "Persisted review payload hash does not match.",
      metadata: {
        snapshotId: "snapshot-1",
        provenance: "exact",
        contractVersion: 1,
        computationPolicyVersion: 1,
        payloadHash: "bad-hash",
        evidenceFingerprint: "evidence-hash",
        finalizedAt: "2026-07-14T12:00:00.000Z",
        exactHistoricalInterpretation: true,
      },
    });

    const model = await loadCompletedWorkoutReviewReadModel("user-1", "workout-1");

    expect(model.postSessionReview).toMatchObject({
      status: "blocked",
      headline: "Post-session review unavailable",
    });
    expect(mocks.produceCurrentPostSessionReviewInterpretation).not.toHaveBeenCalled();
  });

  it("returns a safe blocked DTO for incomplete or not-ready workouts", async () => {
    mocks.produceCurrentPostSessionReviewInterpretation.mockResolvedValue({
      status: "blocked",
      reason: "not_ready",
      message: "Workout is not completed or partial enough for post-session review.",
      contract: null,
    });

    const model = await loadCompletedWorkoutReviewReadModel("user-1", "workout-1");

    expect(model.postSessionReview).toMatchObject({
      status: "not_ready",
      headline: "Post-session review is not ready",
      completion: null,
      summaryBullets: ["No seed or plan changes made"],
    });
  });

  it("keeps missing or unauthorized workouts protected", async () => {
    mocks.produceCurrentPostSessionReviewInterpretation.mockResolvedValue({
      status: "blocked",
      reason: "not_found_or_unauthorized",
      message: "Workout was not found for this user.",
      contract: null,
    });

    const model = await loadCompletedWorkoutReviewReadModel("user-2", "workout-1");

    expect(model.postSessionReview).toBeNull();
  });

  it("carries skipped, runtime-added, and replacement evidence into display DTO rows", async () => {
    mocks.produceCurrentPostSessionReviewInterpretation.mockResolvedValue(
      readyResult({
        sourceTruth: {
          ...buildInput().sourceTruth,
          runtimeEditReconciliationAvailable: true,
        },
        exercises: [
          exercise({
            exerciseId: "lat-pulldown",
            exerciseName: "Lat Pulldown",
            sets: [
              performedSet("set-1", {
                wasSkipped: true,
                actualReps: null,
                actualLoad: null,
              }),
            ],
          }),
          exercise({
            workoutExerciseId: "we-added",
            exerciseId: "cable-curl",
            exerciseName: "Cable Curl",
            section: "ACCESSORY",
            isMainLift: false,
            isRuntimeAdded: true,
            sets: [performedSet("set-2"), performedSet("set-3")],
          }),
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
              evidence: ["selectionMetadata.runtimeEditReconciliation op"],
              seedMutation: false,
              policyMutation: false,
            },
          }),
        ],
      })
    );

    const model = await loadCompletedWorkoutReviewReadModel("user-1", "workout-1");

    expect(model.postSessionReview?.exerciseChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "skipped",
          exerciseName: "Lat Pulldown",
        }),
        expect.objectContaining({
          kind: "runtime_added",
          exerciseName: "Cable Curl",
        }),
        expect.objectContaining({
          kind: "replacement_evidence",
          exerciseName: "Machine Row",
          headline: "Used Machine Row instead of Barbell Row",
        }),
      ])
    );
  });

  it("does not leak raw debug, evidence, or internal contract strings", async () => {
    mocks.produceCurrentPostSessionReviewInterpretation.mockResolvedValue(
      readyResult({
        sourceTruth: {
          ...buildInput().sourceTruth,
          runtimeEditReconciliationAvailable: true,
        },
        exercises: [
          exercise({
            workoutExerciseId: "we-replaced",
            exerciseId: "bench",
            exerciseName: "Bench Press",
            replacement: {
              source: "runtime_edit_reconciliation",
              fromExerciseId: "barbell-bench",
              fromExerciseName: "Barbell Bench Press",
              toExerciseId: "bench",
              reason: "equipment_availability_equivalent_push_swap",
              evidence: ["selectionMetadata.runtimeEditReconciliation op"],
              seedMutation: false,
              policyMutation: false,
            },
            sets: [
              performedSet("set-1", { targetLoad: 100, actualLoad: 130 }),
              performedSet("set-2", { targetLoad: 100, actualLoad: 130 }),
            ],
          }),
        ],
        nextExposureDecisions: [
          {
            exerciseId: "bench",
            exerciseName: "Bench Press",
            decision: {
              action: "increase",
              summary: "raw summary should not leak",
              reason: "raw reason should not leak",
              anchorLoad: 130,
              repRange: { min: 8, max: 12 },
              modalRpe: 8,
              medianReps: 10,
              decisionLog: ["raw decision log should not leak"],
            },
          },
        ],
      })
    );

    const model = await loadCompletedWorkoutReviewReadModel("user-1", "workout-1");
    const serialized = JSON.stringify(model.postSessionReview);

    expect(serialized).not.toContain("decisionLog");
    expect(serialized).not.toContain("runtime_edit_reconciliation");
    expect(serialized).not.toContain("replacement_like");
    expect(serialized).not.toContain("target_too_low");
    expect(serialized).not.toContain("policyMutation");
    expect(serialized).not.toContain("seedMutation");
    expect(serialized).not.toContain("selectionMetadata");
    expect(serialized).not.toContain("raw summary should not leak");
    expect(serialized).not.toContain("raw decision log should not leak");
  });

  it("does not import audit, CLI, artifact, weekly-retro, or mutation paths", () => {
    const source = readFileSync("src/lib/api/completed-workout-review.ts", "utf8");
    const pageSource = readFileSync("src/app/workout/[id]/page.tsx", "utf8");

    expect(source).toContain("./post-session-review-producer");
    expect(source).toContain("./post-session-review-snapshot");
    expect(source).toContain("./post-session-review-display");
    expect(source).not.toContain("@/lib/audit/workout-audit");
    expect(source).not.toContain("workout-audit-cli");
    expect(source).not.toContain("scripts/workout-audit");
    expect(source).not.toContain("artifacts/audits");
    expect(source).not.toContain("weekly-retro");
    expect(source).not.toContain("@/lib/db/prisma");
    expect(source).not.toContain("prisma.");
    expect(source).not.toContain("create(");
    expect(source).not.toContain("update(");
    expect(source).not.toContain("upsert(");
    expect(source).not.toContain("delete(");

    expect(pageSource).toContain("@/lib/api/completed-workout-review");
    expect(pageSource).not.toContain("post-session-review-contract");
    expect(pageSource).not.toContain("post-session-review-evidence");
  });
});
