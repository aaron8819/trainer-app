/**
 * Protects: Status consumption split: performed-signal consumers use COMPLETED + PARTIAL; advancement uses COMPLETED only.
 * Why it matters: Mixing advancement and performed signals causes silent progression and analytics drift.
 */
import { describe, expect, it } from "vitest";
import { WorkoutStatus } from "@prisma/client";
import {
  ADVANCEMENT_WORKOUT_STATUSES,
  PERFORMED_WORKOUT_STATUSES,
  SCHEDULE_RESOLVED_WORKOUT_STATUSES,
  TERMINAL_WORKOUT_STATUSES,
  getWorkoutStatusPolicy,
  isTerminalWorkoutStatus,
} from "./workout-status";

describe("workout-status constants", () => {
  it("defines performed signal statuses as COMPLETED + PARTIAL", () => {
    expect(new Set(PERFORMED_WORKOUT_STATUSES)).toEqual(
      new Set(["COMPLETED", "PARTIAL"]),
    );
  });

  it.each([
    [WorkoutStatus.PLANNED, false, false, false],
    [WorkoutStatus.IN_PROGRESS, false, false, false],
    [WorkoutStatus.PARTIAL, true, false, false],
    [WorkoutStatus.COMPLETED, true, true, true],
    [WorkoutStatus.SKIPPED, false, false, true],
  ])(
    "defines exhaustive policy for %s",
    (status, performed, completed, scheduleResolved) => {
      expect(getWorkoutStatusPolicy(status)).toMatchObject({
        performed,
        completed,
        scheduleResolved,
      });
    },
  );

  it("fails safely for unknown runtime values", () => {
    expect(getWorkoutStatusPolicy("FUTURE_STATUS")).toBeNull();
    expect(getWorkoutStatusPolicy(null)).toBeNull();
    expect(new Set(SCHEDULE_RESOLVED_WORKOUT_STATUSES)).toEqual(
      new Set(["COMPLETED", "SKIPPED"]),
    );
  });

  it("defines advancement statuses as COMPLETED only", () => {
    expect(ADVANCEMENT_WORKOUT_STATUSES).toEqual(["COMPLETED"]);
  });

  it("treats terminal statuses deterministically", () => {
    expect(TERMINAL_WORKOUT_STATUSES).toEqual(["COMPLETED", "PARTIAL", "SKIPPED"]);
    expect(isTerminalWorkoutStatus("PARTIAL")).toBe(true);
    expect(isTerminalWorkoutStatus("PLANNED")).toBe(false);
  });
});
