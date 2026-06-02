import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveOwner: vi.fn(),
  loadCompletedWorkoutReviewReadModel: vi.fn(),
}));

vi.mock("@/lib/api/workout-context", () => ({
  resolveOwner: (...args: unknown[]) => mocks.resolveOwner(...args),
}));

vi.mock("@/lib/api/completed-workout-review", () => ({
  loadCompletedWorkoutReviewReadModel: (...args: unknown[]) =>
    mocks.loadCompletedWorkoutReviewReadModel(...args),
}));

import { GET } from "./route";

describe("GET /api/workouts/[id]/post-session-review", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveOwner.mockResolvedValue({ id: "user-1" });
    mocks.loadCompletedWorkoutReviewReadModel.mockResolvedValue({
      postSessionReview: null,
    });
  });

  it("returns the app-owned post-session review display DTO", async () => {
    mocks.loadCompletedWorkoutReviewReadModel.mockResolvedValue({
      postSessionReview: {
        status: "reviewed",
        headline: "Post-session review ready",
        summaryBullets: ["Completed planned work", "No seed or plan changes made"],
        completion: null,
        exerciseChanges: [],
        loadCalibration: [],
        nextExposureNotes: [],
        weeklyImpact: [],
        learningSignals: [],
        warnings: [],
        source: {
          ownerSeam: "api/post-session-review-display",
          readOnly: true,
          evidenceOnly: true,
          noMutationNote: "No seed or plan changes made",
        },
      },
    });

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "workout-1" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      postSessionReview: {
        headline: "Post-session review ready",
        source: {
          ownerSeam: "api/post-session-review-display",
          readOnly: true,
        },
      },
    });
    expect(mocks.loadCompletedWorkoutReviewReadModel).toHaveBeenCalledWith(
      "user-1",
      "workout-1"
    );
  });

  it("returns null when the read model has no review", async () => {
    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "workout-1" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ postSessionReview: null });
  });

  it("rejects missing route params", async () => {
    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "" }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Missing workout id" });
    expect(mocks.loadCompletedWorkoutReviewReadModel).not.toHaveBeenCalled();
  });

  it("does not import audit, CLI, artifact, producer, contract, or mutation paths", () => {
    const source = readFileSync(
      "src/app/api/workouts/[id]/post-session-review/route.ts",
      "utf8"
    );

    expect(source).toContain("@/lib/api/completed-workout-review");
    expect(source).not.toContain("@/lib/audit/workout-audit");
    expect(source).not.toContain("workout-audit-cli");
    expect(source).not.toContain("scripts/workout-audit");
    expect(source).not.toContain("artifacts/audits");
    expect(source).not.toContain("post-session-review-contract");
    expect(source).not.toContain("post-session-review-evidence");
    expect(source).not.toContain("post-session-review-producer");
    expect(source).not.toContain("prisma.");
    expect(source).not.toContain("create(");
    expect(source).not.toContain("update(");
    expect(source).not.toContain("upsert(");
    expect(source).not.toContain("delete(");
  });
});
