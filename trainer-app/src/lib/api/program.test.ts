import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const mesocycleFindFirst = vi.fn();
  const constraintsFindUnique = vi.fn();
  const userIntegrationFindFirst = vi.fn();
  const workoutFindMany = vi.fn();
  const workoutFindFirst = vi.fn();
  const mesocycleUpdate = vi.fn();
  const getCurrentMesoWeekFn = vi.fn(() => 1);

  return {
    mesocycleFindFirst,
    constraintsFindUnique,
    userIntegrationFindFirst,
    workoutFindMany,
    workoutFindFirst,
    mesocycleUpdate,
    getCurrentMesoWeekFn,
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

  it("does not suppress gap-fill when next-week carryover is only PLANNED", async () => {
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

    const result = await loadHomeProgramSupport("user-1");

    expect(result.gapFill.anchorWeek).toBe(1);
    expect(result.gapFill.suppressedByStartedNextWeek).toBe(false);
    expect(result.gapFill.reason).toBeNull();
    expect(result.gapFill.eligible).toBe(true);
    expect(result.gapFill.targetMuscles.length).toBeGreaterThan(0);
  });

  it.each(["IN_PROGRESS", "PARTIAL"] as const)(
    "suppresses gap-fill when next-week carryover is %s",
    async (status) => {
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
          id: "w-started",
          status,
          sessionIntent: "PUSH",
          scheduledDate: new Date("2026-03-08T00:00:00.000Z"),
        },
      ]);

      const result = await loadHomeProgramSupport("user-1");

      expect(result.gapFill.anchorWeek).toBe(1);
      expect(result.gapFill.suppressedByStartedNextWeek).toBe(true);
      expect(result.gapFill.reason).toBe("suppressed_by_started_next_week");
      expect(result.gapFill.eligible).toBe(false);
    }
  );

  it("keeps prior-week gap-fill eligible after lifecycle advances into deload with only a planned next-week carryover", async () => {
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

    const result = await loadHomeProgramSupport("user-1");

    expect(result.gapFill.anchorWeek).toBe(4);
    expect(result.gapFill.eligible).toBe(true);
    expect(result.gapFill.reason).toBeNull();
    expect(result.gapFill.suppressedByStartedNextWeek).toBe(false);
  });

  it("counts anchored strict gap-fill volume toward the anchored week", async () => {
    setupDashboardMocks(
      {
        state: "ACTIVE_DELOAD",
        sessionsPerWeek: 3,
        accumulationSessionsCompleted: 12,
        deloadSessionsCompleted: 0,
      },
      5
    );
    mocks.workoutFindMany
      .mockResolvedValueOnce([
        {
          id: "w-deload-planned",
          status: "PLANNED",
          sessionIntent: "PUSH",
          scheduledDate: new Date("2026-03-29T00:00:00.000Z"),
        },
      ])
      .mockResolvedValueOnce([
        {
          status: "COMPLETED",
          mesocycleWeekSnapshot: 4,
          scheduledDate: new Date("2026-03-25T00:00:00.000Z"),
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
      ])
      .mockResolvedValueOnce([
        {
          selectionMetadata: {
            sessionDecisionReceipt: {
              version: 1,
              cycleContext: {
                weekInMeso: 4,
                weekInBlock: 4,
                phase: "accumulation",
                blockType: "accumulation",
                isDeload: false,
                source: "computed",
              },
              lifecycleVolume: { source: "unknown" },
              sorenessSuppressedMuscles: [],
              deloadDecision: { mode: "none", reason: [], reductionPercent: 0, appliedTo: "none" },
              readiness: {
                wasAutoregulated: false,
                signalAgeHours: null,
                fatigueScoreOverall: null,
                intensityScaling: { applied: false, exerciseIds: [], scaledUpCount: 0, scaledDownCount: 0 },
              },
              exceptions: [{ code: "optional_gap_fill", message: "Marked as optional gap-fill session." }],
            },
          },
          selectionMode: "INTENT",
          sessionIntent: "BODY_PART",
        },
      ]);

    const result = await loadHomeProgramSupport("user-1");

    expect(result.gapFill.alreadyUsedThisWeek).toBe(true);
    expect(result.gapFill.eligible).toBe(false);
    expect(result.gapFill.reason).toBe("weekly_optional_gap_fill_cap_reached");
    expect(result.gapFill.targetMuscles.length).toBeGreaterThan(0);
  });
});
