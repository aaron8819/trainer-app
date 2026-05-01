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

  it("builds current-week-audit context through the projected-week path without loading next-session", async () => {
    const context = await buildWorkoutAuditContext({
      mode: "current-week-audit",
      userId: "user-1",
      plannerDiagnosticsMode: "debug",
    });

    expect(context).toMatchObject({
      mode: "current-week-audit",
      requestedMode: "current-week-audit",
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

  it("builds v2 accepted-seed prepare compare context without loading next-session intent", async () => {
    const context = await buildWorkoutAuditContext({
      mode: "v2-accepted-seed-prepare-compare",
      userId: "user-1",
      mesocycleId: "meso-1",
      plannerDiagnosticsMode: "debug",
    });

    expect(context).toMatchObject({
      mode: "v2-accepted-seed-prepare-compare",
      requestedMode: "v2-accepted-seed-prepare-compare",
      userId: "user-1",
      plannerDiagnosticsMode: "debug",
      v2AcceptedSeedPrepareCompare: {
        mesocycleId: "meso-1",
        requestedIdSource: "mesocycle_id",
      },
    });
    expect(mocks.loadNextWorkoutContext).not.toHaveBeenCalled();
  });

  it("builds mesocycle-explain context without loading next-session intent", async () => {
    const context = await buildWorkoutAuditContext({
      mode: "mesocycle-explain",
      userId: "user-1",
      sourceMesocycleId: "meso-source",
      retrospectiveMesocycleId: "meso-retro",
      plannerDiagnosticsMode: "debug",
    });

    expect(context).toMatchObject({
      mode: "mesocycle-explain",
      requestedMode: "mesocycle-explain",
      userId: "user-1",
      plannerDiagnosticsMode: "debug",
      mesocycleExplain: {
        sourceMesocycleId: "meso-source",
        retrospectiveMesocycleId: "meso-retro",
      },
    });
    expect(mocks.loadNextWorkoutContext).not.toHaveBeenCalled();
  });

  it("passes planner-only dry-run comparison flags only for mesocycle-explain", async () => {
    const context = await buildWorkoutAuditContext({
      mode: "mesocycle-explain",
      userId: "user-1",
      plannerOnlyDryRun: true,
      compareRepaired: true,
    });

    expect(context.mesocycleExplain?.plannerOnlyDryRun).toEqual({
      enabled: true,
      compareRepaired: true,
      plannerOnlyPolicyOverride: {
        id: "calves_4_4_lower_slot_allocation",
        readOnly: true,
        appliesOnlyTo: "planner_only_dry_run",
        slots: [
          {
            slotId: "lower_a",
            muscle: "Calves",
            targetEffectiveSets: 4,
            maxDirectExercises: 1,
            preferredExerciseClass: "calf_raise",
          },
          {
            slotId: "lower_b",
            muscle: "Calves",
            targetEffectiveSets: 4,
            maxDirectExercises: 1,
            preferredExerciseClass: "calf_raise",
          },
        ],
      },
    });
    expect(mocks.loadNextWorkoutContext).not.toHaveBeenCalled();
  });

  it("requires compare-repaired for the first planner-only dry-run implementation", async () => {
    await expect(
      buildWorkoutAuditContext({
        mode: "mesocycle-explain",
        userId: "user-1",
        plannerOnlyDryRun: true,
      }),
    ).rejects.toThrow("--planner-only-dry-run currently requires --compare-repaired");
  });

  it("passes planner-only no-repair only for flagged mesocycle-explain runs", async () => {
    const normalContext = await buildWorkoutAuditContext({
      mode: "mesocycle-explain",
      userId: "user-1",
    });
    const flaggedContext = await buildWorkoutAuditContext({
      mode: "mesocycle-explain",
      userId: "user-1",
      plannerOnlyNoRepair: true,
      compareRepaired: true,
    });

    expect(normalContext.mesocycleExplain?.plannerOnlyNoRepair).toBeUndefined();
    expect(flaggedContext.mesocycleExplain?.plannerOnlyNoRepair).toEqual({
      enabled: true,
      compareRepaired: true,
    });
  });

  it("passes v2 debug artifact only with planner-only no-repair mesocycle-explain", async () => {
    const context = await buildWorkoutAuditContext({
      mode: "mesocycle-explain",
      userId: "user-1",
      plannerOnlyNoRepair: true,
      compareRepaired: true,
      v2DebugArtifact: true,
    });

    expect(context.mesocycleExplain?.plannerOnlyNoRepair).toEqual({
      enabled: true,
      compareRepaired: true,
      v2DebugArtifact: true,
    });
  });

  it("rejects planner-only no-repair outside mesocycle-explain", async () => {
    await expect(
      buildWorkoutAuditContext({
        mode: "future-week",
        userId: "user-1",
        plannerOnlyNoRepair: true,
      }),
    ).rejects.toThrow("--planner-only-no-repair requires --mode mesocycle-explain");
  });

  it("rejects v2 debug artifact outside mesocycle-explain", async () => {
    await expect(
      buildWorkoutAuditContext({
        mode: "future-week",
        userId: "user-1",
        plannerOnlyNoRepair: true,
        v2DebugArtifact: true,
      }),
    ).rejects.toThrow("--v2-debug-artifact requires --mode mesocycle-explain");
  });

  it("rejects v2 debug artifact without planner-only no-repair", async () => {
    await expect(
      buildWorkoutAuditContext({
        mode: "mesocycle-explain",
        userId: "user-1",
        v2DebugArtifact: true,
      }),
    ).rejects.toThrow("--v2-debug-artifact requires --planner-only-no-repair");
  });
});
