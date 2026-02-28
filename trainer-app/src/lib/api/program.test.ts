import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Hoisted mocks ─────────────────────────────────────────────────────────────
// Must be defined before any imports that touch @/lib/db/prisma or ./mesocycle-lifecycle.
const mocks = vi.hoisted(() => {
  const mesocycleFindFirst = vi.fn();
  const constraintsFindUnique = vi.fn();
  const userIntegrationFindFirst = vi.fn();
  const workoutFindMany = vi.fn();
  const workoutFindFirst = vi.fn();
  const getCurrentMesoWeekFn = vi.fn(() => 1);
  return {
    mesocycleFindFirst,
    constraintsFindUnique,
    userIntegrationFindFirst,
    workoutFindMany,
    workoutFindFirst,
    getCurrentMesoWeekFn,
    prisma: {
      mesocycle: { findFirst: mesocycleFindFirst },
      constraints: { findUnique: constraintsFindUnique },
      userIntegration: { findFirst: userIntegrationFindFirst },
      workout: { findMany: workoutFindMany, findFirst: workoutFindFirst },
    },
  };
});

vi.mock("@/lib/db/prisma", () => ({ prisma: mocks.prisma }));
// Partial mock: stub getCurrentMesoWeek so tests control week derivation,
// but let getRirTarget run from real source so rirTarget tests exercise real logic.
vi.mock("./mesocycle-lifecycle", async (importOriginal) => {
  const original = await importOriginal<typeof import("./mesocycle-lifecycle")>();
  return { ...original, getCurrentMesoWeek: mocks.getCurrentMesoWeekFn };
});

import { computeMesoWeekStart, loadProgramDashboardData } from "./program";

// ─── Shared test fixtures ──────────────────────────────────────────────────────

const BASE_MESO = {
  id: "meso-1",
  mesoNumber: 1,
  focus: "Hypertrophy",
  durationWeeks: 5,
  completedSessions: 0,
  accumulationSessionsCompleted: 0,
  sessionsPerWeek: 3,
  volumeTarget: "MODERATE",
  startWeek: 0,
  state: "ACTIVE_ACCUMULATION" as "ACTIVE_ACCUMULATION" | "ACTIVE_DELOAD" | "COMPLETED",
  rirBandConfig: {
    weekBands: {
      week1: { min: 3, max: 4 },
      week2: { min: 2, max: 3 },
      week3: { min: 2, max: 3 },
      week4: { min: 1, max: 2 },
      week5Deload: { min: 4, max: 6 },
    },
  },
  blocks: [],
  macroCycle: { startDate: new Date("2026-01-01T00:00:00.000Z") },
};

function setupDefaultMocks(
  mesoOverrides: Partial<typeof BASE_MESO> | null = {},
  week = 1
) {
  mocks.userIntegrationFindFirst.mockResolvedValue(null);
  const mesoRecord = mesoOverrides === null ? null : { ...BASE_MESO, ...mesoOverrides };
  mocks.mesocycleFindFirst.mockResolvedValue(mesoRecord);
  mocks.constraintsFindUnique.mockResolvedValue({ daysPerWeek: 3, weeklySchedule: [] });
  mocks.getCurrentMesoWeekFn.mockReturnValue(week);
  // Default: no workouts for all findMany calls (incompleteWorkouts, loadMesoWeekMuscleVolume, recentWorkouts)
  mocks.workoutFindMany.mockResolvedValue([]);
  // Default: no workout for findFirst (lastSessionSkipped query)
  mocks.workoutFindFirst.mockResolvedValue(null);
}

// ─── computeMesoWeekStart (existing tests) ─────────────────────────────────────

describe("computeMesoWeekStart", () => {
  it("returns the meso start date itself for week 1", () => {
    // Meso starts on a Wednesday (2026-02-18)
    const mesoStart = new Date("2026-02-18T00:00:00.000Z");
    const result = computeMesoWeekStart(mesoStart, 1);
    expect(result.toISOString().slice(0, 10)).toBe("2026-02-18");
  });

  it("advances by 7 days per week", () => {
    const mesoStart = new Date("2026-02-18T00:00:00.000Z");
    const week2Start = computeMesoWeekStart(mesoStart, 2);
    expect(week2Start.toISOString().slice(0, 10)).toBe("2026-02-25");
    const week3Start = computeMesoWeekStart(mesoStart, 3);
    expect(week3Start.toISOString().slice(0, 10)).toBe("2026-03-04");
  });

  it("includes a Sunday workout that falls in the prior ISO calendar week", () => {
    // Meso starts on Wednesday 2026-02-18.
    // ISO week 1 = Mon 2026-02-16 → Sun 2026-02-22.
    // ISO week 2 = Mon 2026-02-23 → ...
    // A workout on Sunday 2026-02-22 belongs to ISO week 1 (prior ISO week),
    // but the meso week started Wednesday 2026-02-18, so it should be included.
    const mesoStart = new Date("2026-02-18T00:00:00.000Z");
    const mesoWeek1Start = computeMesoWeekStart(mesoStart, 1);

    const sundayWorkout = new Date("2026-02-22T00:00:00.000Z"); // Sunday — prior ISO week

    // The meso-week boundary correctly includes Sunday 2026-02-22
    expect(sundayWorkout >= mesoWeek1Start).toBe(true);

    // An ISO-Monday boundary (Feb 23) would incorrectly EXCLUDE the Sunday workout
    const isoMondayNext = new Date("2026-02-23T00:00:00.000Z");
    expect(sundayWorkout >= isoMondayNext).toBe(false);

    // The day before the meso start (Tuesday 2026-02-17) is NOT included
    const dayBeforeMeso = new Date("2026-02-17T00:00:00.000Z");
    expect(dayBeforeMeso >= mesoWeek1Start).toBe(false);
  });
});

// ─── loadProgramDashboardData ──────────────────────────────────────────────────

describe("loadProgramDashboardData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── rirTarget (existing tests) ────────────────────────────────────────────────

  describe("rirTarget — matches getRirTarget canonical values", () => {
    it("returns { min: 3, max: 4 } for week 1 (ACTIVE_ACCUMULATION)", async () => {
      setupDefaultMocks({}, 1);
      const result = await loadProgramDashboardData("user-1");
      // Cross-referenced against mesocycle-lifecycle.test.ts: week1 band
      expect(result.rirTarget).toEqual({ min: 3, max: 4 });
    });

    it("returns { min: 2, max: 3 } for week 2", async () => {
      setupDefaultMocks({}, 2);
      const result = await loadProgramDashboardData("user-1");
      expect(result.rirTarget).toEqual({ min: 2, max: 3 });
    });

    it("returns { min: 2, max: 3 } for week 3", async () => {
      setupDefaultMocks({}, 3);
      const result = await loadProgramDashboardData("user-1");
      expect(result.rirTarget).toEqual({ min: 2, max: 3 });
    });

    it("returns { min: 1, max: 2 } for week 4", async () => {
      setupDefaultMocks({}, 4);
      const result = await loadProgramDashboardData("user-1");
      expect(result.rirTarget).toEqual({ min: 1, max: 2 });
    });

    it("returns { min: 4, max: 6 } for deload (ACTIVE_DELOAD state)", async () => {
      setupDefaultMocks({ state: "ACTIVE_DELOAD" }, 5);
      const result = await loadProgramDashboardData("user-1");
      // Cross-referenced against mesocycle-lifecycle.test.ts: week5Deload band
      expect(result.rirTarget).toEqual({ min: 4, max: 6 });
    });

    it("returns null rirTarget when no active mesocycle exists", async () => {
      setupDefaultMocks(null);
      const result = await loadProgramDashboardData("user-1");
      expect(result.rirTarget).toBeNull();
    });
  });

  // ── volumeThisWeek filtering ──────────────────────────────────────────────────

  describe("volumeThisWeek — filtering", () => {
    it("excludes Front Delts when mev=0 and directSets=0", async () => {
      // No workouts → Front Delts directSets=0, MEV=0 → filtered out
      setupDefaultMocks();
      const result = await loadProgramDashboardData("user-1");
      const muscleNames = result.volumeThisWeek.map((r) => r.muscle);
      expect(muscleNames).not.toContain("Front Delts");
    });

    it("includes Front Delts when directSets > 0 (sets logged even with mev=0)", async () => {
      setupDefaultMocks();
      // Return a workout with Front Delts as PRIMARY muscle, 1 completed set
      const volumeWorkout = {
        id: "w1",
        exercises: [
          {
            exercise: {
              exerciseMuscles: [{ role: "PRIMARY", muscle: { name: "Front Delts" } }],
            },
            sets: [{ logs: [{ wasSkipped: false }] }],
          },
        ],
      };
      // Call order: #1=incompleteWorkouts, #2=loadMesoWeekMuscleVolume, #3=recentWorkouts
      mocks.workoutFindMany.mockResolvedValueOnce([]); // incompleteWorkouts — no incomplete workouts
      mocks.workoutFindMany.mockResolvedValueOnce([volumeWorkout]); // loadMesoWeekMuscleVolume
      // #3 recentWorkouts falls through to default []

      const result = await loadProgramDashboardData("user-1");
      const muscleNames = result.volumeThisWeek.map((r) => r.muscle);
      expect(muscleNames).toContain("Front Delts");
    });

    it("includes Biceps, Triceps, and Calves when mev > 0 (even with no sets logged)", async () => {
      // These muscles have mev > 0, so they appear even with 0 directSets
      setupDefaultMocks();
      const result = await loadProgramDashboardData("user-1");
      const muscleNames = result.volumeThisWeek.map((r) => r.muscle);
      expect(muscleNames).toContain("Biceps");
      expect(muscleNames).toContain("Triceps");
      expect(muscleNames).toContain("Calves");
    });
  });

  // ── volumeThisWeek sort order ─────────────────────────────────────────────────

  describe("volumeThisWeek — sort order (most lagging first)", () => {
    it("places muscle with lower sets/target ratio before muscle with higher ratio", async () => {
      setupDefaultMocks({}, 1);
      // Week 1: Biceps target = mev = 8, Chest target = mev = 10
      // Give Biceps 4 completed sets → ratio 4/8 = 0.5
      // Chest gets 0 sets → ratio 0/10 = 0 (most lagging → should appear first)
      const volumeWorkout = {
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
      };
      // Call order: #1=incompleteWorkouts, #2=loadMesoWeekMuscleVolume, #3=recentWorkouts
      mocks.workoutFindMany.mockResolvedValueOnce([]); // incompleteWorkouts
      mocks.workoutFindMany.mockResolvedValueOnce([volumeWorkout]); // loadMesoWeekMuscleVolume
      // #3 recentWorkouts falls through to default []

      const result = await loadProgramDashboardData("user-1");
      const chestIndex = result.volumeThisWeek.findIndex((r) => r.muscle === "Chest");
      const bicepsIndex = result.volumeThisWeek.findIndex((r) => r.muscle === "Biceps");

      // Chest (ratio=0) should come before Biceps (ratio=0.5)
      expect(chestIndex).not.toBe(-1);
      expect(bicepsIndex).not.toBe(-1);
      expect(chestIndex).toBeLessThan(bicepsIndex);
    });

    it("returns all rows in non-decreasing sets/target ratio order", async () => {
      setupDefaultMocks();
      const result = await loadProgramDashboardData("user-1");
      const rows = result.volumeThisWeek;
      for (let i = 1; i < rows.length; i++) {
        const prevRatio = rows[i - 1]!.target === 0 ? 0 : rows[i - 1]!.directSets / rows[i - 1]!.target;
        const currRatio = rows[i]!.target === 0 ? 0 : rows[i]!.directSets / rows[i]!.target;
        expect(currRatio).toBeGreaterThanOrEqual(prevRatio);
      }
    });
  });

  // ── N1/N2: nextSession — existing incomplete workout takes precedence ──────────

  describe("nextSession — N1/N2: existing incomplete workout takes precedence over rotation", () => {
    it("isExisting=true when a PLANNED workout exists, regardless of rotation", async () => {
      setupDefaultMocks();
      mocks.constraintsFindUnique.mockResolvedValue({
        daysPerWeek: 3,
        weeklySchedule: ["PUSH", "PULL", "LEGS"],
      });
      const plannedWorkout = {
        id: "w-planned",
        status: "PLANNED",
        sessionIntent: "LEGS",
        scheduledDate: new Date("2026-03-01"),
      };
      // Call #1 (incompleteWorkouts) returns the planned workout
      mocks.workoutFindMany.mockResolvedValueOnce([plannedWorkout]);
      // Call #2 (loadMesoWeekMuscleVolume) and #3 (recentWorkouts) return []

      const result = await loadProgramDashboardData("user-1");

      expect(result.nextSession.isExisting).toBe(true);
      expect(result.nextSession.workoutId).toBe("w-planned");
      expect(result.nextSession.intent).toBe("legs");
      // Backward-compat alias should also be "legs"
      expect(result.nextSessionIntent).toBe("legs");
    });

    it("isExisting=false falls back to rotation when no incomplete workout exists", async () => {
      setupDefaultMocks();
      mocks.constraintsFindUnique.mockResolvedValue({
        daysPerWeek: 3,
        weeklySchedule: ["PUSH", "PULL", "LEGS"],
      });
      // completedSessions=0 → rotation index 0 → "push"
      // incompleteWorkouts returns [] (no incomplete workout)

      const result = await loadProgramDashboardData("user-1");

      expect(result.nextSession.isExisting).toBe(false);
      expect(result.nextSession.workoutId).toBeNull();
      expect(result.nextSession.intent).toBe("push");
    });
  });

  // ── N3: latestIncomplete — priority sort ──────────────────────────────────────

  describe("latestIncomplete — N3: IN_PROGRESS takes priority over future-dated PLANNED", () => {
    it("returns the IN_PROGRESS workout over a future-dated PLANNED workout", async () => {
      setupDefaultMocks();
      const inProgressWorkout = {
        id: "w-inprogress",
        status: "IN_PROGRESS",
        sessionIntent: "PUSH",
        scheduledDate: new Date("2026-02-01"),
      };
      // PLANNED workout is dated far in the future
      const plannedWorkout = {
        id: "w-planned",
        status: "PLANNED",
        sessionIntent: "PULL",
        scheduledDate: new Date("2026-12-31"),
      };
      // incompleteWorkouts returns both; Prisma already sorts by scheduledDate asc,
      // but our app-level sort should promote IN_PROGRESS above PLANNED regardless of date.
      mocks.workoutFindMany.mockResolvedValueOnce([plannedWorkout, inProgressWorkout]);

      const result = await loadProgramDashboardData("user-1");

      // latestIncomplete should be the IN_PROGRESS workout (status priority wins over date)
      expect(result.latestIncomplete?.id).toBe("w-inprogress");
      expect(result.latestIncomplete?.status).toBe("in_progress");
      // nextSession should also reflect the IN_PROGRESS workout
      expect(result.nextSession.workoutId).toBe("w-inprogress");
      expect(result.nextSession.intent).toBe("push");
    });

    it("uses status priority: IN_PROGRESS before PLANNED", async () => {
      setupDefaultMocks();
      const inProgress = {
        id: "w-ip",
        status: "IN_PROGRESS",
        sessionIntent: "PUSH",
        scheduledDate: new Date("2026-02-20"),
      };
      const planned = {
        id: "w-pl",
        status: "PLANNED",
        sessionIntent: "PULL",
        scheduledDate: new Date("2026-02-10"), // earlier date, but lower priority
      };
      // PLANNED comes first in DB result (earlier date), but IN_PROGRESS should win
      mocks.workoutFindMany.mockResolvedValueOnce([planned, inProgress]);

      const result = await loadProgramDashboardData("user-1");

      expect(result.nextSession.workoutId).toBe("w-ip");
      expect(result.nextSession.isExisting).toBe(true);
    });

    it("returns null latestIncomplete when no incomplete workouts exist", async () => {
      setupDefaultMocks();
      // workoutFindMany default is [] — no incomplete workouts

      const result = await loadProgramDashboardData("user-1");

      expect(result.latestIncomplete).toBeNull();
      expect(result.nextSession.isExisting).toBe(false);
    });
  });

  // ── N4: lastSessionSkipped ────────────────────────────────────────────────────

  describe("lastSessionSkipped — N4: detects stalled rotation intent", () => {
    it("lastSessionSkipped=true when most recent workout for the rotation intent is SKIPPED", async () => {
      setupDefaultMocks();
      mocks.constraintsFindUnique.mockResolvedValue({
        daysPerWeek: 3,
        weeklySchedule: ["PUSH", "PULL", "LEGS"],
      });
      // completedSessions=0 → next rotation intent = "push"
      // No incomplete workout (incompleteWorkouts returns [])
      // findFirst for lastSessionSkipped: most recent PUSH = SKIPPED
      mocks.workoutFindFirst.mockResolvedValue({ status: "SKIPPED" });

      const result = await loadProgramDashboardData("user-1");

      expect(result.nextSession.isExisting).toBe(false);
      expect(result.nextSession.intent).toBe("push");
      expect(result.lastSessionSkipped).toBe(true);
    });

    it("lastSessionSkipped=false when most recent workout for the rotation intent is COMPLETED", async () => {
      setupDefaultMocks();
      mocks.constraintsFindUnique.mockResolvedValue({
        daysPerWeek: 3,
        weeklySchedule: ["PUSH", "PULL", "LEGS"],
      });
      // Most recent PUSH = COMPLETED
      mocks.workoutFindFirst.mockResolvedValue({ status: "COMPLETED" });

      const result = await loadProgramDashboardData("user-1");

      expect(result.lastSessionSkipped).toBe(false);
    });

    it("lastSessionSkipped=false when nextSession.isExisting=true (not checked for existing workouts)", async () => {
      setupDefaultMocks();
      mocks.constraintsFindUnique.mockResolvedValue({
        daysPerWeek: 3,
        weeklySchedule: ["PUSH", "PULL", "LEGS"],
      });
      const plannedWorkout = {
        id: "w-pl",
        status: "PLANNED",
        sessionIntent: "LEGS",
        scheduledDate: new Date("2026-03-01"),
      };
      mocks.workoutFindMany.mockResolvedValueOnce([plannedWorkout]);
      // workoutFindFirst should NOT be called when isExisting=true
      // (lastSessionSkipped check is skipped)

      const result = await loadProgramDashboardData("user-1");

      expect(result.nextSession.isExisting).toBe(true);
      expect(result.lastSessionSkipped).toBe(false);
      // findFirst should NOT have been called for lastSessionSkipped
      expect(mocks.workoutFindFirst).not.toHaveBeenCalled();
    });

    it("lastSessionSkipped=false when no intent is configured", async () => {
      // weeklySchedule=[] → no intent → lastSessionSkipped should not fire
      setupDefaultMocks();
      // workoutFindFirst should not be called

      const result = await loadProgramDashboardData("user-1");

      expect(result.nextSession.intent).toBeNull();
      expect(result.lastSessionSkipped).toBe(false);
      expect(mocks.workoutFindFirst).not.toHaveBeenCalled();
    });
  });
});
