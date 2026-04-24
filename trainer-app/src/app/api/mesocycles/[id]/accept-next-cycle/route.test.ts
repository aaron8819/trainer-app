import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const resolveOwner = vi.fn();
  const mesocycleFindFirst = vi.fn();
  const acceptMesocycleHandoff = vi.fn();

  return {
    resolveOwner,
    mesocycleFindFirst,
    acceptMesocycleHandoff,
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
  acceptMesocycleHandoff: (...args: unknown[]) => mocks.acceptMesocycleHandoff(...args),
}));

import { POST } from "./route";

describe("POST /api/mesocycles/[id]/accept-next-cycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveOwner.mockResolvedValue({ id: "user-1" });
  });

  it("accepts a pending handoff and returns the created successor", async () => {
    mocks.mesocycleFindFirst.mockResolvedValue({
      id: "meso-1",
    });
    mocks.acceptMesocycleHandoff.mockResolvedValue({
      id: "meso-2",
      state: "ACTIVE_ACCUMULATION",
      mesoNumber: 2,
    });

    const response = await POST(
      new Request("http://localhost/api/mesocycles/meso-1/accept-next-cycle", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "meso-1" }) }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      priorMesocycleId: "meso-1",
      nextMesocycle: {
        id: "meso-2",
        state: "ACTIVE_ACCUMULATION",
        mesoNumber: 2,
      },
    });
    expect(mocks.acceptMesocycleHandoff).toHaveBeenCalledWith({
      userId: "user-1",
      mesocycleId: "meso-1",
    });
  });

  it("rejects when handoff is not pending", async () => {
    mocks.mesocycleFindFirst.mockResolvedValue({ id: "meso-1" });
    mocks.acceptMesocycleHandoff.mockRejectedValue(new Error("MESOCYCLE_HANDOFF_NOT_PENDING"));

    const response = await POST(
      new Request("http://localhost/api/mesocycles/meso-1/accept-next-cycle", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "meso-1" }) }
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "Mesocycle handoff is not pending.",
    });
  });

  it("allows the handoff owner to recover an inactive pending source by retrying accept", async () => {
    mocks.mesocycleFindFirst.mockResolvedValue({
      id: "meso-1",
      state: "AWAITING_HANDOFF",
      isActive: false,
    });
    mocks.acceptMesocycleHandoff.mockResolvedValue({
      id: "meso-2",
      state: "ACTIVE_ACCUMULATION",
      mesoNumber: 2,
    });

    const response = await POST(
      new Request("http://localhost/api/mesocycles/meso-1/accept-next-cycle", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "meso-1" }) }
    );

    expect(response.status).toBe(200);
    expect(mocks.acceptMesocycleHandoff).toHaveBeenCalledWith({
      userId: "user-1",
      mesocycleId: "meso-1",
    });
  });

  it("surfaces an invalid stored draft", async () => {
    mocks.mesocycleFindFirst.mockResolvedValue({
      id: "meso-1",
    });
    mocks.acceptMesocycleHandoff.mockRejectedValue(
      new Error("MESOCYCLE_HANDOFF_DRAFT_INVALID")
    );

    const response = await POST(
      new Request("http://localhost/api/mesocycles/meso-1/accept-next-cycle", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "meso-1" }) }
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "Mesocycle handoff draft is invalid.",
    });
  });

  it("surfaces keep-selection conflicts against the edited split", async () => {
    mocks.mesocycleFindFirst.mockResolvedValue({
      id: "meso-1",
    });
    mocks.acceptMesocycleHandoff.mockRejectedValue(
      new Error(
        "MESOCYCLE_HANDOFF_KEEP_SELECTION_CONFLICT:Resolve carry-forward conflicts before accepting the next cycle."
      )
    );

    const response = await POST(
      new Request("http://localhost/api/mesocycles/meso-1/accept-next-cycle", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "meso-1" }) }
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "Resolve carry-forward conflicts before accepting the next cycle.",
    });
  });
});
