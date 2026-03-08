import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const mesocycleFindFirst = vi.fn();
  const constraintsFindUnique = vi.fn();
  const userIntegrationFindFirst = vi.fn();
  const workoutFindMany = vi.fn();
  const workoutFindFirst = vi.fn();
  const mesocycleUpdate = vi.fn();
  const getCurrentMesoWeekFn = vi.fn(() => 1);
  const findPendingWeekCloseForUser = vi.fn();

  return {
    mesocycleFindFirst,
    constraintsFindUnique,
    userIntegrationFindFirst,
    workoutFindMany,
    workoutFindFirst,
    mesocycleUpdate,
    getCurrentMesoWeekFn,
    findPendingWeekCloseForUser,
    prisma: {
      mesocycle: { findFirst: mesocycleFindFirst, update: mesocycleUpdate },
      constraints: { findUnique: constraintsFindUnique },
      userIntegration: { findFirst: userIntegrationFindFirst },
      workout: { findMany: workoutFindMany, findFirst: workoutFindFirst },
    },
  };
});

vi.mock("@/lib/db/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("./mesocycle-lifecycle-math", async (importOriginal) => {
  const original = await importOriginal<typeof import("./mesocycle-lifecycle-math")>();
  return { ...original, getCurrentMesoWeek: mocks.getCurrentMesoWeekFn };
});
vi.mock("./mesocycle-week-close", () => ({
  findPendingWeekCloseForUser: (...args: unknown[]) => mocks.findPendingWeekCloseForUser(...args),
}));

import {
  computeMesoWeekStart,
  loadHomeProgramSupport,
  loadProgramDashboardData,
} from "./program";

type BaseMesoRecord = {
  id: string;
  mesoNumber: number;
  focus: string;
  durationWeeks: number;
  completedSessions: number;
  accumulationSessionsCompleted: number;
  deloadSessionsCompleted: number;
  sessionsPerWeek: number;
  volumeTarget: string;
  startWeek: number;
  state: "ACTIVE_ACCUMULATION" | "ACTIVE_DELOAD" | "COMPLETED";
  rirBandConfig: {
    weekBands: {
      week1: { min: number; max: number };
      week2: { min: number; max: number };
      week3: { min: number; max: number };
      week4: { min: number; max: number };
      week5Deload: { min: number; max: number };
    };
  };
  blocks: Array<{ blockType: string; startWeek: number; durationWeeks: number }>;
  macroCycle: { startDate: Date };
};

const BASE_MESO: BaseMesoRecord = {
  id: "meso-1",
  mesoNumber: 1,
  focus: "Hypertrophy",
  durationWeeks: 5,
  completedSessions: 0,
  accumulationSessionsCompleted: 0,
  deloadSessionsCompleted: 0,
  sessionsPerWeek: 3,
  volumeTarget: "MODERATE",
  startWeek: 0,
  state: "ACTIVE_ACCUMULATION" as "ACTIVE_ACCUMULATION" | "ACTIVE_DELOAD" | "COMPLETED",
  rirBandConfig: {
    weekBands: {
      week1: { min: 3, max: 4 },
      week2: { min: 2, max: 3 },
      week3: { min: 1, max: 2 },
      week4: { min: 0, max: 1 },
      week5Deload: { min: 5, max: 6 },
    },
  },
  blocks: [],
  macroCycle: { startDate: new Date("2026-01-01T00:00:00.000Z") },
};

function setupDashboardMocks(
  mesoOverrides: Partial<BaseMesoRecord> | null = {},
  week = 1
) {
  const mesoRecord = mesoOverrides === null ? null : { ...BASE_MESO, ...mesoOverrides };
  mocks.mesocycleFindFirst.mockResolvedValue(mesoRecord);
  mocks.constraintsFindUnique.mockResolvedValue({ daysPerWeek: 3, weeklySchedule: [] });
  mocks.userIntegrationFindFirst.mockResolvedValue(null);
  mocks.workoutFindMany.mockResolvedValue([]);
  mocks.workoutFindFirst.mockResolvedValue(null);
  mocks.getCurrentMesoWeekFn.mockReturnValue(week);
  mocks.findPendingWeekCloseForUser.mockResolvedValue(null);
}

describe("computeMesoWeekStart", () => {
  it("returns the meso start date itself for week 1", () => {
    const mesoStart = new Date("2026-02-18T00:00:00.000Z");
    const result = computeMesoWeekStart(mesoStart, 1);
    expect(result.toISOString().slice(0, 10)).toBe("2026-02-18");
  });

  it("advances by 7 days per week", () => {
    const mesoStart = new Date("2026-02-18T00:00:00.000Z");
    expect(computeMesoWeekStart(mesoStart, 2).toISOString().slice(0, 10)).toBe("2026-02-25");
    expect(computeMesoWeekStart(mesoStart, 3).toISOString().slice(0, 10)).toBe("2026-03-04");
  });
});

describe("loadProgramDashboardData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("rirTarget", () => {
    it("returns the canonical week 1 band", async () => {
      setupDashboardMocks({}, 1);
      const result = await loadProgramDashboardData("user-1");
      expect(result.rirTarget).toEqual({ min: 3, max: 4 });
    });

    it("returns the canonical deload band", async () => {
      setupDashboardMocks({ state: "ACTIVE_DELOAD" }, 5);
      const result = await loadProgramDashboardData("user-1");
      expect(result.rirTarget).toEqual({ min: 5, max: 6 });
    });

    it("returns null when there is no active mesocycle", async () => {
      setupDashboardMocks(null);
      const result = await loadProgramDashboardData("user-1");
      expect(result.rirTarget).toBeNull();
    });
  });

  describe("volumeThisWeek", () => {
    it("counts anchored optional gap-fill volume toward the anchored viewed week after lifecycle advances", async () => {
      setupDashboardMocks(
        {
          state: "ACTIVE_DELOAD",
          accumulationSessionsCompleted: 12,
          deloadSessionsCompleted: 0,
          sessionsPerWeek: 3,
        },
        5
      );
      mocks.workoutFindMany.mockResolvedValueOnce([
        {
          id: "w-gap-fill",
          exercises: [
            {
              exercise: {
                exerciseMuscles: [{ role: "PRIMARY", muscle: { name: "Chest" } }],
              },
              sets: [
                { logs: [{ wasSkipped: false }] },
                { logs: [{ wasSkipped: false }] },
              ],
            },
          ],
        },
      ]);

      const result = await loadProgramDashboardData("user-1", 4);
      const chestRow = result.volumeThisWeek.find((row) => row.muscle === "Chest");

      expect(chestRow?.directSets).toBe(2);
    });

    it("includes Front Delts when baseline target is non-zero even without direct sets", async () => {
      setupDashboardMocks();
      const result = await loadProgramDashboardData("user-1");
      expect(result.volumeThisWeek.map((row) => row.muscle)).toContain("Front Delts");
    });

    it("uses weighted effective sets as the canonical dashboard actual while keeping raw counts contextual", async () => {
      setupDashboardMocks();
      mocks.workoutFindMany.mockResolvedValueOnce([
        {
          id: "w1",
          exercises: [
            {
              exercise: {
                id: "ex-bench",
                name: "Bench Press",
                aliases: [],
                exerciseMuscles: [
                  { role: "PRIMARY", muscle: { name: "Chest" } },
                  { role: "SECONDARY", muscle: { name: "Front Delts" } },
                  { role: "SECONDARY", muscle: { name: "Triceps" } },
                ],
              },
              sets: [
                { logs: [{ wasSkipped: false }] },
                { logs: [{ wasSkipped: false }] },
              ],
            },
          ],
        },
      ]);

      const result = await loadProgramDashboardData("user-1");
      const frontDeltRow = result.volumeThisWeek.find((row) => row.muscle === "Front Delts");

      expect(frontDeltRow).toMatchObject({
        effectiveSets: 0.6,
        directSets: 0,
        indirectSets: 2,
      });
    });

    it("threads a sorted exercise breakdown onto each muscle row without changing the primary total", async () => {
      setupDashboardMocks();
      mocks.workoutFindMany.mockResolvedValueOnce([
        {
          id: "w1",
          exercises: [
            {
              exercise: {
                id: "row",
                name: "Barbell Row",
                aliases: [],
                exerciseMuscles: [
                  { role: "PRIMARY", muscle: { name: "Upper Back" } },
                  { role: "PRIMARY", muscle: { name: "Lats" } },
                  { role: "SECONDARY", muscle: { name: "Biceps" } },
                ],
              },
              sets: Array.from({ length: 3 }, () => ({ logs: [{ wasSkipped: false }] })),
            },
            {
              exercise: {
                id: "pullup",
                name: "Pull-Up",
                aliases: [],
                exerciseMuscles: [
                  { role: "PRIMARY", muscle: { name: "Lats" } },
                  { role: "SECONDARY", muscle: { name: "Biceps" } },
                ],
              },
              sets: Array.from({ length: 2 }, () => ({ logs: [{ wasSkipped: false }] })),
            },
            {
              exercise: {
                id: "curl",
                name: "EZ-Bar Curl",
                aliases: [],
                exerciseMuscles: [{ role: "PRIMARY", muscle: { name: "Biceps" } }],
              },
              sets: Array.from({ length: 2 }, () => ({ logs: [{ wasSkipped: false }] })),
            },
          ],
        },
      ]);

      const result = await loadProgramDashboardData("user-1");
      const bicepsRow = result.volumeThisWeek.find((row) => row.muscle === "Biceps");

      expect(bicepsRow?.effectiveSets).toBe(4.1);
      expect(bicepsRow?.breakdown).toEqual({
        muscle: "Biceps",
        effectiveSets: 4.1,
        targetSets: bicepsRow?.target,
        contributions: [
          {
            exerciseId: "curl",
            exerciseName: "EZ-Bar Curl",
            effectiveSets: 2,
            performedSets: 2,
            directSets: 2,
          },
          {
            exerciseId: "row",
            exerciseName: "Barbell Row",
            effectiveSets: 1.2,
            performedSets: 3,
            indirectSets: 3,
          },
          {
            exerciseId: "pullup",
            exerciseName: "Pull-Up",
            effectiveSets: 0.9,
            performedSets: 2,
            indirectSets: 2,
          },
        ],
      });
    });

    it("keeps Front Delts when direct sets are present", async () => {
      setupDashboardMocks();
      mocks.workoutFindMany.mockResolvedValueOnce([
        {
          id: "w1",
          exercises: [
            {
              exercise: {
                exerciseMuscles: [{ role: "PRIMARY", muscle: { name: "Front Delts" } }],
              },
              sets: [{ logs: [{ wasSkipped: false }] }],
            },
          ],
        },
      ]);

      const result = await loadProgramDashboardData("user-1");
      expect(result.volumeThisWeek.map((row) => row.muscle)).toContain("Front Delts");
    });

    it("sorts muscles by lowest direct-set to target ratio first", async () => {
      setupDashboardMocks({}, 1);
      mocks.workoutFindMany.mockResolvedValueOnce([
        {
          id: "w1",
          exercises: [
            {
              exercise: {
                exerciseMuscles: [{ role: "PRIMARY", muscle: { name: "Biceps" } }],
              },
              sets: [
                { logs: [{ wasSkipped: false }] },
                { logs: [{ wasSkipped: false }] },
                { logs: [{ wasSkipped: false }] },
                { logs: [{ wasSkipped: false }] },
              ],
            },
          ],
        },
      ]);

      const result = await loadProgramDashboardData("user-1");
      const chestIndex = result.volumeThisWeek.findIndex((row) => row.muscle === "Chest");
      const bicepsIndex = result.volumeThisWeek.findIndex((row) => row.muscle === "Biceps");

      expect(chestIndex).toBeGreaterThanOrEqual(0);
      expect(bicepsIndex).toBeGreaterThanOrEqual(0);
      expect(chestIndex).toBeLessThan(bicepsIndex);
    });

    it("scopes performed-volume queries to the requested mesocycle week snapshot with bounded legacy date fallback", async () => {
      setupDashboardMocks(
        {
          durationWeeks: 5,
          sessionsPerWeek: 3,
          startWeek: 0,
          macroCycle: { startDate: new Date("2026-01-01T00:00:00.000Z") },
        },
        2
      );
      mocks.workoutFindMany.mockResolvedValue([]);

      await loadProgramDashboardData("user-1", 1);

      expect(mocks.workoutFindMany).toHaveBeenCalledTimes(2);
      const viewedWhere = mocks.workoutFindMany.mock.calls[0]?.[0]?.where;
      const currentWhere = mocks.workoutFindMany.mock.calls[1]?.[0]?.where;

      expect(viewedWhere?.OR).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ mesocycleWeekSnapshot: 1 }),
          expect.objectContaining({
            mesocycleWeekSnapshot: null,
            scheduledDate: expect.objectContaining({
              gte: expect.any(Date),
              lt: expect.any(Date),
            }),
          }),
        ])
      );
      expect(currentWhere?.OR).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ mesocycleWeekSnapshot: 2 }),
          expect.objectContaining({
            mesocycleWeekSnapshot: null,
            scheduledDate: expect.objectContaining({
              gte: expect.any(Date),
              lt: expect.any(Date),
            }),
          }),
        ])
      );
    });

    it("uses the viewed canonical week bucket (not active week) when loading dashboard volume", async () => {
      setupDashboardMocks(
        {
          durationWeeks: 5,
          sessionsPerWeek: 3,
          startWeek: 0,
          macroCycle: { startDate: new Date("2026-01-01T00:00:00.000Z") },
        },
        4
      );
      mocks.workoutFindMany.mockResolvedValue([]);

      await loadProgramDashboardData("user-1", 3);

      expect(mocks.workoutFindMany).toHaveBeenCalledTimes(2);
      const viewedWhere = mocks.workoutFindMany.mock.calls[0]?.[0]?.where;
      const currentWhere = mocks.workoutFindMany.mock.calls[1]?.[0]?.where;

      expect(viewedWhere?.OR).toEqual(
        expect.arrayContaining([expect.objectContaining({ mesocycleWeekSnapshot: 3 })])
      );
      expect(currentWhere?.OR).toEqual(
        expect.arrayContaining([expect.objectContaining({ mesocycleWeekSnapshot: 4 })])
      );
    });
  });

  it("keeps deloadReadiness anchored to the live current week when viewing history", async () => {
    setupDashboardMocks({ durationWeeks: 5 }, 5);
    mocks.workoutFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "current-week",
          exercises: [
            {
              exercise: {
                exerciseMuscles: [{ role: "PRIMARY", muscle: { name: "Chest" } }],
              },
              sets: Array.from({ length: 17 }, () => ({ logs: [{ wasSkipped: false }] })),
            },
            {
              exercise: {
                exerciseMuscles: [{ role: "PRIMARY", muscle: { name: "Biceps" } }],
              },
              sets: Array.from({ length: 15 }, () => ({ logs: [{ wasSkipped: false }] })),
            },
          ],
        },
      ]);

    const result = await loadProgramDashboardData("user-1", 1);

    expect(result.viewedWeek).toBe(1);
    expect(result.deloadReadiness).toMatchObject({
      shouldDeload: true,
      urgency: "scheduled",
    });
  });

  it("uses weighted effective weekly volume, not primary-only counts, for deload readiness saturation", async () => {
    setupDashboardMocks({ durationWeeks: 5 }, 4);
    mocks.workoutFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "current-week",
          exercises: [
            {
              exercise: {
                id: "ex-bench",
                name: "Bench Press",
                aliases: [],
                exerciseMuscles: [
                  { role: "PRIMARY", muscle: { name: "Chest" } },
                  { role: "SECONDARY", muscle: { name: "Front Delts" } },
                  { role: "SECONDARY", muscle: { name: "Triceps" } },
                ],
              },
              sets: Array.from({ length: 40 }, () => ({ logs: [{ wasSkipped: false }] })),
            },
          ],
        },
      ]);

    const result = await loadProgramDashboardData("user-1", 1);

    expect(result.deloadReadiness).toMatchObject({
      shouldDeload: true,
      urgency: "recommended",
    });
    expect(result.deloadReadiness?.reason).toContain("Front Delts");
    expect(result.deloadReadiness?.reason).toContain("Triceps");
  });

  it("fills missing trailing block coverage with a deload week for timeline continuity", async () => {
    setupDashboardMocks(
      {
        durationWeeks: 5,
        blocks: [{ blockType: "ACCUMULATION", startWeek: 0, durationWeeks: 4 }],
      },
      4
    );

    const result = await loadProgramDashboardData("user-1");

    expect(result.activeMeso?.blocks).toEqual([
      { blockType: "accumulation", startWeek: 1, durationWeeks: 4 },
      { blockType: "deload", startWeek: 5, durationWeeks: 1 },
    ]);
  });

  it("derives coaching cue from viewed week block, not always current week", async () => {
    setupDashboardMocks(
      {
        durationWeeks: 5,
        blocks: [
          { blockType: "ACCUMULATION", startWeek: 0, durationWeeks: 4 },
          { blockType: "DELOAD", startWeek: 4, durationWeeks: 1 },
        ],
      },
      5
    );

    const viewedAccumulation = await loadProgramDashboardData("user-1", 4);
    const viewedDeload = await loadProgramDashboardData("user-1", 5);

    expect(viewedAccumulation.coachingCue).toBe(
      "Accumulation phase - build volume, work within 2-3 RIR."
    );
    expect(viewedDeload.coachingCue).toBe(
      "Deload week - keep loads light, focus on technique and recovery."
    );
  });
});

describe("loadHomeProgramSupport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("prefers an existing incomplete workout over rotation-derived intent", async () => {
    setupDashboardMocks();
    mocks.constraintsFindUnique.mockResolvedValue({
      weeklySchedule: ["PUSH", "PULL", "LEGS"],
    });
    mocks.workoutFindMany.mockResolvedValueOnce([
      {
        id: "w-planned",
        status: "PLANNED",
        sessionIntent: "LEGS",
        scheduledDate: new Date("2026-03-01T00:00:00.000Z"),
      },
    ]);

    const result = await loadHomeProgramSupport("user-1");

    expect(result.nextSession).toEqual({
      intent: "legs",
      workoutId: "w-planned",
      isExisting: true,
    });
    expect(result.latestIncomplete).toEqual({
      id: "w-planned",
      status: "planned",
    });
  });

  it("falls back to rotation when no incomplete workout exists", async () => {
    setupDashboardMocks({ accumulationSessionsCompleted: 7, sessionsPerWeek: 3 }, 3);
    mocks.constraintsFindUnique.mockResolvedValue({
      weeklySchedule: ["PUSH", "PULL", "LEGS"],
    });
    mocks.workoutFindMany.mockResolvedValueOnce([]);

    const result = await loadHomeProgramSupport("user-1");

    expect(result.nextSession).toEqual({
      intent: "pull",
      workoutId: null,
      isExisting: false,
    });
    expect(result.latestIncomplete).toBeNull();
  });

  it("detects when the most recent workout for the rotation intent was skipped", async () => {
    setupDashboardMocks();
    mocks.constraintsFindUnique.mockResolvedValue({
      weeklySchedule: ["PUSH", "PULL", "LEGS"],
    });
    mocks.workoutFindMany.mockResolvedValueOnce([]);
    mocks.workoutFindFirst.mockResolvedValueOnce({ status: "SKIPPED" });

    const result = await loadHomeProgramSupport("user-1");

    expect(result.nextSession.intent).toBe("push");
    expect(result.lastSessionSkipped).toBe(true);
  });

  it("surfaces pending week-close support from the canonical row", async () => {
    setupDashboardMocks(
      {
        state: "ACTIVE_ACCUMULATION",
        sessionsPerWeek: 3,
        accumulationSessionsCompleted: 3,
      },
      2
    );
    mocks.constraintsFindUnique.mockResolvedValue({
      weeklySchedule: ["PUSH", "PULL", "LEGS"],
    });
    mocks.workoutFindMany.mockResolvedValueOnce([
      {
        id: "w-planned",
        status: "PLANNED",
        sessionIntent: "PUSH",
        scheduledDate: new Date("2026-03-08T00:00:00.000Z"),
      },
    ]);
    mocks.findPendingWeekCloseForUser.mockResolvedValueOnce({
      id: "wc-1",
      mesocycleId: "meso-1",
      targetWeek: 1,
      targetPhase: "ACCUMULATION",
      status: "PENDING_OPTIONAL_GAP_FILL",
      deficitSnapshot: {
        version: 1,
        policy: {
          requiredSessionsPerWeek: 3,
          maxOptionalGapFillSessionsPerWeek: 1,
          maxGeneratedHardSets: 12,
          maxGeneratedExercises: 4,
        },
        summary: {
          totalDeficitSets: 6,
          qualifyingMuscleCount: 2,
          topTargetMuscles: ["Chest", "Biceps"],
        },
        muscles: [
          { muscle: "Chest", target: 12, actual: 8, deficit: 4 },
          { muscle: "Biceps", target: 8, actual: 6, deficit: 2 },
        ],
      },
      optionalWorkout: null,
    });

    const result = await loadHomeProgramSupport("user-1");

    expect(result.gapFill.weekCloseId).toBe("wc-1");
    expect(result.gapFill.anchorWeek).toBe(1);
    expect(result.gapFill.targetWeek).toBe(1);
    expect(result.gapFill.targetPhase).toBe("ACCUMULATION");
    expect(result.gapFill.reason).toBeNull();
    expect(result.gapFill.eligible).toBe(true);
    expect(result.gapFill.targetMuscles).toEqual(["Chest", "Biceps"]);
    expect(result.gapFill.linkedWorkout).toBeNull();
  });

  it("keeps prior-week gap-fill available after lifecycle advances into deload while the row remains pending", async () => {
    setupDashboardMocks(
      {
        state: "ACTIVE_DELOAD",
        sessionsPerWeek: 3,
        accumulationSessionsCompleted: 12,
        deloadSessionsCompleted: 0,
      },
      5
    );
    mocks.constraintsFindUnique.mockResolvedValue({
      weeklySchedule: ["PUSH", "PULL", "LEGS"],
    });
    mocks.workoutFindMany.mockResolvedValueOnce([
      {
        id: "w-deload-planned",
        status: "PLANNED",
        sessionIntent: "PUSH",
        scheduledDate: new Date("2026-03-29T00:00:00.000Z"),
      },
    ]);
    mocks.findPendingWeekCloseForUser.mockResolvedValueOnce({
      id: "wc-4",
      mesocycleId: "meso-1",
      targetWeek: 4,
      targetPhase: "ACCUMULATION",
      status: "PENDING_OPTIONAL_GAP_FILL",
      deficitSnapshot: {
        version: 1,
        policy: {
          requiredSessionsPerWeek: 3,
          maxOptionalGapFillSessionsPerWeek: 1,
          maxGeneratedHardSets: 12,
          maxGeneratedExercises: 4,
        },
        summary: {
          totalDeficitSets: 4,
          qualifyingMuscleCount: 1,
          topTargetMuscles: ["Front Delts"],
        },
        muscles: [{ muscle: "Front Delts", target: 5, actual: 1, deficit: 4 }],
      },
      optionalWorkout: null,
    });

    const result = await loadHomeProgramSupport("user-1");

    expect(result.gapFill.anchorWeek).toBe(4);
    expect(result.gapFill.eligible).toBe(true);
    expect(result.gapFill.reason).toBeNull();
    expect(result.gapFill.targetMuscles).toEqual(["Front Delts"]);
  });

  it("surfaces a linked optional workout from the pending row", async () => {
    setupDashboardMocks(
      {
        state: "ACTIVE_DELOAD",
        sessionsPerWeek: 3,
        accumulationSessionsCompleted: 12,
        deloadSessionsCompleted: 0,
      },
      5
    );
    mocks.workoutFindMany.mockResolvedValueOnce([
      {
        id: "w-deload-planned",
        status: "PLANNED",
        sessionIntent: "PUSH",
        scheduledDate: new Date("2026-03-29T00:00:00.000Z"),
      },
    ]);
    mocks.findPendingWeekCloseForUser.mockResolvedValueOnce({
      id: "wc-4",
      mesocycleId: "meso-1",
      targetWeek: 4,
      targetPhase: "ACCUMULATION",
      status: "PENDING_OPTIONAL_GAP_FILL",
      deficitSnapshot: {
        version: 1,
        policy: {
          requiredSessionsPerWeek: 3,
          maxOptionalGapFillSessionsPerWeek: 1,
          maxGeneratedHardSets: 12,
          maxGeneratedExercises: 4,
        },
        summary: {
          totalDeficitSets: 4,
          qualifyingMuscleCount: 1,
          topTargetMuscles: ["Chest"],
        },
        muscles: [{ muscle: "Chest", target: 12, actual: 8, deficit: 4 }],
      },
      optionalWorkout: {
        id: "w-gap-fill",
        status: "PLANNED",
        scheduledDate: new Date("2026-03-25T00:00:00.000Z"),
      },
    });

    const result = await loadHomeProgramSupport("user-1");

    expect(result.gapFill.eligible).toBe(true);
    expect(result.gapFill.linkedWorkout).toEqual({
      id: "w-gap-fill",
      status: "PLANNED",
    });
    expect(result.gapFill.weekCloseId).toBe("wc-4");
  });

  it("returns ineligible support when no pending week-close exists", async () => {
    setupDashboardMocks();
    mocks.constraintsFindUnique.mockResolvedValue({
      weeklySchedule: ["PUSH", "PULL", "LEGS"],
    });
    mocks.workoutFindMany.mockResolvedValueOnce([]);
    mocks.findPendingWeekCloseForUser.mockResolvedValueOnce(null);

    const result = await loadHomeProgramSupport("user-1");

    expect(result.gapFill.eligible).toBe(false);
    expect(result.gapFill.reason).toBe("no_pending_week_close");
    expect(result.gapFill.weekCloseId).toBeNull();
  });
});
