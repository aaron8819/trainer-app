import { beforeEach, describe, expect, it, vi } from "vitest";

const loadWorkoutContextMock = vi.fn();
const mapProfileMock = vi.fn();
const mapGoalsMock = vi.fn();
const mapConstraintsMock = vi.fn();
const mapExercisesMock = vi.fn();
const mapHistoryMock = vi.fn();
const mapPreferencesMock = vi.fn();
const mapCheckInMock = vi.fn();
const loadExerciseExposureMock = vi.fn();
const loadActiveMesocycleMock = vi.fn();
const deriveCurrentMesocycleSessionMock = vi.fn();
const getCurrentMesoWeekMock = vi.fn();
const getRirTargetMock = vi.fn();
const getWeeklyVolumeTargetMock = vi.fn();
const buildLifecyclePeriodizationMock = vi.fn();
const shouldDeloadMock = vi.fn();
const mesocycleRoleFindManyMock = vi.fn();
const loadGenerationPhaseBlockContextMock = vi.fn();

vi.mock("@/lib/api/workout-context", () => ({
  loadWorkoutContext: (...args: unknown[]) => loadWorkoutContextMock(...args),
  mapProfile: (...args: unknown[]) => mapProfileMock(...args),
  mapGoals: (...args: unknown[]) => mapGoalsMock(...args),
  mapConstraints: (...args: unknown[]) => mapConstraintsMock(...args),
  mapExercises: (...args: unknown[]) => mapExercisesMock(...args),
  mapHistory: (...args: unknown[]) => mapHistoryMock(...args),
  mapPreferences: (...args: unknown[]) => mapPreferencesMock(...args),
  mapCheckIn: (...args: unknown[]) => mapCheckInMock(...args),
}));

vi.mock("@/lib/api/exercise-exposure", () => ({
  loadExerciseExposure: (...args: unknown[]) => loadExerciseExposureMock(...args),
}));

vi.mock("@/lib/engine/progression", () => ({
  shouldDeload: (...args: unknown[]) => shouldDeloadMock(...args),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    mesocycleExerciseRole: {
      findMany: (...args: unknown[]) => mesocycleRoleFindManyMock(...args),
    },
  },
}));

vi.mock("@/lib/api/generation-phase-block-context", () => ({
  loadGenerationPhaseBlockContext: (...args: unknown[]) => loadGenerationPhaseBlockContextMock(...args),
  resolveGenerationPhaseBlockContext: (...args: unknown[]) => loadGenerationPhaseBlockContextMock(...args),
}));

vi.mock("@/lib/api/mesocycle-lifecycle", () => ({
  loadActiveMesocycle: (...args: unknown[]) => loadActiveMesocycleMock(...args),
  deriveCurrentMesocycleSession: (...args: unknown[]) => deriveCurrentMesocycleSessionMock(...args),
  getCurrentMesoWeek: (...args: unknown[]) => getCurrentMesoWeekMock(...args),
  getRirTarget: (...args: unknown[]) => getRirTargetMock(...args),
  getWeeklyVolumeTarget: (...args: unknown[]) => getWeeklyVolumeTargetMock(...args),
  buildLifecyclePeriodization: (...args: unknown[]) => buildLifecyclePeriodizationMock(...args),
}));

import { loadMappedGenerationContext } from "./context-loader";

describe("template-session context-loader mismatch policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    loadWorkoutContextMock.mockResolvedValue({
      profile: { id: "profile-1" },
      goals: { primaryGoal: "HYPERTROPHY", secondaryGoal: "NONE" },
      constraints: { daysPerWeek: 4, splitType: "PPL", weeklySchedule: ["PUSH", "PULL", "LEGS"] },
      injuries: [],
      exercises: [{ id: "bench" }],
      workouts: [
        {
          id: "workout-1",
          sessionIntent: "PUSH",
          exercises: [
            {
              exerciseId: "bench",
              section: "ACCESSORY",
            },
          ],
        },
      ],
      preferences: null,
      checkIns: [],
    });
    mapProfileMock.mockReturnValue({ id: "user-1" });
    mapGoalsMock.mockReturnValue({ primary: "hypertrophy" });
    mapConstraintsMock.mockReturnValue({ daysPerWeek: 4, splitType: "ppl", weeklySchedule: ["push", "pull", "legs"] });
    mapExercisesMock.mockReturnValue([{ id: "bench", isMainLiftEligible: true }]);
    mapHistoryMock.mockReturnValue([
      {
        date: "2026-03-01T00:00:00.000Z",
        completed: true,
        status: "COMPLETED",
        selectionMode: "INTENT",
        sessionIntent: "push",
        exercises: [{ exerciseId: "bench", sets: [] }],
      },
    ]);
    mapPreferencesMock.mockReturnValue(undefined);
    mapCheckInMock.mockReturnValue(undefined);
    loadExerciseExposureMock.mockResolvedValue(new Map());
    loadActiveMesocycleMock.mockResolvedValue({
      id: "meso-1",
      state: "ACTIVE_ACCUMULATION",
      durationWeeks: 5,
      accumulationSessionsCompleted: 3,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 3,
    });
    mesocycleRoleFindManyMock.mockResolvedValue([
      { exerciseId: "bench", role: "CORE_COMPOUND", sessionIntent: "PUSH" },
    ]);
    deriveCurrentMesocycleSessionMock.mockReturnValue({
      week: 2,
      session: 1,
      phase: "ACCUMULATION",
    });
    getCurrentMesoWeekMock.mockReturnValue(2);
    getRirTargetMock.mockReturnValue({ min: 2, max: 3 });
    getWeeklyVolumeTargetMock.mockImplementation(() => 12);
    buildLifecyclePeriodizationMock.mockReturnValue({
      isDeload: false,
      weekInBlock: 2,
      setMultiplier: 1,
      backOffMultiplier: 1,
      rpeOffset: 0,
      accumulationWeeks: 4,
      lifecycleRirTarget: { min: 2, max: 3 },
      lifecycleSetTargets: { main: 4, accessory: 3 },
    });
    loadGenerationPhaseBlockContextMock.mockResolvedValue({
      blockContext: {
        block: {
          id: "block-1",
          mesocycleId: "meso-1",
          blockNumber: 1,
          blockType: "accumulation",
          startWeek: 0,
          durationWeeks: 2,
          volumeTarget: "high",
          intensityBias: "hypertrophy",
          adaptationType: "myofibrillar_hypertrophy",
        },
        weekInBlock: 2,
        weekInMeso: 2,
        weekInMacro: 2,
        mesocycle: {
          id: "meso-1",
          macroCycleId: "macro-1",
          mesoNumber: 1,
          startWeek: 0,
          durationWeeks: 5,
          focus: "Hypertrophy",
          volumeTarget: "high",
          intensityBias: "hypertrophy",
          blocks: [],
        },
        macroCycle: {
          id: "macro-1",
          userId: "user-1",
          startDate: new Date("2026-03-01T00:00:00.000Z"),
          endDate: new Date("2026-04-05T00:00:00.000Z"),
          durationWeeks: 5,
          trainingAge: "intermediate",
          primaryGoal: "hypertrophy",
          mesocycles: [],
        },
      },
      profile: {
        blockType: "accumulation",
        weekInBlock: 2,
        blockDurationWeeks: 2,
        isDeload: false,
      },
      cycleContext: {
        weekInMeso: 2,
        weekInBlock: 2,
        mesocycleLength: 5,
        phase: "accumulation",
        blockType: "accumulation",
        isDeload: false,
        source: "computed",
      },
      weekInMeso: 2,
      weekInBlock: 2,
      mesocycleLength: 5,
    });
    shouldDeloadMock.mockReturnValue(false);
  });

  it("warns on historical section/role mismatches without normalizing the receipt section", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      const result = await loadMappedGenerationContext("user-1");

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Section/role mismatch detected: workout=workout-1")
      );
      expect(result.rawWorkouts[0]?.exercises[0]?.section).toBe("ACCESSORY");
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("keeps planning aligned to the mesocycle role registry instead of stale historical sections", async () => {
    const result = await loadMappedGenerationContext("user-1");

    expect(result.mesocycleRoleMapByIntent.push.get("bench")).toBe("CORE_COMPOUND");
    expect(result.rawWorkouts[0]?.exercises[0]?.section).toBe("ACCESSORY");
  });

  it("loads real phase/block context into generation instead of dropping block context to null", async () => {
    const result = await loadMappedGenerationContext("user-1");

    expect(loadGenerationPhaseBlockContextMock).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        weekInMeso: 2,
        forceAccumulation: false,
      })
    );
    expect(result.phaseBlockContext).toEqual(
      expect.objectContaining({
        weekInMeso: 2,
        weekInBlock: 2,
        profile: expect.objectContaining({
          blockType: "accumulation",
          weekInBlock: 2,
        }),
      })
    );
    expect(result.blockContext).toEqual(
      expect.objectContaining({
        weekInBlock: 2,
        block: expect.objectContaining({ blockType: "accumulation" }),
      })
    );
    expect(getRirTargetMock).toHaveBeenCalledWith(
      expect.any(Object),
      2,
      expect.objectContaining({
        blockType: "accumulation",
        weekInBlock: 2,
      })
    );
    expect(buildLifecyclePeriodizationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        phaseBlockContext: expect.objectContaining({
          blockType: "accumulation",
          weekInBlock: 2,
        }),
      })
    );
    expect(getWeeklyVolumeTargetMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(String),
      2,
      expect.objectContaining({
        blockContext: expect.objectContaining({
          weekInBlock: 2,
          block: expect.objectContaining({ blockType: "accumulation" }),
        }),
      })
    );
  });

  it("forces accumulation semantics for anchored optional gap-fill after lifecycle advances to deload", async () => {
    loadActiveMesocycleMock.mockResolvedValueOnce({
      id: "meso-1",
      state: "ACTIVE_DELOAD",
      durationWeeks: 5,
      accumulationSessionsCompleted: 12,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 3,
    });
    loadGenerationPhaseBlockContextMock.mockResolvedValueOnce({
      blockContext: {
        block: {
          id: "block-2",
          mesocycleId: "meso-1",
          blockNumber: 2,
          blockType: "intensification",
          startWeek: 2,
          durationWeeks: 2,
          volumeTarget: "moderate",
          intensityBias: "hypertrophy",
          adaptationType: "myofibrillar_hypertrophy",
        },
        weekInBlock: 2,
        weekInMeso: 4,
        weekInMacro: 4,
        mesocycle: {
          id: "meso-1",
          macroCycleId: "macro-1",
          mesoNumber: 1,
          startWeek: 0,
          durationWeeks: 5,
          focus: "Hypertrophy",
          volumeTarget: "high",
          intensityBias: "hypertrophy",
          blocks: [],
        },
        macroCycle: {
          id: "macro-1",
          userId: "user-1",
          startDate: new Date("2026-03-01T00:00:00.000Z"),
          endDate: new Date("2026-04-05T00:00:00.000Z"),
          durationWeeks: 5,
          trainingAge: "intermediate",
          primaryGoal: "hypertrophy",
          mesocycles: [],
        },
      },
      profile: {
        blockType: "intensification",
        weekInBlock: 2,
        blockDurationWeeks: 2,
        isDeload: false,
      },
      cycleContext: {
        weekInMeso: 4,
        weekInBlock: 2,
        mesocycleLength: 5,
        phase: "intensification",
        blockType: "intensification",
        isDeload: false,
        source: "computed",
      },
      weekInMeso: 4,
      weekInBlock: 2,
      mesocycleLength: 5,
    });
    getRirTargetMock.mockReturnValueOnce({ min: 0, max: 1 });
    buildLifecyclePeriodizationMock.mockReturnValueOnce({
      isDeload: false,
      weekInBlock: 2,
      setMultiplier: 1.3,
      backOffMultiplier: 1,
      rpeOffset: 0,
      accumulationWeeks: 4,
      lifecycleRirTarget: { min: 0, max: 1 },
      lifecycleSetTargets: { main: 5, accessory: 5 },
    });

    const result = await loadMappedGenerationContext("user-1", {
      anchorWeek: 4,
      forceAccumulation: true,
    });

    expect(getRirTargetMock).toHaveBeenCalledWith(
      expect.objectContaining({ state: "ACTIVE_ACCUMULATION" }),
      4,
      expect.objectContaining({
        blockType: "intensification",
        weekInBlock: 2,
      })
    );
    expect(buildLifecyclePeriodizationMock).toHaveBeenCalledWith(
      expect.objectContaining({ week: 4, isDeload: false })
    );
    expect(result.lifecycleWeek).toBe(4);
    expect(result.cycleContext).toEqual(
      expect.objectContaining({
        weekInMeso: 4,
        weekInBlock: 2,
        phase: "intensification",
        blockType: "intensification",
        isDeload: false,
      })
    );
    expect(result.deloadDecision.mode).toBe("none");
  });
});
