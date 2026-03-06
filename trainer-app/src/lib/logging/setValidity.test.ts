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
});
