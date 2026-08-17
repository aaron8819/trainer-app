import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  saveDraft: vi.fn(),
  provisionOwner: vi.fn(),
}));

vi.mock("@/lib/api/hypertrophy-plan-drafts", () => ({
  saveHypertrophyPlanDraft: mocks.saveDraft,
}));
vi.mock("@/lib/api/workout-context", () => ({
  provisionOwnerForMutation: mocks.provisionOwner,
}));
vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/operations/custom-hypertrophy-plan-rollout-http", () => ({
  customHypertrophyPlanRolloutUnavailableResponse: vi.fn(() => null),
}));
vi.mock("@/lib/operations/production-write-gate-http", () => ({
  productionWritePauseResponse: vi.fn(() => null),
}));

import { PATCH } from "./route";

const requestBody = {
  expectedRevision: 1,
  name: "Draft",
  draft: {
    version: 1,
    settings: { equipmentProfile: "FULL_GYM", sessionDurationMinutes: 60 },
    sessions: [
      { slotId: "upper", name: "Upper", focus: "UPPER", exercises: [] },
      { slotId: "lower", name: "Lower", focus: "LOWER", exercises: [] },
    ],
  },
};

describe("PATCH /api/plans/[id]/draft", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.provisionOwner.mockResolvedValue({ id: "user-1" });
    mocks.saveDraft.mockResolvedValue({
      revision: 2,
      updatedAt: "2026-08-15T12:00:00.000Z",
      health: {
        status: "AVAILABLE",
        policyVersion: "draft-plan-health.v2",
        draftId: "plan-1",
        draftRevision: 2,
        confirmationScope: `plan-health-confirmation.v1.${"2".repeat(64)}`,
        evaluatedWeek: 1,
        summary: {
          blockingSafety: 2,
          importantWarnings: 0,
          coachingObservations: 0,
          informationalVolumeAvailable: false,
        },
        issues: [],
        volumeEstimates: [],
        sessionEstimates: [],
        evaluatedFacts: {
          catalogExerciseCount: 150,
          equipmentProfile: "FULL_GYM",
          recognizedLimitationCount: 0,
          unrecognizedLimitationsPresent: false,
        },
      },
    });
  });

  it("returns revision-bound Health from the authoritative save orchestration", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/plans/plan-1/draft", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      }),
      { params: Promise.resolve({ id: "plan-1" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      revision: 2,
      health: {
        status: "AVAILABLE",
        draftId: "plan-1",
        draftRevision: 2,
      },
    });
    expect(mocks.saveDraft).toHaveBeenCalledWith({
      userId: "user-1",
      planId: "plan-1",
      ...requestBody,
    });
  });
});
