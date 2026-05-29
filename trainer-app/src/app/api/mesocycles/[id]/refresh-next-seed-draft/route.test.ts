import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const resolveOwner = vi.fn();
  const mesocycleFindFirst = vi.fn();
  const refreshMesocycleHandoffNextSeedDraftFromV2 = vi.fn();

  return {
    resolveOwner,
    mesocycleFindFirst,
    refreshMesocycleHandoffNextSeedDraftFromV2,
    prisma: {
      mesocycle: {
        findFirst: mesocycleFindFirst,
      },
    },
  };
});

vi.mock("@/lib/api/workout-context", () => ({
  resolveOwner: (...args: unknown[]) => mocks.resolveOwner(...args),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: mocks.prisma,
}));

vi.mock("@/lib/api/mesocycle-handoff", () => ({
  refreshMesocycleHandoffNextSeedDraftFromV2: (...args: unknown[]) =>
    mocks.refreshMesocycleHandoffNextSeedDraftFromV2(...args),
}));

import { POST } from "./route";

describe("POST /api/mesocycles/[id]/refresh-next-seed-draft", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveOwner.mockResolvedValue({ id: "user-1" });
    mocks.mesocycleFindFirst.mockResolvedValue({
      id: "meso-1",
      state: "AWAITING_HANDOFF",
    });
    mocks.refreshMesocycleHandoffNextSeedDraftFromV2.mockResolvedValue({
      handoff: { mesocycleId: "meso-1" },
      seedDraft: {
        source: "v2_materialized_seed",
        slotCount: 4,
        exerciseCount: 12,
        parserCompatible: true,
        minimalExecutableRowsOnly: true,
      },
      v2Preparation: {
        basePlanValidationStatus: "pass_with_warnings",
        materializerStatus: "materialized",
        promotionReadinessStatus: "eligible_for_guarded_write",
        productionGatesMissing: [],
      },
      safety: {
        updatedNextSeedDraftJsonOnly: true,
        successorAccepted: false,
        successorMesocycleCreated: false,
        workoutLogSessionCreated: false,
        runtimeReplayChanged: false,
      },
    });
  });

  it("refreshes an awaiting-handoff draft through the guarded API seam", async () => {
    const response = await POST(
      new Request(
        "http://localhost/api/mesocycles/meso-1/refresh-next-seed-draft",
        { method: "POST" },
      ),
      { params: Promise.resolve({ id: "meso-1" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      seedDraft: {
        source: "v2_materialized_seed",
        parserCompatible: true,
        minimalExecutableRowsOnly: true,
      },
      safety: {
        updatedNextSeedDraftJsonOnly: true,
        successorAccepted: false,
        successorMesocycleCreated: false,
      },
    });
    expect(mocks.refreshMesocycleHandoffNextSeedDraftFromV2).toHaveBeenCalledWith({
      userId: "user-1",
      mesocycleId: "meso-1",
    });
  });

  it("requires owner resolution", async () => {
    mocks.resolveOwner.mockResolvedValue(null);

    const response = await POST(
      new Request(
        "http://localhost/api/mesocycles/meso-1/refresh-next-seed-draft",
        { method: "POST" },
      ),
      { params: Promise.resolve({ id: "meso-1" }) },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: "User not found",
    });
    expect(mocks.refreshMesocycleHandoffNextSeedDraftFromV2).not.toHaveBeenCalled();
  });

  it("rejects owner mismatches before invoking refresh", async () => {
    mocks.mesocycleFindFirst.mockResolvedValue(null);

    const response = await POST(
      new Request(
        "http://localhost/api/mesocycles/meso-1/refresh-next-seed-draft",
        { method: "POST" },
      ),
      { params: Promise.resolve({ id: "meso-1" }) },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: "Mesocycle not found",
    });
    expect(mocks.refreshMesocycleHandoffNextSeedDraftFromV2).not.toHaveBeenCalled();
  });

  it("rejects non-awaiting-handoff sources before invoking refresh", async () => {
    mocks.mesocycleFindFirst.mockResolvedValue({
      id: "meso-1",
      state: "ACTIVE_DELOAD",
    });

    const response = await POST(
      new Request(
        "http://localhost/api/mesocycles/meso-1/refresh-next-seed-draft",
        { method: "POST" },
      ),
      { params: Promise.resolve({ id: "meso-1" }) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "Mesocycle handoff is not pending.",
    });
    expect(mocks.refreshMesocycleHandoffNextSeedDraftFromV2).not.toHaveBeenCalled();
  });

  it("fails closed when V2 materialized seed is not production eligible", async () => {
    mocks.refreshMesocycleHandoffNextSeedDraftFromV2.mockRejectedValue(
      new Error(
        "MESOCYCLE_HANDOFF_V2_DRAFT_REFRESH_BLOCKED:required_lane_coverage_incomplete",
      ),
    );

    const response = await POST(
      new Request(
        "http://localhost/api/mesocycles/meso-1/refresh-next-seed-draft",
        { method: "POST" },
      ),
      { params: Promise.resolve({ id: "meso-1" }) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "V2 materialized seed is not eligible for draft refresh.",
      reason: "required_lane_coverage_incomplete",
    });
  });
});
