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

  it("builds next-session context from ownerEmail and derived next intent", async () => {
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
      mode: "next-session",
      ownerEmail: "owner@test.local",
    });

    expect(context.userId).toBe("user-1");
    expect(context.generationInput.intent).toBe("pull");
    expect(context.plannerDiagnosticsMode).toBe("standard");
    expect(context.nextSession?.source).toBe("rotation");
  });

  it("throws for intent-preview when intent is missing", async () => {
    await expect(
      buildWorkoutAuditContext({
        mode: "intent-preview",
        userId: "user-1",
      })
    ).rejects.toThrow("intent-preview mode requires intent");
  });

  it("uses explicit debug diagnostics mode for intent-preview", async () => {
    const context = await buildWorkoutAuditContext({
      mode: "intent-preview",
      userId: "user-1",
      intent: "push",
      plannerDiagnosticsMode: "debug",
    });

    expect(context.mode).toBe("intent-preview");
    expect(context.generationInput.intent).toBe("push");
    expect(context.plannerDiagnosticsMode).toBe("debug");
  });
});
