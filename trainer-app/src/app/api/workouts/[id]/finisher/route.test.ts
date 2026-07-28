import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class MockFinisherServiceError extends Error {
    constructor(
      public readonly code: string,
      public readonly status: number
    ) {
      super(code);
    }
  }
  return {
    FinisherServiceError: MockFinisherServiceError,
    resolveOwner: vi.fn(),
    getFinisherOffer: vi.fn(),
    pauseFinisher: vi.fn(),
    selectFinisher: vi.fn(),
    startFinisher: vi.fn(),
    dismissSelectedFinisher: vi.fn(),
    resumeFinisher: vi.fn(),
    skipFinisherStep: vi.fn(),
    substituteFinisherStep: vi.fn(),
    endFinisher: vi.fn(),
    recordFinisherFeedback: vi.fn(),
  };
});

vi.mock("@/lib/api/workout-context", () => ({
  resolveOwner: mocks.resolveOwner,
}));

vi.mock("@/lib/operations/production-write-gate-http", () => ({
  productionWritePauseResponse: vi.fn(() => null),
}));

vi.mock("@/lib/api/finisher-service", () => {
  return {
    FinisherServiceError: mocks.FinisherServiceError,
    getFinisherOffer: mocks.getFinisherOffer,
    pauseFinisher: mocks.pauseFinisher,
    selectFinisher: mocks.selectFinisher,
    startFinisher: mocks.startFinisher,
    dismissSelectedFinisher: mocks.dismissSelectedFinisher,
    resumeFinisher: mocks.resumeFinisher,
    skipFinisherStep: mocks.skipFinisherStep,
    substituteFinisherStep: mocks.substituteFinisherStep,
    endFinisher: mocks.endFinisher,
    recordFinisherFeedback: mocks.recordFinisherFeedback,
  };
});

import { GET, POST } from "./route";
import { FinisherServiceError } from "@/lib/api/finisher-service";

const context = {
  params: Promise.resolve({ id: "workout-1" }),
};
const offer = {
  routines: [],
  recommendation: null,
  recommendationUnavailableReason: null,
  execution: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveOwner.mockResolvedValue({ id: "owner-1" });
  mocks.getFinisherOffer.mockResolvedValue(offer);
});

describe("/api/workouts/[id]/finisher", () => {
  it("loads only through canonical owner and workout context", async () => {
    const response = await GET(new Request("http://local.test"), context);
    expect(response.status).toBe(200);
    expect(mocks.getFinisherOffer).toHaveBeenCalledWith({
      userId: "owner-1",
      workoutId: "workout-1",
    });
  });

  it("rejects invalid action payloads before service mutation", async () => {
    const response = await POST(
      new Request("http://local.test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "substitute", alternativeId: "free form" }),
      }),
      context
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "INVALID_REQUEST" });
    expect(mocks.substituteFinisherStep).not.toHaveBeenCalled();
  });

  it("requires and forwards the optimistic execution revision", async () => {
    const response = await POST(
      new Request("http://local.test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "pause", expectedRevision: 7 }),
      }),
      context
    );
    expect(response.status).toBe(200);
    expect(mocks.pauseFinisher).toHaveBeenCalledWith({
      userId: "owner-1",
      workoutId: "workout-1",
      action: "pause",
      expectedRevision: 7,
    });
  });

  it("returns deterministic service conflict codes", async () => {
    mocks.pauseFinisher.mockRejectedValue(
      new FinisherServiceError("FINISHER_STALE_TRANSITION", 409)
    );
    const response = await POST(
      new Request("http://local.test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "pause", expectedRevision: 7 }),
      }),
      context
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "FINISHER_STALE_TRANSITION",
      code: "FINISHER_STALE_TRANSITION",
    });
  });
});
