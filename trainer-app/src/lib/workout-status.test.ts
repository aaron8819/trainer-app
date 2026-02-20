/**
 * Protects: Status consumption split: performed-signal consumers use COMPLETED + PARTIAL; advancement uses COMPLETED only.
 * Why it matters: Mixing advancement and performed signals causes silent progression and analytics drift.
 */
import { describe, expect, it } from "vitest";
import {
  ADVANCEMENT_WORKOUT_STATUSES,
  PERFORMED_WORKOUT_STATUSES,
  TERMINAL_WORKOUT_STATUSES,
  isTerminalWorkoutStatus,
} from "./workout-status";

describe("workout-status constants", () => {
  it("defines performed signal statuses as COMPLETED + PARTIAL", () => {
    expect(PERFORMED_WORKOUT_STATUSES).toEqual(["COMPLETED", "PARTIAL"]);
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
