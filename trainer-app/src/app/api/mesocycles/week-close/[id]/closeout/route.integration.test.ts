import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const createCloseoutSessionForWeek = vi.fn();

  const tx = {};

  const prisma = {
    $transaction: vi.fn(async (callback: (trx: typeof tx) => Promise<unknown>) => callback(tx)),
  };

  return {
    createCloseoutSessionForWeek,
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
    createCloseoutSessionForWeek: mocks.createCloseoutSessionForWeek,
  };
});

import { POST } from "./route";

describe("POST /api/mesocycles/week-close/[id]/closeout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createCloseoutSessionForWeek.mockResolvedValue({
      id: "workout-closeout-1",
      userId: "user-1",
      scheduledDate: new Date("2026-04-09T12:00:00.000Z"),
      status: "PLANNED",
      selectionMode: "MANUAL",
      sessionIntent: null,
      selectionMetadata: {
        weekCloseId: "wc-1",
        sessionDecisionReceipt: {
          version: 1,
          cycleContext: {
            weekInMeso: 4,
            weekInBlock: 2,
            phase: "accumulation",
            blockType: "accumulation",
            isDeload: false,
            source: "computed",
          },
          lifecycleVolume: { source: "unknown" },
          sorenessSuppressedMuscles: [],
          deloadDecision: {
            mode: "none",
            reason: [],
            reductionPercent: 0,
            appliedTo: "none",
          },
          readiness: {
            wasAutoregulated: false,
            signalAgeHours: null,
            fatigueScoreOverall: null,
            intensityScaling: {
              applied: false,
              exerciseIds: [],
              scaledUpCount: 0,
              scaledDownCount: 0,
            },
          },
          exceptions: [
            {
              code: "closeout_session",
              message: "Marked as closeout session.",
            },
          ],
        },
      },
      advancesSplit: false,
      mesocycleId: "meso-1",
      mesocycleWeekSnapshot: 4,
      mesocyclePhaseSnapshot: "ACCUMULATION",
      mesoSessionSnapshot: 4,
      revision: 1,
    });
  });

  it("creates a closeout scaffold workout through the week-close seam", async () => {
    const response = await POST(
      new Request("http://localhost/api/mesocycles/week-close/wc-1/closeout", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "wc-1" }) }
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      workout: expect.objectContaining({
        id: "workout-closeout-1",
        selectionMode: "MANUAL",
        advancesSplit: false,
        mesocycleWeekSnapshot: 4,
      }),
    });
    expect(mocks.createCloseoutSessionForWeek).toHaveBeenCalledWith(mocks.tx, {
      userId: "user-1",
      weekCloseId: "wc-1",
    });
  });

  it("returns 404 when the week-close row is not found for the user", async () => {
    mocks.createCloseoutSessionForWeek.mockRejectedValueOnce(new Error("WEEK_CLOSE_NOT_FOUND"));

    const response = await POST(
      new Request("http://localhost/api/mesocycles/week-close/wc-missing/closeout", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "wc-missing" }) }
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: "Week-close window not found",
    });
  });

  it("returns 409 when a closeout already exists for the active week", async () => {
    mocks.createCloseoutSessionForWeek.mockRejectedValueOnce(
      new Error("CLOSEOUT_ALREADY_EXISTS_FOR_WEEK")
    );

    const response = await POST(
      new Request("http://localhost/api/mesocycles/week-close/wc-1/closeout", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "wc-1" }) }
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "A closeout session already exists for this active week.",
    });
  });
});
