import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const resolveOwner = vi.fn();
  const mesocycleFindFirst = vi.fn();
  const loadMesocycleSetupPreviewFromPrisma = vi.fn();

  return {
    resolveOwner,
    mesocycleFindFirst,
    loadMesocycleSetupPreviewFromPrisma,
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

vi.mock("@/lib/api/mesocycle-setup", () => ({
  loadMesocycleSetupPreviewFromPrisma: (...args: unknown[]) =>
    mocks.loadMesocycleSetupPreviewFromPrisma(...args),
}));

import { POST } from "./route";

describe("POST /api/mesocycles/[id]/setup-preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveOwner.mockResolvedValue({ id: "user-1" });
    mocks.mesocycleFindFirst.mockResolvedValue({
      id: "meso-1",
      state: "AWAITING_HANDOFF",
    });
  });

  it("returns the canonical server preview for a valid draft", async () => {
    mocks.loadMesocycleSetupPreviewFromPrisma.mockResolvedValue({
      summary: {
        title: "Meso 2 - Upper Hypertrophy",
        focus: "Upper Hypertrophy",
        mesoNumber: 2,
        splitType: "UPPER_LOWER",
        sessionsPerWeek: 4,
        daysPerWeek: 4,
        slotSequence: [],
        keepCount: 1,
        rotateCount: 1,
        dropCount: 0,
      },
      slotPlanProjection: {
        slotPlans: [
          {
            slotId: "upper_a",
            intent: "UPPER",
            exercises: [{ exerciseId: "bench", role: "CORE_COMPOUND" }],
          },
        ],
      },
      display: {
        projectedSlotPlans: [
          {
            slotId: "upper_a",
            intent: "UPPER",
            label: "Upper 1",
            exercises: [
              {
                exerciseId: "bench",
                exerciseName: "Bench Press",
                role: "CORE_COMPOUND",
              },
            ],
          },
        ],
      },
      slotPlanError: null,
    });

    const response = await POST(
      new Request("http://localhost/api/mesocycles/meso-1/setup-preview", {
        method: "POST",
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
      preview: {
        slotPlanProjection: {
          slotPlans: [
            {
              slotId: "upper_a",
              intent: "UPPER",
              exercises: [{ exerciseId: "bench", role: "CORE_COMPOUND" }],
            },
          ],
        },
        display: {
          projectedSlotPlans: [
            {
              label: "Upper 1",
            },
          ],
        },
      },
    });
    expect(mocks.loadMesocycleSetupPreviewFromPrisma).toHaveBeenCalledWith({
      userId: "user-1",
      mesocycleId: "meso-1",
      draft: expect.objectContaining({
        sourceMesocycleId: "meso-1",
      }),
    });
  });

  it("rejects an invalid preview draft payload", async () => {
    const response = await POST(
      new Request("http://localhost/api/mesocycles/meso-1/setup-preview", {
        method: "POST",
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

  it("surfaces canonical keep-selection conflicts for preview refreshes", async () => {
    mocks.loadMesocycleSetupPreviewFromPrisma.mockRejectedValue(
      new Error(
        "MESOCYCLE_HANDOFF_KEEP_SELECTION_CONFLICT:Resolve carry-forward conflicts before accepting the next cycle."
      )
    );

    const response = await POST(
      new Request("http://localhost/api/mesocycles/meso-1/setup-preview", {
        method: "POST",
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
