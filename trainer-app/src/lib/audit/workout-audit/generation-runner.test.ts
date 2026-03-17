import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkoutAuditContext } from "./types";

const mocks = vi.hoisted(() => {
  const loadActiveMesocycle = vi.fn();
  const generateSessionFromIntent = vi.fn();
  const generateDeloadSessionFromIntent = vi.fn();
  return {
    loadActiveMesocycle,
    generateSessionFromIntent,
    generateDeloadSessionFromIntent,
  };
});

vi.mock("@/lib/api/mesocycle-lifecycle", () => ({
  loadActiveMesocycle: (...args: unknown[]) => mocks.loadActiveMesocycle(...args),
}));

vi.mock("@/lib/api/template-session", () => ({
  generateSessionFromIntent: (...args: unknown[]) => mocks.generateSessionFromIntent(...args),
  generateDeloadSessionFromIntent: (...args: unknown[]) =>
    mocks.generateDeloadSessionFromIntent(...args),
}));

import { runWorkoutAuditGeneration } from "./generation-runner";

const okGenerationResult = {
  workout: {
    id: "w1",
    scheduledDate: "2026-03-04",
    warmup: [],
    mainLifts: [],
    accessories: [],
    estimatedMinutes: 45,
  },
  selectionMode: "INTENT" as const,
  sessionIntent: "push" as const,
  sraWarnings: [],
  substitutions: [],
  volumePlanByMuscle: {},
  selection: {
    selectedExerciseIds: [],
    mainLiftIds: [],
    accessoryIds: [],
    perExerciseSetTargets: {},
    rationale: {},
    volumePlanByMuscle: {},
  },
};

describe("runWorkoutAuditGeneration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadActiveMesocycle.mockResolvedValue({ state: "ACTIVE_ACCUMULATION" });
    mocks.generateSessionFromIntent.mockResolvedValue(okGenerationResult);
    mocks.generateDeloadSessionFromIntent.mockResolvedValue(okGenerationResult);
  });

  it("forwards standard diagnostics mode for derived future-week path", async () => {
    const context: WorkoutAuditContext = {
      mode: "future-week",
      requestedMode: "future-week",
      userId: "user-1",
      plannerDiagnosticsMode: "standard",
      generationInput: { intent: "legs" },
      nextSession: {
        intent: "legs",
        slotId: "legs_a",
        slotSequenceIndex: 2,
        slotSource: "legacy_weekly_schedule",
        existingWorkoutId: null,
        isExisting: false,
        source: "rotation",
        weekInMeso: 2,
        sessionInWeek: 3,
        derivationTrace: [],
        selectedIncompleteStatus: null,
      },
    };

    await runWorkoutAuditGeneration(context);

    expect(mocks.generateSessionFromIntent).toHaveBeenCalledWith("user-1", {
      intent: "legs",
      targetMuscles: undefined,
      plannerDiagnosticsMode: "standard",
    });
  });

  it("forwards debug diagnostics mode for explicit-intent future-week path", async () => {
    const context: WorkoutAuditContext = {
      mode: "future-week",
      requestedMode: "future-week",
      userId: "user-1",
      plannerDiagnosticsMode: "debug",
      generationInput: { intent: "push", targetMuscles: ["Chest"] },
    };

    await runWorkoutAuditGeneration(context);

    expect(mocks.generateSessionFromIntent).toHaveBeenCalledWith("user-1", {
      intent: "push",
      targetMuscles: ["Chest"],
      plannerDiagnosticsMode: "debug",
    });
  });

  it("uses deload generation path when active mesocycle is deload", async () => {
    mocks.loadActiveMesocycle.mockResolvedValue({ state: "ACTIVE_DELOAD" });
    const context: WorkoutAuditContext = {
      mode: "future-week",
      requestedMode: "future-week",
      userId: "user-1",
      plannerDiagnosticsMode: "debug",
      generationInput: { intent: "legs" },
      nextSession: {
        intent: "legs",
        slotId: "legs_a",
        slotSequenceIndex: 0,
        slotSource: "legacy_weekly_schedule",
        existingWorkoutId: "w-in-progress",
        isExisting: true,
        source: "existing_incomplete",
        weekInMeso: 5,
        sessionInWeek: 1,
        derivationTrace: [],
        selectedIncompleteStatus: "in_progress",
      },
    };

    const run = await runWorkoutAuditGeneration(context);

    expect(mocks.generateDeloadSessionFromIntent).toHaveBeenCalledWith("user-1", {
      intent: "legs",
      targetMuscles: undefined,
      plannerDiagnosticsMode: "debug",
    });
    expect(mocks.generateSessionFromIntent).not.toHaveBeenCalled();
    expect(run.generationPath).toEqual({
      requestedMode: "future-week",
      executionMode: "active_deload_reroute",
      generator: "generateDeloadSessionFromIntent",
      reason: "active_mesocycle_state_active_deload",
    });
  });
});
