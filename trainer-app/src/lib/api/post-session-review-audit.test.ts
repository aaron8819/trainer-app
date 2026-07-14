import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  workoutFindMany: vi.fn(),
  loadHistorical: vi.fn(),
  produceCurrent: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: { workout: { findMany: (...args: unknown[]) => mocks.workoutFindMany(...args) } },
}));

vi.mock("./post-session-review-snapshot", () => ({
  loadHistoricalPostSessionReview: (...args: unknown[]) =>
    mocks.loadHistorical(...args),
  hashPostSessionReviewValue: (value: unknown) => JSON.stringify(value),
}));

vi.mock("./post-session-review-producer", () => ({
  produceCurrentPostSessionReviewInterpretation: (...args: unknown[]) =>
    mocks.produceCurrent(...args),
}));

import { auditPostSessionReviewSnapshots } from "./post-session-review-audit";

describe("post-session review snapshot audit", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reports completed workouts missing required exact snapshots without writing", async () => {
    mocks.workoutFindMany.mockResolvedValue([
      { id: "workout-1", userId: "user-1", status: "COMPLETED" },
    ]);
    mocks.loadHistorical.mockResolvedValue({ status: "legacy_missing" });

    const report = await auditPostSessionReviewSnapshots();

    expect(report).toMatchObject({
      readOnly: true,
      summary: {
        completedWorkoutCount: 1,
        missingRequiredExactCount: 1,
        exactCount: 0,
      },
    });
    expect(report.rows[0]?.issues).toContain(
      "completed_workout_missing_required_exact_snapshot"
    );
    expect(mocks.produceCurrent).not.toHaveBeenCalled();
  });

  it("reports exact integrity and optional current reinterpretation differences", async () => {
    const historicalContract = {
      contractVersion: 1,
      conclusion: "A",
      workoutIdentity: { status: "COMPLETED" },
    };
    mocks.workoutFindMany.mockResolvedValue([
      { id: "workout-1", userId: "user-1", status: "COMPLETED" },
    ]);
    mocks.loadHistorical.mockResolvedValue({
      status: "ready",
      contract: historicalContract,
      metadata: {
        snapshotId: "snapshot-1",
        provenance: "exact",
        contractVersion: 1,
        computationPolicyVersion: 1,
        payloadHash: JSON.stringify(historicalContract),
        evidenceFingerprint: "evidence-hash",
        finalizedAt: "2026-07-14T12:00:00.000Z",
        exactHistoricalInterpretation: true,
      },
    });
    mocks.produceCurrent.mockResolvedValue({
      status: "ready",
      contract: { contractVersion: 1, conclusion: "B" },
    });

    const report = await auditPostSessionReviewSnapshots({
      includeCurrentReinterpretation: true,
    });

    expect(report.summary).toMatchObject({
      exactCount: 1,
      integrityErrorCount: 0,
      currentInterpretationDifferenceCount: 1,
    });
    expect(report.rows[0]).toMatchObject({
      payloadHashValid: true,
      evidenceFingerprintValid: true,
      currentInterpretationDiffers: true,
    });
  });
});
