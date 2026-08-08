import { describe, expect, it } from "vitest";
import {
  getSetValidity,
  INVALID_SET_REASON_LOAD_ONLY,
  INVALID_SET_REASON_MISSING_PERFORMANCE,
} from "@/lib/logging/setValidity";

describe("getSetValidity", () => {
  it("accepts skipped sets", () => {
    expect(getSetValidity({ wasSkipped: true })).toEqual({ valid: true });
  });

  it("accepts performed sets with reps", () => {
    expect(getSetValidity({ actualReps: 8, actualLoad: 135 })).toEqual({ valid: true });
  });

  it("accepts performed sets with rpe only", () => {
    expect(getSetValidity({ actualRpe: 8 })).toEqual({ valid: true });
  });

  it("rejects load-only sets", () => {
    expect(getSetValidity({ actualLoad: 135 })).toEqual({
      valid: false,
      reason: INVALID_SET_REASON_LOAD_ONLY,
    });
  });

  it("rejects empty performed sets", () => {
    expect(getSetValidity({})).toEqual({
      valid: false,
      reason: INVALID_SET_REASON_MISSING_PERFORMANCE,
    });
  });

  it("enforces classified rep and load requirements", () => {
    expect(
      getSetValidity({
        measurementProfile: "REPS_EXTERNAL_LOAD",
        actualReps: 8,
        actualLoad: 0,
      }).valid,
    ).toBe(false);
    expect(
      getSetValidity({
        measurementProfile: "REPS_EXTERNAL_LOAD",
        actualReps: 0,
        actualLoad: 135,
      }),
    ).toEqual({ valid: true });
    expect(
      getSetValidity({
        measurementProfile: "REPS_BODYWEIGHT",
        actualReps: 8,
      }),
    ).toEqual({ valid: true });
    expect(
      getSetValidity({
        measurementProfile: "REPS_BODYWEIGHT",
        actualReps: 8,
        actualLoad: 1,
      }).valid,
    ).toBe(false);
    expect(
      getSetValidity({
        measurementProfile: "REPS_ASSISTED",
        actualReps: 8,
        actualLoad: 40,
      }),
    ).toEqual({ valid: true });
    expect(
      getSetValidity({ measurementProfile: "REPS_ASSISTED", actualRpe: 8 }).valid,
    ).toBe(false);
  });
});
