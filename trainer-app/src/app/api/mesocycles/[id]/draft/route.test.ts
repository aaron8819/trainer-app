import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const resolveOwner = vi.fn();
  const mesocycleFindFirst = vi.fn();
  const transaction = vi.fn();
  const updateMesocycleHandoffDraftInTransaction = vi.fn();

  return {
    resolveOwner,
    mesocycleFindFirst,
    transaction,
    updateMesocycleHandoffDraftInTransaction,
    prisma: {
      mesocycle: {
        findFirst: mesocycleFindFirst,
      },
      $transaction: transaction,
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
  updateMesocycleHandoffDraftInTransaction: (...args: unknown[]) =>
    mocks.updateMesocycleHandoffDraftInTransaction(...args),
}));

import { PATCH } from "./route";

describe("PATCH /api/mesocycles/[id]/draft", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveOwner.mockResolvedValue({ id: "user-1" });
    mocks.transaction.mockImplementation((callback: (tx: unknown) => Promise<unknown>) =>
      callback({})
    );
    mocks.mesocycleFindFirst.mockResolvedValue({
      id: "meso-1",
      state: "AWAITING_HANDOFF",
    });
  });

  it("saves a valid pending handoff draft", async () => {
    mocks.updateMesocycleHandoffDraftInTransaction.mockResolvedValue({
      mesocycleId: "meso-1",
      mesoNumber: 1,
      focus: "Upper Hypertrophy",
      closedAt: "2026-04-01T00:00:00.000Z",
      summary: { version: 1 },
      draft: { version: 1, structure: { splitType: "UPPER_LOWER" } },
    });

    const response = await PATCH(
      new Request("http://localhost/api/mesocycles/meso-1/draft", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceMesocycleId: "meso-1",
          structure: {
            splitType: "UPPER_LOWER",
            sessionsPerWeek: 4,
            daysPerWeek: 4,
            sequenceMode: "ordered_flexible",
            slots: [
              { slotId: "upper_a", intent: "UPPER" },
              { slotId: "lower_a", intent: "LOWER" },
              { slotId: "upper_b", intent: "UPPER" },
              { slotId: "lower_b", intent: "LOWER" },
            ],
          },
          carryForwardSelections: [
            {
              exerciseId: "bench",
              exerciseName: "Bench Press",
              sessionIntent: "UPPER",
              role: "CORE_COMPOUND",
              action: "keep",
            },
          ],
        }),
      }),
      { params: Promise.resolve({ id: "meso-1" }) }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      handoff: {
        mesocycleId: "meso-1",
      },
    });
    expect(mocks.updateMesocycleHandoffDraftInTransaction).toHaveBeenCalledOnce();
  });

  it("rejects an invalid draft payload", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/mesocycles/meso-1/draft", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceMesocycleId: "meso-1",
          structure: {
            splitType: "UPPER_LOWER",
            sessionsPerWeek: 4,
            daysPerWeek: 2,
            sequenceMode: "ordered_flexible",
            slots: [],
          },
          carryForwardSelections: [],
        }),
      }),
      { params: Promise.resolve({ id: "meso-1" }) }
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Draft payload is invalid.",
    });
  });

  it("surfaces keep-selection conflicts against the edited split", async () => {
    mocks.updateMesocycleHandoffDraftInTransaction.mockRejectedValue(
      new Error(
        "MESOCYCLE_HANDOFF_KEEP_SELECTION_CONFLICT:Resolve carry-forward conflicts before accepting the next cycle."
      )
    );

    const response = await PATCH(
      new Request("http://localhost/api/mesocycles/meso-1/draft", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceMesocycleId: "meso-1",
          structure: {
            splitType: "PPL",
            sessionsPerWeek: 3,
            daysPerWeek: 3,
            sequenceMode: "ordered_flexible",
            slots: [
              { slotId: "push_a", intent: "PUSH" },
              { slotId: "pull_a", intent: "PULL" },
              { slotId: "legs_a", intent: "LEGS" },
            ],
          },
          carryForwardSelections: [
            {
              exerciseId: "bench",
              exerciseName: "Bench Press",
              sessionIntent: "UPPER",
              role: "CORE_COMPOUND",
              action: "keep",
            },
          ],
        }),
      }),
      { params: Promise.resolve({ id: "meso-1" }) }
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "Resolve carry-forward conflicts before accepting the next cycle.",
    });
  });
});
