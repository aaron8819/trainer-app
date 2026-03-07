import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const dismissPendingWeekClose = vi.fn();
  const weekCloseFindFirst = vi.fn();

  const tx = {
    mesocycleWeekClose: {
      findFirst: weekCloseFindFirst,
    },
  };

  const prisma = {
    $transaction: vi.fn(async (callback: (trx: typeof tx) => Promise<unknown>) => callback(tx)),
  };

  return {
    dismissPendingWeekClose,
    weekCloseFindFirst,
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
    dismissPendingWeekClose: mocks.dismissPendingWeekClose,
  };
});

import { POST } from "./route";

describe("POST /api/mesocycles/week-close/[id]/dismiss", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.weekCloseFindFirst.mockResolvedValue({ id: "wc-1" });
    mocks.dismissPendingWeekClose.mockResolvedValue({
      weekCloseId: "wc-1",
      status: "RESOLVED",
      resolution: "GAP_FILL_DISMISSED",
      advancedLifecycle: true,
      outcome: "resolved",
    });
  });

  it("dismisses a pending week-close row once and advances lifecycle once", async () => {
    const response = await POST(
      new Request("http://localhost/api/mesocycles/week-close/wc-1/dismiss", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "wc-1" }) }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      weekCloseId: "wc-1",
      status: "RESOLVED",
      resolution: "GAP_FILL_DISMISSED",
      advancedLifecycle: true,
      outcome: "resolved",
    });
    expect(mocks.dismissPendingWeekClose).toHaveBeenCalledWith(mocks.tx, { weekCloseId: "wc-1" });
  });

  it("treats duplicate dismiss retries as a safe no-op", async () => {
    mocks.dismissPendingWeekClose.mockResolvedValueOnce({
      weekCloseId: "wc-1",
      status: "RESOLVED",
      resolution: "GAP_FILL_DISMISSED",
      advancedLifecycle: false,
      outcome: "already_resolved",
    });

    const response = await POST(
      new Request("http://localhost/api/mesocycles/week-close/wc-1/dismiss", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "wc-1" }) }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      outcome: "already_resolved",
      advancedLifecycle: false,
    });
  });

  it("returns 404 when the user does not own the week-close row", async () => {
    mocks.weekCloseFindFirst.mockResolvedValueOnce(null);

    const response = await POST(
      new Request("http://localhost/api/mesocycles/week-close/wc-missing/dismiss", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "wc-missing" }) }
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: "Week-close window not found",
    });
    expect(mocks.dismissPendingWeekClose).not.toHaveBeenCalled();
  });
});
