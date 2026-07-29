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
    findOwnerReadOnly: vi.fn(),
    productionWritePauseResponse: vi.fn(),
    createFinisherOffer: vi.fn(),
    declineFinisherOffer: vi.fn(),
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
    syncFinisher: vi.fn(),
  };
});

vi.mock("@/lib/api/workout-context", () => ({
  resolveOwner: mocks.resolveOwner,
  findOwnerReadOnly: mocks.findOwnerReadOnly,
}));

vi.mock("@/lib/operations/production-write-gate-http", () => ({
  productionWritePauseResponse: (...args: unknown[]) =>
    mocks.productionWritePauseResponse(...args),
}));

vi.mock("@/lib/api/finisher-service", () => {
  return {
    FinisherServiceError: mocks.FinisherServiceError,
    createFinisherOffer: mocks.createFinisherOffer,
    declineFinisherOffer: mocks.declineFinisherOffer,
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
    syncFinisher: mocks.syncFinisher,
  };
});

import { GET, POST } from "./route";
import { FinisherServiceError } from "@/lib/api/finisher-service";

const context = {
  params: Promise.resolve({ id: "workout-1" }),
};
const offer = {
  serverTime: "2026-07-28T12:00:00.000Z",
  routines: [],
  recommendation: null,
  recommendationUnavailableReason: null,
  execution: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveOwner.mockResolvedValue({ id: "owner-1" });
  mocks.findOwnerReadOnly.mockResolvedValue({ id: "owner-1" });
  mocks.productionWritePauseResponse.mockReturnValue(null);
  mocks.getFinisherOffer.mockResolvedValue(offer);
  mocks.createFinisherOffer.mockResolvedValue(offer);
});

describe("/api/workouts/[id]/finisher", () => {
  it("loads only through canonical owner and workout context", async () => {
    const response = await GET(new Request("http://local.test"), context);
    expect(response.status).toBe(200);
    expect(mocks.getFinisherOffer).toHaveBeenCalledWith({
      userId: "owner-1",
      workoutId: "workout-1",
    });
    expect(mocks.findOwnerReadOnly).toHaveBeenCalledTimes(1);
    expect(mocks.resolveOwner).not.toHaveBeenCalled();
    expect(mocks.productionWritePauseResponse).not.toHaveBeenCalled();
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

  it("creates the durable offer through the write-gated POST action", async () => {
    const response = await POST(
      new Request("http://local.test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "offer" }),
      }),
      context
    );
    expect(response.status).toBe(200);
    expect(mocks.createFinisherOffer).toHaveBeenCalledWith({
      userId: "owner-1",
      workoutId: "workout-1",
    });
    expect(mocks.getFinisherOffer).not.toHaveBeenCalled();
  });

  it("requires and forwards the optimistic execution revision", async () => {
    const committedResult = {
      serverTime: "2026-07-28T12:00:01.000Z",
      id: "44444444-4444-4444-8444-444444444444",
      revision: 8,
      state: "IN_PROGRESS",
      timer: { segment: "WORK" },
    };
    mocks.pauseFinisher.mockResolvedValue(committedResult);
    mocks.getFinisherOffer.mockResolvedValue({
      ...offer,
      serverTime: "2026-07-28T12:05:00.000Z",
      execution: { ...committedResult, revision: 12, state: "COMPLETED" },
    });
    const response = await POST(
      new Request("http://local.test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "pause",
          executionId: "44444444-4444-4444-8444-444444444444",
          expectedRevision: 7,
          commandId: "55555555-5555-4555-8555-555555555555",
        }),
      }),
      context
    );
    expect(response.status).toBe(200);
    expect(mocks.pauseFinisher).toHaveBeenCalledWith({
      userId: "owner-1",
      workoutId: "workout-1",
      action: "pause",
      executionId: "44444444-4444-4444-8444-444444444444",
      expectedRevision: 7,
      commandId: "55555555-5555-4555-8555-555555555555",
    });
    expect(await response.json()).toEqual(committedResult);
    expect(mocks.getFinisherOffer).not.toHaveBeenCalled();
  });

  it("returns the original committed command result on a lost-response retry", async () => {
    const committedResult = {
      serverTime: "2026-07-28T12:00:01.000Z",
      id: "44444444-4444-4444-8444-444444444444",
      revision: 8,
      state: "IN_PROGRESS",
      timer: { segment: "WORK", currentStepIndex: 0 },
    };
    mocks.syncFinisher.mockResolvedValue(committedResult);
    mocks.getFinisherOffer.mockResolvedValue({
      ...offer,
      serverTime: "2026-07-28T12:10:00.000Z",
      execution: { ...committedResult, revision: 14, state: "COMPLETED" },
    });
    const requestBody = {
      action: "sync",
      executionId: committedResult.id,
      expectedRevision: 7,
      commandId: "55555555-5555-4555-8555-555555555555",
    };

    const original = await POST(
      new Request("http://local.test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(requestBody),
      }),
      context,
    );
    const retry = await POST(
      new Request("http://local.test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(requestBody),
      }),
      context,
    );

    expect(await original.json()).toEqual(committedResult);
    expect(await retry.json()).toEqual(committedResult);
    expect(mocks.getFinisherOffer).not.toHaveBeenCalled();
  });

  it("blocks synchronization before resolving an owner during a production write pause", async () => {
    mocks.productionWritePauseResponse.mockReturnValue(
      new Response(
        JSON.stringify({
          error: "Production writes are paused",
          code: "PRODUCTION_WRITE_PAUSED",
        }),
        {
          status: 503,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const response = await POST(
      new Request("http://local.test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "sync", expectedRevision: 7 }),
      }),
      context,
    );

    expect(response.status).toBe(503);
    expect(mocks.resolveOwner).not.toHaveBeenCalled();
    expect(mocks.syncFinisher).not.toHaveBeenCalled();
  });

  it("returns deterministic service conflict codes", async () => {
    mocks.pauseFinisher.mockRejectedValue(
      new FinisherServiceError("FINISHER_STALE_TRANSITION", 409)
    );
    const response = await POST(
      new Request("http://local.test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "pause",
          executionId: "44444444-4444-4444-8444-444444444444",
          expectedRevision: 7,
          commandId: "55555555-5555-4555-8555-555555555555",
        }),
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
