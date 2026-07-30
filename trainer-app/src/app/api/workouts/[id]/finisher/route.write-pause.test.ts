import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class MockFinisherServiceError extends Error {
    constructor(
      public readonly code: string,
      public readonly status: number,
    ) {
      super(code);
    }
  }
  return {
    FinisherServiceError: MockFinisherServiceError,
    findOwnerReadOnly: vi.fn(),
    resolveOwner: vi.fn(),
    getFinisherOffer: vi.fn(),
    syncFinisher: vi.fn(),
  };
});
vi.mock("@/lib/api/workout-context", () => ({
  findOwnerReadOnly: mocks.findOwnerReadOnly,
  resolveOwner: mocks.resolveOwner,
}));

vi.mock("@/lib/api/finisher-service", () => ({
  FinisherServiceError: mocks.FinisherServiceError,
  getFinisherOffer: mocks.getFinisherOffer,
  syncFinisher: mocks.syncFinisher,
  dismissSelectedFinisher: vi.fn(),
  endFinisher: vi.fn(),
  pauseFinisher: vi.fn(),
  recordFinisherFeedback: vi.fn(),
  resumeFinisher: vi.fn(),
  selectFinisher: vi.fn(),
  skipFinisherStep: vi.fn(),
  startFinisher: vi.fn(),
  substituteFinisherStep: vi.fn(),
}));

import { GET, POST } from "./route";

const context = {
  params: Promise.resolve({ id: "workout-1" }),
};

describe("Finisher route during the production write pause", () => {
  const originalPause = process.env.TRAINER_WRITE_PAUSE;
  const originalRollout = process.env.TRAINER_FINISHERS_ROLLOUT;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TRAINER_WRITE_PAUSE = "enabled";
    process.env.TRAINER_FINISHERS_ROLLOUT = "enabled";
    mocks.findOwnerReadOnly.mockResolvedValue({ id: "owner-1" });
    mocks.getFinisherOffer.mockResolvedValue({
      serverTime: "2026-07-28T12:00:45.000Z",
      routines: [],
      recommendation: null,
      recommendationUnavailableReason: null,
      execution: {
        state: "IN_PROGRESS",
        timer: {
          segment: "RECOVERY",
          revision: 4,
          syncRequired: true,
        },
      },
    });
  });

  afterEach(() => {
    if (originalPause == null) {
      delete process.env.TRAINER_WRITE_PAUSE;
    } else {
      process.env.TRAINER_WRITE_PAUSE = originalPause;
    }
    if (originalRollout == null) {
      delete process.env.TRAINER_FINISHERS_ROLLOUT;
    } else {
      process.env.TRAINER_FINISHERS_ROLLOUT = originalRollout;
    }
  });

  it("allows an elapsed GET projection without resolving a mutating owner", async () => {
    const response = await GET(new Request("http://local.test"), context);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      execution: {
        state: "IN_PROGRESS",
        timer: { segment: "RECOVERY", syncRequired: true },
      },
    });
    expect(mocks.getFinisherOffer).toHaveBeenCalledTimes(1);
    expect(mocks.resolveOwner).not.toHaveBeenCalled();
    expect(mocks.syncFinisher).not.toHaveBeenCalled();
  });

  it("uses the canonical rollout decision before owner or Finisher service access", async () => {
    delete process.env.TRAINER_FINISHERS_ROLLOUT;

    const getResponse = await GET(new Request("http://local.test"), context);
    const postResponse = await POST(
      new Request("http://local.test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "sync" }),
      }),
      context,
    );

    expect(getResponse.status).toBe(503);
    expect(postResponse.status).toBe(503);
    await expect(getResponse.json()).resolves.toMatchObject({
      code: "FINISHERS_NOT_ENABLED",
    });
    await expect(postResponse.json()).resolves.toMatchObject({
      code: "FINISHERS_NOT_ENABLED",
    });
    expect(mocks.findOwnerReadOnly).not.toHaveBeenCalled();
    expect(mocks.resolveOwner).not.toHaveBeenCalled();
    expect(mocks.getFinisherOffer).not.toHaveBeenCalled();
    expect(mocks.syncFinisher).not.toHaveBeenCalled();
  });

  it("blocks the explicit synchronization mutation before any service write", async () => {
    const response = await POST(
      new Request("http://local.test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "sync", expectedRevision: 4 }),
      }),
      context,
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code: "PRODUCTION_WRITE_PAUSED",
    });
    expect(mocks.resolveOwner).not.toHaveBeenCalled();
    expect(mocks.syncFinisher).not.toHaveBeenCalled();
  });
});
