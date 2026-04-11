import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const dismissCloseoutSession = vi.fn();
  const tx = {};
  const prisma = {
    $transaction: vi.fn(async (callback: (trx: typeof tx) => Promise<unknown>) => callback(tx)),
  };

  return {
    dismissCloseoutSession,
    tx,
    prisma,
  };
});

vi.mock("@/lib/db/prisma", () => ({
  prisma: mocks.prisma,
}));

vi.mock("@/lib/api/workout-context", () => ({
  resolveOwner: vi.fn(async () => ({ id: "user-1" })),
}));

vi.mock("@/lib/api/mesocycle-week-close", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/mesocycle-week-close")>();
  return {
    ...actual,
    dismissCloseoutSession: mocks.dismissCloseoutSession,
  };
});

import { POST } from "./route";

describe("POST /api/workouts/[id]/dismiss-closeout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dismissCloseoutSession.mockResolvedValue({
      id: "workout-closeout-1",
      status: "PLANNED",
      selectionMetadata: {
        closeoutDismissed: true,
      },
      revision: 2,
      outcome: "dismissed",
    });
  });

  it("marks the closeout as dismissed through the week-close seam", async () => {
    const response = await POST(
      new Request("http://localhost/api/workouts/workout-closeout-1/dismiss-closeout", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "workout-closeout-1" }) }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      workoutId: "workout-closeout-1",
      status: "PLANNED",
      revision: 2,
      outcome: "dismissed",
      closeoutDismissed: true,
    });
    expect(mocks.dismissCloseoutSession).toHaveBeenCalledWith(mocks.tx, {
      userId: "user-1",
      workoutId: "workout-closeout-1",
    });
  });

  it("returns 409 when the workout is not a planned closeout", async () => {
    mocks.dismissCloseoutSession.mockRejectedValueOnce(
      new Error("CLOSEOUT_DISMISSAL_REQUIRES_PLANNED")
    );

    const response = await POST(
      new Request("http://localhost/api/workouts/workout-closeout-1/dismiss-closeout", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "workout-closeout-1" }) }
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Only planned closeout workouts can be dismissed.",
    });
  });
});
