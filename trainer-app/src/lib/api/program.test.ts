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
  computeMesoWeekEnd,
  computeMesoWeekStart,
  loadHomeProgramSupport,
  loadProgramDashboardData,
} from "./program";

const BASE_MESO = {
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
  mesoOverrides: Partial<typeof BASE_MESO> | null = {},
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

describe("computeMesoWeekEnd", () => {
  it("returns an exclusive end date exactly 7 days after week start", () => {
    const weekStart = new Date("2026-02-18T00:00:00.000Z");
    const weekEnd = computeMesoWeekEnd(weekStart);
    expect(weekEnd.toISOString().slice(0, 10)).toBe("2026-02-25");
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

  it("derives currentBlockType from lifecycle week + block config, including deload week", async () => {
    setupDashboardMocks(
      {
        durationWeeks: 5,
        blocks: [
          { blockType: "ACCUMULATION", startWeek: 0, durationWeeks: 4 },
          { blockType: "DELOAD", startWeek: 4, durationWeeks: 1 },
        ],
      },
      4
    );
    const accumulationWeek = await loadProgramDashboardData("user-1");
    expect(accumulationWeek.activeMeso?.currentBlockType).toBe("accumulation");

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
    const deloadWeek = await loadProgramDashboardData("user-1");
    expect(deloadWeek.activeMeso?.currentBlockType).toBe("deload");
  });

  it("derives coaching cue from viewed week block SSOT and differs between accumulation and deload", async () => {
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
    expect(viewedAccumulation.coachingCue).not.toBe(viewedDeload.coachingCue);
  });

  it("uses bounded weekly windows and does not leak later-week workouts into viewed week volume", async () => {
    setupDashboardMocks(
      {
        durationWeeks: 5,
        blocks: [{ blockType: "ACCUMULATION", startWeek: 0, durationWeeks: 5 }],
      },
      4
    );

    const workouts = [
      {
        id: "week3",
        scheduledDate: new Date("2026-01-15T00:00:00.000Z"),
        exercises: [
          {
            exercise: {
              exerciseMuscles: [{ role: "PRIMARY", muscle: { name: "Chest" } }],
            },
            sets: Array.from({ length: 2 }, () => ({ logs: [{ wasSkipped: false }] })),
          },
        ],
      },
      {
        id: "week4",
        scheduledDate: new Date("2026-01-22T00:00:00.000Z"),
        exercises: [
          {
            exercise: {
              exerciseMuscles: [{ role: "PRIMARY", muscle: { name: "Chest" } }],
            },
            sets: Array.from({ length: 5 }, () => ({ logs: [{ wasSkipped: false }] })),
          },
        ],
      },
    ];

    mocks.workoutFindMany.mockImplementation(async (args: { where?: { scheduledDate?: { gte?: Date; lt?: Date } } }) => {
      const gte = args.where?.scheduledDate?.gte?.getTime() ?? Number.NEGATIVE_INFINITY;
      const lt = args.where?.scheduledDate?.lt?.getTime() ?? Number.POSITIVE_INFINITY;
      return workouts.filter(
        (workout) =>
          workout.scheduledDate.getTime() >= gte &&
          workout.scheduledDate.getTime() < lt
      );
    });

    const result = await loadProgramDashboardData("user-1", 3);
    const chest = result.volumeThisWeek.find((row) => row.muscle === "Chest");

    expect(chest?.directSets).toBe(2);
    const firstFindManyCall = mocks.workoutFindMany.mock.calls[0][0];
    expect(firstFindManyCall.where.scheduledDate).toMatchObject({
      gte: new Date("2026-01-15T00:00:00.000Z"),
      lt: new Date("2026-01-22T00:00:00.000Z"),
    });
  });

  it("keeps viewed-week rir/phase/volume derived from viewed week SSOT when lifecycle is already week N+1", async () => {
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
    mocks.workoutFindMany
      .mockResolvedValueOnce([
        {
          id: "week4",
          exercises: [
            {
              exercise: {
                exerciseMuscles: [{ role: "PRIMARY", muscle: { name: "Biceps" } }],
              },
              sets: Array.from({ length: 3 }, () => ({ logs: [{ wasSkipped: false }] })),
            },
          ],
        },
      ])
      .mockResolvedValueOnce([]);

    const result = await loadProgramDashboardData("user-1", 4);

    expect(result.currentWeek).toBe(5);
    expect(result.viewedWeek).toBe(4);
    expect(result.activeMeso?.currentBlockType).toBe("deload");
    expect(result.rirTarget).toEqual({ min: 0, max: 1 });
    expect(result.coachingCue).toBe("Accumulation phase - build volume, work within 2-3 RIR.");
    const biceps = result.volumeThisWeek.find((row) => row.muscle === "Biceps");
    expect(biceps?.directSets).toBe(3);
  });

  it("fills missing trailing block coverage with a deload week for timeline/cue continuity", async () => {
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

  describe("gapFill", () => {
    function setupGapFillScenario(input?: {
      mesoOverrides?: Partial<typeof BASE_MESO>;
      incompleteWorkouts?: Array<Record<string, unknown>>;
      startedIncompleteExists?: boolean;
      nextWeekAdvancingStartedOrPerformed?: boolean;
      capCandidates?: Array<{ selectionMetadata: unknown }>;
      weekWorkouts?: Array<{ scheduledDate: Date; exercises: Array<Record<string, unknown>> }>;
    }) {
      const mesoRecord = { ...BASE_MESO, accumulationSessionsCompleted: 6, sessionsPerWeek: 3, ...(input?.mesoOverrides ?? {}) };
      mocks.mesocycleFindFirst.mockImplementation(async () => mesoRecord);
      mocks.constraintsFindUnique.mockResolvedValue({ weeklySchedule: ["PUSH", "PULL", "LEGS"] });
      mocks.workoutFindMany.mockImplementation(async (args: { where?: Record<string, unknown> }) => {
        const where = args.where ?? {};
        const statusIn = (where.status as { in?: string[] } | undefined)?.in ?? [];
        if (Array.isArray(statusIn) && statusIn.includes("PLANNED") && !("mesocycleId" in where)) {
          return input?.incompleteWorkouts ?? [];
        }
        if (where.selectionMode === "INTENT" && where.sessionIntent === "BODY_PART") {
          return input?.capCandidates ?? [];
        }
        if ("scheduledDate" in where) {
          const window = where.scheduledDate as { gte?: Date; lt?: Date };
          const start = window.gte?.getTime() ?? Number.NEGATIVE_INFINITY;
          const end = window.lt?.getTime() ?? Number.POSITIVE_INFINITY;
          return (input?.weekWorkouts ?? []).filter(
            (workout) => workout.scheduledDate.getTime() >= start && workout.scheduledDate.getTime() < end
          );
        }
        return [];
      });
      mocks.workoutFindFirst.mockImplementation(async (args: { where?: Record<string, unknown> }) => {
        const where = args.where ?? {};
        const statusIn = (where.status as { in?: string[] } | undefined)?.in ?? [];
        if (Array.isArray(statusIn) && statusIn.length === 2 && statusIn.includes("IN_PROGRESS") && statusIn.includes("PARTIAL")) {
          return input?.startedIncompleteExists ? { id: "started-1" } : null;
        }
        if ("mesocycleWeekSnapshot" in where) {
          return input?.nextWeekAdvancingStartedOrPerformed ? { id: "next-week-advancing" } : null;
        }
        return null;
      });
    }

    it("is eligible only at end of required rotation", async () => {
      setupGapFillScenario({
        mesoOverrides: { accumulationSessionsCompleted: 5, sessionsPerWeek: 3 },
      });
      const ineligible = await loadHomeProgramSupport("user-1");
      expect(ineligible.gapFill.eligible).toBe(false);
      expect(ineligible.gapFill.reason).toBe("not_end_of_required_rotation");

      setupGapFillScenario({
        mesoOverrides: { accumulationSessionsCompleted: 6, sessionsPerWeek: 3 },
      });
      const eligible = await loadHomeProgramSupport("user-1");
      expect(eligible.gapFill.anchorWeek).toBe(2);
      expect(eligible.gapFill.reason).not.toBe("not_end_of_required_rotation");
    });

    it("is ineligible during deload", async () => {
      setupGapFillScenario({
        mesoOverrides: { state: "ACTIVE_DELOAD" },
      });
      const result = await loadHomeProgramSupport("user-1");
      expect(result.gapFill.eligible).toBe(false);
      expect(result.gapFill.reason).toBe("in_deload");
    });

    it("is ineligible when any IN_PROGRESS/PARTIAL workout exists", async () => {
      setupGapFillScenario({
        startedIncompleteExists: true,
      });
      const result = await loadHomeProgramSupport("user-1");
      expect(result.gapFill.eligible).toBe(false);
      expect(result.gapFill.reason).toBe("started_incomplete_workout");
    });

    it("is not suppressed by PLANNED next-week advancing workout", async () => {
      setupGapFillScenario({
        incompleteWorkouts: [
          {
            id: "planned-next",
            status: "PLANNED",
            sessionIntent: "PUSH",
            scheduledDate: new Date("2026-01-16T00:00:00.000Z"),
          },
        ],
      });
      const result = await loadHomeProgramSupport("user-1");
      expect(result.gapFill.reason).not.toBe("started_next_week_advancing_workout");
      expect(result.gapFill.suppressedByStartedNextWeek).toBe(false);
    });

    it("is suppressed when next-week advancing workout is started/performed", async () => {
      setupGapFillScenario({
        nextWeekAdvancingStartedOrPerformed: true,
      });
      const result = await loadHomeProgramSupport("user-1");
      expect(result.gapFill.eligible).toBe(false);
      expect(result.gapFill.reason).toBe("started_next_week_advancing_workout");
      expect(result.gapFill.suppressedByStartedNextWeek).toBe(true);
    });

    it("weekly cap counting requires optional_gap_fill receipt marker", async () => {
      setupGapFillScenario({
        capCandidates: [{ selectionMetadata: { sessionDecisionReceipt: { exceptions: [{ code: "other_reason" }] } } }],
      });
      const unmarked = await loadHomeProgramSupport("user-1");
      expect(unmarked.gapFill.reason).not.toBe("already_used_gap_fill");

      setupGapFillScenario({
        capCandidates: [{ selectionMetadata: { sessionDecisionReceipt: { exceptions: [{ code: "optional_gap_fill" }] } } }],
      });
      const marked = await loadHomeProgramSupport("user-1");
      expect(marked.gapFill.eligible).toBe(false);
      expect(marked.gapFill.reason).toBe("already_used_gap_fill");
      expect(marked.gapFill.alreadyUsedThisWeek).toBe(true);
    });

    it("computes deficits from anchorWeek only (no later-week leakage)", async () => {
      setupGapFillScenario({
        weekWorkouts: [
          {
            scheduledDate: new Date("2026-01-09T00:00:00.000Z"),
            exercises: [
              {
                exercise: { exerciseMuscles: [{ role: "PRIMARY", muscle: { name: "Chest" } }] },
                sets: Array.from({ length: 2 }, () => ({ logs: [{ wasSkipped: false }] })),
              },
            ],
          },
          {
            scheduledDate: new Date("2026-01-16T00:00:00.000Z"),
            exercises: [
              {
                exercise: { exerciseMuscles: [{ role: "PRIMARY", muscle: { name: "Chest" } }] },
                sets: Array.from({ length: 99 }, () => ({ logs: [{ wasSkipped: false }] })),
              },
            ],
          },
        ],
      });
      const result = await loadHomeProgramSupport("user-1");
      const chest = result.gapFill.deficitSummary.find((row) => row.muscle === "Chest");
      expect(chest?.actual).toBe(2);
    });

    it("fails closed when week-bounded effective actual cannot be computed", async () => {
      setupGapFillScenario({
        mesoOverrides: { macroCycle: { startDate: null } as unknown as { startDate: Date } },
      });
      const result = await loadHomeProgramSupport("user-1");
      expect(result.gapFill.eligible).toBe(false);
      expect(result.gapFill.reason).toBe("insufficient_week_scoping_data");
    });
  });
});
