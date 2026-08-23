import { describe, expect, it } from "vitest";
import {
  getSetValidity,
  INVALID_SET_REASON_INVALID_LOAD,
  INVALID_SET_REASON_LOAD_ONLY,
  INVALID_SET_REASON_MISSING_PERFORMANCE,
} from "@/lib/logging/setValidity";
import type { MeasurementSemantics } from "@/lib/exercise-measurement/semantics";

const bulgarian: MeasurementSemantics = {
  profile: "REPS_EXTERNAL_LOAD",
  loadConvention: "IMPLEMENT_WEIGHT",
  repBasis: "PER_SIDE",
};
const hackSquat: MeasurementSemantics = {
  profile: "REPS_EXTERNAL_LOAD",
  loadConvention: "MACHINE_DISPLAYED",
  repBasis: "TOTAL",
};
const barbell: MeasurementSemantics = {
  profile: "REPS_EXTERNAL_LOAD",
  loadConvention: "BARBELL_TOTAL",
  repBasis: "TOTAL",
};

describe("getSetValidity", () => {
  it("accepts skipped sets with blank load", () => {
    expect(getSetValidity({ wasSkipped: true })).toEqual({ valid: true });
  });

  it("preserves legacy-null optional-load compatibility", () => {
    expect(getSetValidity({ actualReps: 8 })).toEqual({ valid: true });
    expect(getSetValidity({ actualRpe: 8, actualLoad: 0 })).toEqual({ valid: true });
    expect(getSetValidity({ actualReps: 8, actualLoad: 135 })).toEqual({ valid: true });
    expect(getSetValidity({ actualLoad: 135 })).toEqual({
      valid: false,
      reason: INVALID_SET_REASON_LOAD_ONLY,
    });
    expect(getSetValidity({})).toEqual({
      valid: false,
      reason: INVALID_SET_REASON_MISSING_PERFORMANCE,
    });
  });

  it.each([
    ["negative", -1],
    ["NaN", Number.NaN],
    ["positive infinity", Number.POSITIVE_INFINITY],
    ["negative infinity", Number.NEGATIVE_INFINITY],
  ])("rejects %s loads even when skipped", (_label, actualLoad) => {
    expect(getSetValidity({ actualReps: 8, actualLoad, wasSkipped: true })).toEqual({
      valid: false,
      reason: INVALID_SET_REASON_INVALID_LOAD,
    });
  });

  it.each([
    ["Bulgarian zero", bulgarian, "BODYWEIGHT_NO_ADDED_LOAD" as const],
    ["Hack Squat zero", hackSquat, "MACHINE_DEFAULT_NO_ADDED_LOAD" as const],
  ])("accepts %s with its frozen capability", (_label, measurement, zeroLoadMeaning) => {
    expect(
      getSetValidity({ measurement, zeroLoadMeaning, actualReps: 8, actualLoad: 0 }),
    ).toEqual({ valid: true });
  });

  it.each([
    ["Bulgarian", bulgarian, "BODYWEIGHT_NO_ADDED_LOAD" as const],
    ["Hack Squat", hackSquat, "MACHINE_DEFAULT_NO_ADDED_LOAD" as const],
  ])("rejects blank load for performed %s sets", (_label, measurement, zeroLoadMeaning) => {
    expect(
      getSetValidity({ measurement, zeroLoadMeaning, actualReps: 8 }),
    ).toMatchObject({ valid: false });
  });

  it("rejects zero for normal barbell and ordinary machine profiles", () => {
    expect(getSetValidity({ measurement: barbell, actualReps: 8, actualLoad: 0 }).valid).toBe(false);
    expect(getSetValidity({ measurement: hackSquat, actualReps: 8, actualLoad: 0 }).valid).toBe(false);
  });

  it("accepts zero for bodyweight-plus-load and rejects blank", () => {
    const measurement: MeasurementSemantics = {
      profile: "REPS_BODYWEIGHT_PLUS_LOAD",
      loadConvention: "ADDED_EXTERNAL_LOAD",
      repBasis: "TOTAL",
    };
    expect(getSetValidity({ measurement, actualReps: 8, actualLoad: 0 })).toEqual({ valid: true });
    expect(getSetValidity({ measurement, actualReps: 8 }).valid).toBe(false);
  });

  it("accepts bodyweight-only with null load and rejects supplied load", () => {
    const measurement: MeasurementSemantics = {
      profile: "REPS_BODYWEIGHT",
      repBasis: "TOTAL",
    };
    expect(getSetValidity({ measurement, actualReps: 8 })).toEqual({ valid: true });
    expect(getSetValidity({ measurement, actualReps: 8, actualLoad: 0 }).valid).toBe(false);
  });

  it("preserves positive classified behavior and requires reps", () => {
    expect(getSetValidity({ measurement: barbell, actualReps: 8, actualLoad: 135 })).toEqual({ valid: true });
    expect(getSetValidity({ measurement: barbell, actualRpe: 8, actualLoad: 135 }).valid).toBe(false);
  });
});
