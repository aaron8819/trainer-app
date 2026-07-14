import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { buildPostSessionReviewContract } from "./post-session-review-contract-builder";
import type { PostSessionReviewContractBuildInput } from "./post-session-review-evidence";

const mocks = vi.hoisted(() => ({
  workoutFindFirst: vi.fn(),
  workoutFindMany: vi.fn(),
  workoutExerciseFindMany: vi.fn(),
  snapshotFindUnique: vi.fn(),
  snapshotCreate: vi.fn(),
  produceCurrent: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    workout: {
      findFirst: (...args: unknown[]) => mocks.workoutFindFirst(...args),
      findMany: (...args: unknown[]) => mocks.workoutFindMany(...args),
    },
    workoutExercise: {
      findMany: (...args: unknown[]) => mocks.workoutExerciseFindMany(...args),
    },
    postSessionReviewSnapshot: {
      findUnique: (...args: unknown[]) => mocks.snapshotFindUnique(...args),
      create: (...args: unknown[]) => mocks.snapshotCreate(...args),
    },
  },
}));

vi.mock("./post-session-review-producer", () => ({
  produceCurrentPostSessionReviewInterpretation: (...args: unknown[]) =>
    mocks.produceCurrent(...args),
}));

import {
  buildPostSessionReviewEvidenceFingerprint,
  createPostSessionReviewSnapshotInTransaction,
  hashPostSessionReviewValue,
  loadHistoricalPostSessionReview,
} from "./post-session-review-snapshot";

function contract() {
  const input: PostSessionReviewContractBuildInput = {
    workoutIdentity: {
      userId: "user-1",
      workoutId: "workout-1",
      status: "COMPLETED",
      revision: 2,
      scheduledDate: "2026-07-14T12:00:00.000Z",
      selectionMode: "INTENT",
      sessionIntent: "UPPER",
      advancesSplit: true,
      mesocycleId: "meso-1",
      mesocycleWeekSnapshot: 2,
      mesoSessionSnapshot: 4,
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
    exercises: [
      {
        workoutExerciseId: "we-1",
        exerciseId: "bench",
        exerciseName: "Bench Press",
        orderIndex: 0,
        section: "MAIN",
        isMainLift: true,
        sets: [
          {
            workoutSetId: "set-1",
            setIndex: 0,
            targetReps: 10,
            targetRepMin: 8,
            targetRepMax: 12,
            targetRpe: 8,
            targetLoad: 100,
            wasLogged: true,
            wasSkipped: false,
            actualReps: 10,
            actualRpe: 8,
            actualLoad: 100,
          },
        ],
      },
    ],
  };
  return buildPostSessionReviewContract(input);
}

const evidence = {
  id: "workout-1",
  userId: "user-1",
  status: "COMPLETED",
  revision: 2,
  selectionMetadata: { sessionDecisionReceipt: { version: 3 } },
  exercises: [],
};
const fingerprintEvidence = {
  workout: evidence,
  priorExerciseHistory: [],
  weeklyPerformedHistory: [],
};

function snapshot(payload = contract()) {
  return {
    id: "snapshot-1",
    contractVersion: 1,
    computationPolicyVersion: 1,
    payload,
    payloadHash: hashPostSessionReviewValue(payload),
    evidenceFingerprint: hashPostSessionReviewValue(fingerprintEvidence),
    provenance: "exact",
    finalizedAt: new Date("2026-07-14T12:01:00.000Z"),
  };
}

describe("post-session review snapshots", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.workoutFindMany.mockResolvedValue([]);
    mocks.workoutExerciseFindMany.mockResolvedValue([]);
  });

  it("normalizes object key order before hashing", () => {
    expect(hashPostSessionReviewValue({ b: 2, a: { d: 4, c: 3 } })).toBe(
      hashPostSessionReviewValue({ a: { c: 3, d: 4 }, b: 2 })
    );
  });

  it("returns the exact persisted review without invoking current policy", async () => {
    mocks.workoutFindFirst
      .mockResolvedValueOnce({ id: "workout-1", postSessionReviewSnapshot: snapshot() })
      .mockResolvedValueOnce(evidence);

    const result = await loadHistoricalPostSessionReview("user-1", "workout-1");

    expect(result).toMatchObject({
      status: "ready",
      contract: { workoutIdentity: { workoutId: "workout-1" } },
      metadata: { provenance: "exact", exactHistoricalInterpretation: true },
    });
    expect(mocks.produceCurrent).not.toHaveBeenCalled();
  });

  it.each([
    ["unsupported_contract_version", { contractVersion: 99 }],
    ["unsupported_policy_version", { computationPolicyVersion: 99 }],
    ["payload_hash_mismatch", { payloadHash: "corrupt" }],
  ] as const)("fails explicitly for %s", async (reason, override) => {
    mocks.workoutFindFirst.mockResolvedValueOnce({
      id: "workout-1",
      postSessionReviewSnapshot: { ...snapshot(), ...override },
    });

    await expect(
      loadHistoricalPostSessionReview("user-1", "workout-1")
    ).resolves.toMatchObject({ status: "integrity_error", reason });
    expect(mocks.produceCurrent).not.toHaveBeenCalled();
  });

  it("rejects a persisted payload with missing required contract fields", async () => {
    const invalidPayload = { contractVersion: 1 };
    mocks.workoutFindFirst.mockResolvedValueOnce({
      id: "workout-1",
      postSessionReviewSnapshot: {
        ...snapshot(),
        payload: invalidPayload,
        payloadHash: hashPostSessionReviewValue(invalidPayload),
      },
    });

    await expect(
      loadHistoricalPostSessionReview("user-1", "workout-1")
    ).resolves.toMatchObject({ status: "integrity_error", reason: "invalid_payload" });
  });

  it("detects post-finalization evidence mutation without replacing the snapshot", async () => {
    mocks.workoutFindFirst
      .mockResolvedValueOnce({ id: "workout-1", postSessionReviewSnapshot: snapshot() })
      .mockResolvedValueOnce({ ...evidence, revision: 3 });

    await expect(
      loadHistoricalPostSessionReview("user-1", "workout-1")
    ).resolves.toMatchObject({
      status: "integrity_error",
      reason: "evidence_fingerprint_mismatch",
    });
    expect(mocks.snapshotCreate).not.toHaveBeenCalled();
  });

  it("creates one versioned exact snapshot from the current policy inside the transaction", async () => {
    const payload = contract();
    const created = { ...snapshot(payload), workoutId: "workout-1" };
    mocks.snapshotFindUnique.mockResolvedValue(null);
    mocks.produceCurrent.mockResolvedValue({ status: "ready", contract: payload });
    mocks.workoutFindFirst.mockResolvedValue(evidence);
    mocks.snapshotCreate.mockResolvedValue(created);
    const tx = {
      workout: {
        findFirst: mocks.workoutFindFirst,
        findMany: mocks.workoutFindMany,
      },
      workoutExercise: { findMany: mocks.workoutExerciseFindMany },
      postSessionReviewSnapshot: {
        findUnique: mocks.snapshotFindUnique,
        create: mocks.snapshotCreate,
      },
    } as never;

    const result = await createPostSessionReviewSnapshotInTransaction(tx, {
      userId: "user-1",
      workoutId: "workout-1",
      provenance: "exact",
    });

    expect(result).toMatchObject({ created: true, snapshot: { id: "snapshot-1" } });
    expect(mocks.snapshotCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workoutId: "workout-1",
        contractVersion: 1,
        computationPolicyVersion: 1,
        provenance: "exact",
        payloadHash: hashPostSessionReviewValue(payload),
        evidenceFingerprint: hashPostSessionReviewValue(fingerprintEvidence),
      }),
    });
  });

  it("reuses an existing snapshot without recomputation", async () => {
    mocks.snapshotFindUnique.mockResolvedValue(snapshot());
    mocks.workoutFindFirst.mockResolvedValue(evidence);
    const tx = {
      workout: {
        findFirst: mocks.workoutFindFirst,
        findMany: mocks.workoutFindMany,
      },
      workoutExercise: { findMany: mocks.workoutExerciseFindMany },
      postSessionReviewSnapshot: { findUnique: mocks.snapshotFindUnique },
    } as never;

    await expect(
      createPostSessionReviewSnapshotInTransaction(tx, {
        userId: "user-1",
        workoutId: "workout-1",
        provenance: "exact",
      })
    ).resolves.toMatchObject({ created: false });
    expect(mocks.produceCurrent).not.toHaveBeenCalled();
  });

  it("fingerprints the persisted evidence rather than display formatting", async () => {
    mocks.workoutFindFirst.mockResolvedValue(evidence);
    const tx = {
      workout: {
        findFirst: mocks.workoutFindFirst,
        findMany: mocks.workoutFindMany,
      },
      workoutExercise: { findMany: mocks.workoutExerciseFindMany },
    } as never;

    await expect(
      buildPostSessionReviewEvidenceFingerprint(tx, {
        userId: "user-1",
        workoutId: "workout-1",
      })
    ).resolves.toBe(hashPostSessionReviewValue(fingerprintEvidence));
  });

  it("keeps the migration one-to-one, immutable, and parent-delete restricted", () => {
    const migration = readFileSync(
      "prisma/migrations/20260714180000_add_post_session_review_snapshots/migration.sql",
      "utf8"
    );

    expect(migration).toContain(
      'CREATE UNIQUE INDEX "PostSessionReviewSnapshot_workoutId_key"'
    );
    expect(migration).toContain("BEFORE UPDATE OR DELETE");
    expect(migration).toContain("ON DELETE RESTRICT");
  });

  it("keeps legacy backfill dry-run-first with explicit write mode", () => {
    const source = readFileSync("scripts/backfill-post-session-reviews.ts", "utf8");

    expect(source).toContain('process.argv.includes("--write")');
    expect(source).toContain('status: "COMPLETED"');
    expect(source).toContain('provenance: "legacy_derived"');
    expect(source).toContain("if (write)");
    expect(source).not.toContain("updateMany({");
    expect(source).not.toContain("deleteMany({");
  });
});
