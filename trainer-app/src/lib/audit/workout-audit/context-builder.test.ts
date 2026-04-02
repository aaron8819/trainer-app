import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const userFindUnique = vi.fn();
  const loadNextWorkoutContext = vi.fn();
  return {
    userFindUnique,
    loadNextWorkoutContext,
    prisma: { user: { findUnique: userFindUnique } },
  };
});

vi.mock("@/lib/db/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/api/next-session", () => ({
  loadNextWorkoutContext: (...args: unknown[]) => mocks.loadNextWorkoutContext(...args),
}));

import { buildWorkoutAuditContext } from "./context-builder";

describe("buildWorkoutAuditContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds future-week context from ownerEmail and derived next intent", async () => {
    mocks.userFindUnique.mockResolvedValue({ id: "user-1", email: "owner@test.local" });
    mocks.loadNextWorkoutContext.mockResolvedValue({
      intent: "pull",
      existingWorkoutId: null,
      isExisting: false,
      source: "rotation",
      weekInMeso: 2,
      sessionInWeek: 2,
      derivationTrace: [],
      selectedIncompleteStatus: null,
    });

    const context = await buildWorkoutAuditContext({
      mode: "future-week",
      ownerEmail: "owner@test.local",
    });

    expect(context.userId).toBe("user-1");
    expect(context.generationInput!.intent).toBe("pull");
    expect(context.plannerDiagnosticsMode).toBe("standard");
    expect(context.nextSession?.source).toBe("rotation");
  });

  it("uses explicit debug diagnostics mode for future-week with an explicit intent", async () => {
    const context = await buildWorkoutAuditContext({
      mode: "future-week",
      userId: "user-1",
      intent: "push",
      plannerDiagnosticsMode: "debug",
    });

    expect(context.mode).toBe("future-week");
    expect(context.requestedMode).toBe("future-week");
    expect(context.generationInput!.intent).toBe("push");
    expect(context.generationInput!.source).toBe("explicit-intent");
    expect(context.plannerDiagnosticsMode).toBe("debug");
  });

  it("builds projected-week-volume context without requiring next-session intent derivation", async () => {
    const context = await buildWorkoutAuditContext({
      mode: "projected-week-volume",
      userId: "user-1",
      plannerDiagnosticsMode: "debug",
    });

    expect(context).toMatchObject({
      mode: "projected-week-volume",
      requestedMode: "projected-week-volume",
      userId: "user-1",
      plannerDiagnosticsMode: "debug",
      projectedWeekVolume: {
        enabled: true,
      },
    });
    expect(mocks.loadNextWorkoutContext).not.toHaveBeenCalled();
  });

  it("builds weekly-retro context from explicit week and mesocycle inputs without loading next-session", async () => {
    const context = await buildWorkoutAuditContext({
      mode: "weekly-retro",
      userId: "user-1",
      week: 3,
      mesocycleId: "meso-1",
    });

    expect(context).toMatchObject({
      mode: "weekly-retro",
      requestedMode: "weekly-retro",
      userId: "user-1",
      plannerDiagnosticsMode: "standard",
      weeklyRetro: {
        week: 3,
        mesocycleId: "meso-1",
      },
    });
    expect(mocks.loadNextWorkoutContext).not.toHaveBeenCalled();
  });
});
